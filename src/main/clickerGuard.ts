import { clickerKeyActions, deviceKey } from './clickerKeys'
import { mainStrings } from './strings'

/**
 * Clicker key guard (SPEC 5.8, Windows only). This file is a small separate
 * process, started by clicker.ts when "Keep the clicker keys away from other
 * programs" is on.
 *
 * The problem: a clicker is a keyboard for Windows. When another program is
 * in front, Windows gives the clicker key to that program too, so it scrolls
 * or types. The main process only listens to the keys; it cannot stop them.
 *
 * What this process does: it puts a keyboard hook in Windows. Windows asks
 * the hook about every key before the program in front gets it. The hook
 * does not know the device of a key, but raw input does (as in clicker.ts).
 * So for each clicker key (arrows, Page Up, Page Down, B, period):
 *  - raw input already told the device: a key from the clicker is dropped,
 *    a key from another keyboard goes on as normal.
 *  - raw input did not tell yet: the key is held, and decided when raw input
 *    tells (dropped, or typed again by this process). After 40 ms without an
 *    answer the key is typed again, so a key is never lost.
 * Keys that come while a key is held are held too and typed again in the
 * same order, so the order of typed text does not change.
 *
 * This process does not act on the clicker. The main process still does that
 * from its own raw input.
 *
 * Why a separate process: Windows waits for the hook on every key of the
 * whole computer. Here the answer is always fast, also when the main process
 * is busy. And if this process fails, only the guard stops: keys work as
 * before, and the app keeps running.
 */

/** What the main process sends. */
export interface GuardConfig {
  /** The paired clicker (USB maker and model). */
  deviceKey: string
  /** The control window. Its own keys handle the clicker when it is in front on the Service page. */
  hwnd: string
  /** The Service page is shown. */
  liveKeys: boolean
}

/** What this process tells the main process. */
export type GuardMessage = { type: 'ready' } | { type: 'failed'; message: string }

const WM_INPUT = 0x00ff
const RID_INPUT = 0x10000003
const RIDI_DEVICENAME = 0x20000007
const RIM_TYPEKEYBOARD = 1
const RIDEV_INPUTSINK = 0x100
const RI_KEY_BREAK = 1
const WH_KEYBOARD_LL = 13
const LLKHF_EXTENDED = 0x01
const LLKHF_INJECTED = 0x10
const LLKHF_UP = 0x80
const KEYEVENTF_EXTENDEDKEY = 0x1
const KEYEVENTF_KEYUP = 0x2
const HWND_MESSAGE = -3
const QS_ALLINPUT = 0x04ff
const MWMO_INPUTAVAILABLE = 0x4
const PM_REMOVE = 1
/** Marks the keys this process types again, so the hook lets them pass. */
const OWN_KEY = 0x4d43

/** How long a held key waits for raw input to tell its device. */
const holdMs = 40
/** How long raw input that came before its key is kept. */
const earlyMs = 40
/** After this many held keys in a row without an answer, the guard stops: it does not work on this computer. */
const maxUnanswered = 4

/** Set MEDIA_CONSOLE_CLICKER_LOG=1 to print what the guard does with each clicker key. */
const logKeys = process.env.MEDIA_CONSOLE_CLICKER_LOG === '1'
/**
 * For tests without a clicker: MEDIA_CONSOLE_CLICKER_TEST=clicker or =keyboard treats keys typed by
 * a program as keys from the clicker or from a keyboard. =silent treats them as keys from a device
 * that raw input never reports.
 */
const testMode = process.env.MEDIA_CONSOLE_CLICKER_TEST as 'clicker' | 'keyboard' | 'silent' | undefined

interface Key {
  vk: number
  scan: number
  extended: boolean
  up: boolean
}

interface HeldKey extends Key {
  at: number
  /** wait: raw input has not told the device yet. send: type it again. drop: it came from the clicker. */
  verdict: 'wait' | 'send' | 'drop'
}

interface Win32 {
  /** Wait for a key or a message, at most this long. */
  wait: (ms: number) => void
  /** Read the raw input that is waiting. all: also take other messages off the list (they are not used). */
  readRawInput: (all?: boolean) => void
  foregroundWindow: () => bigint
  type: (keys: Key[]) => void
  stop: () => void
}

