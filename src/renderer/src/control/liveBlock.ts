import type { LiveBlock } from '../../../shared/types'
import { strings } from '../strings'

/**
 * Show a message when the main process did not do an action because something
 * is on the screens. `action` is a short text from strings (for example
 * strings.liveBlockedNew). Returns true when the action was blocked.
 */
export function warnIfLive(result: LiveBlock | void, action: string): boolean {
  if (result !== 'live') return false
  window.alert(strings.liveBlocked(action))
  return true
}
