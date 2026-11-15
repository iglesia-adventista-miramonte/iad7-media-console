import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { YoutubeChoices, YoutubeInfo, YoutubeMode } from '../../../shared/types'
import { formatTime, strings } from '../strings'

const api = window.mediaConsole

/** A link that looks like a video page (YouTube or another site yt-dlp knows). */
function looksLikeLink(text: string): boolean {
  return /^https?:\/\/\S+\.\S+/i.test(text.trim()) || /^(www\.)?(youtube\.com|youtu\.be)\//i.test(text.trim())
}

function fullLink(text: string): string {
  const t = text.trim()
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

/**
 * Add a YouTube video or song: paste the link, the app looks it up, then
 * choose video or MP3, the picture size and the folder. The item is added to
 * the playlist at once and downloads there. The keys stay inside this window.
 */
export function YoutubeDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (itemId: string) => void }) {
  const [link, setLink] = useState('')
  const [info, setInfo] = useState<YoutubeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [setup, setSetup] = useState<number | null>(null)
  const [choices, setChoices] = useState<YoutubeChoices | null>(null)
  const [mode, setMode] = useState<YoutubeMode>('video')
  const [height, setHeight] = useState(1080)
  const [folder, setFolder] = useState('')
  const lookedUp = useRef('')

  useEffect(() => {
    void api.youtubeChoices().then((c) => {
      setChoices(c)
      setMode(c.mode)
      setHeight(c.height)
      setFolder(c.folder)
    })
    return api.onYoutubeSetup(setSetup)
  }, [])

  const lookup = async (text: string) => {
    if (!looksLikeLink(text)) return
    const url = fullLink(text)
    if (url === lookedUp.current) return
    lookedUp.current = url
    setLooking(true)
    setError(null)
    setInfo(null)
    const result = await api.youtubeLookup(url)
    // The link changed while it looked up: keep only the answer for the last link.
    if (lookedUp.current !== url) return
    setLooking(false)
    if (result.error || !result.info) {
      setError(result.error ?? '')
      lookedUp.current = ''
      return
    }
    setInfo(result.info)
    // Use the remembered size, or the largest one below it.
    const heights = result.info.heights.map((h) => h.height)
    const wanted = choices?.height ?? 1080
    setHeight(heights.find((h) => h <= wanted) ?? heights.at(-1) ?? wanted)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!info) return void lookup(link)
    if (!folder) return
    const id = await api.addYoutube({ url: info.url, title: info.title, duration: info.duration, mode, height, folder })
    onAdded(id)
    onClose()
  }

  const pickFolder = async () => {
    const chosen = await api.youtubePickFolder(folder)
    if (chosen) setFolder(chosen)
  }

  const audioSize = info ? strings.ytBytes(info.audioBytes) : ''

  return (
    <div
      className="dialog-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <form className="dialog yt-dialog" tabIndex={-1} onClick={(e) => e.stopPropagation()} onSubmit={(e) => void submit(e)}>
        <div className="dialog-head">
          <h2 className="bible-title">{strings.ytTitle}</h2>
          <div className="spacer" />
          <button type="button" className="btn btn-small btn-quiet" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="yt-link-row">
          <input
            className="input"
            value={link}
            autoFocus
            spellCheck={false}
            placeholder={strings.ytLinkPlaceholder}
            onChange={(e) => {
              setLink(e.target.value)
              // A pasted link is looked up at once.
              if (looksLikeLink(e.target.value) && fullLink(e.target.value) !== lookedUp.current) void lookup(e.target.value)
            }}
          />
          <button type="button" className="btn" disabled={!looksLikeLink(link) || looking} onClick={() => void lookup(link)}>
            {strings.ytLookup}
          </button>
        </div>

        {setup !== null && <p className="dim small">{strings.ytSetup(setup)}</p>}
        {looking && setup === null && <p className="dim small">{strings.ytLooking}</p>}
        {error !== null && <p className="warn small">{error || strings.downloadError}</p>}

        {info && (
          <>
            <div className="yt-found">
              {info.thumbnail ? <img className="yt-thumb" src={info.thumbnail} alt="" /> : <div className="yt-thumb" />}
              <div className="yt-found-text">
                <span className="selected-title">{info.title}</span>
                <span className="dim small">
                  {[info.channel, info.duration ? formatTime(info.duration) : ''].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>

            <div className="preset-field">
              <span className="label-inline">{strings.ytKind}</span>
              <div className="chips">
                <button type="button" className={mode === 'video' ? 'chip is-on' : 'chip'} onClick={() => setMode('video')}>
                  {strings.ytVideo}
                </button>
                <button type="button" className={mode === 'audio' ? 'chip is-on' : 'chip'} onClick={() => setMode('audio')}>
                  {strings.ytAudio}
                  {audioSize && <span className="dim"> · {audioSize}</span>}
                </button>
              </div>
            </div>

            {mode === 'video' && (
              <div className="preset-field">
                <span className="label-inline">{strings.ytQuality}</span>
                <div className="chips">
                  {info.heights.map((h) => (
                    <button
                      key={h.height}
                      type="button"
                      className={height === h.height ? 'chip is-on' : 'chip'}
                      onClick={() => setHeight(h.height)}
                    >
                      {strings.ytHeight(h.height)}
                      {h.bytes > 0 && <span className="dim"> · {strings.ytBytes(h.bytes)}</span>}
                    </button>
                  ))}
                </div>
                {height > 1080 && <p className="dim small">{strings.ytBigNote}</p>}
              </div>
            )}
            {mode === 'audio' && <p className="dim small">{strings.ytAudioNote}</p>}

            <div className="preset-field">
              <span className="label-inline">{strings.ytSaveIn}</span>
              <div className="yt-link-row">
                <input className="input mono" value={folder} onChange={(e) => setFolder(e.target.value)} spellCheck={false} />
                <button type="button" className="btn" onClick={() => void pickFolder()}>
                  {strings.ytChange}
                </button>
              </div>
            </div>
            <p className="help small">
              {strings.ytHelp} {strings.ytRights}
            </p>
          </>
        )}

        <div className="preset-actions">
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {strings.ytCancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!info || !folder.trim()}>
            {strings.ytAdd}
          </button>
        </div>
      </form>
    </div>
  )
}
