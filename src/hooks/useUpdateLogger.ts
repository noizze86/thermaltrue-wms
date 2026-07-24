import { useEffect, useRef, useState, useCallback } from "react"
import { check } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { isTauri } from "../lib/tauri"
import { toast } from "./use-toast"

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "done"
  | "error"

export interface UpdateLogEntry {
  timestamp: string
  message: string
  level: "info" | "success" | "error" | "warning"
}

export function useUpdateLogger() {
  const [phase, setPhase] = useState<UpdatePhase>("idle")
  const [logs, setLogs] = useState<UpdateLogEntry[]>([])
  const [updateVersion, setUpdateVersion] = useState<string>("")
  const [errorMsg, setErrorMsg] = useState<string>("")
  const ranOnce = useRef(false)

  const addLog = useCallback((message: string, level: UpdateLogEntry["level"]) => {
    const timestamp = new Date().toLocaleTimeString()
    // console.log is captured by Tauri log plugin
    console.log(`[UPDATE][${level.toUpperCase()}] ${message}`)
    setLogs((prev) => [...prev, { timestamp, message, level }])
  }, [])

  const checkAndInstall = useCallback(async (autoTrigger = false) => {
    if (!isTauri()) return

    setPhase("checking")
    setErrorMsg("")
    addLog("Update check started", "info")

    try {
      const update = await check()

      if (!update?.available) {
        addLog("No update available", "info")
        setPhase("idle")
        return
      }

      const url =
        (update.rawJson?.platforms as Record<string, { url?: string }> | undefined)?.["windows-x86_64"]?.url ??
        (update.rawJson?.platforms as Record<string, { url?: string }> | undefined)?.["darwin-aarch64"]?.url ??
        "unknown"

      addLog(`Update found: version ${update.version}`, "success")
      addLog(`Downloading update from ${url}`, "info")

      setUpdateVersion(update.version)
      setPhase("available")

      if (!autoTrigger) return

      // Auto-mode: proceed with download
      addLog("Auto-update: starting download...", "info")
      setPhase("downloading")

      await update.downloadAndInstall()

      addLog("Update installed successfully", "success")
      setPhase("done")

      toast({
        title: "Update Installed",
        description: `Version ${update.version} has been installed. Restarting...`,
      })

      addLog("Relaunching application...", "info")

      setTimeout(async () => {
        try {
          await relaunch()
        } catch (err) {
          addLog(`Relaunch failed: ${err}. Please restart manually.`, "warning")
          toast({
            title: "Restart Required",
            description: "Please restart the application manually.",
          })
        }
      }, 1500)

    } catch (err) {
      const msg = String(err)
      // ACL / origin errors are expected when running in HTTP mode
      if (msg.includes("not allowed by ACL") || msg.includes("plugin:updater")) {
        addLog(`Update check skipped (HTTP mode): ${msg}`, "info")
        setPhase("idle")
        return
      }
      addLog(`Update error: ${msg}`, "error")
      setErrorMsg(msg)
      setPhase("error")

      // Only show toast for errors that happened after finding an update
      if (phase !== "checking") {
        toast({
          title: "Update Failed",
          description: msg,
          variant: "destructive",
        })
      }
    }
  }, [addLog, phase])

  // Auto-check on mount (TauriUpdateChecker behavior)
  useEffect(() => {
    if (ranOnce.current) return
    ranOnce.current = true
    checkAndInstall(true)
  }, [checkAndInstall])

  const reset = useCallback(() => {
    setPhase("idle")
    setErrorMsg("")
    setUpdateVersion("")
  }, [])

  return {
    phase,
    logs,
    updateVersion,
    errorMsg,
    checkAndInstall,
    reset,
  }
}
