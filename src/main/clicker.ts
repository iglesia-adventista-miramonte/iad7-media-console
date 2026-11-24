import { fork, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ClickerAction, ClickerStatus, Settings } from '../shared/types'
import type { GuardConfig, GuardMessage } from './clickerGuard'
import { clickerKeyActions as keyActions, deviceKey, vidPid } from './clickerKeys'
import { saveSettings } from './settings'
import { mainStrings } from './strings'

/**
 * Presenter clicker in the background (SPEC 5.8, Windows only).
 *
 * Windows sends a key only to the window in front. To hear the clicker while
 * another program (for example Chrome) is in front, the app asks Windows for
 * "raw input": every key press, with the device it came from. The app pairs
 * one device (the clicker) and acts only on keys from that device, so the
 * keyboard keeps working as normal in other programs. Windows still gives
 * the key to the program in front too, unless "Keep the clicker keys away
 * from other programs" is on: then a small helper process (clickerGuard.ts)
 * takes the clicker keys before that program gets them.
 */

const WM_INPUT = 0x00ff
const RID_INPUT = 0x10000003
const RIDI_DEVICENAME = 0x20000007
const RIM_TYPEKEYBOARD = 1
const RIDEV_INPUTSINK = 0x100
const RI_KEY_BREAK = 1
const INVALID_HANDLE = 0xffffffffffffffffn

interface Hooks {
  onAction: (action: ClickerAction) => void
  onStatus: (status: ClickerStatus) => void
  /** False while the control window is in front and its own keys handle the clicker. */
  shouldAct: () => boolean
}

interface Win32 {
  readInput: (hRawInput: bigint) => { device: bigint; vkey: number; up: boolean } | null
  devicePath: (device: bigint) => string | null
  productName: (path: string) => string | null
}

let settings: Settings
let hooks: Hooks
let win32: Win32 | null = null
let error: string | null = null
let pairing = false
let lastPress: ClickerStatus['lastPress'] = null
/** Device handle → device key and name. Handles stay the same while the device stays plugged in. */
const devices = new Map<bigint, { key: string; name: string } | null>()
/** Keys held down now, so a held key counts once. */
const down = new Set<string>()
/** The helper process that keeps the clicker keys away from other programs. */
let guard: ChildProcess | null = null
let guardError: string | null = null
/** The control window, as text (the number is too big for a message). */
let controlHwnd = ''
/** The Service page is shown in the control window. */
let liveKeys = false

export function connectClicker(s: Settings, h: Hooks): void {
  settings = s
  hooks = h
}

export function clickerStatus(): ClickerStatus {
  const c = settings.clicker
  return {
    supported: !!win32,
    error,
    pairing,
    paired: c ? { name: c.name, enabled: c.enabled, block: !!c.block } : null,
    blockError: guardError,
    lastPress
  }
}

function changed(): void {
  hooks.onStatus(clickerStatus())
}

