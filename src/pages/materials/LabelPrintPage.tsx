import { useQuery } from "@tanstack/react-query"
import { getMaterials, getLabelTemplates, generateQrCode, generateZpl } from "../../api"
import type { LabelTemplate } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Checkbox } from "../../components/ui/checkbox"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Printer, Search, RotateCcw, Eye, FileDown } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { toast } from "../../hooks/use-toast"
import JsBarcode from "jsbarcode"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const BARCODE_TYPES = ["CODE128", "EAN-13", "UPC-A"] as const
type BarcodeType = (typeof BARCODE_TYPES)[number]
const COMPANY_NAME = "PT. Udara Jadi Bersih"
const SINGLE_COL = { cols: 1, w: 60, h: 30 }

function qrPx(size: string): number {
  if (size === "large") return 28; if (size === "small") return 10; return 14
}

function fontPx(scale: number, base: number): string {
  return `${Math.round(base * scale)}px`
}

function borderClass(style: string): string {
  if (style === "none") return "print:border-0 border-0"; if (style === "dashed") return "border-dashed"; return ""
}

export default function LabelPrintPage() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  const [barcodeType, setBarcodeType] = useState<BarcodeType>("CODE128")
  const [zplPreview, setZplPreview] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState("default")
  const barcodeRefs = useRef<Record<string, SVGElement | null>>({})

  const { data: templates } = useQuery({
    queryKey: ["label_templates"],
    queryFn: getLabelTemplates,
  })

  const currentTmpl = useMemo<LabelTemplate | null>(() => {
    if (!templates) return null
    return templates.find((t) => t.id === templateId) || templates[0] || null
  }, [templates, templateId])

  const gridCols = currentTmpl
    ? { cols: parseInt(currentTmpl.template_type.split("x")[1] || "1") || 1 }
    : SINGLE_COL

  const labelW = currentTmpl?.label_width_mm ?? 52
  const labelH = currentTmpl?.label_height_mm ?? 37

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: materials, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["materials", debouncedSearch],
    queryFn: () => getMaterials(debouncedSearch || undefined),
  })

  const filtered = useMemo(() => materials || [], [materials])

  const loadQr = useCallback(async (id: string, sku: string, name: string) => {
    if (qrCodes[id]) return
    try {
      const url = await generateQrCode(JSON.stringify({ id, sku, name }))
      setQrCodes((prev) => ({ ...prev, [id]: url }))
    } catch { /* ignore */ }
  }, [qrCodes])

  useEffect(() => {
    for (const m of filtered) {
      if (selected.has(m.id)) loadQr(m.id, m.sku, m.name)
    }
  }, [selected, filtered, loadQr])

  useEffect(() => {
    for (const m of filtered) {
      if (selected.has(m.id) && barcodeRefs.current[m.id]) {
        try {
          JsBarcode(barcodeRefs.current[m.id], m.sku, {
            format: barcodeType, width: 0.8, height: 12, displayValue: false, margin: 0,
          })
        } catch { /* ignore */ }
      }
    }
  }, [selected, filtered, barcodeType])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((m) => m.id)))
    }
  }

  const labels = filtered.filter((m) => selected.has(m.id))

  const print = () => window.print()

  const handleZpl = async (m: { id: string }) => {
    if (zplPreview) { setZplPreview(null); return }
    try {
      const zpl = await generateZpl(m.id, templateId)
      setZplPreview(zpl)
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  const downloadZpl = (zpl: string, sku: string) => {
    const blob = new Blob([zpl], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = `${sku}.zpl`; a.click()
    URL.revokeObjectURL(url)
  }

  const renderLabel = (m: typeof filtered[0]) => {
    const t = currentTmpl
    if (!t) return null
    const fs = t.font_scale
    const qpx = t.show_qr ? qrPx(t.qr_size) : 0

    // ── Style-specific renderers ──
    if (t.layout_style === "rack") {
      return (
        <div className="flex flex-col items-center justify-center text-center p-1 h-full">
          {t.show_qr && qrCodes[m.id] && (
            <img src={qrCodes[m.id]} alt="" className="mx-auto" style={{ width: qpx + 6, height: qpx + 6 }} />
          )}
          <p className="font-extrabold leading-tight" style={{ fontSize: fontPx(fs, 16) }}>{m.sku}</p>
          <p className="leading-tight" style={{ fontSize: fontPx(fs, 9) }}>{m.name}</p>
          <p className="font-semibold leading-tight" style={{ fontSize: fontPx(fs, 7) }}>{COMPANY_NAME}</p>
        </div>
      )
    }

    if (t.layout_style === "mini") {
      return (
        <div className="flex flex-col items-center justify-center text-center p-0.5 h-full leading-[1.1]">
          {t.show_qr && qrCodes[m.id] && (
            <img src={qrCodes[m.id]} alt="" className="mx-auto" style={{ width: qpx + 2, height: qpx + 2 }} />
          )}
          {t.show_barcode && <svg ref={(el) => { barcodeRefs.current[m.id] = el }} className="w-full h-2 mb-0.5" />}
          {t.show_sku && <p className="font-bold truncate w-full" style={{ fontSize: fontPx(fs, 8) }}>{m.sku}</p>}
          {t.show_name && <p className="truncate w-full" style={{ fontSize: fontPx(fs, 6) }}>{m.name}</p>}
          <p className="font-semibold" style={{ fontSize: fontPx(fs, 5) }}>PT. UJB</p>
        </div>
      )
    }

    if (t.layout_style === "qr_only") {
      return (
        <div className="flex flex-col items-center justify-center text-center p-1 h-full">
          {t.show_qr && qrCodes[m.id] && (
            <img src={qrCodes[m.id]} alt="" className="mx-auto" style={{ width: qpx + 8, height: qpx + 8 }} />
          )}
          {t.show_sku && <p className="font-black leading-tight" style={{ fontSize: fontPx(fs, 12) }}>{m.sku}</p>}
          {t.show_company && <p className="font-semibold" style={{ fontSize: fontPx(fs, 7) }}>{COMPANY_NAME}</p>}
        </div>
      )
    }

    if (t.layout_style === "full_card") {
      return (
        <div className="flex flex-col text-left p-1.5 h-full text-[7px] leading-[1.3]" style={{ fontSize: fontPx(fs, 7) }}>
          <div className="flex items-start gap-1 mb-0.5">
            {t.show_qr && qrCodes[m.id] && (
              <img src={qrCodes[m.id]} alt="" className="shrink-0" style={{ width: qpx + 4, height: qpx + 4 }} />
            )}
            <div className="flex-1 min-w-0">
              {t.show_sku && <p className="font-bold truncate" style={{ fontSize: fontPx(fs, 9) }}>{m.sku}</p>}
              {t.show_name && <p className="truncate">{m.name}</p>}
              {t.show_company && <p className="font-semibold truncate">{COMPANY_NAME}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {t.show_qty && <span>Qty: {m.quantity}</span>}
            {t.show_price && <span>Rp {m.price?.toLocaleString()}</span>}
            {t.show_category && <span>Cat: {m.category_id || "-"}</span>}
            {t.show_supplier && <span>Sup: {m.supplier_id || "-"}</span>}
            {t.show_location && <span>Loc: {m.warehouse_id || "-"}</span>}
            {t.show_min_stock && <span>Min: {m.min_stock}</span>}
            {t.show_expiry && <span>Exp: {m.expiry_date || "-"}</span>}
          </div>
          {t.show_barcode && <svg ref={(el) => { barcodeRefs.current[m.id] = el }} className="w-full h-2.5 mt-0.5" />}
        </div>
      )
    }

    if (t.layout_style === "two_side") {
      return (
        <div className="flex flex-row h-full w-full p-0.5 gap-1">
          <div className="flex flex-col text-left flex-[3] min-w-0 text-[6px] leading-[1.25] overflow-hidden" style={{ fontSize: fontPx(fs, 6) }}>
            {t.show_company && <p className="font-bold truncate" style={{ fontSize: fontPx(fs, 8) }}>{COMPANY_NAME}</p>}
            {t.show_sku && <p><span className="font-semibold">SKU:</span> {m.sku}</p>}
            {t.show_name && <p className="truncate"><span className="font-semibold">Name:</span> {m.name}</p>}
            {t.show_qty && <p><span className="font-semibold">Qty:</span> {m.quantity}</p>}
            {t.show_price && <p><span className="font-semibold">Price:</span> Rp {m.price?.toLocaleString()}</p>}
            {t.show_category && <p className="truncate"><span className="font-semibold">Cat:</span> {m.category_id || "-"}</p>}
            {t.show_supplier && <p className="truncate"><span className="font-semibold">Sup:</span> {m.supplier_id || "-"}</p>}
            {t.show_location && <p className="truncate"><span className="font-semibold">Loc:</span> {m.warehouse_id || "-"}</p>}
            {t.show_expiry && <p><span className="font-semibold">Exp:</span> {m.expiry_date || "-"}</p>}
            {t.show_batch && <p><span className="font-semibold">Batch:</span> -</p>}
            {t.show_min_stock && <p><span className="font-semibold">Min:</span> {m.min_stock}</p>}
          </div>
          <div className="flex-[2] flex items-center justify-center">
            {t.show_qr && qrCodes[m.id] && (
              <img src={qrCodes[m.id]} alt="" className="object-contain" style={{ width: qpx + 10, height: qpx + 10 }} />
            )}
          </div>
        </div>
      )
    }

    // ── Standard & Branded (common render) ──
    return (
      <div className="flex flex-col items-center justify-center text-center p-1.5 h-full">
        {/* Logo on top for branded */}
        {t.layout_style === "branded" && t.show_company && (
          <p className="font-bold truncate w-full leading-tight" style={{ fontSize: fontPx(fs, 11) }}>{COMPANY_NAME}</p>
        )}
        {t.show_qr && qrCodes[m.id] && (
          <img src={qrCodes[m.id]} alt="" className="mx-auto" style={{ width: qpx + 4, height: qpx + 4 }} />
        )}
        {t.show_barcode && (
          <svg ref={(el) => { barcodeRefs.current[m.id] = el }} className="w-full h-3 mb-0.5" />
        )}
        {t.show_sku && <p className="font-bold leading-tight truncate w-full" style={{ fontSize: fontPx(fs, 9) }}>{m.sku}</p>}
        {t.show_name && <p className="truncate w-full leading-tight" style={{ fontSize: fontPx(fs, 8) }}>{m.name}</p>}
        {/* Company below name for standard */}
        {t.layout_style !== "branded" && t.show_company && (
          <p className="font-semibold leading-tight truncate w-full" style={{ fontSize: fontPx(fs, 7) }}>{COMPANY_NAME}</p>
        )}
        {t.show_category && (
          <p className="truncate w-full" style={{ fontSize: fontPx(fs, 6) }}>Cat: {m.category_id || "-"}</p>
        )}
        {t.show_location && (
          <p className="truncate w-full" style={{ fontSize: fontPx(fs, 6) }}>Loc: {m.warehouse_id || "-"}</p>
        )}
        <div className="flex gap-1.5 leading-tight" style={{ fontSize: fontPx(fs, 7) }}>
          {t.show_qty && <span>Qty: {m.quantity}</span>}
          {t.show_price && m.price != null && <span>Rp {m.price.toLocaleString()}</span>}
        </div>
        {t.show_expiry && (
          <p className="truncate w-full" style={{ fontSize: fontPx(fs, 6) }}>Exp: {m.expiry_date || "-"}</p>
        )}
        {t.show_batch && (
          <p className="truncate w-full" style={{ fontSize: fontPx(fs, 6) }}>Batch: -</p>
        )}
      </div>
    )
  }

  if (isLoading) return <LoadingState text="Loading materials..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load materials"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Label Printing</h1>
        <div className="flex gap-2 items-center">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-48">
            {templates?.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <Label className="text-sm text-muted-foreground">
            {currentTmpl?.label_width_mm ?? 52}×{currentTmpl?.label_height_mm ?? 37}mm
          </Label>
          <Select value={barcodeType} onChange={(e) => setBarcodeType(e.target.value as BarcodeType)} className="w-24 h-8 text-xs">
            {BARCODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Button variant="outline" size="sm" onClick={print} disabled={labels.length === 0}>
            <Printer className="h-4 w-4" /> Print ({labels.length})
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search materials..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox checked={filtered.length > 0 && selected.size === filtered.length} onCheckedChange={selectAll} />
          <span className="text-sm text-muted-foreground">All ({filtered.length})</span>
        </div>
        {selected.size > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            <RotateCcw className="h-4 w-4" /> Clear
          </Button>
        )}
        {currentTmpl && (
          <span className="text-xs text-muted-foreground ml-auto">
            {currentTmpl.name} — <span className="capitalize">{currentTmpl.layout_style}</span>
          </span>
        )}
      </div>

      <div className="border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 w-10"><Checkbox checked={filtered.length > 0 && selected.size === filtered.length} onCheckedChange={selectAll} /></th>
              {currentTmpl?.show_sku !== false && <th className="p-2 text-left font-medium">SKU</th>}
              {currentTmpl?.show_name !== false && <th className="p-2 text-left font-medium">Name</th>}
              {currentTmpl?.show_price !== false && <th className="p-2 text-right font-medium">Price</th>}
              {currentTmpl?.show_qty !== false && <th className="p-2 text-right font-medium">Qty</th>}
              {currentTmpl?.show_qr !== false && <th className="p-2 text-center font-medium">QR</th>}
              <th className="p-2 text-center font-medium">ZPL</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => toggleSelect(m.id)}>
                <td className="p-2" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggleSelect(m.id)} /></td>
                {currentTmpl?.show_sku !== false && <td className="p-2 font-mono text-xs">{m.sku}</td>}
                {currentTmpl?.show_name !== false && <td className="p-2 font-medium">{m.name}</td>}
                {currentTmpl?.show_price !== false && <td className="p-2 text-right">{m.price ? m.price.toLocaleString() : "-"}</td>}
                {currentTmpl?.show_qty !== false && <td className="p-2 text-right">{m.quantity}</td>}
                {currentTmpl?.show_qr !== false && (
                  <td className="p-2 text-center">
                    {qrCodes[m.id] ? (
                      <img src={qrCodes[m.id]} alt="" className="w-8 h-8 inline-block" />
                    ) : selected.has(m.id) ? (
                      <span className="text-xs text-muted-foreground">Loading...</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                )}
                <td className="p-2 text-center">
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleZpl(m) }} disabled={!selected.has(m.id)} title="ZPL Preview">
                    <Eye className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center text-muted-foreground py-8">No materials found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!zplPreview} onOpenChange={(v) => { if (!v) setZplPreview(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ZPL Preview</DialogTitle>
            <p className="text-sm text-muted-foreground">ZPL code for label printer — preview before download</p>
          </DialogHeader>
          {zplPreview && (
            <div className="space-y-4">
              <pre className="bg-muted p-4 rounded text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto">{zplPreview}</pre>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setZplPreview(null)}>Close</Button>
                <Button onClick={() => downloadZpl(zplPreview, "label")}><FileDown className="h-4 w-4" /> Download ZPL</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {labels.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Print Preview ({labels.length} labels, {currentTmpl?.name || "default"})
          </h2>
          <div className="print-only">
            <div className="grid gap-1 print:gap-1" style={{ gridTemplateColumns: `repeat(${gridCols.cols}, 1fr)` }}>
              {labels.map((m) => (
                <div
                  key={m.id}
                  className={`border rounded p-1 text-center print:border print:shadow-none print:break-inside-avoid flex flex-col items-center justify-center ${borderClass(currentTmpl?.border_style || "solid")}`}
                  style={{ minHeight: `${labelH}mm`, minWidth: `${labelW}mm` }}
                >
                  {renderLabel(m)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
