import { useState, useEffect, useCallback, useRef } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { tauriInvoke, isTauri } from "../lib/tauri"

// ── Types ─────────────────────────────────────────────────────────────────

export interface TestLogEntry {
  timestamp: string
  action: string
  detail: string
  success: boolean
}

export interface PingResponse {
  deviceIp: string
  latencyMs: number
  success: boolean
  error?: string
}

export interface PingResult {
  responses: PingResponse[]
  totalDevices: number
}

export interface DeviceEntry {
  ip: string
  lastSeenMs: number
  latencyMs: number | null
}

export interface PingReceivedEvent {
  deviceIp: string
}

// ── Hook: useLocalIp ──────────────────────────────────────────────────────

export function useLocalIp(): string | null {
  const [ip, setIp] = useState<string | null>(null)
  const fetched = useRef(false)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    if (!isTauri()) {
      setIp("Browser mode")
      return
    }
    tauriInvoke<string>("get_local_ip").then((result) => {
      if (result) setIp(result)
    })
  }, [])

  return ip
}

// ── Hook: useUdpListener ──────────────────────────────────────────────────

export function useUdpListener() {
  const [active, setActive] = useState(false)
  const [port, setPort] = useState(45000)

  useEffect(() => {
    if (!isTauri()) return
    tauriInvoke<boolean>("get_listener_status").then(setActive)
    tauriInvoke<number>("get_listener_port").then((p) => {
      if (p && p > 0) setPort(p)
    })
  }, [])

  const start = useCallback(async (listenPort: number) => {
    setActive(true)
    setPort(listenPort)
    if (!isTauri()) return
    try {
      await tauriInvoke<void>("start_udp_listener", { port: listenPort })
    } catch {
      // will be caught by caller
    }
  }, [])

  const stop = useCallback(async () => {
    setActive(false)
    if (!isTauri()) return
    try {
      await tauriInvoke<void>("stop_udp_listener")
    } catch {
      // silently ignore
    }
  }, [])

  return { active, port, setPort, start, stop }
}

// ── Hook: usePing ─────────────────────────────────────────────────────────

export function usePing() {
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<PingResult | null>(null)

  const send = useCallback(async (port: number, timeoutMs: number): Promise<PingResult | null> => {
    if (!isTauri()) return null
    setSending(true)
    try {
      const result = await tauriInvoke<PingResult>("send_ping", { port, timeoutMs })
      if (result) setResults(result)
      return result
    } finally {
      setSending(false)
    }
  }, [])

  return { send, sending, results, setResults }
}

// ── Hook: useDiscoveredDevices ────────────────────────────────────────────

export function useDiscoveredDevices() {
  const [devices, setDevices] = useState<DeviceEntry[]>([])

  const fetchDevices = useCallback(async () => {
    if (!isTauri()) return
    const list = await tauriInvoke<DeviceEntry[]>("get_discovered_devices")
    if (list) setDevices(list)
  }, [])

  // Poll devices every 3 seconds
  useEffect(() => {
    if (!isTauri()) return
    fetchDevices()
    const interval = setInterval(fetchDevices, 3000)
    return () => clearInterval(interval)
  }, [fetchDevices])

  // Listen for ping-received events
  useEffect(() => {
    if (!isTauri()) return
    let unlisten: UnlistenFn | undefined
    listen<PingReceivedEvent>("ping-received", () => {
      fetchDevices()
    }).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  }, [fetchDevices])

  // Listen for pong-results events
  useEffect(() => {
    if (!isTauri()) return
    let unlisten: UnlistenFn | undefined
    listen("pong-results", () => {
      fetchDevices()
    }).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  }, [fetchDevices])

  const clear = useCallback(async () => {
    if (!isTauri()) return
    await tauriInvoke<void>("clear_discovered_devices")
    setDevices([])
  }, [])

  return { devices, clear, refresh: fetchDevices }
}

// ── Hook: useTestLog ──────────────────────────────────────────────────────

export function useTestLog() {
  const [entries, setEntries] = useState<TestLogEntry[]>([])
  const [loading, setLoading] = useState(false)

  const fetchLog = useCallback(async (limit = 100) => {
    if (!isTauri()) return
    setLoading(true)
    try {
      const log = await tauriInvoke<TestLogEntry[]>("get_test_log", { limit })
      if (log) setEntries(log)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLog()
    const interval = setInterval(() => fetchLog(), 2000)
    return () => clearInterval(interval)
  }, [fetchLog])

  const clearLog = useCallback(async () => {
    if (!isTauri()) return
    await tauriInvoke<void>("clear_test_log")
    setEntries([])
  }, [])

  const exportCsv = useCallback(async () => {
    if (!isTauri()) return ""
    const csv = await tauriInvoke<string>("export_test_log_csv")
    return csv ?? ""
  }, [])

  const downloadCsv = useCallback(async () => {
    const csv = await exportCsv()
    if (!csv) return
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `network-test-${new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [exportCsv])

  return { entries, loading, fetchLog, clearLog, exportCsv, downloadCsv }
}
