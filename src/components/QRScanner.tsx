import { useEffect, useRef, useState, useCallback } from "react"
import { Html5Qrcode } from "html5-qrcode"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Scan, Camera, CameraOff, Loader2 } from "lucide-react"

interface QRScannerProps {
  onScan: (result: string) => void
  onClose?: () => void
  autoStart?: boolean
}

type ScannerState = "idle" | "starting" | "active" | "error"

export default function QRScanner({ onScan, onClose, autoStart }: QRScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [state, setState] = useState<ScannerState>(autoStart ? "starting" : "idle")

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop()
      } catch {
        // ignore stop errors
      }
      scannerRef.current = null
    }
    setState("idle")
  }, [])

  const startScanner = useCallback(async () => {
    if (!containerRef.current) return
    setState("starting")

    const id = `qr-reader-${Date.now()}`
    const div = document.createElement("div")
    div.id = id
    containerRef.current.innerHTML = ""
    containerRef.current.appendChild(div)

    try {
      const scanner = new Html5Qrcode(id)
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => {
          onScan(decodedText)
          stopScanner()
        },
        () => {
          // ignore scan failures (continuous scanning)
        },
      )
      setState("active")
    } catch (e) {
      console.error("QR Scanner error:", e)
      setState("error")
    }
  }, [onScan, stopScanner])

  useEffect(() => {
    if (autoStart) startScanner()
    return () => {
      stopScanner()
    }
  }, [autoStart, startScanner, stopScanner])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2"><Scan className="h-5 w-5" /> QR Scanner</span>
          <div className="flex gap-2">
            {state === "idle" && (
              <Button size="sm" onClick={startScanner}><Camera className="h-4 w-4" /> Start</Button>
            )}
            {state === "active" && (
              <Button size="sm" variant="destructive" onClick={stopScanner}><CameraOff className="h-4 w-4" /> Stop</Button>
            )}
            {onClose && <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state === "starting" && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p>Starting camera...</p>
          </div>
        )}
        {state === "active" && (
          <div ref={containerRef} className="w-full rounded-lg overflow-hidden bg-black" />
        )}
        {state === "idle" && !autoStart && (
          <div className="text-center py-12 text-muted-foreground">
            <Scan className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Camera is off</p>
            <p className="text-sm">Click Start to scan QR codes</p>
          </div>
        )}
        {state === "error" && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-red-500">Camera unavailable</p>
            <p className="text-sm mt-1">Could not access the camera. Please check permissions.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
