import { useState, useEffect, useRef } from "react"
import { getMaterials, generateQrCode, getCompanyProfile, generateQrZip } from "../../api"
import { useQuery } from "@tanstack/react-query"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import { Badge } from "../../components/ui/badge"
import { Checkbox } from "../../components/ui/checkbox"
import { Download, Printer, Scan, Camera, CameraOff, Search, Archive, Grid3X3 } from "lucide-react"
import { toast } from "../../hooks/use-toast"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

export default function QrGeneratorPage() {
  const [selectedId, setSelectedId] = useState("")
  const [customData, setCustomData] = useState("")
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [scannerActive, setScannerActive] = useState(false)
  const [scannedData, setScannedData] = useState("")
  const [materialSearch, setMaterialSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [qrWidth, setQrWidth] = useState(200)
  const [qrHeight, setQrHeight] = useState(200)
  const [qrMargin, setQrMargin] = useState(10)
  const [showLogo, setShowLogo] = useState(false)
  const [companyLogo, setCompanyLogo] = useState("")
  const [generatedQrs, setGeneratedQrs] = useState<{ materialId: string; sku: string; name: string; url: string }[]>([])
  const [thermalLayout, setThermalLayout] = useState(false)
  const [zipLoading, setZipLoading] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<number | null>(null)

  const { data: materials, isLoading, isError, error, refetch } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })

  const filteredMaterials = materials?.filter((m) =>
    m.sku.toLowerCase().includes(materialSearch.toLowerCase()) ||
    m.name.toLowerCase().includes(materialSearch.toLowerCase())
  )

  const allFilteredSelected = filteredMaterials && filteredMaterials.length > 0 &&
    filteredMaterials.every((m) => selectedIds.includes(m.id))

  const toggleSelectAll = () => {
    if (!filteredMaterials) return
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredMaterials.some((m) => m.id === id)))
    } else {
      setSelectedIds((prev) => {
        const ids = new Set(prev)
        filteredMaterials.forEach((m) => ids.add(m.id))
        return Array.from(ids)
      })
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const startScanner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setScannerActive(true)
      }
    } catch {
      toast({ title: "Camera Error", description: "Could not access camera", variant: "destructive" })
    }
  }

  const stopScanner = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    setScannerActive(false)
  }

  useEffect(() => {
    return () => { stopScanner() }
  }, [])

  useEffect(() => {
    if (showLogo && !companyLogo) {
      getCompanyProfile().then((profile) => {
        if (profile?.logo) setCompanyLogo(profile.logo)
      }).catch(() => {})
    }
  }, [showLogo, companyLogo])

  const generate = async () => {
    try {
      const data = selectedId === "custom" ? customData : scannedData || JSON.stringify(materials?.find((m) => m.id === selectedId) || {})
      const url = await generateQrCode(data)
      setQrUrl(url)
    } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  const generateBatch = async () => {
    if (selectedIds.length === 0) return
    setGeneratedQrs([])
    const results: { materialId: string; sku: string; name: string; url: string }[] = []
    for (const id of selectedIds) {
      try {
        const mat = materials?.find((m) => m.id === id)
        const payload = JSON.stringify(mat || { id })
        const url = await generateQrCode(payload)
        results.push({ materialId: id, sku: mat?.sku ?? "", name: mat?.name ?? "", url })
    } catch (e: unknown) {
        toast({ title: "Error", description: `Failed for ${id}: ${e}`, variant: "destructive" })
      }
    }
    setGeneratedQrs(results)
    toast({ title: "Batch Complete", description: `Generated ${results.length} QR codes` })
  }

  const download = () => {
    if (!qrUrl) return
    const a = document.createElement("a")
    a.href = qrUrl
    a.download = "qrcode.png"
    a.click()
  }

  const downloadIndividual = (url: string, filename: string) => {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
  }

  const handlePrint = () => {
    window.print()
  }

  const handleZipDownload = async () => {
    if (generatedQrs.length === 0) return
    setZipLoading(true)
    try {
      const dataUrls = generatedQrs.map((q) => q.sku)
      const zipB64 = await generateQrZip(dataUrls)
      const a = document.createElement("a")
      a.href = zipB64
      a.download = `qrcodes-${Date.now()}.zip`
      a.click()
      toast({ title: "ZIP Ready", description: `Downloaded ${generatedQrs.length} QR codes` })
    } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
    setZipLoading(false)
  }

  if (isLoading) return <LoadingState text="Loading materials..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load materials"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          @page { margin: 10mm; size: auto; }
          .no-print { display: none !important; }
          .print-grid { display: grid !important; }
        }
      `}</style>
      <h1 className="text-3xl font-bold">QR Generator & Scanner</h1>
      <div className="grid gap-6 md:grid-cols-2 no-print">
        <Card>
          <CardHeader>
            <CardTitle>Generate QR Code</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Search Material</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search by SKU or name..." className="pl-8" value={materialSearch} onChange={(e) => setMaterialSearch(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Select Material</Label>
                {filteredMaterials && filteredMaterials.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} />
                    Select All
                  </label>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto border rounded-md">
                {filteredMaterials?.map((m) => (
                  <div
                    key={m.id}
                    className={`px-3 py-2 cursor-pointer text-sm hover:bg-muted flex items-center gap-2 ${selectedId === m.id ? "bg-primary/10" : ""}`}
                  >
                    <Checkbox
                      checked={selectedIds.includes(m.id)}
                      onCheckedChange={() => toggleSelect(m.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 flex items-center justify-between" onClick={() => { setSelectedId(m.id); setScannedData("") }}>
                      <span>{m.sku} - {m.name}</span>
                      <Badge variant="outline" className="text-xs">{m.quantity}</Badge>
                    </div>
                  </div>
                ))}
                {(!filteredMaterials || filteredMaterials.length === 0) && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No materials found</div>
                )}
                <div
                  className={`px-3 py-2 cursor-pointer text-sm hover:bg-muted ${selectedId === "custom" ? "bg-primary/10" : ""}`}
                  onClick={() => { setSelectedId("custom"); setScannedData("") }}
                >
                  Custom Data
                </div>
              </div>
            </div>
            {selectedId === "custom" && (
              <div className="space-y-2">
                <Label>Custom Data</Label>
                <Input value={customData} onChange={(e) => setCustomData(e.target.value)} placeholder="Enter text or JSON..." />
              </div>
            )}
            {scannedData && (
              <div className="space-y-1">
                <Label>Scanned Data</Label>
                <Input value={scannedData} onChange={(e) => setScannedData(e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Width (mm)</Label>
                <Input type="number" value={qrWidth} onChange={(e) => setQrWidth(Number(e.target.value))} min={10} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Height (mm)</Label>
                <Input type="number" value={qrHeight} onChange={(e) => setQrHeight(Number(e.target.value))} min={10} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Margin (mm)</Label>
                <Input type="number" value={qrMargin} onChange={(e) => setQrMargin(Number(e.target.value))} min={0} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={showLogo} onCheckedChange={(v) => setShowLogo(!!v)} />
              Show Company Logo
            </label>
            <div className="flex gap-2">
              <Button onClick={generate} className="flex-1" disabled={!selectedId && !scannedData}>Generate QR</Button>
              {selectedIds.length > 0 && (
                <Button onClick={generateBatch} variant="secondary" className="flex-1">Generate Batch ({selectedIds.length})</Button>
              )}
            </div>
            {qrUrl && (
              <div className="text-center space-y-2">
                <div className="relative inline-block">
                  <img src={qrUrl} alt="QR Code" className="mx-auto" style={{ width: qrWidth, height: qrHeight }} />
                  {showLogo && companyLogo && (
                    <img src={companyLogo} alt="logo" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 object-contain bg-white rounded" />
                  )}
                </div>
                <Button variant="outline" onClick={download}><Download className="h-4 w-4" /> Download</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Scanner</span>
              {!scannerActive ? (
                <Button size="sm" onClick={startScanner}><Camera className="h-4 w-4" /> Start</Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={stopScanner}><CameraOff className="h-4 w-4" /> Stop</Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scannerActive ? (
              <div className="space-y-3">
                <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg bg-black" />
                <p className="text-sm text-muted-foreground text-center">
                  <Scan className="h-4 w-4 inline mr-1" />
                  Point camera at a QR code
                </p>
                <p className="text-xs text-muted-foreground text-center">
                  For actual QR scanning, use a dedicated scanner library like <code>html5-qrcode</code> or <code>zxing</code>.
                  The scanned text can be pasted below.
                </p>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Scan className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Camera is off</p>
                <p className="text-sm">Click Start to scan QR codes</p>
              </div>
            )}
            <div className="mt-4 space-y-2">
              <Label>Scanned Result</Label>
              <Input
                placeholder="Paste or enter scanned QR data..."
                value={scannedData}
                onChange={(e) => setScannedData(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {generatedQrs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Generated QR Codes ({generatedQrs.length})</span>
              <div className="flex gap-2 no-print">
                <Button variant={thermalLayout ? "default" : "outline"} size="sm" onClick={() => setThermalLayout(!thermalLayout)}><Grid3X3 className="h-4 w-4" /> Thermal Grid</Button>
                <Button variant="outline" size="sm" onClick={handleZipDownload} disabled={zipLoading}><Archive className="h-4 w-4" /> ZIP All</Button>
                <Button variant="outline" onClick={handlePrint}><Printer className="h-4 w-4" /> Print</Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={thermalLayout ? "grid grid-cols-2 gap-1 print:grid-cols-2" : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"}>
              {generatedQrs.map((item) => (
                <div key={item.materialId} className={`border rounded-lg text-center ${thermalLayout ? "p-1 space-y-0" : "p-3 space-y-2"}`}>
                  <div className="relative inline-block">
                    <img
                      src={item.url}
                      alt={item.sku}
                      className="mx-auto"
                      style={{ width: thermalLayout ? 80 : qrWidth, height: thermalLayout ? 80 : qrHeight }}
                    />
                    {showLogo && companyLogo && (
                      <img
                        src={companyLogo}
                        alt="logo"
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 object-contain bg-white rounded"
                      />
                    )}
                  </div>
                  {thermalLayout ? (
                    <div className="text-[10px] leading-tight">
                      <p className="font-medium truncate">{item.sku}</p>
                      <p className="text-muted-foreground truncate">{item.name}</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.sku}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="no-print"
                        onClick={() => downloadIndividual(item.url, `${item.sku}-qrcode.png`)}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
