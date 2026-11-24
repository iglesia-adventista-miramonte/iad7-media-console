import { useEffect, useState, type ReactNode } from 'react'
import { setLanguage } from './strings'

/**
 * The top of each app window (control, output, test). It sets the language
 * when the page loads, and draws the page again when the operator picks
 * another language. The page is drawn again, not reloaded, so a video on an
 * output screen keeps playing.
 *
 * `render` is called on each change, so every part of the page reads the new
 * text from `strings`.
 */
export function LanguageRoot({ render }: { render: () => ReactNode }) {
  const api = window.mediaConsole
  const [language, setShown] = useState(() => {
    setLanguage(api.initialLanguage)
    return api.initialLanguage
  })
  useEffect(
    () =>
      api.onLanguageChanged((next) => {
        setLanguage(next)
        setShown(next)
      }),
    []
  )
  document.documentElement.lang = language
  return <>{render()}</>
}
