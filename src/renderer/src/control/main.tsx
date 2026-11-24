import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../theme.css'
import './control.css'
import { App } from './App'
import { LanguageRoot } from '../language'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageRoot render={() => <App />} />
  </StrictMode>
)
