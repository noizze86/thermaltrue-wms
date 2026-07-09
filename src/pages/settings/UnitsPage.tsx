import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getUnits, createUnit, updateUnit, deleteUnit, getUnitConversions, createUnitConversion, deleteUnitConversion, convertUnit, exportReportCsv } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs"
import { Plus, Pencil, Trash2, Ruler, Download, Search, ArrowRightLeft } from "lucide-react"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const schema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Max 50 characters"),
  symbol: z.string().max(20, "Max 20 characters"),
  category: z.string().max(50),
})

const UNIT_CATEGORIES = ["Mass", "Volume", "Length", "Pieces", "Time", "Area", "Other"]

export default function UnitsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: units, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["units", debouncedSearch],
    queryFn: () => getUnits(debouncedSearch || undefined),
  })
  const { data: conversions } = useQuery({
    queryKey: ["unit_conversions"],
    queryFn: getUnitConversions,
  })

  // Unit CRUD
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", symbol: "", category: "" })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [exporting, setExporting] = useState(false)

  // Conversion dialog
  const [showConvForm, setShowConvForm] = useState(false)
  const [convForm, setConvForm] = useState({ from_unit_id: "", to_unit_id: "", factor: 1 })

  // Calculator
  const [calcFrom, setCalcFrom] = useState("")
  const [calcTo, setCalcTo] = useState("")
  const [calcQty, setCalcQty] = useState(1)
  const [calcResult, setCalcResult] = useState<number | null>(null)

  const calcMut = useMutation({
    mutationFn: () => convertUnit(calcFrom, calcTo, calcQty),
    onSuccess: (data) => setCalcResult(data),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

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

  const createMut = useMutation({
    mutationFn: () => createUnit(form.name, form.symbol, form.category),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["units"] }); setShowForm(false); setForm({ name: "", symbol: "", category: "" }); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const updateMut = useMutation({
    mutationFn: () => updateUnit(editId!, form.name, form.symbol, form.category),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["units"] }); setShowForm(false); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteUnit(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["units"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const createConvMut = useMutation({
    mutationFn: () => createUnitConversion(convForm.from_unit_id, convForm.to_unit_id, convForm.factor),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["unit_conversions"] }); setShowConvForm(false); setConvForm({ from_unit_id: "", to_unit_id: "", factor: 1 }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteConvMut = useMutation({
    mutationFn: (id: string) => deleteUnitConversion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["unit_conversions"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const handleExportCsv = async () => {
    setExporting(true)
    try {
      const csv = await exportReportCsv("units")
      const blob = new Blob([csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = "units.csv"; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Units exported as CSV" })
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    } finally { setExporting(false) }
  }
  if (isLoading) return <LoadingState text="Loading units..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load units"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2"><Ruler className="h-8 w-8" /> Units</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCsv} disabled={exporting}><Download className="h-4 w-4" /> Export CSV</Button>
          <Button onClick={() => { setEditId(null); setForm({ name: "", symbol: "", category: "" }); setErrors({}); setShowForm(true) }}><Plus className="h-4 w-4" /> Add Unit</Button>
        </div>
      </div>

      <Tabs defaultValue="units">
        <TabsList>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="conversions">Conversions</TabsTrigger>
          <TabsTrigger value="calculator">Calculator</TabsTrigger>
        </TabsList>

        <TabsContent value="units">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Measurement Units</CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search units..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Name</TableHead><TableHead>Symbol</TableHead><TableHead>Category</TableHead><TableHead className="w-[100px]">Actions</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {units?.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No units found</TableCell></TableRow>
                  ) : units?.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="font-mono">{u.symbol || "-"}</TableCell>
                      <TableCell><span className="text-xs bg-muted px-2 py-0.5 rounded">{u.category || "Other"}</span></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditId(u.id); setForm({ name: u.name, symbol: u.symbol, category: u.category }); setErrors({}); setShowForm(true) }}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this unit?")) deleteMut.mutate(u.id) }}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversions">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Unit Conversions</CardTitle>
                <Button onClick={() => { setConvForm({ from_unit_id: "", to_unit_id: "", factor: 1 }); setShowConvForm(true) }}><Plus className="h-4 w-4" /> Add Conversion</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Factor</TableHead><TableHead className="w-[80px]">Actions</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {conversions?.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No conversions defined</TableCell></TableRow>
                  ) : conversions?.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.from_unit_name} ({c.from_unit_symbol})</TableCell>
                      <TableCell>{c.to_unit_name} ({c.to_unit_symbol})</TableCell>
                      <TableCell className="font-mono">{c.factor}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this conversion?")) deleteConvMut.mutate(c.id) }}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calculator">
          <Card>
            <CardHeader><CardTitle>Conversion Calculator</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>From Unit</Label>
                  <Select value={calcFrom} onChange={(e) => setCalcFrom(e.target.value)}>
                    <option value="">Select unit</option>
                    {units?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>To Unit</Label>
                  <Select value={calcTo} onChange={(e) => setCalcTo(e.target.value)}>
                    <option value="">Select unit</option>
                    {units?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" value={calcQty} onChange={(e) => setCalcQty(Number(e.target.value))} />
                </div>
              </div>
              <Button onClick={() => calcMut.mutate()} disabled={!calcFrom || !calcTo || calcMut.isPending}>
                <ArrowRightLeft className="h-4 w-4" /> Convert
              </Button>
              {calcResult !== null && (
                <div className="p-4 bg-muted rounded-md text-center">
                  <span className="text-lg font-bold">{calcQty} → {calcResult.toFixed(4)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) setErrors({}); setShowForm(v) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit Unit" : "Add Unit"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Symbol</Label>
              <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
              {errors.symbol && <p className="text-sm text-destructive">{errors.symbol}</p>}
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {UNIT_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </Select>
            </div>
            <Button onClick={() => { if (validate()) { if (editId) { updateMut.mutate() } else { createMut.mutate() } } }} className="w-full" disabled={createMut.isPending || updateMut.isPending}>{editId ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showConvForm} onOpenChange={setShowConvForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Unit Conversion</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>From Unit</Label>
              <Select value={convForm.from_unit_id} onChange={(e) => setConvForm({ ...convForm, from_unit_id: e.target.value })}>
                <option value="">Select unit</option>
                {units?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To Unit</Label>
              <Select value={convForm.to_unit_id} onChange={(e) => setConvForm({ ...convForm, to_unit_id: e.target.value })}>
                <option value="">Select unit</option>
                {units?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Factor (1 from = ? to)</Label>
              <Input type="number" step="0.0001" value={convForm.factor} onChange={(e) => setConvForm({ ...convForm, factor: Number(e.target.value) })} />
            </div>
            <Button onClick={() => createConvMut.mutate()} className="w-full" disabled={!convForm.from_unit_id || !convForm.to_unit_id || createConvMut.isPending}>Add</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
