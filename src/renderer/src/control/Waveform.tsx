import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Waveform } from '../../../shared/types'
import { formatTime, strings } from '../strings'

const api = window.mediaConsole

/** Waveforms already asked for, by media:// address. The main process makes each one only once. */
const known = new Map<string, Promise<Waveform | null>>()

/** The waveform of a file, or null while it is made (or when it cannot be read). */
export function useWaveform(url: string | undefined): Waveform | null {
  const [wave, setWave] = useState<Waveform | null>(null)
  useEffect(() => {
    setWave(null)
    if (!url) return
    let request = known.get(url)
    if (!request) {
      request = api.waveform(url).catch(() => null)
      known.set(url, request)
      // Not made (for example the file is still copying): ask again next time.
      void request.then((w) => !w && known.delete(url))
    }
    let current = true
    void request.then((w) => current && setWave(w))
    return () => {
      current = false
    }
  }, [url])
  return wave
}

/**
 * A time bar with the waveform of the sound behind it. The part that already
 * played has the accent color. `children` is the input that seeks (a range
 * input over the whole bar); without it the bar only shows.
 */
export function WaveTrack(props: {
  wave: Waveform | null
  duration: number
  time: number
  accent: 'live' | 'preview'
  children?: ReactNode
  className?: string
}) {
  const { wave, duration, time, accent, children, className } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const total = duration || (wave ? wave.peaks.length * wave.step : 0)

  // Follow the width of the bar.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => setWidth(canvas.clientWidth))
    observer.observe(canvas)
    setWidth(canvas.clientWidth)
    return () => observer.disconnect()
  }, [])

  // The loudest value for each column of pixels. Made again only when the width or the file changes.
  const columns = useMemo(() => {
    if (!wave || !width || !total) return null
    const out = new Float32Array(width)
    for (let x = 0; x < width; x++) {
      const from = Math.floor(((x / width) * total) / wave.step)
      const to = Math.max(from + 1, Math.floor((((x + 1) / width) * total) / wave.step))
      let peak = 0
      for (let i = from; i < to && i < wave.peaks.length; i++) if (wave.peaks[i] > peak) peak = wave.peaks[i]
      out[x] = peak
    }
    return out
  }, [wave, width, total])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width) return
    const ratio = window.devicePixelRatio || 1
    const height = canvas.clientHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const g = canvas.getContext('2d')
    if (!g) return
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.clearRect(0, 0, width, height)
    const style = getComputedStyle(canvas)
    const played = style.getPropertyValue(accent === 'live' ? '--live' : '--preview').trim() || '#d13438'
    const rest = style.getPropertyValue('--text-2').trim() || '#9aa0a8'
    const mid = height / 2
    const playedX = total ? (Math.min(time, total) / total) * width : 0

    if (columns) {
      for (let x = 0; x < width; x++) {
        // Square root: quiet sound still shows, so a soft start is visible.
        const h = Math.max(1, Math.sqrt(columns[x]) * (height - 2))
        g.fillStyle = x < playedX ? played : rest
        g.globalAlpha = x < playedX ? 1 : 0.55
        g.fillRect(x, mid - h / 2, 1, h)
      }
    } else {
      // No waveform (yet): a thin line, like a normal time bar.
      g.globalAlpha = 0.55
      g.fillStyle = rest
      g.fillRect(0, mid - 1, width, 2)
      g.globalAlpha = 1
      g.fillStyle = played
      g.fillRect(0, mid - 1, playedX, 2)
    }
    // The playhead.
    g.globalAlpha = 1
    g.fillStyle = played
    g.fillRect(Math.min(width - 2, Math.max(0, playedX - 1)), 0, 2, height)
  }, [columns, width, time, total, accent])

  return (
    <div className={['wave-track', className].filter(Boolean).join(' ')}>
      <canvas ref={canvasRef} className="wave-canvas" />
      {children}
    </div>
  )
}

/**
 * A short note next to the time bar when the sound is not heard now: the file
 * has no sound, or the sound starts later in the file (seconds of quiet at the start).
 */
export function WaveNote({ wave, time }: { wave: Waveform | null; time: number }) {
  if (!wave) return null
  if (wave.noAudio) return <span className="wave-note">{strings.waveNoAudio}</span>
  if (wave.firstSound === null) return <span className="wave-note">{strings.waveAllQuiet}</span>
  // Only a real wait (more than one second), and only before the sound starts.
  if (wave.firstSound > 1 && time < wave.firstSound - 0.3) {
    return (
      <span className="wave-note" title={strings.waveSoundStartsHint}>
        {strings.waveSoundStarts(formatTime(wave.firstSound), formatTime(wave.firstSound - time))}
      </span>
    )
  }
  return null
}
