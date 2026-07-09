import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getLabelTemplates, saveLabelTemplate, deleteLabelTemplate } from "../../api"
import type { LabelTemplate } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Checkbox } from "../../components/ui/checkbox"
import { Select } from "../../components/ui/select"
import { Plus, Pencil, Trash2, Tags, Eye } from "lucide-react"
import { toast } from "../../hooks/use-toast"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { useState } from "react"

const SYSTEM_IDS = new Set(["default", "company", "asset_standard", "branded", "rack_label", "full_card", "mini_thermal", "qr_only", "two_side"])

const LAYOUT_STYLES = [
  { value: "standard", label: "Standard" },
  { value: "branded", label: "Branded" },
  { value: "rack", label: "Rack Label" },
  { value: "full_card", label: "Full Stock Card" },
  { value: "mini", label: "Mini Thermal" },
  { value: "qr_only", label: "QR-Only Scan" },
  { value: "two_side", label: "Two-Side QR (Left Text + Right QR)" },
]

const emptyForm = (): LabelTemplate => ({
  id: "", name: "", layout_style: "standard",
  show_sku: true, show_name: true, show_company: false,
  show_qty: true, show_price: true, show_barcode: true, show_qr: true,
  show_category: false, show_supplier: false, show_location: false,
  show_expiry: false, show_batch: false, show_min_stock: false,
  show_logo: false, show_border: true,
  qr_size: "medium", border_style: "solid", font_scale: 1.0,
  template_type: "2x4", label_width_mm: 52, label_height_mm: 37,
  created_at: "", updated_at: "",
})

export default function LabelTemplatesPage() {
  const queryClient = useQueryClient()
  const { data: templates, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["label_templates"],
    queryFn: getLabelTemplates,
  })

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<LabelTemplate>(emptyForm())

  const openCreate = () => { setEditId(null); setForm(emptyForm()); setShowForm(true) }
  const openEdit = (t: LabelTemplate) => { setEditId(t.id); setForm({ ...t }); setShowForm(true) }

  const saveMut = useMutation({
    mutationFn: () => saveLabelTemplate(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["label_templates"] })
      setShowForm(false)
      toast({ title: "Saved", description: "Label template saved" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLabelTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["label_templates"] })
      toast({ title: "Deleted", description: "Label template deleted" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const toggleField = (field: keyof LabelTemplate) => {
    setForm((prev) => ({ ...prev, [field]: !prev[field as keyof typeof prev] }))
  }

  const layoutExample = (style: string) => {
    const examples: Record<string, string> = {
      standard: "QR + SKU + Name + Qty/Price + Barcode",
      branded: "Company → QR → SKU → Name → Qty/Price → Expiry",
      rack: "QR (large) → Rack Code → Warehouse → Location",
      full_card: "QR(large) → SKU → Name → Company → Qty → Price → Category → Barcode",
      mini: "QR(small) → SKU → Name(trunc) → PT. UJB → Barcode",
      qr_only: "QR(large) → SKU(bold) → Company",
      two_side: "Left: SKU/Name/Company/Qty/Price/Location... | Right: QR(large)",
    }
    return examples[style] || ""
  }

  if (isLoading) return <LoadingState text="Loading label templates..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2"><Tags className="h-8 w-8" /> Label Templates</h1>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> Add Template</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Label Layout Templates</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Layout Style</TableHead>
                <TableHead className="text-center">QR</TableHead>
                <TableHead className="text-center">Barcode</TableHead>
                <TableHead className="text-center">Fields</TableHead>
                <TableHead>Size (mm)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-xs capitalize">{t.layout_style}</TableCell>
                  <TableCell className="text-center">{t.show_qr ? t.qr_size : "–"}</TableCell>
                  <TableCell className="text-center">{t.show_barcode ? "✓" : "–"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{layoutExample(t.layout_style)}</TableCell>
                  <TableCell className="text-xs font-mono">{t.label_width_mm}×{t.label_height_mm}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(t)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!SYSTEM_IDS.has(t.id) && (
                        <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(t.id)} title="Delete">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!templates || templates.length === 0) && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No templates yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {editId ? "Edit Template" : "New Template"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Template Name</Label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Standard Label" />
              </div>
              <div>
                <Label>Layout Style</Label>
                <Select value={form.layout_style} onChange={(e) => setForm((p) => ({ ...p, layout_style: e.target.value as LabelTemplate["layout_style"] }))} className="w-full">
                  {LAYOUT_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">{layoutExample(form.layout_style)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Grid / Type</Label>
                <Select value={form.template_type} onChange={(e) => setForm((p) => ({ ...p, template_type: e.target.value }))}>
                  <option value="1x1">1×1 (single)</option>
                  <option value="2x4">2×4 (grid)</option>
                  <option value="4x6">4×6 (grid)</option>
                </Select>
              </div>
              <div>
                <Label>Width (mm)</Label>
                <Input type="number" value={form.label_width_mm} onChange={(e) => setForm((p) => ({ ...p, label_width_mm: Number(e.target.value) }))} min={15} max={200} />
              </div>
              <div>
                <Label>Height (mm)</Label>
                <Input type="number" value={form.label_height_mm} onChange={(e) => setForm((p) => ({ ...p, label_height_mm: Number(e.target.value) }))} min={15} max={200} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>QR Size</Label>
                <Select value={form.qr_size} onChange={(e) => setForm((p) => ({ ...p, qr_size: e.target.value as LabelTemplate["qr_size"] }))}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </Select>
              </div>
              <div>
                <Label>Border Style</Label>
                <Select value={form.border_style} onChange={(e) => setForm((p) => ({ ...p, border_style: e.target.value as LabelTemplate["border_style"] }))}>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="none">None</option>
                </Select>
              </div>
              <div>
                <Label>Font Scale</Label>
                <Input type="number" value={form.font_scale} onChange={(e) => setForm((p) => ({ ...p, font_scale: Number(e.target.value) }))} min={0.5} max={2.0} step={0.1} />
              </div>
            </div>

            <Label className="block font-medium">Display Fields</Label>
            <div className="grid grid-cols-3 gap-2">
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_sku} onCheckedChange={() => toggleField("show_sku")} />
                <span>SKU</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_name} onCheckedChange={() => toggleField("show_name")} />
                <span>Name</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_company} onCheckedChange={() => toggleField("show_company")} />
                <span>Company Name</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_qty} onCheckedChange={() => toggleField("show_qty")} />
                <span>QTY</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_price} onCheckedChange={() => toggleField("show_price")} />
                <span>Price</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_barcode} onCheckedChange={() => toggleField("show_barcode")} />
                <span>Barcode</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_qr} onCheckedChange={() => toggleField("show_qr")} />
                <span>QR Code</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_category} onCheckedChange={() => toggleField("show_category")} />
                <span>Category</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_supplier} onCheckedChange={() => toggleField("show_supplier")} />
                <span>Supplier</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_location} onCheckedChange={() => toggleField("show_location")} />
                <span>Location</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_expiry} onCheckedChange={() => toggleField("show_expiry")} />
                <span>Expiry Date</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_batch} onCheckedChange={() => toggleField("show_batch")} />
                <span>Batch No</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_min_stock} onCheckedChange={() => toggleField("show_min_stock")} />
                <span>Min Stock</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_logo} onCheckedChange={() => toggleField("show_logo")} />
                <span>Logo (QR center)</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={form.show_border} onCheckedChange={() => toggleField("show_border")} />
                <span>Border</span>
              </Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={!form.name.trim()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
