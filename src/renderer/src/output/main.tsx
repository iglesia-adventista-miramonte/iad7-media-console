import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../theme.css'
import './output.css'
import { AudioPlayer } from './AudioPlayer'
import { LiveOutput } from './LiveOutput'
import { TestScreen } from './TestScreen'
import { LanguageRoot } from '../language'

// The same page is used for test windows (?mode=test), live output windows
// (?mode=live) and the hidden audio window (?mode=audio).
const mode = new URLSearchParams(location.search).get('mode')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageRoot render={() => (mode === 'test' ? <TestScreen /> : mode === 'audio' ? <AudioPlayer /> : <LiveOutput />)} />
  </StrictMode>
)
