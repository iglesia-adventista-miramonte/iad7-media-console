import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import type { HymnAudio, HymnChoice, HymnInfo, HymnalState, Settings } from '../shared/types'
import { byFileName, typeByExtension } from './fileTypes'
import { saveSettings } from './settings'

/**
 * The hymnal: a folder with the pictures and the music of each hymn. The team
 * copies the files into the folder; the app only reads them. The files are
 * played from the folder itself (no copy in the media cache), because the
 * folder is on this computer and is large (about 3.8 GB).
 *
 *   Letra/001 - Cantad alegres al Senor/01.jpg, 02.jpg, …   one picture per slide
 *   Musica/Cantado/001 - Cantad alegres al Senor.mp3        sung
 *   Musica/Instrumental/001 - Cantad alegres al Senor.mp3   track only
 *   himnos.json                                             optional: titles and slide times
 *
 * The folder of the old "Himnario Adventista" program works too: it has the same
 * Letra and Musica folders, and the titles and times are read from its
 * Resources/index.html when there is no himnos.json.
 *
 * A hymn is found by the number at the start of the name, so the names of the
 * music files do not need to be the same as the names of the picture folders.
 */

let settings: Settings
let state: HymnalState = { root: '', found: false, hymns: [], oldProgram: false, importTarget: '', importing: null, importResult: null }
let importing: HymnalState['importing'] = null
let importResult: HymnalState['importResult'] = null
let byNumber = new Map<number, HymnInfo>()
let notify: () => void = () => {}

const musicFolders: Record<Exclude<HymnAudio, 'none'>, string> = { sung: 'Cantado', instrumental: 'Instrumental' }

/** The folder the app reads: the chosen folder, or the default one. */
export function hymnalRoot(): string {
  return settings?.hymnalFolder || defaultHymnalRoot()
}

/** The dev copy uses the "himnario" folder of the project. The installed app uses Documents\Himnario. */
function defaultHymnalRoot(): string {
  return app.isPackaged ? join(app.getPath('documents'), 'Himnario') : join(app.getAppPath(), 'himnario')
}

/** The folder of the old "Himnario Adventista" program: it has Letra and Resources\index.html. */
export function isOldProgramFolder(folder: string): boolean {
  return existsSync(join(folder, 'Letra')) && existsSync(join(folder, 'Resources', 'index.html'))
}

/** Where an import copies to: the hymnal folder, or the default folder when the hymnal folder is the old program itself. */
function importTarget(): string {
  const root = hymnalRoot()
  return isOldProgramFolder(root) ? defaultHymnalRoot() : root
}

export function connectHymnal(s: Settings, onChange: () => void): void {
  settings = s
  notify = onChange
  scan()
}

export function hymnalState(): HymnalState {
  return state
}

export function findHymn(number: number): HymnInfo | undefined {
  return byNumber.get(number)
}

/** Read the folder again and tell the windows. */
export function rescanHymnal(): void {
  scan()
  notify()
}

export function setHymnalFolder(path: string): void {
  settings.hymnalFolder = path
  importResult = null
  saveSettings(settings)
  rescanHymnal()
}

/**
 * Copy the pictures and music of the old program into the hymnal folder, and
 * write himnos.json (titles and slide times). Files that are already there
 * with the same size are not copied again, so an import can run again to
 * repair the folder. The app then reads the hymnal folder, not the old program.
 */
