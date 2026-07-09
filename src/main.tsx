import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import * as Sentry from "@sentry/react"
import { ThemeProvider } from "./contexts/ThemeContext"
import { OfflineProvider } from "./contexts/OfflineContext"
import App from "./App"
import "./index.css"

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <OfflineProvider>
        <App />
      </OfflineProvider>
    </ThemeProvider>
  </StrictMode>
)
