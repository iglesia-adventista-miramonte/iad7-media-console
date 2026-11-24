import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { setPriority, constants } from 'node:os'
import { join } from 'node:path'
import type { Waveform } from '../shared/types'
import { cacheDir } from './cache'
import { mediaFile } from './protocol'
import { ffmpegPath } from './youtube'

/**
 * The waveform of a video or audio file: how loud the sound is in each tenth
 * of a second. The control window draws it under the time bar, so the
 * operator can see where the sound starts (for example a song with a long
 * quiet start) and where the playhead is.
 *
 * ffmpeg reads the sound once per file, at low priority, one file at a time.
 * The result is saved next to the media cache, so it is read only once.
 */

/** Samples per second that ffmpeg makes (one channel). Enough for loudness, small and fast. */
const sampleRate = 4000
/** One value per this many seconds. */
const step = 0.1
/** Below this loudness (0..1) a part counts as quiet. About -46 dB. */
const quietLevel = 0.005

const memory = new Map<string, Promise<Waveform | null>>()
let queue: Promise<unknown> = Promise.resolve()

function waveDir(): string {
  const dir = join(cacheDir(), 'waveforms')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** The waveform for a media:// address, or null when the file is not found or ffmpeg is missing. */
export function waveform(address: string): Promise<Waveform | null> {
  const file = mediaFile(address)
  if (!file) return Promise.resolve(null)
  const info = statSync(file)
  // The same file changed (copied again): a new key, so a new waveform.
  const key = createHash('sha1').update(`${file}|${info.size}|${info.mtimeMs}`).digest('hex')
  let result = memory.get(key)
  if (!result) {
    result = load(key, file)
    memory.set(key, result)
    result.then((w) => !w && memory.delete(key)).catch(() => memory.delete(key))
  }
  return result
}

async function load(key: string, file: string): Promise<Waveform | null> {
  const saved = join(waveDir(), `${key}.json`)
  if (existsSync(saved)) {
    try {
      return JSON.parse(readFileSync(saved, 'utf8')) as Waveform
    } catch {
      // A broken file: make it again.
    }
  }
  // One ffmpeg at a time, so a playlist with many videos does not slow the computer during the service.
  const run = queue.then(() => measure(file))
  queue = run.catch(() => {})
  const w = await run
  if (w) writeFileSync(saved, JSON.stringify(w))
  return w
}

function measure(file: string): Promise<Waveform | null> {
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) return Promise.resolve(null)
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-threads', '1', '-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-'], {
      windowsHide: true
    })
    try {
      if (p.pid) setPriority(p.pid, constants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Not allowed on this computer: it still works, at normal priority.
    }
    const perValue = Math.round(sampleRate * step)
    const peaks: number[] = []
    let peak = 0
    let count = 0
    let carry: Buffer | null = null
    let stderr = ''
    p.stdout.on('data', (chunk: Buffer) => {
      const data = carry ? Buffer.concat([carry, chunk]) : chunk
      const usable = data.length - (data.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(data.readInt16LE(i)) / 32768
        if (v > peak) peak = v
        if (++count === perValue) {
          peaks.push(Math.round(peak * 1000) / 1000)
          peak = 0
          count = 0
        }
      }
      carry = usable < data.length ? data.subarray(usable) : null
    })
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    p.on('error', () => resolve(null))
    p.on('close', (code) => {
      if (count > 0) peaks.push(Math.round(peak * 1000) / 1000)
      // A video without a sound track: ffmpeg finds no audio stream.
      if (code !== 0 && peaks.length === 0) {
        const noAudio = /does not contain any stream|matches no streams|Output file #0 does not contain/i.test(stderr)
        return resolve(noAudio ? { step, peaks: [], firstSound: null, noAudio: true } : null)
      }
      const first = peaks.findIndex((v) => v > quietLevel)
      resolve({ step, peaks, firstSound: first < 0 ? null : first * step, noAudio: false })
    })
  })
}
