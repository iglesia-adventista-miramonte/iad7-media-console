import { useEffect, useState } from 'react'
import type { ClockRender } from '../../../shared/types'
import { formatClock, useNow } from '../view/clock'

const api = window.mediaConsole

/** "10:42:05": the 24-hour clock with seconds. */
function withSeconds(now: number): string {
  return `${formatClock(now)}:${String(new Date(now).getSeconds()).padStart(2, '0')}`
}

/**
 * The corner clock window (SPEC 7.1): only the time, as large as the window.
 * The window size sets the clock size, so the text is sized in vh.
 */
export function CornerClock() {
  const [render, setRender] = useState<ClockRender | null>(null)
  useEffect(() => api.onClockRender(setRender), [])
  // The page and the window are transparent: only the clock shows.
  useEffect(() => document.documentElement.classList.add('clock-page'), [])
  const now = useNow(render?.seconds ? 200 : 1000)
  if (!render) return null
  return (
    <div className={`corner-clock${render.background ? ' corner-clock-box' : ''}`}>
      {render.seconds ? withSeconds(now) : formatClock(now)}
    </div>
  )
}
