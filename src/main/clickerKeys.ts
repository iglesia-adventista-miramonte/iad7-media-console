import type { ClickerAction } from '../shared/types'

// Shared by the main process (clicker.ts) and the key guard process (clickerGuard.ts).

/** The keys that presenter clickers send (Windows virtual key codes). Anything else from the clicker is ignored. */
export const clickerKeyActions: Record<number, ClickerAction> = {
  0x22: 'next', // Page Down
  0x27: 'next', // →
  0x28: 'next', // ↓
  0x21: 'previous', // Page Up
  0x25: 'previous', // ←
  0x26: 'previous', // ↑
  0x42: 'black', // B
  0xbe: 'black' // .
}

/** The USB maker and model in a Windows device path, or null. */
export function vidPid(path: string): { vid: string; pid: string } | null {
  const vid = /VID[_&]([0-9A-F]+)/i.exec(path)?.[1]
  const pid = /PID[_&]([0-9A-F]+)/i.exec(path)?.[1]
  return vid && pid ? { vid: vid.toUpperCase(), pid: pid.toUpperCase() } : null
}

/**
 * The maker and model of the device (USB VID and PID), for example 046d:c538.
 * They stay the same when the clicker is plugged into another USB port.
 */
export function deviceKey(path: string): string {
  const ids = vidPid(path)
  return ids ? `${ids.vid}:${ids.pid}`.toLowerCase() : path.toLowerCase()
}