export async function importOldProgram(source: string): Promise<void> {
  if (importing) return
  const target = importTarget()
  if (resolve(source) === resolve(target)) return
  importing = { done: 0, total: 0, target }
  importResult = null
  notifyNow()
  let copied = 0
  let kept = 0
  try {
    const files: { from: string; to: string }[] = []
    for (const dir of readdirSync(join(source, 'Letra'), { withFileTypes: true })) {
      if (!dir.isDirectory() || leadingNumber(dir.name) === null) continue
      for (const f of filesOfType(join(source, 'Letra', dir.name), 'image'))
        files.push({ from: join(source, 'Letra', dir.name, f), to: join(target, 'Letra', dir.name, f) })
    }
    for (const kind of Object.values(musicFolders))
      for (const f of filesOfType(join(source, 'Musica', kind), 'audio'))
        files.push({ from: join(source, 'Musica', kind, f), to: join(target, 'Musica', kind, f) })
    importing.total = files.length
    notifyNow()

    let lastNotify = Date.now()
    for (const { from, to } of files) {
      const size = (await stat(from)).size
      const old = await stat(to).catch(() => null)
      if (old && old.size === size) kept++
      else {
        await mkdir(dirname(to), { recursive: true })
        // Copy the content only. A normal file copy on Windows also copies the
        // "hidden" mark of the old program's files.
        await writeFile(to, await readFile(from))
        copied++
      }
      importing.done++
      if (Date.now() - lastNotify > 300) {
        lastNotify = Date.now()
        notifyNow()
      }
    }

    const meta = readMetaOldProgram(source) ?? new Map()
    const hymns = [...meta.entries()].map(([number, m]) => ({ number, title: m.title ?? '', times: m.times ?? [] })).sort((a, b) => a.number - b.number)
    await writeFile(join(target, 'himnos.json'), JSON.stringify({ hymns }, null, 1), 'utf8')

    // Read the hymnal folder from now on (not the old program).
    settings.hymnalFolder = target === defaultHymnalRoot() ? undefined : target
    saveSettings(settings)
    importResult = { copied, kept, error: null }
  } catch (err) {
    console.error('Could not import the hymnal:', err)
    importResult = { copied, kept, error: err instanceof Error ? err.message : String(err) }
  }
  importing = null
  rescanHymnal()
}

/** Tell the windows now, without reading the folder again. */
function notifyNow(): void {
  state = { ...state, importing: importing && { ...importing }, importResult, importTarget: importTarget() }
  notify()
}

/** Make the folder (with its subfolders) if it is missing, so the team can copy the files into it. */
export function ensureHymnalFolder(): string {
  const root = hymnalRoot()
  for (const dir of ['Letra', join('Musica', 'Cantado'), join('Musica', 'Instrumental')]) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  return root
}

/** media://hymnal/<path inside the hymnal folder>. See protocol.ts. */
function hymnalUrl(...parts: string[]): string {
  return `media://hymnal/${parts.map(encodeURIComponent).join('/')}`
}

/** The music of a hymn item as a media:// URL, or null (no music, or the file is missing). */
export function hymnAudioUrl(choice: HymnChoice): string | null {
  if (choice.audio === 'none') return null
  const files = byNumber.get(choice.number)?.[choice.audio] ?? []
  const file = files[choice.track ?? 0] ?? files[0]
  return file ? hymnalUrl('Musica', musicFolders[choice.audio], file) : null
}

/**
 * The file for a path in the hymnal folder ("/Letra/001 - …/01.jpg"), or null.
 * Only files inside the hymnal folder: no "..", no other folders.
 */
export function hymnalFile(pathname: string): string | null {
  const root = hymnalRoot()
  let file: string
  try {
    file = resolve(root, ...pathname.split('/').filter(Boolean).map(decodeURIComponent))
  } catch {
    return null // A bad %-escape in the path.
  }
  const inside = relative(root, file)
  if (!inside || inside.startsWith('..') || !existsSync(file) || !statSync(file).isFile()) return null
  return file
}

/** The number at the start of a name: "045 - Santo.mp3" → 45. */
function leadingNumber(name: string): number | null {
  const m = /^\s*(\d+)/.exec(name)
  return m ? Number(m[1]) : null
}

function filesOfType(dir: string, type: 'image' | 'audio'): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.') && typeByExtension[extname(n).toLowerCase()] === type)
    .sort(byFileName)
}

type HymnMeta = Map<number, { title?: string; times?: number[] }>