let config: GuardConfig | null = null
let win32: Win32
/** Keys taken from Windows that are not decided or not typed again yet, oldest first. */
const held: HeldKey[] = []
/** Raw input for a clicker key that came before the hook saw that key. */
const early: { vk: number; up: boolean; fromClicker: boolean; at: number }[] = []
let unanswered = 0

function tell(message: GuardMessage): void {
  process.send?.(message)
}

function log(text: string): void {
  if (logKeys) console.log(`clicker-guard ${text}`)
}

/** The guard takes keys only while the main process acts on the clicker in the background. */
function active(): boolean {
  if (!config) return false
  return !(config.liveKeys && win32.foregroundWindow() === BigInt(config.hwnd))
}

/** Raw input told the device of a key. */
function onRawKey(vk: number, up: boolean, fromClicker: boolean): void {
  if (!(vk in clickerKeyActions)) return
  const waiting = held.find((k) => k.verdict === 'wait' && k.vk === vk && k.up === up)
  if (waiting) {
    waiting.verdict = fromClicker ? 'drop' : 'send'
    unanswered = 0
    log(`key 0x${vk.toString(16)} ${up ? 'up' : 'down'}: device known after the key, ${fromClicker ? 'dropped' : 'typed again'}`)
  } else if (active()) {
    early.push({ vk, up, fromClicker, at: Date.now() })
    if (early.length > 16) early.shift()
  }
}

/** Held keys that waited too long are typed again. Old early raw input is forgotten. */
function expire(): void {
  const now = Date.now()
  for (const key of held) {
    if (key.verdict !== 'wait' || now - key.at < holdMs) continue
    key.verdict = 'send'
    unanswered++
    log(`key 0x${key.vk.toString(16)} ${key.up ? 'up' : 'down'}: no device after ${holdMs} ms, typed again`)
  }
  while (early.length && now - early[0].at > earlyMs) early.shift()
}

/** Take the decided keys from the front of the list. Returns the ones to type again, in order. */
function takeDecided(): Key[] {
  const keys: Key[] = []
  while (held.length && held[0].verdict !== 'wait') {
    const key = held.shift()!
    if (key.verdict === 'send') keys.push(key)
  }
  return keys
}

/**
 * Windows asks about one key. Returns true to take the key away from the
 * program in front.
 */
function onKey(key: Key, typedByProgram: boolean): boolean {
  win32.readRawInput()
  // Test: a key typed by a program counts as a key from a device.
  const fromDevice = !typedByProgram || !!testMode
  const clickerKey = key.vk in clickerKeyActions && fromDevice && active()
  if (clickerKey && typedByProgram && testMode !== 'silent') onRawKey(key.vk, key.up, testMode === 'clicker')
  expire()
  const again = takeDecided()

  let verdict: 'pass' | 'drop' | 'wait' = 'pass'
  if (clickerKey) {
    const i = early.findIndex((e) => e.vk === key.vk && e.up === key.up)
    if (i < 0) verdict = 'wait'
    else {
      verdict = early[i].fromClicker ? 'drop' : 'pass'
      early.splice(i, 1)
      unanswered = 0
      log(`key 0x${key.vk.toString(16)} ${key.up ? 'up' : 'down'}: device known, ${verdict === 'drop' ? 'dropped' : 'passed on'}`)
    }
  }

  let take = verdict !== 'pass'
  if (verdict === 'wait') held.push({ ...key, at: Date.now(), verdict: 'wait' })
  else if (verdict === 'pass' && (held.length || again.length)) {
    // Older keys are held or typed again now. This key must come after them.
    held.push({ ...key, at: Date.now(), verdict: 'send' })
    again.push(...takeDecided())
    take = true
  }
  if (again.length) win32.type(again)
  return take
}

/** Windows did not tell the device of several keys in a row: stop, so keys work as before. */
function giveUp(): void {
  const keys = held.splice(0).filter((k) => k.verdict !== 'drop')
  win32.stop()
  if (keys.length) win32.type(keys)
  tell({ type: 'failed', message: mainStrings.noKeyDevice })
  log('stopped: no device for several keys in a row')
  setTimeout(() => process.exit(0), 100)
}

