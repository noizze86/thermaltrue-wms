import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, exportReportCsv, getSupplierRatings, createSupplierRating, getSupplierPrices, createSupplierPrice, getMaterials } from "../../api"
import type { Supplier } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { Plus, Pencil, Trash2, Truck, Download, Search, Star, DollarSign } from "lucide-react"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const schema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Max 255 characters"),
  contact: z.string().max(255, "Max 255 characters"),
  phone: z.string().max(50, "Max 50 characters"),
  email: z.string().max(255, "Max 255 characters").email("Invalid email format").or(z.literal("")),
  address: z.string().max(500, "Max 500 characters"),
  contact_person: z.string().max(255, "Max 255 characters"),
  pic_phone: z.string().max(50, "Max 50 characters"),
  pic_email: z.string().max(255, "Max 255 characters").email("Invalid email").or(z.literal("")),
})

export default function SuppliersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [activeTab, setActiveTab] = useState<"list" | "ratings" | "prices">("list")
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: suppliers, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["suppliers", debouncedSearch],
    queryFn: () => getSuppliers(debouncedSearch || undefined),
  })
  const { data: ratings } = useQuery({ queryKey: ["supplier_ratings", selectedSupplier?.id], queryFn: () => getSupplierRatings(selectedSupplier!.id), enabled: activeTab === "ratings" && !!selectedSupplier })
  const { data: prices } = useQuery({ queryKey: ["supplier_prices", selectedSupplier?.id], queryFn: () => getSupplierPrices(selectedSupplier!.id), enabled: activeTab === "prices" && !!selectedSupplier })
  const { data: materials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })

  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Supplier | null>(null)
  const [form, setForm] = useState({ name: "", contact: "", phone: "", email: "", address: "", contact_person: "", pic_phone: "", pic_email: "" })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [exporting, setExporting] = useState(false)

  // Rating form
  const [ratingForm, setRatingForm] = useState({ metric: "on_time_delivery", score: 5, period: new Date().toISOString().slice(0, 7), notes: "" })
  // Price form
  const [priceForm, setPriceForm] = useState({ material_id: "", price: 0, date: new Date().toISOString().slice(0, 10) })

  const validate = () => {
    const result = schema.safeParse(form)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) fieldErrors[issue.path[0] as string] = issue.message
      setErrors(fieldErrors)
      return false
    }
    setErrors({})
    return true
  }

  const createMut = useMutation({
    mutationFn: () => createSupplier({ id: "", name: form.name, contact: form.contact, phone: form.phone, email: form.email, address: form.address, contact_person: form.contact_person, pic_phone: form.pic_phone, pic_email: form.pic_email, created_at: "" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["suppliers"] }); setShowForm(false); setForm({ name: "", contact: "", phone: "", email: "", address: "", contact_person: "", pic_phone: "", pic_email: "" }); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const updateMut = useMutation({
    mutationFn: () => updateSupplier({ id: editItem!.id, name: form.name, contact: form.contact, phone: form.phone, email: form.email, address: form.address, contact_person: form.contact_person, pic_phone: form.pic_phone, pic_email: form.pic_email, created_at: "" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["suppliers"] }); setShowForm(false); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSupplier(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const ratingMut = useMutation({
    mutationFn: () => createSupplierRating(selectedSupplier!.id, ratingForm.metric, ratingForm.score, ratingForm.period, ratingForm.notes),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["supplier_ratings", selectedSupplier?.id] }); setRatingForm({ metric: "on_time_delivery", score: 5, period: new Date().toISOString().slice(0, 7), notes: "" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const priceMut = useMutation({
    mutationFn: () => createSupplierPrice(selectedSupplier!.id, priceForm.material_id, priceForm.price, priceForm.date),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["supplier_prices", selectedSupplier?.id] }); setPriceForm({ material_id: "", price: 0, date: new Date().toISOString().slice(0, 10) }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const handleExportCsv = async () => {
    setExporting(true)
    try {
      const csv = await exportReportCsv("suppliers")
      const blob = new Blob([csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = "suppliers.csv"; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported" })
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" })
    } finally { setExporting(false) }
  }
  if (isLoading) return <LoadingState text="Loading suppliers..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load suppliers"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2"><Truck className="h-8 w-8" /> Suppliers</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCsv} disabled={exporting}><Download className="h-4 w-4" /> Export CSV</Button>
          <Button onClick={() => { setEditItem(null); setForm({ name: "", contact: "", phone: "", email: "", address: "", contact_person: "", pic_phone: "", pic_email: "" }); setErrors({}); setShowForm(true) }}><Plus className="h-4 w-4" /> Add Supplier</Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-0 border-b">
        <button className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "list" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`} onClick={() => setActiveTab("list")}>Supplier List</button>
        <button className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "ratings" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`} onClick={() => setActiveTab("ratings")} disabled={!selectedSupplier}>Ratings</button>
        <button className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "prices" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`} onClick={() => setActiveTab("prices")} disabled={!selectedSupplier}>Price History</button>
      </div>

      {activeTab === "list" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Supplier List</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>Contact Person</TableHead><TableHead>Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {suppliers?.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No suppliers found</TableCell></TableRow>
                : suppliers?.map((s) => <TableRow key={s.id} className={selectedSupplier?.id === s.id ? "bg-muted/50" : ""}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.contact || "-"}</TableCell>
                  <TableCell>{s.phone || "-"}</TableCell>
                  <TableCell>{s.contact_person || "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditItem(s); setForm({ name: s.name, contact: s.contact, phone: s.phone, email: s.email, address: s.address, contact_person: s.contact_person, pic_phone: s.pic_phone, pic_email: s.pic_email }); setErrors({}); setShowForm(true) }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { setSelectedSupplier(s); setActiveTab("ratings") }}><Star className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { setSelectedSupplier(s); setActiveTab("prices") }}><DollarSign className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete?")) deleteMut.mutate(s.id) }}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === "ratings" && selectedSupplier && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Star className="h-5 w-5 text-yellow-500" /> Ratings for {selectedSupplier.name}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-4">
                <div className="space-y-1">
                  <Label>Metric</Label>
                  <Select value={ratingForm.metric} onChange={(e) => setRatingForm({ ...ratingForm, metric: e.target.value })}>
                    <option value="on_time_delivery">On-Time Delivery</option>
                    <option value="quality">Quality (1-5)</option>
                    <option value="price_competitiveness">Price Competitiveness</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Score (1-5)</Label>
                  <Input type="number" min={1} max={5} value={ratingForm.score} onChange={(e) => setRatingForm({ ...ratingForm, score: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label>Period</Label>
                  <Input type="month" value={ratingForm.period} onChange={(e) => setRatingForm({ ...ratingForm, period: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1 mb-4">
                <Label>Notes</Label>
                <Input value={ratingForm.notes} onChange={(e) => setRatingForm({ ...ratingForm, notes: e.target.value })} />
              </div>
              <Button onClick={() => ratingMut.mutate()} disabled={ratingMut.isPending}>Add Rating</Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              {ratings && ratings.length > 0 ? <Table><TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Score</TableHead><TableHead>Period</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
                <TableBody>{ratings.map((r) => <TableRow key={r.id}><TableCell className="capitalize">{r.metric.replace(/_/g, " ")}</TableCell><TableCell><span className={`font-bold ${r.score >= 4 ? "text-green-600" : r.score >= 3 ? "text-yellow-600" : "text-red-600"}`}>{r.score}/5</span></TableCell><TableCell>{r.period}</TableCell><TableCell className="text-xs">{r.notes || "-"}</TableCell></TableRow>)}</TableBody></Table>
              : <p className="text-center text-muted-foreground py-4">No ratings yet</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "prices" && selectedSupplier && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /> Price History for {selectedSupplier.name}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-4">
                <div className="space-y-1">
                  <Label>Material</Label>
                  <Select value={priceForm.material_id} onChange={(e) => setPriceForm({ ...priceForm, material_id: e.target.value })}>
                    <option value="">Select material</option>
                    {materials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Price</Label>
                  <Input type="number" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label>Date</Label>
                  <Input type="date" value={priceForm.date} onChange={(e) => setPriceForm({ ...priceForm, date: e.target.value })} />
                </div>
              </div>
              <Button onClick={() => priceMut.mutate()} disabled={priceMut.isPending || !priceForm.material_id}>Add Price</Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              {prices && prices.length > 0 ? <Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Price</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                <TableBody>{prices.map((p) => <TableRow key={p.id}><TableCell>{p.material_name}</TableCell><TableCell className="font-medium">{p.price.toLocaleString()}</TableCell><TableCell className="text-xs">{p.date}</TableCell></TableRow>)}</TableBody></Table>
              : <p className="text-center text-muted-foreground py-4">No price history yet</p>}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) setErrors({}); setShowForm(v) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit Supplier" : "Add Supplier"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}</div>
            <div className="space-y-2"><Label>Contact</Label><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />{errors.contact && <p className="text-sm text-destructive">{errors.contact}</p>}</div>
            <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />{errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}</div>
            <div className="space-y-2"><Label>Contact Person</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="PIC name" />{errors.contact_person && <p className="text-sm text-destructive">{errors.contact_person}</p>}</div>
            <div className="space-y-2"><Label>Pic Phone</Label><Input value={form.pic_phone} onChange={(e) => setForm({ ...form, pic_phone: e.target.value })} placeholder="PIC phone" />{errors.pic_phone && <p className="text-sm text-destructive">{errors.pic_phone}</p>}</div>
            <div className="space-y-2"><Label>Pic Email</Label><Input type="email" value={form.pic_email} onChange={(e) => setForm({ ...form, pic_email: e.target.value })} placeholder="PIC email" />{errors.pic_email && <p className="text-sm text-destructive">{errors.pic_email}</p>}</div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />{errors.email && <p className="text-sm text-destructive">{errors.email}</p>}</div>
            <div className="space-y-2"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />{errors.address && <p className="text-sm text-destructive">{errors.address}</p>}</div>
            <Button onClick={() => { if (validate()) { if (editItem) { updateMut.mutate() } else { createMut.mutate() } } }} className="w-full" disabled={createMut.isPending || updateMut.isPending}>{editItem ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