/**
 * Titles (with accents) and slide times. They come from himnos.json (written by
 * `npm run himnario`). When the folder has no himnos.json but is the folder of
 * the old "Himnario Adventista" program itself, they come from its page
 * Resources/index.html, the same way the import script reads them.
 */
function readMeta(root: string): HymnMeta {
  return readMetaJson(root) ?? readMetaOldProgram(root) ?? new Map()
}

function readMetaJson(root: string): HymnMeta | null {
  try {
    const data = JSON.parse(readFileSync(join(root, 'himnos.json'), 'utf8')) as {
      hymns?: { number: number; title?: string; times?: number[] }[]
    }
    const meta: HymnMeta = new Map()
    for (const h of data.hymns ?? []) if (Number.isFinite(h.number)) meta.set(h.number, h)
    return meta
  } catch {
    // No file, or a broken file.
    return null
  }
}

/** The old program has one tag per hymn: <span class="himn" data-number="1" data-title="…" data-times="12000,25000,…">. Times are in milliseconds. */
export function readMetaOldProgram(root: string): HymnMeta | null {
  let html: string
  try {
    html = readFileSync(join(root, 'Resources', 'index.html'), 'utf8')
  } catch {
    return null
  }
  const meta: HymnMeta = new Map()
  for (const tag of html.match(/<span class="himn"[^>]*>/g) ?? []) {
    const attr = (name: string): string => (new RegExp(`data-${name}="([^"]*)"`).exec(tag) ?? [])[1] ?? ''
    const number = Number(attr('number'))
    if (!number) continue
    const times = attr('times')
      .split(',')
      .map((t) => Number(t) / 1000)
      .filter((t) => Number.isFinite(t) && t > 0)
    meta.set(number, { title: attr('title').trim(), times })
  }
  return meta.size ? meta : null
}

/** Music files by hymn number. */
function readMusic(dir: string): Map<number, string[]> {
  const map = new Map<number, string[]>()
  for (const file of filesOfType(dir, 'audio')) {
    const n = leadingNumber(file)
    if (n === null) continue
    map.set(n, [...(map.get(n) ?? []), file])
  }
  // "614 - Amenes" comes before "614 -  Amenes B": compare the names without the extension and extra spaces.
  const key = (file: string): string => file.replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim()
  for (const files of map.values()) files.sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: 'base' }))
  return map
}

function scan(): void {
  const root = hymnalRoot()
  const letra = join(root, 'Letra')
  const hymns: HymnInfo[] = []
  try {
    if (existsSync(letra)) {
      const meta = readMeta(root)
      const sung = readMusic(join(root, 'Musica', musicFolders.sung))
      const instrumental = readMusic(join(root, 'Musica', musicFolders.instrumental))
      for (const dir of readdirSync(letra, { withFileTypes: true })) {
        const number = dir.isDirectory() ? leadingNumber(dir.name) : null
        if (number === null) continue
        const pages = filesOfType(join(letra, dir.name), 'image')
        if (pages.length === 0) continue
        const info = meta.get(number)
        const nameTitle = dir.name.replace(/^\s*\d+\s*[-–.]?\s*/, '')
        const times = (info?.times ?? []).filter((t) => Number.isFinite(t) && t > 0)
        hymns.push({
          number,
          title: info?.title?.trim() || nameTitle || `Himno ${number}`,
          pageUrls: pages.map((p) => hymnalUrl('Letra', dir.name, p)),
          sung: sung.get(number) ?? [],
          instrumental: instrumental.get(number) ?? [],
          times
        })
      }
    }
  } catch (err) {
    console.error('Could not read the hymnal folder:', err)
  }
  hymns.sort((a, b) => a.number - b.number)
  state = { root, found: hymns.length > 0, hymns, oldProgram: isOldProgramFolder(root), importTarget: importTarget(), importing, importResult }
  byNumber = new Map(hymns.map((h) => [h.number, h]))
}