async function run(): Promise<void> {
  win32 = loadWin32()
  tell({ type: 'ready' })
  log('started')
  for (;;) {
    win32.wait(held.length ? 5 : 50)
    win32.readRawInput(true)
    expire()
    const again = takeDecided()
    if (again.length) win32.type(again)
    if (unanswered >= maxUnanswered) return giveUp()
    // Let Node handle messages from the main process.
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function loadWin32(): Win32 {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32_t',
    scanCode: 'uint32_t',
    flags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t'
  })
  koffi.struct('MSG', {
    hwnd: 'uintptr_t',
    message: 'uint32_t',
    wParam: 'uintptr_t',
    lParam: 'intptr_t',
    time: 'uint32_t',
    x: 'int32_t',
    y: 'int32_t',
    lPrivate: 'uint32_t'
  })
  const RAWINPUTDEVICE = koffi.struct('RAWINPUTDEVICE', {
    usUsagePage: 'uint16_t',
    usUsage: 'uint16_t',
    dwFlags: 'uint32_t',
    hwndTarget: 'uintptr_t'
  })
  const HookProc = koffi.proto('intptr_t __stdcall HookProc(int code, uintptr_t wParam, KBDLLHOOKSTRUCT *info)')

  const SetWindowsHookExW = user32.func('uintptr_t __stdcall SetWindowsHookExW(int id, HookProc *fn, uintptr_t module, uint32_t thread)')
  const UnhookWindowsHookEx = user32.func('int __stdcall UnhookWindowsHookEx(uintptr_t hook)')
  const CallNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(uintptr_t hook, int code, uintptr_t wParam, KBDLLHOOKSTRUCT *info)')
  const PeekMessageW = user32.func('int __stdcall PeekMessageW(_Out_ MSG *msg, uintptr_t hwnd, uint32_t min, uint32_t max, uint32_t remove)')
  const MsgWaitForMultipleObjectsEx = user32.func('uint32_t __stdcall MsgWaitForMultipleObjectsEx(uint32_t count, void *handles, uint32_t ms, uint32_t mask, uint32_t flags)')
  const CreateWindowExW = user32.func('uintptr_t __stdcall CreateWindowExW(uint32_t exStyle, const char16_t *className, const char16_t *name, uint32_t style, int x, int y, int w, int h, intptr_t parent, uintptr_t menu, uintptr_t instance, void *param)')
  const RegisterRawInputDevices = user32.func('int __stdcall RegisterRawInputDevices(RAWINPUTDEVICE *devices, uint32_t count, uint32_t size)')
  const GetRawInputData = user32.func('uint32_t __stdcall GetRawInputData(uintptr_t hRawInput, uint32_t command, void *data, _Inout_ uint32_t *size, uint32_t headerSize)')
  const GetRawInputDeviceInfoW = user32.func('uint32_t __stdcall GetRawInputDeviceInfoW(uintptr_t device, uint32_t command, void *data, _Inout_ uint32_t *size)')
  const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()')
  const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t count, void *inputs, int size)')
  const GetModuleHandleW = kernel32.func('uintptr_t __stdcall GetModuleHandleW(const char16_t *name)')

  // A window that is never shown. It only receives the raw input messages.
  const hwnd = CreateWindowExW(0, 'STATIC', '', 0, 0, 0, 0, 0, HWND_MESSAGE, 0, 0, null)
  if (!hwnd) throw new Error(mainStrings.noMessageWindow)
  // Keyboards (usage page 1, usage 6). INPUTSINK: also while another program is in front.
  if (!RegisterRawInputDevices({ usUsagePage: 1, usUsage: 6, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd }, 1, koffi.sizeof(RAWINPUTDEVICE)))
    throw new Error(mainStrings.keysNotAllowed)

  // RAWINPUTHEADER: 24 bytes on 64-bit Windows, 16 on 32-bit. RAWKEYBOARD follows it.
  const wide = process.arch !== 'ia32'
  const headerSize = wide ? 24 : 16
  const raw = Buffer.alloc(headerSize + 16)
  /** Device handle → the device is the paired clicker. Cleared when the paired clicker changes. */
  const isClicker = new Map<bigint, boolean>()
  let knownClicker = ''

  function fromClicker(device: bigint): boolean {
    if (config && config.deviceKey !== knownClicker) {
      knownClicker = config.deviceKey
      isClicker.clear()
    }
    let known = isClicker.get(device)
    if (known === undefined) {
      const size = [0]
      GetRawInputDeviceInfoW(device, RIDI_DEVICENAME, null, size)
      const name = Buffer.alloc(size[0] * 2)
      const ok = size[0] > 0 && (GetRawInputDeviceInfoW(device, RIDI_DEVICENAME, name, size) as number) !== 0xffffffff
      const path = ok ? name.toString('utf16le').replace(/\0[\s\S]*$/, '') : ''
      known = !!path && deviceKey(path) === knownClicker
      isClicker.set(device, known)
    }
    return known
  }

  function readRawInput(all = false): void {
    const msg: { message?: number; lParam?: number | bigint } = {}
    while (all ? PeekMessageW(msg, 0, 0, 0, PM_REMOVE) : PeekMessageW(msg, hwnd, WM_INPUT, WM_INPUT, PM_REMOVE)) {
      if (msg.message !== WM_INPUT) continue
      const size = [raw.length]
      const n = GetRawInputData(BigInt(msg.lParam ?? 0), RID_INPUT, raw, size, headerSize) as number
      if (n === 0xffffffff || n < headerSize + 16 || raw.readUInt32LE(0) !== RIM_TYPEKEYBOARD) continue
      const device = wide ? raw.readBigUInt64LE(8) : BigInt(raw.readUInt32LE(8))
      const flags = raw.readUInt16LE(headerSize + 2)
      const vkey = raw.readUInt16LE(headerSize + 6)
      const extra = raw.readUInt32LE(headerSize + 12)
      // Device 0: typed by a program (also the keys this process types again). 0xFF: a fake key from Windows.
      if (device === 0n || extra === OWN_KEY || vkey === 0xff) continue
      onRawKey(vkey, (flags & RI_KEY_BREAK) !== 0, fromClicker(device))
    }
  }

  let hook: number | bigint = 0
  const proc = koffi.register((code: number, wParam: number | bigint, info: bigint): number | bigint => {
    try {
      if (code === 0 && hook) {
        const k = koffi.decode(info, KBDLLHOOKSTRUCT) as { vkCode: number; scanCode: number; flags: number; dwExtraInfo: number | bigint }
        const own = BigInt(k.dwExtraInfo) === BigInt(OWN_KEY)
        const key: Key = { vk: k.vkCode, scan: k.scanCode, extended: (k.flags & LLKHF_EXTENDED) !== 0, up: (k.flags & LLKHF_UP) !== 0 }
        if (!own && onKey(key, (k.flags & LLKHF_INJECTED) !== 0)) return 1
      }
    } catch (err) {
      console.error('Clicker guard: could not handle a key:', err)
    }
    return CallNextHookEx(0, code, wParam, info) as number | bigint
  }, koffi.pointer(HookProc))
  hook = SetWindowsHookExW(WH_KEYBOARD_LL, proc, GetModuleHandleW(null), 0) as number | bigint
  if (!hook) throw new Error(mainStrings.noKeyboardHook)

  // INPUT: 40 bytes on 64-bit Windows, 28 on 32-bit.
  const inputSize = wide ? 40 : 28
  return {
    wait: (ms) => void MsgWaitForMultipleObjectsEx(0, null, ms, QS_ALLINPUT, MWMO_INPUTAVAILABLE),
    readRawInput,
    foregroundWindow: () => BigInt(GetForegroundWindow() as number | bigint),
    type(keys) {
      const inputs = Buffer.alloc(inputSize * keys.length)
      keys.forEach((key, i) => {
        const at = i * inputSize
        const flags = (key.extended ? KEYEVENTF_EXTENDEDKEY : 0) | (key.up ? KEYEVENTF_KEYUP : 0)
        inputs.writeUInt32LE(1, at) // INPUT_KEYBOARD
        inputs.writeUInt16LE(key.vk, at + (wide ? 8 : 4))
        inputs.writeUInt16LE(key.scan & 0xffff, at + (wide ? 10 : 6))
        inputs.writeUInt32LE(flags, at + (wide ? 12 : 8))
        if (wide) inputs.writeBigUInt64LE(BigInt(OWN_KEY), at + 24)
        else inputs.writeUInt32LE(OWN_KEY, at + 16)
      })
      SendInput(keys.length, inputs, inputSize)
    },
    stop() {
      if (hook) UnhookWindowsHookEx(hook)
      hook = 0
    }
  }
}

process.on('message', (message: GuardConfig) => {
  config = message
})
// The main process is gone: stop too.
process.on('disconnect', () => process.exit(0))

run().catch((err) => {
  tell({ type: 'failed', message: err instanceof Error ? err.message : String(err) })
  console.error('Clicker guard: could not start:', err)
  setTimeout(() => process.exit(1), 100)
})
