import { BrowserWindow } from 'electron'
import type { ClockCorner, ClockRender, ClockSettings, OutputStatus } from '../shared/types'
import { loadPage, preloadPath } from './pages'

/**
 * The corner clock (SPEC 7.1): a small window with the time now, on one
 * output screen, above everything else. It is above the app's own output
 * windows and above other programs (for example a PowerPoint slide show
 * after "Hide screens"), so a presenter can always see the time.
 *
 * The window is transparent, takes no focus and lets mouse clicks pass
 * through to the window under it.
 */

export function defaultClockSettings(): ClockSettings {
  return { enabled: false, outputId: null, corner: 'top-right', size: 8, seconds: false, background: true }
}

let win: BrowserWindow | null = null
let current: ClockSettings = defaultClockSettings()
let raiseTimer: NodeJS.Timeout | null = null

/** Width of the clock window for each 1 px of height: room for "10:42" or "10:42:05". */
function widthFor(height: number, seconds: boolean): number {
  return Math.round(height * (seconds ? 3.9 : 2.7))
}

function boundsFor(s: ClockSettings, screen: NonNullable<OutputStatus['screen']>): Electron.Rectangle {
  const size = Math.min(40, Math.max(3, s.size))
  const height = Math.round((screen.height * size) / 100)
  const width = Math.min(screen.width, widthFor(height, s.seconds))
  const margin = Math.round(screen.height * 0.02)
  const corner: ClockCorner = s.corner
  const x = corner.endsWith('left') ? screen.x + margin : screen.x + screen.width - width - margin
  const y = corner.startsWith('top') ? screen.y + margin : screen.y + screen.height - height - margin
  return { x, y, width, height }
}

function render(): ClockRender {
  return { seconds: current.seconds, background: current.background }
}

/**
 * Put the clock on top again. Windows keeps one group of "always on top"
 * windows, and the window raised last is in front. The output windows and
 * other programs can be raised after the clock, so do this often.
 */
function raise(): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.moveTop()
}

function close(): void {
  if (raiseTimer) clearInterval(raiseTimer)
  raiseTimer = null
  const w = win
  win = null
  if (w && !w.isDestroyed()) {
    w.removeAllListeners('closed')
    w.destroy()
  }
}

function create(bounds: Electron.Rectangle): BrowserWindow {
  const w = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: false,
    focusable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: preloadPath(), sandbox: true, backgroundThrottling: false }
  })
  // Clicks go to the window under the clock (the slide show, the output window).
  w.setIgnoreMouseEvents(true)
  w.webContents.on('did-finish-load', () => w.webContents.send('clock:render', render()))
  w.webContents.on('render-process-gone', () => {
    if (!w.isDestroyed()) w.reload()
  })
  // If the window dies, open it again on the next update.
  w.on('closed', () => {
    if (win === w) win = null
  })
  w.once('ready-to-show', () => {
    w.showInactive()
    raise()
  })
  loadPage(w, 'output', { mode: 'clock' })
  return w
}

/**
 * Open, move or close the clock to match the settings and the connected
 * screens. Call after the clock settings, the outputs or the screens change.
 */
export function syncClock(settings: ClockSettings | undefined, outputs: OutputStatus[]): void {
  current = { ...defaultClockSettings(), ...settings }
  const screen = current.enabled ? outputs.find((o) => o.output.id === current.outputId)?.screen : null
  if (!screen) {
    close()
    return
  }
  const bounds = boundsFor(current, screen)
  if (!win || win.isDestroyed()) {
    win = create(bounds)
  } else {
    win.setBounds(bounds)
    win.webContents.send('clock:render', render())
  }
  if (!raiseTimer) raiseTimer = setInterval(raise, 2000)
  raise()
}

/** Put the clock in front again now (after the output windows were shown or moved). */
export function raiseClock(): void {
  raise()
}

export function closeClock(): void {
  close()
}
