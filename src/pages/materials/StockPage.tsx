import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getMaterials, createMaterial, updateMaterial, deleteMaterial,
  deleteMaterialsBulk, updateMaterialsBulk, importMaterialsCsv, exportReportCsv,
  getTransactions, getCategories, getUnits, getSuppliers,
  getWarehouses, getRacks, generateQrCode,
  getMaterialBatches, createMaterialBatch, deleteMaterialBatch,
  getMaterialImages, createMaterialImage, deleteMaterialImage, reorderMaterialImages,
  getStockValuation, importMaterialsXlsx, exportStockXlsx, previewImportXlsx,
} from "../../api"
import type { Material, StockValuation } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Checkbox } from "../../components/ui/checkbox"
import DataTable from "../../components/DataTable"
import type { Column } from "../../components/DataTable"
import { Badge } from "../../components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { formatCurrency } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { Search, Plus, Pencil, Trash2, QrCode, Download, Upload, History, Image, LayoutGrid, Table2, Settings2, Layers, Camera, FileSpreadsheet } from "lucide-react"
import JsBarcode from "jsbarcode"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

function ImageGrid({ images, onReorder, onDelete, onView }: {
  images: { id: string; url: string; sort_order: number }[]
  onReorder: (ids: string[]) => void
  onDelete: (id: string) => void
  onView: (url: string) => void
}) {
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order)
  const [items, setItems] = useState(sorted)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  useEffect(() => { setItems([...images].sort((a, b) => a.sort_order - b.sort_order)) }, [images])

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); return }
    const next = [...items]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(idx, 0, moved)
    setItems(next)
    setDragIdx(null)
    onReorder(next.map((i) => i.id))
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
      {items.map((img, i) => (
        <div
          key={img.id}
          draggable
          onDragStart={() => setDragIdx(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(i)}
          className={`relative group border rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition-shadow ${dragIdx === i ? "opacity-50 ring-2 ring-primary" : ""}`}
        >
          <img src={img.url} alt="" className="w-full aspect-square object-cover" onClick={() => onView(img.url)} />
          <button
            className="absolute top-1 right-1 bg-destructive text-white rounded-full h-5 w-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onDelete(img.id) }}
          >×</button>
          <div className="absolute bottom-1 left-1 text-xs bg-background/80 px-1 rounded">#{i + 1}</div>
          <div className="absolute top-1 left-1 text-xs bg-primary/80 text-primary-foreground px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">&#x2630;</div>
        </div>
      ))}
    </div>
  )
}

const schema = z.object({
  sku: z.string().min(1, "SKU is required").max(100, "Max 100 characters"),
  name: z.string().min(1, "Name is required").max(255, "Max 255 characters"),
  description: z.string().max(500, "Max 500 characters"),
  quantity: z.number().min(0, "Quantity cannot be negative"),
  price: z.number().min(0, "Price cannot be negative"),
  min_stock: z.number().min(0, "Min stock cannot be negative"),
  max_stock: z.number().min(0, "Max stock cannot be negative"),
})

