import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AppProviders } from './app/providers'
import { createAppRuntime } from './app/runtime'
import { createAppI18n } from './i18n'
import './styles/globals.css'

const runtime = createAppRuntime()
const language = await createAppI18n()
const target = document.getElementById('app')
if (!target) throw new Error('Application mount element is missing')
createRoot(target).render(
  <StrictMode>
    <AppProviders runtime={runtime} language={language}>
      <App />
    </AppProviders>
  </StrictMode>,
)
