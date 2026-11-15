import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { chmod, rename, stat, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { YoutubeInfo, YoutubeSource } from '../shared/types'

/**
 * YouTube download with yt-dlp (https://github.com/yt-dlp/yt-dlp).
 *
 * - yt-dlp is downloaded from its GitHub releases the first time it is used,
 *   into the user data folder. YouTube changes often and old versions stop
 *   working, so it updates itself (yt-dlp -U) when it is older than a week.
 * - ffmpeg comes with the app (the ffmpeg-static package). yt-dlp needs it to
 *   join the picture and the sound of a video, and to make MP3 files.
 * - yt-dlp needs a JavaScript program for YouTube. The app itself can run as
 *   Node.js (ELECTRON_RUN_AS_NODE), so nothing more is installed.
 */

const releaseBase = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
const exeName = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
const updateAfterMs = 7 * 24 * 3600 * 1000

function toolsDir(): string {
  const dir = join(app.getPath('userData'), 'tools')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function ytDlpPath(): string {
  return join(toolsDir(), exeName)
}

/** The ffmpeg program that comes with the app, or null if it is missing. */
function ffmpegPath(): string | null {
  try {
    const req = createRequire(__filename)
    const path = (req('ffmpeg-static') as string | null) ?? null
    // In the installed app the program is outside the app.asar archive.
    const real = path?.replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`)
    return real && existsSync(real) ? real : null
  } catch {
    return null
  }
}

let setupPromise: Promise<void> | null = null

/**
 * Make sure yt-dlp is there (download it the first time), and update it when it is old.
 * `onProgress` gets 0..1 while it downloads, and null at the end.
 */
export function ensureYtDlp(onProgress: (fraction: number | null) => void): Promise<void> {
  if (!setupPromise) {
    setupPromise = setup(onProgress).finally(() => {
      onProgress(null)
      setupPromise = null
    })
  }
  return setupPromise
}

async function setup(onProgress: (fraction: number | null) => void): Promise<void> {
  const exe = ytDlpPath()
  const info = await stat(exe).catch(() => null)
  if (!info) {
    await downloadFile(releaseBase + exeName, exe, onProgress)
    if (process.platform !== 'win32') await chmod(exe, 0o755)
    return
  }
  if (Date.now() - info.mtimeMs > updateAfterMs) {
    // Not fatal: without internet the old version is used.
    await run(['-U'], () => {}).catch(() => {})
  }
}

async function downloadFile(url: string, target: string, onProgress: (fraction: number) => void): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Could not download the YouTube downloader (${res.status}). Check the internet connection.`)
  const total = Number(res.headers.get('content-length')) || 0
  const tmp = `${target}.part`
  let done = 0
  let last = 0
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    done += chunk.length
    if (total && Date.now() - last > 200) {
      last = Date.now()
      onProgress(done / total)
    }
  })
  try {
    await pipeline(body, createWriteStream(tmp))
    await rename(tmp, target)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

/** Start yt-dlp with the options every call needs. */
function start(args: string[]): ChildProcess {
  const ffmpeg = ffmpegPath()
  const common = ['--no-colors', '--no-playlist', '--js-runtimes', `node:${process.execPath}`]
  if (ffmpeg) common.push('--ffmpeg-location', ffmpeg)
  return spawn(ytDlpPath(), [...common, ...args], {
    // The app runs as Node.js when yt-dlp starts it for the YouTube JavaScript.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    windowsHide: true
  })
}

/** Run yt-dlp to the end. Returns what it wrote. Each line of output also goes to `onLine`. */
function run(args: string[], onLine: (line: string) => void, keep?: (p: ChildProcess) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = start(args)
    keep?.(p)
    let out = ''
    let err = ''
    let partial = ''
    p.stdout!.setEncoding('utf8')
    p.stderr!.setEncoding('utf8')
    p.stdout!.on('data', (text: string) => {
      out += text
      partial += text
      const lines = partial.split(/\r?\n/)
      partial = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    })
    p.stderr!.on('data', (text: string) => (err += text))
    p.on('error', reject)
    p.on('close', (code, signal) => {
      if (partial) onLine(partial)
      if (code === 0) return resolve(out)
      if (signal) return reject(new Error('Stopped.'))
      reject(new Error(errorMessage(err) || `The download did not work (code ${code}).`))
    })
  })
}

/** The useful part of what yt-dlp wrote when it failed: the ERROR lines. */
function errorMessage(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => l.startsWith('ERROR:'))
  const text = (lines.at(-1) ?? '').replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, '')
  if (/Unsupported URL|is not a valid URL/i.test(text)) return 'This is not a link to a video.'
  if (/unavailable|Private video|been removed/i.test(text)) return 'This video is not available (private or removed).'
  if (/Sign in to confirm your age/i.test(text)) return 'YouTube asks to sign in for this video (age limit). It cannot be downloaded.'
  if (/getaddrinfo|Failed to resolve|Unable to download webpage|timed out/i.test(text)) return 'No internet connection, or YouTube did not answer.'
  return text
}

interface Format {
  format_id: string
  vcodec?: string
  acodec?: string
  height?: number | null
  filesize?: number | null
  filesize_approx?: number | null
  tbr?: number | null
  protocol?: string
}

