import { BrowserWindow } from 'electron'
import type { ScreenInfo } from '../shared/types'
import { loadPage, preloadPath } from './pages'

/**
 * Put a window on a screen and make it cover the full screen.
 * Rules for all screen windows: frameless, fullscreen, always on top,
 * pointer hidden (the page sets cursor: none).
 *
 * When the window already covers the screen, only "always on top" is set
 * again. Fullscreen is not turned off and on, because:
 * - On Windows, Electron marks a hidden window as visible (WS_VISIBLE) when
 *   it leaves fullscreen, without really showing it. After that, the window
 *   can stay black when it is shown: the page runs, but nothing reaches the
 *   screen until the app restarts. This happened after "Hide screens".
 * - Windows reports display changes often (for example when another program
 *   goes fullscreen). Each change would turn fullscreen off and on again on
 *   the live screens.
 * Call this only for a window that is shown, or for a new window before it
 * is shown for the first time (it is not fullscreen yet then).
 */
export function coverScreen(win: BrowserWindow, s: ScreenInfo): void {
  win.setAlwaysOnTop(true, 'screen-saver')
  const b = win.getBounds()
  const inPlace = b.x === s.x && b.y === s.y && b.width === s.width && b.height === s.height
  if (inPlace && win.isFullScreen()) return
  if (win.isFullScreen()) win.setFullScreen(false)
  win.setBounds({ x: s.x, y: s.y, width: s.width, height: s.height })
  win.setFullScreen(true)
}

/**
 * Create a window for one screen. Do not set `resizable: false`: on Windows
 * that makes a frameless window 14×7 px bigger than the screen.
 */
export function createScreenWindow(s: ScreenInfo, mode: 'test' | 'live', stayHidden: () => boolean = () => false): BrowserWindow {
  const win = new BrowserWindow({
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    frame: false,
    show: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.once('ready-to-show', () => {
    // "Hide screens" is on: the window stays hidden until the operator shows the screens again.
    if (stayHidden()) return
    coverScreen(win, s)
    // A test window takes focus so Esc can close it. A live window must not
    // take focus away from the control window.
    if (mode === 'test') win.show()
    else win.showInactive()
  })
  loadPage(win, 'output', { mode })
  return win
}
