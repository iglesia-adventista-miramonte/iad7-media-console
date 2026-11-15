import { useEffect, useState } from 'react'
import type { CaptureSource, ContentLayer, ItemSettings, ServiceItem, ServiceState } from '../../../shared/types'
import { strings } from '../strings'
import { ScreenView } from '../view/ScreenView'
import { NotesAndStatus, PreviewStage, TargetSelect } from './PreviewPanel'

const api = window.mediaConsole
const noOverlays = { black: false, logo: false }
const blackIdle = { kind: 'black' as const, media: [], interval: 8 }
const cropSides = ['cropTop', 'cropBottom', 'cropLeft', 'cropRight'] as const

/**
 * Choose a window of another program (a browser, Zoom, a PowerPoint from a
 * visitor). The keys stay inside this window, so they never reach the live controls.
 */
export function CaptureDialog({ onChoose, onClose }: { onChoose: (source: CaptureSource) => void; onClose: () => void }) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const load = () => {
    setSources(null)
    void api.captureSources().then(setSources)
  }
  useEffect(load, [])

  return (
    <div
      className="dialog-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="dialog capture-dialog" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 className="bible-title">{strings.captureDialogTitle}</h2>
          <div className="spacer" />
          <button className="btn btn-small" onClick={load}>
            ↻ {strings.captureRefresh}
          </button>
          <button className="btn btn-small btn-quiet" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="help small">{strings.captureDialogHelp}</p>
        <div className="capture-grid">
          {sources === null && <p className="dim">{strings.captureLoading}</p>}
          {sources?.length === 0 && <p className="dim">{strings.captureNone}</p>}
          {sources?.map((s) => (
            <button key={s.id} className="capture-source" title={s.name} onClick={() => onChoose(s)}>
              <img className="capture-thumb" src={s.thumbnail} alt="" />
              <span className="capture-name">
                {s.appIcon && <img src={s.appIcon} alt="" width={16} height={16} />}
                <span>{s.name}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Preview of a window capture item: the live window, "Change window…", and how much of the edges to cut off. */
export function CapturePreview({ state, item }: { state: ServiceState; item: ServiceItem }) {
  const s = item.settings
  const [choosing, setChoosing] = useState(false)
  const set = (settings: Partial<ItemSettings>) => void api.updateItem(item.id, { settings })
  const content: ContentLayer = { itemId: item.id, type: 'capture', url: '', settings: s, take: -1, playing: true }

  return (
    <section className="panel preview">
      <div className="preview-head">
        <h2 className="label">{strings.previewLabel}</h2>
        <div className="preview-title" title={s.captureName}>
          <span className="selected-title">{item.title}</span>
          <span className="dim mono">{strings.captureFrom(s.captureName ?? '')}</span>
        </div>
        <TargetSelect state={state} />
        <button className="btn btn-live" disabled={!s.captureId} onClick={() => void api.goLive(item.id)}>
          {strings.goLive} ⏎
        </button>
      </div>
      <PreviewStage item={item}>
        <div className="preview-box">
          <ScreenView content={content} idle={blackIdle} overlays={noOverlays} captureFps={15} captureHint />
        </div>
      </PreviewStage>
      <div className="option-grid">
        <div className="option">
          <button className="btn btn-small" onClick={() => setChoosing(true)}>
            {strings.captureChange}
          </button>
          <span className="dim small">{strings.captureNote}</span>
        </div>
        <div className="option">
          <span className="label-inline">{strings.captureCrop}</span>
          <div className="crop-grid">
            {cropSides.map((side) => (
              <label key={side} className="crop-row">
                <span className="dim small">{strings.cropSides[side]}</span>
                <input type="range" min={0} max={40} step={0.5} value={s[side] ?? 0} onChange={(e) => set({ [side]: Number(e.target.value) })} />
                <span className="mono small">{(s[side] ?? 0).toFixed(1)}%</span>
              </label>
            ))}
          </div>
          <div className="button-row tight">
            <button className="btn btn-small btn-quiet" onClick={() => set({ cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 })}>
              {strings.cropReset}
            </button>
            <span className="dim small">{strings.captureCropHint}</span>
          </div>
        </div>
      </div>
      <NotesAndStatus item={item} />
      {choosing && (
        <CaptureDialog
          onClose={() => setChoosing(false)}
          onChoose={(source) => {
            setChoosing(false)
            void api.setCaptureSource(item.id, { id: source.id, name: source.name })
          }}
        />
      )}
    </section>
  )
}
