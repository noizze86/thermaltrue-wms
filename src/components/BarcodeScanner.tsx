import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Scan, Camera, CameraOff, Loader2 } from "lucide-react"
import { toast } from "../hooks/use-toast"
import type { Scanned, ScanOptions } from "@tauri-apps/plugin-barcode-scanner"

interface BarcodeScannerProps {
  onScan: (data: string) => void
  onClose?: () => void
  autoStart?: boolean
}

type ScannerState = "idle" | "starting" | "active" | "error"

export default function BarcodeScanner({ onScan, onClose, autoStart }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<ScannerState>(autoStart ? "starting" : "idle")
  const [hasTauriPlugin, setHasTauriPlugin] = useState(false)
  const [hasBarcodeDetector, setHasBarcodeDetector] = useState(false)
  const scanTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof BarcodeDetector !== "undefined") {
      BarcodeDetector.getSupportedFormats().then((formats) => {
        if (formats.length > 0) setHasBarcodeDetector(true)
      }).catch(() => {})
    }
    import("@tauri-apps/plugin-barcode-scanner").then(() => {
      setHasTauriPlugin(true)
    }).catch(() => {})
  }, [])

  const stopStream = useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setState("idle")
  }, [])

  const startScanner = useCallback(async () => {
    setState("starting")

    if (hasTauriPlugin) {
      try {
        const { scan } = await import("@tauri-apps/plugin-barcode-scanner")
        const result: Scanned = await scan({ cameraDirection: "back" } as ScanOptions)
        if (result?.content) {
          onScan(result.content)
          toast({ title: "Scanned", description: result.content })
        }
      } catch (e) {
        toast({ title: "Tauri Scan Failed", description: String(e), variant: "destructive" })
      }
      setState("idle")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setState("active")

        if (hasBarcodeDetector) {
          scanTimerRef.current = window.setInterval(async () => {
            if (!videoRef.current) return
            try {
              const detector = new BarcodeDetector()
              const codes = await detector.detect(videoRef.current)
              if (codes.length > 0 && codes[0].rawValue) {
                onScan(codes[0].rawValue)
                toast({ title: "Scanned", description: codes[0].rawValue })
                stopStream()
              }
            } catch {}
          }, 500)
        }
      }
    } catch {
      setState("error")
      toast({ title: "Camera Error", description: "Could not access camera.", variant: "destructive" })
    }
  }, [hasTauriPlugin, hasBarcodeDetector, onScan, stopStream])

  useEffect(() => {
    if (autoStart) startScanner()
    return () => stopStream()
  }, [autoStart, startScanner, stopStream])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2"><Scan className="h-5 w-5" /> Barcode Scanner</span>
          <div className="flex gap-2">
            {state === "idle" && (
              <Button size="sm" onClick={startScanner}><Camera className="h-4 w-4" /> Start</Button>
            )}
            {state === "active" && (
              <Button size="sm" variant="destructive" onClick={stopStream}><CameraOff className="h-4 w-4" /> Stop</Button>
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
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-black" />
        )}
        {state === "idle" && !autoStart && (
          <div className="text-center py-12 text-muted-foreground">
            <Scan className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Camera is off</p>
            <p className="text-sm">Click Start to scan barcodes</p>
          </div>
        )}
        {state === "error" && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-red-500">Camera unavailable</p>
            <p className="text-sm mt-1">Use the manual input below instead.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBarcodeScanner() {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannedData, setScannedData] = useState<string | null>(null)

  const handleScan = useCallback((data: string) => {
    setScannedData(data)
    setScannerOpen(false)
  }, [])

  return { scannerOpen, setScannerOpen, scannedData, setScannedData, handleScan }
}