/** Start listening. The window only receives the messages; it does not need to be in front. */
export function startClicker(window: BrowserWindow): void {
  if (process.platform !== 'win32') return
  try {
    win32 = loadWin32(window)
  } catch (err) {
    win32 = null
    error = err instanceof Error ? err.message : String(err)
    console.error('Clicker: could not listen to keys in the background:', err)
    return
  }
  window.hookWindowMessage(WM_INPUT, (_wParam: Buffer, lParam: Buffer) => {
    try {
      onRawInput(process.arch === 'ia32' ? BigInt(lParam.readUInt32LE(0)) : lParam.readBigUInt64LE(0))
    } catch (err) {
      console.error('Clicker: could not read a key press:', err)
    }
  })
  const handle = window.getNativeWindowHandle()
  controlHwnd = (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString()
  syncGuard()
}

/** The app closes: stop the helper process. */
export function stopClicker(): void {
  stopGuard()
}

/** The control window shows the Service page (true) or another page (false). */
export function setLiveKeys(active: boolean): void {
  liveKeys = active
  syncGuard()
}

/** Keep the clicker keys away from other programs, or not. */
export function setClickerBlock(block: boolean): void {
  if (!settings.clicker) return
  settings.clicker.block = block
  guardError = null
  saveSettings(settings)
  syncGuard()
  changed()
}

/** Start, update or stop the helper process, to match the settings. */
function syncGuard(): void {
  const c = settings.clicker
  if (!win32 || !controlHwnd || !c || !c.enabled || !c.block || guardError) return stopGuard()
  if (!guard) startGuard()
  const config: GuardConfig = { deviceKey: c.deviceKey, hwnd: controlHwnd, liveKeys }
  guard?.send(config)
}

function startGuard(): void {
  // The helper is this same program, run as plain Node (no window).
  const child = fork(join(__dirname, 'clickerGuard.js'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  })
  guard = child
  const failed = (message: string): void => {
    if (guard !== child) return
    guard = null
    guardError = message
    changed()
  }
  child.on('message', (message: GuardMessage) => {
    if (message.type === 'failed') failed(message.message)
  })
  child.on('error', (err) => failed(err.message))
  child.on('exit', () => failed('The helper process stopped.'))
}

function stopGuard(): void {
  const child = guard
  guard = null
  child?.kill()
}

export function startPairing(): void {
  pairing = true
  devices.clear()
  changed()
}

export function cancelPairing(): void {
  pairing = false
  changed()
}

export function forgetClicker(): void {
  settings.clicker = undefined
  lastPress = null
  guardError = null
  saveSettings(settings)
  syncGuard()
  changed()
}

export function setClickerEnabled(enabled: boolean): void {
  if (!settings.clicker) return
  settings.clicker.enabled = enabled
  saveSettings(settings)
  syncGuard()
  changed()
}

/** Set MEDIA_CONSOLE_CLICKER_LOG=1 to print every key Windows reports, with its device (for help with a clicker). */
const logKeys = process.env.MEDIA_CONSOLE_CLICKER_LOG === '1'

function onRawInput(hRawInput: bigint): void {
  const input = win32?.readInput(hRawInput)
  if (logKeys && input) {
    const path = input.device ? win32?.devicePath(input.device) : 'typed by a program'
    console.log(`clicker-log key=0x${input.vkey.toString(16)} ${input.up ? 'up' : 'down'} device=${path}`)
  }
  // Device 0: the key was typed by a program, not by a device.
  if (!input || input.device === 0n) return
  const id = `${input.device}:${input.vkey}`
  if (input.up) {
    down.delete(id)
    return
  }
  if (down.has(id)) return
  down.add(id)

  const device = deviceInfo(input.device)
  if (!device) return
  const action = keyActions[input.vkey]

  if (pairing) {
    // Only a next or previous key pairs, so typing a letter on the keyboard cannot pair it by mistake.
    if (action !== 'next' && action !== 'previous') return
    pairing = false
    // A clicker that is paired again keeps the "keep the keys away" choice.
    settings.clicker = { deviceKey: device.key, name: device.name, enabled: true, block: settings.clicker?.block }
    saveSettings(settings)
    syncGuard()
    lastPress = { action, at: Date.now() }
    changed()
    return
  }

  const clicker = settings.clicker
  if (!clicker || device.key !== clicker.deviceKey) return
  lastPress = { action: action ?? 'other', at: Date.now() }
  changed()
  if (action && clicker.enabled && hooks.shouldAct()) hooks.onAction(action)
}

function deviceInfo(device: bigint): { key: string; name: string } | null {
  if (devices.has(device)) return devices.get(device)!
  const path = win32?.devicePath(device) ?? null
  const info = path ? { key: deviceKey(path), name: deviceName(path) } : null
  devices.set(device, info)
  return info
}

function deviceName(path: string): string {
  const ids = vidPid(path)
  const product = win32?.productName(path)
  const code = ids ? `${ids.vid}:${ids.pid}` : null
  if (product && code) return `${product} (${code})`
  return product ?? (code ? `USB device ${code}` : 'Keyboard device')
}

/** The Windows functions, through koffi. Loaded only on Windows. */
function loadWin32(window: BrowserWindow): Win32 {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const hid = koffi.load('hid.dll')

  const RAWINPUTDEVICE = koffi.struct('RAWINPUTDEVICE', {
    usUsagePage: 'uint16_t',
    usUsage: 'uint16_t',
    dwFlags: 'uint32_t',
    hwndTarget: 'uintptr_t'
  })
  const RegisterRawInputDevices = user32.func('int __stdcall RegisterRawInputDevices(RAWINPUTDEVICE *devices, uint32_t count, uint32_t size)')
  const GetRawInputData = user32.func('uint32_t __stdcall GetRawInputData(uintptr_t hRawInput, uint32_t command, void *data, _Inout_ uint32_t *size, uint32_t headerSize)')
  const GetRawInputDeviceInfoW = user32.func('uint32_t __stdcall GetRawInputDeviceInfoW(uintptr_t device, uint32_t command, void *data, _Inout_ uint32_t *size)')
  const CreateFileW = kernel32.func('uintptr_t __stdcall CreateFileW(const char16_t *name, uint32_t access, uint32_t share, void *security, uint32_t disposition, uint32_t flags, void *template)')
  const CloseHandle = kernel32.func('int __stdcall CloseHandle(uintptr_t handle)')
  const HidD_GetProductString = hid.func('uint8_t __stdcall HidD_GetProductString(uintptr_t handle, void *buffer, uint32_t length)')

  const handleBuffer = window.getNativeWindowHandle()
  const hwnd = handleBuffer.length >= 8 ? handleBuffer.readBigUInt64LE(0) : BigInt(handleBuffer.readUInt32LE(0))
  // Keyboards (usage page 1, usage 6). INPUTSINK: also while another program is in front.
  const ok = RegisterRawInputDevices({ usUsagePage: 1, usUsage: 6, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd }, 1, koffi.sizeof(RAWINPUTDEVICE))
  if (!ok) throw new Error(mainStrings.keysNotAllowed)

  // RAWINPUTHEADER: 24 bytes on 64-bit Windows, 16 on 32-bit. RAWKEYBOARD follows it.
  const headerSize = process.arch === 'ia32' ? 16 : 24
  const buffer = Buffer.alloc(headerSize + 16)

  return {
    readInput(hRawInput) {
      const size = [buffer.length]
      const n = GetRawInputData(hRawInput, RID_INPUT, buffer, size, headerSize) as number
      if (n === 0xffffffff || n < headerSize + 8 || buffer.readUInt32LE(0) !== RIM_TYPEKEYBOARD) return null
      const device = headerSize === 24 ? buffer.readBigUInt64LE(8) : BigInt(buffer.readUInt32LE(8))
      const flags = buffer.readUInt16LE(headerSize + 2)
      const vkey = buffer.readUInt16LE(headerSize + 6)
      // 0xFF is a fake key that Windows adds to some key sequences.
      if (vkey === 0xff) return null
      return { device, vkey, up: (flags & RI_KEY_BREAK) !== 0 }
    },
    devicePath(device) {
      const size = [0]
      GetRawInputDeviceInfoW(device, RIDI_DEVICENAME, null, size)
      if (!size[0]) return null
      const name = Buffer.alloc(size[0] * 2)
      if ((GetRawInputDeviceInfoW(device, RIDI_DEVICENAME, name, size) as number) === 0xffffffff) return null
      return name.toString('utf16le').replace(/\0[\s\S]*$/, '') || null
    },
    productName(path) {
      // Access 0: only ask about the device, do not open it for reading.
      const handle = BigInt(CreateFileW(path, 0, 3, null, 3, 0, null))
      if (handle === INVALID_HANDLE || handle === 0n) return null
      try {
        const text = Buffer.alloc(256)
        if (!HidD_GetProductString(handle, text, text.length)) return null
        return text.toString('utf16le').replace(/\0[\s\S]*$/, '').trim() || null
      } finally {
        CloseHandle(handle)
      }
    }
  }
}
