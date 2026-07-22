import { useState } from "react"
import { useLocalIp, useUdpListener, usePing, useDiscoveredDevices, useTestLog } from "../../hooks/useNetworkTest"
import { isTauri } from "../../lib/tauri"
import { cn } from "../../lib/utils"
import {
  Radio, RadioTower, Activity, Clock, Download, RotateCcw,
  Play, Square, AlertTriangle, Wifi, Server,
} from "lucide-react"

const DEFAULT_PORT = 45000

export default function NetworkTestPage() {
  const localIp = useLocalIp()
  const listener = useUdpListener()
  const ping = usePing()
  const { devices, clear: clearDevices, refresh: refreshDevices } = useDiscoveredDevices()
  const log = useTestLog()

  const [pingPort, setPingPort] = useState(DEFAULT_PORT)
  const [pingTimeout, setPingTimeout] = useState(3000)
  const [listeningPort, setListeningPort] = useState(DEFAULT_PORT)
  const [statusMsg, setStatusMsg] = useState("")

  const showStatus = (msg: string) => {
    setStatusMsg(msg)
    setTimeout(() => setStatusMsg(""), 4000)
  }

  const handleStartListener = async () => {
    try {
      await listener.start(listeningPort)
      showStatus(`Listener started on port ${listeningPort}`)
    } catch (e) {
      showStatus(`Failed to start: ${e}`)
    }
  }

  const handleStopListener = async () => {
    try {
      await listener.stop()
      showStatus("Listener stopped")
    } catch (e) {
      showStatus(`Failed to stop: ${e}`)
    }
  }

  const handlePing = async () => {
    if (!isTauri()) {
      showStatus("Ping hanya tersedia di mode Tauri Desktop")
      return
    }
    showStatus(`Broadcasting ping on port ${pingPort}...`)
    const result = await ping.send(pingPort, pingTimeout)
    if (result) {
      showStatus(`Found ${result.totalDevices} device(s) in ${pingTimeout}ms`)
    }
  }

  const handleRefreshDevices = () => {
    refreshDevices()
    showStatus("Device list refreshed")
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  const successfulPings = log.entries.filter((e) => e.action === "send_ping" && e.success).length
  const failedPings = log.entries.filter((e) => e.action === "send_ping" && !e.success).length
  const totalPings = successfulPings + failedPings

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Network Test</h1>
          <p className="text-sm text-muted-foreground">
            Uji koneksi LAN multi-user sebelum release
          </p>
        </div>
        {!isTauri() && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Beberapa fitur hanya tersedia di Tauri Desktop
          </div>
        )}
      </div>

      {statusMsg && (
        <div className="rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow-sm">
          {statusMsg}
        </div>
      )}

      {/* Row: Device Info + Listener */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* ── My Device ────────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Wifi className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">My Device</h2>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">IP Address</span>
              <span className="font-mono text-sm font-medium">{localIp ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Listener</span>
              <span className={cn(
                "flex items-center gap-1.5 text-sm font-medium",
                listener.active ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
              )}>
                <span className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  listener.active ? "bg-green-500 animate-pulse" : "bg-gray-300",
                )} />
                {listener.active ? `Active on port ${listener.port}` : "Inactive"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                value={listeningPort}
                onChange={(e) => setListeningPort(Number(e.target.value))}
                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
                placeholder="Port"
                min={1024}
                max={65535}
              />
              {listener.active ? (
                <button
                  onClick={handleStopListener}
                  className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleStartListener}
                  disabled={!isTauri()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  Start
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Ping Test ────────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Radio className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Ping Test</h2>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Port</label>
                <input
                  type="number"
                  value={pingPort}
                  onChange={(e) => setPingPort(Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  min={1024}
                  max={65535}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Timeout (ms)</label>
                <input
                  type="number"
                  value={pingTimeout}
                  onChange={(e) => setPingTimeout(Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  min={500}
                  max={10000}
                />
              </div>
              <div className="pt-4">
                <button
                  onClick={handlePing}
                  disabled={ping.sending || !isTauri()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {ping.sending ? (
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <RadioTower className="h-3.5 w-3.5" />
                  )}
                  {ping.sending ? "..." : "Ping"}
                </button>
              </div>
            </div>

            {ping.results && (
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Responses: {ping.results.totalDevices} device(s)
                </div>
                {ping.results.responses.length > 0 ? (
                  <div className="space-y-1">
                    {ping.results.responses.map((r) => (
                      <div key={r.deviceIp} className="flex items-center justify-between rounded-md bg-background px-2 py-1 text-xs">
                        <span className="font-mono">{r.deviceIp}</span>
                        <span className="flex items-center gap-1 font-medium text-green-600 dark:text-green-400">
                          <Activity className="h-3 w-3" />
                          {r.latencyMs}ms
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    No devices responded
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Discovered Devices ───────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Discovered Devices</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {devices.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefreshDevices}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              onClick={clearDevices}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="p-4">
          {devices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No devices discovered yet. Start the listener and send a ping.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">IP Address</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Latency</th>
                    <th className="pb-2 font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => {
                    const lastSeen = new Date(d.lastSeenMs)
                    const now = Date.now()
                    const age = now - d.lastSeenMs
                    const status = age < 15000 ? "connected" : age < 60000 ? "unstable" : "disconnected"
                    return (
                      <tr key={d.ip} className="border-b last:border-0">
                        <td className="py-2 font-mono text-xs">{d.ip}</td>
                        <td className="py-2">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            status === "connected" && "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
                            status === "unstable" && "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
                            status === "disconnected" && "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                          )}>
                            <span className={cn(
                              "inline-block h-1.5 w-1.5 rounded-full",
                              status === "connected" && "bg-green-500",
                              status === "unstable" && "bg-amber-500",
                              status === "disconnected" && "bg-red-500",
                            )} />
                            {status === "connected" ? "Connected" : status === "unstable" ? "Unstable" : "Disconnected"}
                          </span>
                        </td>
                        <td className="py-2 font-mono text-xs">
                          {d.latencyMs != null ? `${d.latencyMs}ms` : "—"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {lastSeen.toLocaleTimeString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
          <p className="text-xs text-muted-foreground">Total Pings</p>
          <p className="mt-1 text-2xl font-bold">{totalPings}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
          <p className="text-xs text-muted-foreground">Successful</p>
          <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">{successfulPings}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
          <p className="text-xs text-muted-foreground">Failed</p>
          <p className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{failedPings}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
          <p className="text-xs text-muted-foreground">Devices Found</p>
          <p className="mt-1 text-2xl font-bold">{devices.length}</p>
        </div>
      </div>

      {/* ── Log ────────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Test Log</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {log.entries.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={log.downloadCsv}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              onClick={log.clearLog}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {log.entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No log entries yet
            </p>
          ) : (
            <div className="space-y-0.5">
              {log.entries.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/50"
                >
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {entry.timestamp.slice(11, 23)}
                  </span>
                  <span className={cn(
                    "shrink-0 rounded px-1 font-medium",
                    entry.success
                      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                      : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                  )}>
                    {entry.action}
                  </span>
                  <span className="text-muted-foreground">{entry.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
