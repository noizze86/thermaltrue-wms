import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "./contexts/ThemeContext"
import { OfflineProvider } from "./contexts/OfflineContext"
import App from "./App"
import "./index.css"

// Guard: prevent any <a> click from causing full-page navigation
// (but let download anchors through so blob: URLs still trigger file downloads)
document.addEventListener("click", (e) => {
  const a = (e.target as Element)?.closest?.("a");
  if (!a) return;
  if (a.hasAttribute("download")) return;
  const href = a.getAttribute("href");
  if (href && !href.startsWith("#") && !href.startsWith("http") && !href.startsWith("tauri") && !href.startsWith("mailto") && !href.startsWith("blob:")) {
    e.preventDefault();
    window.location.hash = href;
  }
}, false);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <OfflineProvider>
        <App />
      </OfflineProvider>
    </ThemeProvider>
  </StrictMode>
)
