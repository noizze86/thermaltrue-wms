import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getRacks, createRack, updateRack, deleteRack, getWarehouses, getRackOccupancy, getRackOccupancyDetails, getRackUtilizationHistory, suggestPutaway, generateQrCode, getLocations } from "../../api"
import type { Rack } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { Plus, Pencil, Trash2, Search, QrCode, BarChart3, Package, ArrowRight } from "lucide-react"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { useAuth } from "../../contexts/AuthContext"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const schema = z.object({
  warehouse_id: z.string().min(1, "Warehouse is required"),
  area: z.string().max(100),
  rack_name: z.string().min(1, "Rack name is required").max(100, "Max 100 characters"),
  bin_location: z.string().max(100),
  max_capacity: z.number().min(0, "Capacity must be >= 0"),
  location_id: z.string().optional(),
})

export default function RackPage() {
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Rack | null>(null)
  const [form, setForm] = useState({ warehouse_id: "", area: "", rack_name: "", bin_location: "", max_capacity: 0, location_id: "" })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [whFilter, setWhFilter] = useState("")
  const [selectedRack, setSelectedRack] = useState<Rack | null>(null)
  const [showUtilization, setShowUtilization] = useState(false)
  const [showPutaway, setShowPutaway] = useState(false)
  const [showQr, setShowQr] = useState<string | null>(null)
  const [putawayWhId, setPutawayWhId] = useState("")
  const [putawayMaterialId, setPutawayMaterialId] = useState("")
  const [viewMode, setViewMode] = useState<"table" | "grid">("table")

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: racks, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["racks", whFilter, debouncedSearch],
    queryFn: () => getRacks(whFilter || undefined, debouncedSearch || undefined),
  })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: locations } = useQuery({
    queryKey: ["locations", form.warehouse_id],
    queryFn: () => getLocations(form.warehouse_id || undefined, undefined),
    enabled: !!form.warehouse_id,
  })
  const { data: occupancy } = useQuery({ queryKey: ["rack_occupancy"], queryFn: getRackOccupancy })
  const { data: details } = useQuery({
    queryKey: ["rack_occupancy_details", whFilter],
    queryFn: getRackOccupancyDetails,
  })
  const { data: utilizationHistory } = useQuery({
    queryKey: ["rack_utilization", selectedRack?.id],
    queryFn: () => selectedRack ? getRackUtilizationHistory(selectedRack.id) : Promise.resolve([]),
    enabled: !!selectedRack && showUtilization,
  })
  const { data: putawaySuggestion } = useQuery({
    queryKey: ["putaway_suggestion", putawayWhId, putawayMaterialId],
    queryFn: () => suggestPutaway(putawayWhId, putawayMaterialId),
    enabled: !!putawayWhId && !!putawayMaterialId,
  })

  const occMap = new Map((occupancy || []).map((o) => [o.rack_id, o]))
  const detailMap = new Map((details || []).map((d) => [d.rack_id, d]))

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
    mutationFn: () => createRack({ id: "", warehouse_id: form.warehouse_id, area: form.area, rack_name: form.rack_name, bin_location: form.bin_location, max_capacity: form.max_capacity, location_id: form.location_id || null, created_at: "" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["racks"] }); queryClient.invalidateQueries({ queryKey: ["rack_occupancy"] }); queryClient.invalidateQueries({ queryKey: ["rack_occupancy_details"] }); setShowForm(false); setForm({ warehouse_id: "", area: "", rack_name: "", bin_location: "", max_capacity: 0, location_id: "" }); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const updateMut = useMutation({
    mutationFn: () => updateRack({ id: editItem!.id, warehouse_id: form.warehouse_id, area: form.area, rack_name: form.rack_name, bin_location: form.bin_location, max_capacity: form.max_capacity, location_id: form.location_id || null, created_at: "" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["racks"] }); queryClient.invalidateQueries({ queryKey: ["rack_occupancy"] }); queryClient.invalidateQueries({ queryKey: ["rack_occupancy_details"] }); setShowForm(false); setEditItem(null); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRack(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["racks"] }); queryClient.invalidateQueries({ queryKey: ["rack_occupancy"] }); queryClient.invalidateQueries({ queryKey: ["rack_occupancy_details"] }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const usagePercent = (rackId: string): number => {
    const o = occMap.get(rackId)
    if (!o || o.max_capacity <= 0) return 0
    return Math.min(100, Math.round((o.total_quantity / o.max_capacity) * 100))
  }

  const usageColor = (pct: number) => {
    if (pct >= 90) return "bg-destructive"
    if (pct >= 70) return "bg-yellow-500"
    if (pct >= 40) return "bg-blue-500"
    return "bg-green-500"
  }

  const renderGrid = () => {
    const whGroups = new Map<string, Rack[]>()
    for (const r of racks || []) {
      const list = whGroups.get(r.warehouse_id) || []
      list.push(r)
      whGroups.set(r.warehouse_id, list)
    }
    if (whGroups.size === 0) {
      return <div className="text-center text-muted-foreground py-12">No racks found</div>
    }
    return Array.from(whGroups.entries()).map(([whId, rackList]) => (
      <Card key={whId}>
        <CardHeader>
          <CardTitle className="text-base">{warehouses?.find((w) => w.id === whId)?.name || "Unknown Warehouse"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {rackList.map((r) => {
              const pct = usagePercent(r.id)
              const d = detailMap.get(r.id)
              return (
                <div
                  key={r.id}
                  className="relative border rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => { setSelectedRack(r); setShowUtilization(true) }}
                >
                  <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-lg ${usageColor(pct)}`} />
                  <div className="text-center pt-1">
                    <div className="font-medium text-sm">{r.rack_name}</div>
                    <div className="text-xs text-muted-foreground">{r.bin_location || r.area || "-"}</div>
                    {r.max_capacity > 0 && (
                      <div className="mt-2">
                        <div className="text-lg font-bold">{pct}%</div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                          <div className={`h-full rounded-full ${usageColor(pct)}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                    {d && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {d.material_count} items
                      </div>
                    )}
                  </div>
                  <div className="absolute top-1 right-1">
                    <span className={`inline-block w-2 h-2 rounded-full ${pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-yellow-500" : "bg-green-500"}`} />
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    ))
  }

  const renderUtilizationChart = () => {
    if (!utilizationHistory || utilizationHistory.length === 0) {
      return <div className="text-center text-muted-foreground py-8">No utilization history data available</div>
    }
    const maxVal = Math.max(...utilizationHistory.map((e) => e.total_quantity), 1)
    return (
      <div className="space-y-2">
        <div className="flex items-end gap-1 h-32">
          {utilizationHistory.map((entry, i) => {
            const h = (entry.total_quantity / maxVal) * 100
            return (
              <div key={entry.id || i} className="flex-1 flex flex-col items-center gap-1 group relative">
                <div
                  className="w-full bg-primary/60 hover:bg-primary rounded-t transition-all min-h-[4px]"
                  style={{ height: `${Math.max(h, 2)}%` }}
                />
                <div className="absolute bottom-full mb-1 hidden group-hover:block bg-popover text-popover-foreground text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg z-10">
                  {entry.date}: {entry.total_quantity}
                </div>
              </div>
            )
          })}
        </div>
        <div className="text-xs text-muted-foreground text-center">
          Last {utilizationHistory.length} days
        </div>
      </div>
    )
  }
  if (isLoading) return <LoadingState text="Loading racks..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load racks"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Rack / Bin Management</h1>
        {can("manage_warehouse") && <Button onClick={() => { setEditItem(null); setForm({ warehouse_id: whFilter || "", area: "", rack_name: "", bin_location: "", max_capacity: 0, location_id: "" }); setErrors({}); setShowForm(true) }}><Plus className="h-4 w-4" /> Add Rack</Button>}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center">
          <div className="relative w-48">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search racks..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Select
            value={whFilter}
            onChange={(e) => setWhFilter(e.target.value)}
          >
            <option value="">All Warehouses</option>
            {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant={viewMode === "table" ? "default" : "outline"} size="sm" onClick={() => setViewMode("table")}>
            Table
          </Button>
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="sm" onClick={() => setViewMode("grid")}>
            Grid
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            if (!racks?.length) { toast({ title: "Info", description: "No racks to suggest put-away for" }); return }
            setPutawayWhId(whFilter || (warehouses?.[0]?.id ?? ""))
            setPutawayMaterialId("")
            setShowPutaway(true)
          }}>
            <Package className="h-4 w-4" /> Put-away
          </Button>
        </div>
      </div>

      {viewMode === "grid" ? renderGrid() : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Warehouse</TableHead><TableHead>Area</TableHead><TableHead>Rack Name</TableHead><TableHead>Bin Location</TableHead><TableHead>Capacity</TableHead><TableHead>Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {racks?.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No racks found</TableCell></TableRow>
                ) : racks?.map((r) => {
                  const occ = occMap.get(r.id)
                  const pct = usagePercent(r.id)
                  const d = detailMap.get(r.id)
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => { setSelectedRack(r); setShowUtilization(true) }}>
                      <TableCell>{warehouses?.find((w) => w.id === r.warehouse_id)?.name || "-"}</TableCell>
                      <TableCell>{r.area || "-"}</TableCell>
                      <TableCell className="font-medium">{r.rack_name}</TableCell>
                      <TableCell>{r.bin_location}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">
                            {d ? `${d.material_count} items, ${d.total_quantity} qty` : occ ? `${occ.material_count} items, ${occ.total_quantity} qty` : "No data"}
                          </span>
                          {r.max_capacity > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${usageColor(pct)}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground w-12 text-right">{pct}%</span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {can("manage_warehouse") && <Button variant="ghost" size="icon" onClick={() => { setEditItem(r); setForm({ warehouse_id: r.warehouse_id, area: r.area, rack_name: r.rack_name, bin_location: r.bin_location, max_capacity: r.max_capacity, location_id: r.location_id || "" }); setErrors({}); setShowForm(true) }}><Pencil className="h-4 w-4" /></Button>}
                          {can("delete_any") && <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this rack?")) deleteMut.mutate(r.id) }}><Trash2 className="h-4 w-4" /></Button>}
                          <Button variant="ghost" size="icon" onClick={async () => {
                            const qrData = `${r.rack_name} | ${r.bin_location} | ${warehouses?.find((w) => w.id === r.warehouse_id)?.name || ""}`;
                            try {
                              const img = await generateQrCode(qrData);
                              setShowQr(img);
                            } catch { toast({ title: "Error", description: "Failed to generate QR", variant: "destructive" }) }
                          }}><QrCode className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) setErrors({}); setShowForm(v) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit Rack" : "Add Rack"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <Select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
                <option value="">Select...</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
              {errors.warehouse_id && <p className="text-sm text-destructive">{errors.warehouse_id}</p>}
            </div>
            <div className="space-y-2">
              <Label>Area</Label>
              <Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Rack Name</Label>
              <Input value={form.rack_name} onChange={(e) => setForm({ ...form, rack_name: e.target.value })} />
              {errors.rack_name && <p className="text-sm text-destructive">{errors.rack_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Bin Location</Label>
              <Input value={form.bin_location} onChange={(e) => setForm({ ...form, bin_location: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Max Capacity</Label>
              <Input type="number" min={0} value={form.max_capacity} onChange={(e) => setForm({ ...form, max_capacity: Number(e.target.value) })} />
              {errors.max_capacity && <p className="text-sm text-destructive">{errors.max_capacity}</p>}
            </div>
            <div className="space-y-2">
              <Label>Location (Zone/Aisle/Rack/Bin)</Label>
              <Select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                <option value="">None</option>
                {locations?.filter((l) => l.type_ === "bin" || l.type_ === "rack").map((l) => <option key={l.id} value={l.id}>{l.code} ({l.type_})</option>)}
              </Select>
            </div>
            <Button onClick={() => { if (validate()) { if (editItem) { updateMut.mutate() } else { createMut.mutate() } } }} className="w-full" disabled={createMut.isPending || updateMut.isPending}>
              {editItem ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showUtilization} onOpenChange={(v) => setShowUtilization(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {selectedRack?.rack_name} — {selectedRack?.bin_location || selectedRack?.area || ""}
            </DialogTitle>
          </DialogHeader>
          {selectedRack && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-muted/50 rounded p-3 text-center">
                  <div className="text-xs text-muted-foreground">Max Capacity</div>
                  <div className="text-lg font-bold">{selectedRack.max_capacity}</div>
                </div>
                <div className="bg-muted/50 rounded p-3 text-center">
                  <div className="text-xs text-muted-foreground">Current Usage</div>
                  <div className="text-lg font-bold">{occMap.get(selectedRack.id)?.total_quantity || 0}</div>
                </div>
                <div className="bg-muted/50 rounded p-3 text-center">
                  <div className="text-xs text-muted-foreground">Utilization</div>
                  <div className="text-lg font-bold">{usagePercent(selectedRack.id)}%</div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Utilization History (90 days)</h4>
                {renderUtilizationChart()}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showPutaway} onOpenChange={(v) => setShowPutaway(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Put-away Suggestion</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <Select value={putawayWhId} onChange={(e) => setPutawayWhId(e.target.value)}>
                <option value="">Select...</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Material ID</Label>
              <Input placeholder="Enter material UUID" value={putawayMaterialId} onChange={(e) => setPutawayMaterialId(e.target.value)} />
            </div>
            {putawaySuggestion && putawaySuggestion.rack_id && (
              <Card className="bg-muted/30 border-green-200">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-green-100 rounded-full p-2 mt-1">
                      <ArrowRight className="h-4 w-4 text-green-700" />
                    </div>
                    <div>
                      <p className="font-medium">Suggested Rack: {putawaySuggestion.rack_name}</p>
                      <div className="text-sm text-muted-foreground mt-1 space-y-1">
                        <p>Rack ID: {putawaySuggestion.rack_id}</p>
                        <p>Capacity: {putawaySuggestion.max_capacity}</p>
                        <p>Used: {putawaySuggestion.used}</p>
                        <p>Available: <strong>{putawaySuggestion.available}</strong></p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {putawaySuggestion && !putawaySuggestion.rack_id && (
              <p className="text-sm text-muted-foreground text-center py-4">{putawaySuggestion.rack_name}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showQr} onOpenChange={(v) => { if (!v) setShowQr(null) }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Rack QR Code</DialogTitle></DialogHeader>
          {showQr && <img src={showQr} alt="QR Code" className="w-full" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