export default function StockPage() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [warehouseFilter, setWarehouseFilter] = useState("")
  const [qrFilter, setQrFilter] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Material | null>(null)
  const [qrData, setQrData] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Material>>({})
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [riwayatMaterial, setRiwayatMaterial] = useState<Material | null>(null)
  const [viewMode, setViewMode] = useState<"table" | "gallery">("table")
  const [lightboxImg, setLightboxImg] = useState("")
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkUpdates, setBulkUpdates] = useState<Record<string, string>>({})
  const [csvPreview, setCsvPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [pendingXlsxBase64, setPendingXlsxBase64] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"list" | "batches" | "gallery" | "timeline" | "valuation">("list")
  const [batchForm, setBatchForm] = useState({ material_id: "", batch_no: "", qty: 0, expiry_date: "", received_at: new Date().toISOString().slice(0, 10) })
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [valuationData, setValuationData] = useState<StockValuation[]>([])
  const [showScanner, setShowScanner] = useState(false)
  const [scanResult, setScanResult] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const xlsxInputRef = useRef<HTMLInputElement>(null)
  const { can } = useAuth()
  const queryClient = useQueryClient()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const filterMaterials = (m: Material[]) => {
    if (!qrFilter) return m
    const q = qrFilter.toLowerCase()
    return m.filter((x) =>
      x.id.toLowerCase().includes(q) ||
      x.sku.toLowerCase().includes(q) ||
      x.name.toLowerCase().includes(q)
    )
  }

  const { data: materials, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["materials", debouncedSearch, categoryFilter, warehouseFilter],
    queryFn: () => getMaterials(debouncedSearch || undefined, categoryFilter || undefined, warehouseFilter || undefined),
  })
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => getCategories() })
  const { data: units } = useQuery({ queryKey: ["units"], queryFn: () => getUnits() })
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => getSuppliers() })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: racks } = useQuery({ queryKey: ["racks"], queryFn: () => getRacks() })
  const { data: riwayat } = useQuery({
    queryKey: ["transactions", "riwayat", riwayatMaterial?.id],
    queryFn: () => getTransactions(undefined, undefined, riwayatMaterial!.id),
    enabled: !!riwayatMaterial,
  })
  const { data: batches } = useQuery({
    queryKey: ["material_batches", batchForm.material_id],
    queryFn: () => getMaterialBatches(batchForm.material_id),
    enabled: !!batchForm.material_id,
  })
  const { data: materialImages } = useQuery({
    queryKey: ["material_images", batchForm.material_id],
    queryFn: () => getMaterialImages(batchForm.material_id),
    enabled: activeTab === "gallery" && !!batchForm.material_id,
  })
  const { data: timelineTx } = useQuery({
    queryKey: ["transactions", "timeline", batchForm.material_id],
    queryFn: () => getTransactions(undefined, undefined, batchForm.material_id),
    enabled: activeTab === "timeline" && !!batchForm.material_id,
  })
  const { data: valuation } = useQuery({
    queryKey: ["stock_valuation"],
    queryFn: () => getStockValuation(),
    enabled: activeTab === "valuation",
  })

  useEffect(() => {
    if (valuation) setValuationData(valuation)
  }, [valuation])

  const filtered = materials ? filterMaterials(materials) : []

  const createMut = useMutation({
    mutationFn: () => createMaterial(form as Material),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["materials"] }); setShowForm(false); setForm({}); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const updateMut = useMutation({
    mutationFn: () => updateMaterial(form as Material),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["materials"] }); setShowForm(false); setEditItem(null); setForm({}); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMaterial(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["materials"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => deleteMaterialsBulk(ids),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["materials"] }); setSelected(new Set()); toast({ title: "Deleted", description: `${selected.size} material(s) deleted` }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const bulkEditMut = useMutation({
    mutationFn: () => updateMaterialsBulk(Array.from(selected), bulkUpdates),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["materials"] }); setBulkEditOpen(false); setBulkUpdates({}); toast({ title: "Updated", description: `${selected.size} material(s) updated` }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const importMut = useMutation({
    mutationFn: (csv: string) => importMaterialsCsv(csv),
    onSuccess: (msg) => { queryClient.invalidateQueries({ queryKey: ["materials"] }); toast({ title: "Import Result", description: msg }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const createBatchMut = useMutation({
    mutationFn: () => createMaterialBatch(batchForm.material_id, batchForm.batch_no, batchForm.qty, batchForm.expiry_date, batchForm.received_at),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["material_batches"] }); setBatchForm((p) => ({ ...p, batch_no: "", qty: 0, expiry_date: "" })); toast({ title: "Batch added" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteBatchMut = useMutation({
    mutationFn: (id: string) => deleteMaterialBatch(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["material_batches"] }); toast({ title: "Batch deleted" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const createImageMut = useMutation({
    mutationFn: (url: string) => createMaterialImage(batchForm.material_id, url),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["material_images"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteImageMut = useMutation({
    mutationFn: (id: string) => deleteMaterialImage(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["material_images"] }); toast({ title: "Image deleted" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const reorderImagesMut = useMutation({
    mutationFn: (ids: string[]) => reorderMaterialImages(ids),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const importXlsxMut = useMutation({
    mutationFn: (data: string) => importMaterialsXlsx(data),
    onSuccess: (msg) => { queryClient.invalidateQueries({ queryKey: ["materials"] }); toast({ title: "XLSX Import", description: msg }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  if (isLoading) return <LoadingState text="Loading materials..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load materials"} onRetry={refetch} />

  const validate = () => {
    const result = schema.safeParse(form)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        fieldErrors[issue.path[0] as string] = issue.message
      }
      setErrors(fieldErrors)
      return false
    }
    setErrors({})
    return true
  }

  const handleExportCsv = async () => {
    try {
      const csv = await exportReportCsv("materials")
      const blob = new Blob([csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = "materials.csv"; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Materials exported as CSV" })
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    }
  }

  const handleExportXlsx = async () => {
    try {
      const data = await exportStockXlsx()
      const blob = new Blob([new Uint8Array(data)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = "materials.xlsx"; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Stock exported as XLSX" })
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    }
  }

  const handleImportXlsx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const result = ev.target?.result as string
      if (result) {
        const base64 = result.split(",")[1]
        try {
          const previewJson = await previewImportXlsx(base64)
          const previewRows = JSON.parse(previewJson) as string[][]
          if (previewRows.length > 1) {
            setCsvPreview({ headers: previewRows[0] || [], rows: previewRows.slice(1) })
            setPendingXlsxBase64(base64)
          } else {
            toast({ title: "Info", description: "XLSX file appears empty" })
          }
        } catch (err) {
          toast({ title: "Error", description: "Could not preview XLSX: " + String(err), variant: "destructive" })
        }
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (!text) return
      const lines = text.split("\n").filter((l) => l.trim())
      if (lines.length < 2) { toast({ title: "Error", description: "CSV must have at least a header + 1 row", variant: "destructive" }); return }
      const parseCsvLine = (line: string): string[] => {
        const result: string[] = []
        let current = ""
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
              current += '"'; i++
            } else {
              inQuotes = !inQuotes
            }
          } else if (ch === ',' && !inQuotes) {
            result.push(current.trim()); current = ""
          } else {
            current += ch
          }
        }
        result.push(current.trim())
        return result
      }
      const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""))
      const rows = lines.slice(1, Math.min(lines.length, 11)).map((line) =>
        parseCsvLine(line).map((c) => c.replace(/^"|"$/g, ""))
      )
      setCsvPreview({ headers, rows })
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      if (dataUrl) setForm({ ...form, image: dataUrl })
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  const handleBatchImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setImageFiles(files)
    const previews: string[] = []
    files.forEach((f) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        if (ev.target?.result) previews.push(ev.target.result as string)
        if (previews.length === files.length) setImagePreviews([...previews])
      }
      reader.readAsDataURL(f)
    })
    e.target.value = ""
  }

  const uploadAllImages = async () => {
    for (const preview of imagePreviews) {
      await createImageMut.mutateAsync(preview)
    }
    if (materialImages && materialImages.length > 0) {
      const ids = [...materialImages.map((i) => i.id), ...(Array(imagePreviews.length).fill("") as string[])]
      reorderImagesMut.mutate(ids.filter(Boolean))
    }
    setImageFiles([])
    setImagePreviews([])
    queryClient.invalidateQueries({ queryKey: ["material_images"] })
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (!filtered) return
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((m) => m.id)))
    }
  }

  const BarcodeCell = ({ sku }: { sku: string }) => {
    const ref = useRef<HTMLCanvasElement>(null)
    useEffect(() => {
      if (ref.current) {
        try { JsBarcode(ref.current, sku, { width: 1, height: 20, displayValue: false, margin: 0 }) } catch { /* ignore */ }
      }
    }, [sku])
    return <canvas ref={ref} className="h-5" />
  }

  const stockColumns: Column<Material>[] = [
    { key: "select", label: "Select", render: (m) => <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggleSelect(m.id)} /> },
    { key: "image", label: "Photo", render: (m) =>
      m.image ? <img src={m.image} alt="" className="h-10 w-10 object-cover rounded cursor-pointer" onClick={() => setLightboxImg(m.image)} /> : <div className="h-10 w-10 rounded bg-muted flex items-center justify-center"><Image className="h-4 w-4 text-muted-foreground" /></div>
    },
    { key: "sku", label: "SKU", sortable: true, render: (m) => <span className="font-mono">{m.sku}</span> },
    { key: "barcode", label: "Barcode", render: (m) => <BarcodeCell sku={m.sku} /> },
    { key: "name", label: "Name", sortable: true, render: (m) => <span className="font-medium">{m.name}</span> },
    { key: "category_name", label: "Category", render: (m) => m.category_name || "-" },
    { key: "quantity", label: "Quantity", sortable: true, render: (m) => (
      <Badge variant={m.quantity <= m.min_stock ? "destructive" : m.quantity <= m.min_stock * 1.5 ? "secondary" : "default"}>{m.quantity}</Badge>
    )},
    { key: "price", label: "Price", sortable: true, render: (m) => formatCurrency(m.price) },
    { key: "warehouse_id", label: "Warehouse", render: (m) => warehouses?.find((w) => w.id === m.warehouse_id)?.name || "-" },
    { key: "actions", label: "Actions", render: (m) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" title="History" onClick={() => setRiwayatMaterial(m)}><History className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" title="QR" onClick={() => handleShowQr(m)}><QrCode className="h-4 w-4" /></Button>
        {can("manage_materials") && <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>}
        {can("delete_any") && <Button variant="ghost" size="icon" title="Delete" onClick={() => { if (confirm("Delete this material?")) deleteMut.mutate(m.id) }}><Trash2 className="h-4 w-4" /></Button>}
      </div>
    )},
  ]

  const handleShowQr = async (item: Material) => {
    try {
      const url = await generateQrCode(JSON.stringify({ id: item.id, sku: item.sku, name: item.name }))
      setQrData(url)
    } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  const openEdit = (item: Material) => {
    setEditItem(item)
    setForm(item)
    setErrors({})
    setShowForm(true)
  }

  const openCreate = () => {
    setEditItem(null)
    setForm({ id: "", sku: `SKU-${Date.now()}`, name: "", description: "", image: "", category_id: null, unit_id: null, supplier_id: null, warehouse_id: null, rack_id: null, quantity: 0, min_stock: 0, max_stock: 0, price: 0, expiry_date: null, is_active: true, created_at: "", updated_at: "" })
    setErrors({})
    setShowForm(true)
  }

  const tabs = [
    { key: "list", label: "List" },
    { key: "batches", label: "Batches" },
    { key: "gallery", label: "Gallery" },
    { key: "timeline", label: "Timeline" },
    { key: "valuation", label: "Valuation" },
  ] as const

  const maxValue = Math.max(...valuationData.map((v) => v.value), 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Stock Management</h1>
        <div className="flex gap-2 flex-wrap">
          <input type="file" accept=".csv" ref={fileInputRef} onChange={handleImportCsv} className="hidden" />
          <input type="file" accept=".xlsx" ref={xlsxInputRef} onChange={handleImportXlsx} className="hidden" />
          {can("manage_materials") && (
            <>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importMut.isPending}>
                <Upload className="h-4 w-4" /> Import CSV
              </Button>
              <Button variant="outline" onClick={() => xlsxInputRef.current?.click()} disabled={importXlsxMut.isPending}>
                <FileSpreadsheet className="h-4 w-4" /> Import XLSX
              </Button>
            </>
          )}
          <Button variant="outline" onClick={handleExportCsv}><Download className="h-4 w-4" /> Export CSV</Button>
          <Button variant="outline" onClick={handleExportXlsx}><FileSpreadsheet className="h-4 w-4" /> Export XLSX</Button>
          {can("manage_materials") && (
            <Button onClick={openCreate}><Plus className="h-4 w-4" /> Add Material</Button>
          )}
        </div>
      </div>

      <div className="flex border-b gap-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "list" ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Materials</CardTitle>
              <div className="flex gap-2 flex-wrap items-center">
                <div className="relative w-48">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="">All Categories</option>
                  {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
                  <option value="">All Warehouses</option>
                  {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
                <Input
                  placeholder="QR filter (id/sku/name)"
                  value={qrFilter}
                  onChange={(e) => setQrFilter(e.target.value)}
                  className="w-40"
                />
                <Button variant="outline" size="sm" onClick={() => setShowScanner(true)} title="Scan Barcode">
                  <Camera className="h-4 w-4" />
                </Button>
                <div className="flex border rounded-md">
                  <Button variant={viewMode === "table" ? "default" : "ghost"} size="sm" className="rounded-r-none" onClick={() => setViewMode("table")}><Table2 className="h-4 w-4" /></Button>
                  <Button variant={viewMode === "gallery" ? "default" : "ghost"} size="sm" className="rounded-l-none" onClick={() => setViewMode("gallery")}><LayoutGrid className="h-4 w-4" /></Button>
                </div>
                {selected.size > 0 && (
                  <>
                    {can("manage_materials") && (
                      <Button variant="outline" size="sm" onClick={() => { setBulkUpdates({}); setBulkEditOpen(true) }}>
                        <Settings2 className="h-4 w-4" /> Edit ({selected.size})
                      </Button>
                    )}
                    {can("delete_any") && (
                      <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Delete ${selected.size} material(s)?`)) bulkDeleteMut.mutate(Array.from(selected)) }}>
                        <Trash2 className="h-4 w-4" /> ({selected.size})
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {viewMode === "gallery" ? (
              <div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {filtered?.map((m) => (
                    <div key={m.id} className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                      <div className="relative aspect-square bg-muted cursor-pointer" onClick={() => m.image && setLightboxImg(m.image)}>
                        {m.image ? (
                          <img src={m.image} alt={m.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Image className="h-8 w-8" />
                          </div>
                        )}
                        <div className="absolute top-1 left-1">
                          <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggleSelect(m.id)} />
                        </div>
                      </div>
                      <div className="p-2 space-y-1">
                        <p className="font-medium text-sm truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{m.sku}</p>
                        <div className="flex items-center justify-between">
                          <Badge variant={m.quantity <= m.min_stock ? "destructive" : "default"} className="text-xs">{m.quantity}</Badge>
                          <span className="text-xs text-muted-foreground">{formatCurrency(m.price)}</span>
                        </div>
                        <div className="flex gap-1 pt-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="QR" onClick={() => handleShowQr(m)}><QrCode className="h-3 w-3" /></Button>
                          {can("manage_materials") && <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit" onClick={() => openEdit(m)}><Pencil className="h-3 w-3" /></Button>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {filtered?.length === 0 && <div className="text-center py-12 text-muted-foreground">No materials found</div>}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Checkbox
                    checked={filtered ? selected.size === filtered.length && filtered.length > 0 : false}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-sm text-muted-foreground">Select All ({selected.size} selected)</span>
                </div>
                <DataTable
                  columns={stockColumns}
                  data={filtered || []}
                  keyExtractor={(m) => m.id}
                  pageSize={15}
                  emptyMessage="No materials found"
                />
              </>
            )}
          </CardContent>
        </Card>
      ) : activeTab === "batches" ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Add Batch</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Material</Label>
                <Select value={batchForm.material_id} onChange={(e) => setBatchForm({ ...batchForm, material_id: e.target.value })}>
                  <option value="">Select material...</option>
                  {materials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Batch No</Label>
                <Input value={batchForm.batch_no} onChange={(e) => setBatchForm({ ...batchForm, batch_no: e.target.value })} placeholder="e.g. BATCH-001" />
              </div>
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input type="number" value={batchForm.qty} onChange={(e) => setBatchForm({ ...batchForm, qty: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Expiry Date</Label>
                <Input type="date" value={batchForm.expiry_date} onChange={(e) => setBatchForm({ ...batchForm, expiry_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Received At</Label>
                <Input type="date" value={batchForm.received_at} onChange={(e) => setBatchForm({ ...batchForm, received_at: e.target.value })} />
              </div>
              <Button onClick={() => createBatchMut.mutate()} disabled={!batchForm.material_id || !batchForm.batch_no || createBatchMut.isPending} className="w-full">
                <Layers className="h-4 w-4" /> Add Batch
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Batches</CardTitle></CardHeader>
            <CardContent>
              {!batchForm.material_id ? (
                <p className="text-sm text-muted-foreground text-center py-8">Select a material to view batches</p>
              ) : !batches || batches.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No batches found</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-left font-medium">Batch No</th>
                        <th className="p-2 text-right font-medium">Qty</th>
                        <th className="p-2 text-left font-medium">Expiry Date</th>
                        <th className="p-2 text-left font-medium">Received At</th>
                        <th className="p-2 text-center font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map((b) => (
                        <tr key={b.id} className="border-b">
                          <td className="p-2 font-mono text-xs">{b.batch_no}</td>
                          <td className="p-2 text-right">{b.qty}</td>
                          <td className="p-2 text-muted-foreground text-xs">{b.expiry_date}</td>
                          <td className="p-2 text-muted-foreground text-xs">{b.received_at}</td>
                          <td className="p-2 text-center">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm("Delete this batch?")) deleteBatchMut.mutate(b.id) }}><Trash2 className="h-3 w-3" /></Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : activeTab === "gallery" ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Image Gallery</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Material</Label>
              <Select value={batchForm.material_id} onChange={(e) => setBatchForm({ ...batchForm, material_id: e.target.value })}>
                <option value="">Select material...</option>
                {materials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name}</option>)}
              </Select>
            </div>
            {batchForm.material_id && (
              <>
                <div className="space-y-2">
                  <Label>Upload Images</Label>
                  <input type="file" accept="image/*" multiple onChange={handleBatchImageUpload} className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
                </div>
                {imagePreviews.length > 0 && (
                  <>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                      {imagePreviews.map((p, i) => (
                        <div key={i} className="relative group border rounded-lg overflow-hidden">
                          <img src={p} alt={`Preview ${i}`} className="w-full aspect-square object-cover" />
                          <button
                            className="absolute top-1 right-1 bg-destructive text-white rounded-full h-5 w-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              setImagePreviews((prev) => prev.filter((_, idx) => idx !== i))
                              setImageFiles((prev) => prev.filter((_, idx) => idx !== i))
                            }}
                          >×</button>
                        </div>
                      ))}
                    </div>
                    <Button onClick={uploadAllImages} disabled={createImageMut.isPending || imageFiles.length === 0}>
                      <Upload className="h-4 w-4" /> Upload All ({imagePreviews.length})
                    </Button>
                  </>
                )}
                <div className="space-y-2">
                  <Label>Existing Images <span className="text-xs text-muted-foreground">(drag to reorder)</span></Label>
                  {!materialImages || materialImages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No images uploaded yet</p>
                  ) : (
                    <ImageGrid images={materialImages} onReorder={(newOrder) => { reorderImagesMut.mutate(newOrder) }} onDelete={(id) => { if (confirm("Delete this image?")) deleteImageMut.mutate(id) }} onView={(url) => setLightboxImg(url)} />
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : activeTab === "timeline" ? (
        <Card>
          <CardHeader>
            <CardTitle>Transaction Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Material</Label>
              <Select value={batchForm.material_id} onChange={(e) => setBatchForm({ ...batchForm, material_id: e.target.value })}>
                <option value="">Select material...</option>
                {materials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name}</option>)}
              </Select>
            </div>
            {!batchForm.material_id ? (
              <p className="text-sm text-muted-foreground text-center py-8">Select a material to view its timeline</p>
            ) : !timelineTx || timelineTx.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No transactions found for this material</p>
            ) : (
              <div className="relative pl-8 space-y-0">
                <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border" />
                {timelineTx.map((tx) => (
                  <div key={tx.id} className="relative pb-6">
                    <div className={`absolute -left-[1.35rem] top-1 h-3 w-3 rounded-full border-2 ${
                      tx.type === "in" ? "bg-green-500 border-green-500" : tx.type === "out" ? "bg-red-500 border-red-500" : "bg-blue-500 border-blue-500"
                    }`} />
                    <div className="ml-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={tx.type === "in" ? "default" : "destructive"} className="text-xs">{tx.type.toUpperCase()}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{tx.transaction_number}</span>
                      </div>
                      <p className="text-sm mt-1">
                        Qty: <span className="font-medium">{tx.quantity > 0 ? "+" : ""}{tx.quantity}</span>
                        {tx.reference && <span className="text-muted-foreground ml-2">Ref: {tx.reference}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{tx.created_at}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : activeTab === "valuation" ? (
        <Card>
          <CardHeader><CardTitle>Stock Valuation</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {valuationData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No valuation data available</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-left font-medium">Category</th>
                        <th className="p-2 text-right font-medium">Count</th>
                        <th className="p-2 text-right font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valuationData.map((v, i) => (
                        <tr key={i} className="border-b">
                          <td className="p-2">{v.category}</td>
                          <td className="p-2 text-right">{v.count}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(v.value)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 font-medium bg-muted/30">
                        <td className="p-2">Total</td>
                        <td className="p-2 text-right">{valuationData.reduce((s, v) => s + v.count, 0)}</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(valuationData.reduce((s, v) => s + v.value, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Valuation by Category</p>
                  <div className="space-y-2">
                    {valuationData.map((v, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs w-32 truncate text-right">{v.category}</span>
                        <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
                          <div
                            className="h-full bg-primary rounded transition-all"
                            style={{ width: `${(v.value / maxValue) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono w-24 text-right">{formatCurrency(v.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) setErrors({}); setShowForm(v) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Material" : "Add Material"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input value={form.sku || ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              {errors.sku && <p className="text-sm text-destructive">{errors.sku}</p>}
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category_id || ""} onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}>
                <option value="">None</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Select value={form.unit_id || ""} onChange={(e) => setForm({ ...form, unit_id: e.target.value || null })}>
                <option value="">None</option>
                {units?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Select value={form.supplier_id || ""} onChange={(e) => setForm({ ...form, supplier_id: e.target.value || null })}>
                <option value="">None</option>
                {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <Select value={form.warehouse_id || ""} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value || null })}>
                <option value="">None</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rack</Label>
              <Select value={form.rack_id || ""} onChange={(e) => setForm({ ...form, rack_id: e.target.value || null })}>
                <option value="">None</option>
                {racks?.map((r) => <option key={r.id} value={r.id}>{r.rack_name} - {r.bin_location}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" value={form.quantity ?? 0} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
              {errors.quantity && <p className="text-sm text-destructive">{errors.quantity}</p>}
            </div>
            <div className="space-y-2">
              <Label>Price</Label>
              <Input type="number" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
              {errors.price && <p className="text-sm text-destructive">{errors.price}</p>}
            </div>
            <div className="space-y-2">
              <Label>Min Stock</Label>
              <Input type="number" value={form.min_stock ?? 0} onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) })} />
              {errors.min_stock && <p className="text-sm text-destructive">{errors.min_stock}</p>}
            </div>
            <div className="space-y-2">
              <Label>Max Stock</Label>
              <Input type="number" value={form.max_stock ?? 0} onChange={(e) => setForm({ ...form, max_stock: Number(e.target.value) })} />
              {errors.max_stock && <p className="text-sm text-destructive">{errors.max_stock}</p>}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expiry_date || ""} onChange={(e) => setForm({ ...form, expiry_date: e.target.value || null })} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Image</Label>
              <input type="file" accept="image/*" ref={imageInputRef} onChange={handleImageUpload} className="hidden" />
              <div className="flex items-center gap-3">
                <Button variant="outline" type="button" onClick={() => imageInputRef.current?.click()}>
                  <Image className="h-4 w-4" /> Choose Image
                </Button>
                {form.image && (
                  <>
                    <img src={form.image} alt="Preview" className="h-16 w-16 object-cover rounded border" />
                    <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, image: "" })}>Remove</Button>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => { setShowForm(false); setErrors({}) }}>Cancel</Button>
            <Button onClick={() => { if (validate()) { if (editItem) { updateMut.mutate() } else { createMut.mutate() } } }} disabled={createMut.isPending || updateMut.isPending}>
              {editItem ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrData} onOpenChange={() => setQrData(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>QR Code</DialogTitle></DialogHeader>
          {qrData && <img src={qrData} alt="QR Code" className="mx-auto" />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!riwayatMaterial} onOpenChange={() => setRiwayatMaterial(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Movement History - {riwayatMaterial?.name}</DialogTitle>
          </DialogHeader>
          {riwayat?.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No transactions found</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">#</th>
                    <th className="p-2 text-left font-medium">Type</th>
                    <th className="p-2 text-right font-medium">Qty</th>
                    <th className="p-2 text-left font-medium">Reference</th>
                    <th className="p-2 text-left font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayat?.map((tx) => (
                    <tr key={tx.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{tx.transaction_number}</td>
                      <td className="p-2">
                        <Badge variant={tx.type === "in" ? "default" : "destructive"}>
                          {tx.type.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-2 text-right">{tx.quantity}</td>
                      <td className="p-2 text-muted-foreground">{tx.reference || "-"}</td>
                      <td className="p-2 text-muted-foreground text-xs">{tx.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!lightboxImg} onOpenChange={() => setLightboxImg("")}>
        <DialogContent className="sm:max-w-lg">
          {lightboxImg && <img src={lightboxImg} alt="Material photo" className="w-full max-h-[70vh] object-contain" />}
        </DialogContent>
      </Dialog>

      <Dialog open={bulkEditOpen} onOpenChange={(v) => setBulkEditOpen(v)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk Edit ({selected.size} materials)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <select value={bulkUpdates.category_id || ""} onChange={(e) => setBulkUpdates({ ...bulkUpdates, category_id: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="">— No change —</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <select value={bulkUpdates.warehouse_id || ""} onChange={(e) => setBulkUpdates({ ...bulkUpdates, warehouse_id: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="">— No change —</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Price</Label>
              <Input type="number" placeholder="— No change —" value={bulkUpdates.price || ""} onChange={(e) => setBulkUpdates({ ...bulkUpdates, price: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Min Stock</Label>
              <Input type="number" placeholder="— No change —" value={bulkUpdates.min_stock || ""} onChange={(e) => setBulkUpdates({ ...bulkUpdates, min_stock: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Max Stock</Label>
              <Input type="number" placeholder="— No change —" value={bulkUpdates.max_stock || ""} onChange={(e) => setBulkUpdates({ ...bulkUpdates, max_stock: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="bulk_active" checked={bulkUpdates.is_active === "true"} onChange={(e) => setBulkUpdates({ ...bulkUpdates, is_active: e.target.checked ? "true" : "false" })} className="h-4 w-4" />
              <Label htmlFor="bulk_active">{bulkUpdates.is_active === "true" ? "Active" : bulkUpdates.is_active === "false" ? "Inactive" : "Set Active (check=Active, uncheck=Inactive)"}</Label>
            </div>
            <Button onClick={() => bulkEditMut.mutate()} className="w-full" disabled={bulkEditMut.isPending || Object.keys(bulkUpdates).length === 0}>
              Apply Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!csvPreview} onOpenChange={(v) => { if (!v) { setCsvPreview(null); setPendingXlsxBase64(null) } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{pendingXlsxBase64 ? "XLSX" : "CSV"} Preview</DialogTitle></DialogHeader>
          {csvPreview && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Found {csvPreview.headers.length} columns, {csvPreview.rows.length}+ rows (showing first {csvPreview.rows.length})
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {csvPreview.headers.map((h, i) => <th key={i} className="p-2 text-left font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.rows.map((row, ri) => (
                      <tr key={ri} className="border-b">
                        {row.map((cell, ci) => <td key={ci} className="p-2">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setCsvPreview(null); setPendingXlsxBase64(null) }}>Cancel</Button>
                <Button onClick={() => {
                  if (pendingXlsxBase64) {
                    importXlsxMut.mutate(pendingXlsxBase64)
                  } else {
                    const text = [csvPreview.headers.join(","), ...csvPreview.rows.map((r) => r.join(","))].join("\n")
                    importMut.mutate(text)
                  }
                  setCsvPreview(null); setPendingXlsxBase64(null)
                }} disabled={importMut.isPending || importXlsxMut.isPending}>
                  <Upload className="h-4 w-4" /> Import {csvPreview.rows.length} rows
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showScanner} onOpenChange={(v) => { if (!v) setShowScanner(v) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Scan Barcode</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter barcode value manually or use a barcode scanner device:</p>
            <Input
              placeholder="Scan or type barcode..."
              value={scanResult}
              onChange={(e) => setScanResult(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && scanResult) {
                  setSearch(scanResult)
                  setActiveTab("list")
                  setShowScanner(false)
                  setScanResult("")
                }
              }}
            />
            <Button
              className="w-full"
              onClick={() => {
                if (scanResult) {
                  setSearch(scanResult)
                  setActiveTab("list")
                  setShowScanner(false)
                  setScanResult("")
                }
              }}
              disabled={!scanResult}
            >
              Apply Scan Result
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