/** Look up a link: title, length, and the picture sizes that can be downloaded. */
export async function lookup(url: string, onSetup: (fraction: number | null) => void): Promise<YoutubeInfo> {
  await ensureYtDlp(onSetup)
  const out = await run(['-J', '--no-warnings', url.trim()], () => {})
  const data = JSON.parse(out) as {
    id: string
    webpage_url?: string
    title?: string
    channel?: string
    uploader?: string
    duration?: number
    thumbnail?: string
    thumbnails?: { url: string; width?: number; preference?: number }[]
    formats?: Format[]
    is_live?: boolean
  }
  if (data.is_live) throw new Error('This is a live stream. Only videos that ended can be downloaded.')
  const formats = data.formats ?? []
  const size = (f: Format) => f.filesize ?? f.filesize_approx ?? 0
  const audio = formats.filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
  const audioBytes = Math.max(0, ...audio.map(size))
  // One entry per height: the size of the h264 file (the one the download prefers) plus the sound.
  const byHeight = new Map<number, number>()
  for (const f of formats) {
    if (!f.height || !f.vcodec || f.vcodec === 'none' || f.protocol?.startsWith('m3u8')) continue
    const isH264 = f.vcodec.startsWith('avc1')
    const bytes = size(f)
    const known = byHeight.get(f.height)
    if (known === undefined || (isH264 && bytes)) byHeight.set(f.height, bytes)
  }
  const heights = [...byHeight]
    .sort((a, b) => b[0] - a[0])
    .map(([height, bytes]) => ({ height, bytes: bytes ? bytes + audioBytes : 0 }))
  return {
    id: data.id,
    url: data.webpage_url ?? url.trim(),
    title: data.title ?? data.id,
    channel: data.channel ?? data.uploader ?? '',
    duration: data.duration ?? 0,
    thumbnail: await thumbnailData(data),
    heights,
    audioBytes
  }
}

/** A small picture of the video as a data: URL (the app pages only show local pictures). */
async function thumbnailData(data: { thumbnail?: string; thumbnails?: { url: string; width?: number }[] }): Promise<string | undefined> {
  const small = (data.thumbnails ?? []).filter((t) => t.width && t.width >= 300 && t.width <= 700 && /\.jpe?g/.test(t.url))
  const url = small.at(-1)?.url ?? data.thumbnail
  if (!url) return undefined
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    if (!type.startsWith('image/')) return undefined
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch {
    return undefined
  }
}

export interface DownloadJob {
  /** Ends with the path of the downloaded file. */
  done: Promise<string>
  cancel: () => void
}

/**
 * Download a video (MP4, at most `height` lines, h264 when there is one, so
 * older computers play it smoothly) or only the sound as MP3.
 * `onState` gets the progress of the download (0..1), then "converting" while
 * ffmpeg joins the picture and the sound, or makes the MP3.
 */
export function download(
  source: YoutubeSource,
  onState: (state: 'downloading' | 'converting', fraction?: number) => void
): DownloadJob {
  let child: ChildProcess | null = null
  let cancelled = false
  const done = (async () => {
    onState('downloading', 0)
    await ensureYtDlp(() => {})
    if (cancelled) throw new Error('Stopped.')
    if (!existsSync(source.folder)) mkdirSync(source.folder, { recursive: true })
    const hasFfmpeg = !!ffmpegPath()
    const formatArgs =
      source.mode === 'audio'
        ? hasFfmpeg
          ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
          : ['-f', 'ba[ext=m4a]/ba']
        : hasFfmpeg
          ? ['-f', 'bv*+ba/b', '-S', `res:${source.height},vcodec:h264,acodec:aac`, '--merge-output-format', 'mp4']
          : ['-f', `b[height<=${source.height}][ext=mp4]/b`]
    const args = [
      ...formatArgs,
      '--newline',
      '--progress',
      '--continue',
      '--no-mtime',
      '--progress-template',
      'download:MCPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
      '--print',
      'post_process:MCPOST',
      '--print',
      'after_move:MCFILE %(filepath)s',
      // Windows file names: no characters that Windows does not allow, and a title of at most 80 characters.
      '--windows-filenames',
      '-o',
      join(source.folder, '%(title).80s [%(id)s].%(ext)s'),
      source.url
    ]
    // A video and its sound are two downloads, one after the other. The picture is most of the size.
    let part = 0
    let lastBytes = 0
    let file = ''
    await run(
      args,
      (line) => {
        if (line.startsWith('MCPROG ')) {
          const [bytes, total, estimate] = line.slice(7).split(' ').map(Number)
          const size = total || estimate
          if (!Number.isFinite(bytes) || !size) return
          if (bytes < lastBytes) part++
          lastBytes = bytes
          const f = Math.min(1, bytes / size)
          const overall = source.mode === 'audio' ? f : part === 0 ? f * 0.85 : 0.85 + Math.min(1, f) * 0.15
          onState('downloading', overall)
        } else if (line.startsWith('MCPOST')) {
          onState('converting')
        } else if (line.startsWith('MCFILE ')) {
          file = line.slice(7).trim()
        }
      },
      (p) => (child = p)
    )
    if (!file || !existsSync(file)) throw new Error('The download ended, but the file was not found.')
    return file
  })()
  return {
    done,
    cancel: () => {
      cancelled = true
      child?.kill()
    }
  }
}
