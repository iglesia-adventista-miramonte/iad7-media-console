import { useEffect, useState } from 'react'
import type { ClockCorner, ClockSettings, OutputStatus } from '../../../shared/types'
import { formatClock, useNow } from '../view/clock'
import { strings } from '../strings'

const api = window.mediaConsole

/** The corner clock settings: read when the component opens, then kept up to date. */
export function useClock(): [ClockSettings | null, (change: Partial<ClockSettings>) => void] {
  const [clock, setClock] = useState<ClockSettings | null>(null)
  useEffect(() => {
    void api.getClock().then(setClock)
    return api.onClockChanged(setClock)
  }, [])
  return [clock, (change) => void api.updateClock(change).then(setClock)]
}

/** Width of the clock for each 1 unit of height. Same numbers as the clock window (src/main/clockWindow.ts). */
const clockAspect = (seconds: boolean): number => (seconds ? 3.9 : 2.7)

/**
 * The corner clock drawn on a screen preview (a 16:9 box), in the same corner
 * and at the same size as on the real screen. Put it inside a box with
 * `position: relative`.
 */
export function PreviewClock({ clock }: { clock: ClockSettings }) {
  const now = useNow(1000)
  const size = Math.min(40, Math.max(3, clock.size))
  // The margin on the real screen is 2 % of the screen height. In a 16:9 box that is 2 % of
  // the height and 2 × 9/16 % of the width.
  const vertical = clock.corner.startsWith('top') ? { top: '2%' } : { bottom: '2%' }
  const horizontal = clock.corner.endsWith('left') ? { left: '1.125%' } : { right: '1.125%' }
  const time = clock.seconds
    ? `${formatClock(now)}:${String(new Date(now).getSeconds()).padStart(2, '0')}`
    : formatClock(now)
  return (
    <div
      className={`preview-clock${clock.background ? ' preview-clock-box' : ''}`}
      style={{ ...vertical, ...horizontal, height: `${size}%`, aspectRatio: clockAspect(clock.seconds) }}
      title={strings.cornerClockLabel}
    >
      <span>{time}</span>
    </div>
  )
}

/** Setup page: the corner clock above everything on one screen (SPEC 7.1). */
export function ClockSection({ outputs }: { outputs: OutputStatus[] }) {
  const [clock, update] = useClock()
  if (!clock) return null
  const corners: [ClockCorner, string][] = [
    ['top-left', strings.cornerTopLeft],
    ['top-right', strings.cornerTopRight],
    ['bottom-left', strings.cornerBottomLeft],
    ['bottom-right', strings.cornerBottomRight]
  ]
  const chosen = outputs.find((o) => o.output.id === clock.outputId)

  return (
    <section className="panel">
      <h2 className="label">{strings.cornerClockLabel}</h2>
      <p className="help">{strings.cornerClockHelp}</p>
      <div className="remote-row">
        <label className="switch">
          <input type="checkbox" role="switch" checked={clock.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <span className="switch-track" />
          {strings.cornerClockOn}
        </label>
        <label className="remote-field">
          {strings.cornerClockScreen}
          <select className="input select" value={clock.outputId ?? ''} onChange={(e) => update({ outputId: e.target.value || null })}>
            <option value="">{strings.cornerClockNoScreen}</option>
            {outputs.map((o) => (
              <option key={o.output.id} value={o.output.id}>
                {o.output.name}
              </option>
            ))}
          </select>
        </label>
        <label className="remote-field">
          {strings.cornerClockCorner}
          <select className="input select" value={clock.corner} onChange={(e) => update({ corner: e.target.value as ClockCorner })}>
            {corners.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="remote-row">
        <label className="remote-field clock-size">
          {strings.cornerClockSize}
          <input type="range" min={3} max={40} step={1} value={clock.size} onChange={(e) => update({ size: Number(e.target.value) })} />
          <span className="mono small">{clock.size}%</span>
        </label>
        <label className="check small">
          <input type="checkbox" checked={clock.seconds} onChange={(e) => update({ seconds: e.target.checked })} />
          {strings.cornerClockSeconds}
        </label>
        <label className="check small">
          <input type="checkbox" checked={clock.background} onChange={(e) => update({ background: e.target.checked })} />
          {strings.cornerClockBackground}
        </label>
      </div>
      {clock.enabled && !clock.outputId && <p className="warn small">{strings.cornerClockPickScreen}</p>}
      {clock.enabled && chosen && !chosen.screen && <p className="warn small">{strings.cornerClockNotConnected}</p>}
    </section>
  )
}

/** Stage tab: turn the corner clock on and off quickly. */
export function ClockToggle() {
  const [clock, update] = useClock()
  if (!clock) return null
  return (
    <label className="check small" title={strings.cornerClockHelp}>
      <input type="checkbox" checked={clock.enabled} disabled={!clock.outputId} onChange={(e) => update({ enabled: e.target.checked })} />
      {clock.outputId ? strings.cornerClockOn : strings.cornerClockSetUpFirst}
    </label>
  )
}
