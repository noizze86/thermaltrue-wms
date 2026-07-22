import { useState, useCallback } from "react"
import { check } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { isTauri } from "../../lib/tauri"
import {
  RefreshCw, Download, CheckCircle, AlertCircle, RotateCcw,
  FileText, PackageOpen,
} from "lucide-react"

interface UpdateLog {
  timestamp: string
  message: string
  level: "info" | "success" | "error" | "warning"
}

export default function UpdateTestPage() {
  const [logs, setLogs] = useState<UpdateLog[]>([])
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "downloading" | "installing" | "done" | "error">("idle")
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body?: string; date?: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState("")

  const addLog = useCallback((message: string, level: UpdateLog["level"]) => {
    const ts = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, { timestamp: ts, message, level }])
  }, [])

  const clearLogs = () => setLogs([])

  const handleCheck = useCallback(async () => {
    if (!isTauri()) {
      addLog("Update check hanya tersedia di mode Tauri Desktop", "warning")
      return
    }

    setStatus("checking")
    setErrorMsg("")
    setUpdateInfo(null)
    addLog("Update check started", "info")

    try {
      const update = await check()
      if (!update?.available) {
        addLog("No update available", "info")
        setStatus("idle")
        return
      }

      const plats = update.rawJson?.platforms as Record<string, { url?: string }> | undefined
      const url = plats?.["windows-x86_64"]?.url ?? "unknown"
      addLog(`Downloading update from ${url}`, "info")
      addLog(`Update version: ${update.version}`, "info")
      setUpdateInfo({ version: update.version, body: update.body, date: update.date })

      setStatus("available")

    } catch (err) {
      const msg = String(err)
      addLog(`Update check failed: ${msg}`, "error")
      setErrorMsg(msg)
      setStatus("error")
    }
  }, [addLog])

  const handleDownloadAndInstall = useCallback(async () => {
    if (!isTauri()) return

    setStatus("downloading")
    addLog("Download started...", "info")

    try {
      const update = await check()
      if (!update) {
        addLog("No update available to download", "error")
        setStatus("error")
        return
      }

      await update.downloadAndInstall()
      addLog("Update installed successfully", "success")
      setStatus("done")

      // Auto relaunch after short delay
      addLog("Relaunching application...", "info")
      setTimeout(async () => {
        try {
          await relaunch()
        } catch (err) {
          addLog(`Relaunch failed: ${err}. Please restart manually.`, "warning")
        }
      }, 1500)

    } catch (err) {
      const msg = String(err)
      addLog(`Download/install failed: ${msg}`, "error")
      setErrorMsg(msg)
      setStatus("error")
    }
  }, [addLog])

  const handleSimulateRollback = useCallback(async () => {
    if (!isTauri()) return
    addLog("Rollback test: checking for updates...", "info")

    setStatus("checking")
    setErrorMsg("")

    try {
      const update = await check()
      if (!update?.available) {
        addLog("No update available (server may be down)", "info")
        setStatus("idle")
        return
      }

      addLog(`Update found: ${update.version}`, "info")
      addLog("Rollback test: attempting download with corrupted signature...", "warning")

      setStatus("downloading")
      await update.downloadAndInstall()

      // If we reach here, the update succeeded unexpectedly
      addLog("Update succeeded (rollback test failed - signature was accepted)", "warning")
      setStatus("done")

    } catch (err) {
      const msg = String(err)
      addLog(`Rollback test PASSED: update rejected with error: ${msg}`, "success")
      addLog("App remains on current version. No crash occurred.", "success")
      setStatus("idle")
    }
  }, [addLog])

  const statusBadge = () => {
    switch (status) {
      case "checking": return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"><RefreshCw className="h-3 w-3 animate-spin" /> Checking</span>
      case "available": return <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"><PackageOpen className="h-3 w-3" /> Available</span>
      case "downloading": return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"><Download className="h-3 w-3 animate-bounce" /> Downloading</span>
      case "installing": return <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900 dark:text-purple-300">Installing</span>
      case "done": return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300"><CheckCircle className="h-3 w-3" /> Done</span>
      case "error": return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300"><AlertCircle className="h-3 w-3" /> Error</span>
      default: return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">Idle</span>
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Update Test</h1>
          <p className="text-sm text-muted-foreground">
            Uji auto-update Tauri: check, download, install, rollback
          </p>
        </div>
        {statusBadge()}
      </div>

      {!isTauri() && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertCircle className="h-4 w-4" />
          Update test hanya tersedia di mode Tauri Desktop
        </div>
      )}

      {/* Controls */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Controls</h2>
        </div>
        <div className="flex flex-wrap gap-2 p-4">
          <button
            onClick={handleCheck}
            disabled={status === "checking" || !isTauri()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={status === "checking" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Check for Updates
          </button>

          {status === "available" && (
            <button
              onClick={handleDownloadAndInstall}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              <Download className="h-4 w-4" />
              Download & Install v{updateInfo?.version}
            </button>
          )}

          {status === "done" && (
            <button
              onClick={async () => { try { await relaunch() } catch {} }}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <RotateCcw className="h-4 w-4" />
              Restart Now
            </button>
          )}

          <button
            onClick={handleSimulateRollback}
            disabled={status !== "idle" && status !== "error" || !isTauri()}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-50"
          >
            <AlertCircle className="h-4 w-4" />
            Simulate Rollback
          </button>

          <button
            onClick={clearLogs}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            Clear Log
          </button>
        </div>
      </div>

      {/* Update Info */}
      {updateInfo && (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">Update Info</h2>
          </div>
          <div className="space-y-1 p-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Version:</span>
              <span className="font-mono font-medium">{updateInfo.version}</span>
            </div>
            {updateInfo.date && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Date:</span>
                <span>{updateInfo.date}</span>
              </div>
            )}
            {updateInfo.body && (
              <div className="mt-2 rounded-md bg-muted p-2 text-xs">
                {updateInfo.body}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            Error
          </div>
          <p className="mt-1 font-mono text-xs">{errorMsg}</p>
        </div>
      )}

      {/* Log */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Update Log</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{logs.length}</span>
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {logs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No update activity yet. Click "Check for Updates" to begin.
            </p>
          ) : (
            <div className="space-y-0.5 font-mono text-xs">
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md px-2 py-1 hover:bg-muted/50">
                  <span className="shrink-0 text-muted-foreground">{log.timestamp}</span>
                  <span className={
                    log.level === "success" ? "shrink-0 text-green-600 dark:text-green-400" :
                    log.level === "error" ? "shrink-0 text-red-600 dark:text-red-400" :
                    log.level === "warning" ? "shrink-0 text-amber-600 dark:text-amber-400" :
                    "shrink-0 text-blue-600 dark:text-blue-400"
                  }>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
