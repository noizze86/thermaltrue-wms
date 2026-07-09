import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getWarehouses, createWarehouse, updateWarehouse, deleteWarehouse,
  getWarehouseStats, getZones, createZone, deleteZone,
  getLocations, createLocation, deleteLocation
} from "../../api"
import type { Warehouse } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Badge } from "../../components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Plus, Pencil, Trash2, Warehouse as WarehouseIcon, Search, Layers, BarChart3, Image as ImageIcon, Eye, TreePine } from "lucide-react"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { useAuth } from "../../contexts/AuthContext"
import { LoadingState, ErrorState, EmptyState } from "../../components/ui/data-state"

function LocationTreeNode({ node, all, depth, onDelete }: { node: { id: string; code: string; type_: string; parent_id: string | null }; all: { id: string; code: string; type_: string; parent_id: string | null }[]; depth: number; onDelete: (id: string) => void }) {
  const children = all.filter((l) => l.parent_id === node.id)
  const colors: Record<string, string> = { zone: "text-blue-600 dark:text-blue-400", aisle: "text-green-600 dark:text-green-400", rack: "text-amber-600 dark:text-amber-400", bin: "text-gray-600 dark:text-gray-400" }
  return (
    <div>
      <div className="flex items-center gap-2 py-1 px-2 hover:bg-muted/50 rounded group" style={{ paddingLeft: `${depth * 20 + 8}px` }}>
        <span className={`text-xs font-medium ${colors[node.type_] || ""}`}>{node.type_}</span>
        <span className="font-mono text-xs">{node.code}</span>
        <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100" onClick={() => onDelete(node.id)}><Trash2 className="h-3 w-3" /></Button>
        {children.length > 0 && <span className="text-xs text-muted-foreground">({children.length})</span>}
      </div>
      {children.map((child) => <LocationTreeNode key={child.id} node={child} all={all} depth={depth + 1} onDelete={onDelete} />)}
    </div>
  )
}

const whSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Max 255 characters"),
  code: z.string().min(1, "Code is required").max(50, "Max 50 characters"),
  location: z.string().max(500, "Max 500 characters"),
  capacity: z.number().min(0, "Capacity must be >= 0"),
  is_active: z.boolean(),
})

export default function WarehouseListPage() {
  const [showForm, setShowForm] = useState(false)
  const [showZoneForm, setShowZoneForm] = useState(false)
  const [showLayout, setShowLayout] = useState("")
  const [editItem, setEditItem] = useState<Warehouse | null>(null)
  const [form, setForm] = useState({ name: "", code: "", location: "", capacity: 0, is_active: true })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [zoneWhId, setZoneWhId] = useState("")
  const [zoneName, setZoneName] = useState("")
  const [zoneCode, setZoneCode] = useState("")
  const [zoneCapacity, setZoneCapacity] = useState(0)
  const [showLocations, setShowLocations] = useState(false)
  const [locWhId, setLocWhId] = useState("")
  const [locParentId, setLocParentId] = useState<string | null>(null)
  const [locType, setLocType] = useState("bin")
  const [locCode, setLocCode] = useState("")
  const { data: locationTree } = useQuery({
    queryKey: ["locations", locWhId],
    queryFn: () => getLocations(locWhId, undefined),
    enabled: !!locWhId && showLocations,
  })
  const createLocationMut = useMutation({
    mutationFn: () => createLocation(locWhId, locParentId || "", locType, locCode),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["locations", locWhId] }); setLocCode("") },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteLocationMut = useMutation({
    mutationFn: (id: string) => deleteLocation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["locations", locWhId] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: warehouses, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["warehouses", debouncedSearch],
    queryFn: () => getWarehouses(debouncedSearch || undefined),
  })
  const { data: stats } = useQuery({
    queryKey: ["warehouse_stats"],
    queryFn: getWarehouseStats,
  })
  const { data: zones } = useQuery({
    queryKey: ["zones", zoneWhId],
    queryFn: () => getZones(zoneWhId || undefined),
    enabled: !!zoneWhId,
  })

  const statsMap = new Map((stats || []).map((s) => [s.id, s]))

  const validate = () => {
    const result = whSchema.safeParse(form)
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
    mutationFn: () => createWarehouse({ id: "", name: form.name, code: form.code, location: form.location, capacity: form.capacity, layout_image: "", is_active: form.is_active, created_at: "" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["warehouses"] }); queryClient.invalidateQueries({ queryKey: ["warehouse_stats"] }); setShowForm(false); setForm({ name: "", code: "", location: "", capacity: 0, is_active: true }); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const updateMut = useMutation({
    mutationFn: () => updateWarehouse({ id: editItem!.id, name: form.name, code: form.code, location: form.location, capacity: form.capacity, layout_image: editItem!.layout_image, is_active: form.is_active, created_at: "" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["warehouses"] }); queryClient.invalidateQueries({ queryKey: ["warehouse_stats"] }); setShowForm(false); setEditItem(null); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWarehouse(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["warehouses"] }); queryClient.invalidateQueries({ queryKey: ["warehouse_stats"] }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const createZoneMut = useMutation({
    mutationFn: () => createZone(zoneWhId, zoneName, zoneCode, zoneCapacity),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["zones"] }); setZoneName(""); setZoneCode(""); setZoneCapacity(0); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteZoneMut = useMutation({
    mutationFn: (id: string) => deleteZone(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["zones"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const handleLayoutImage = (e: React.ChangeEvent<HTMLInputElement>, wh: Warehouse) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      updateWarehouse({ ...wh, layout_image: dataUrl }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["warehouses"] })
        toast({ title: "Success", description: "Layout image updated" })
      }).catch((err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }))
    }
    reader.readAsDataURL(file)
  }
  if (isLoading) return <LoadingState text="Loading warehouses..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load warehouses"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2"><WarehouseIcon className="h-8 w-8" /> Warehouses</h1>
        {can("manage_warehouse") && <Button onClick={() => { setEditItem(null); setForm({ name: "", code: "", location: "", capacity: 0, is_active: true }); setErrors({}); setShowForm(true) }}><Plus className="h-4 w-4" /> Add Warehouse</Button>}
      </div>

      <div className="relative w-64">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search warehouses..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
      </div>

      {warehouses?.length === 0 ? (
        <EmptyState title="No warehouses found" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {warehouses?.map((wh) => {
            const s = statsMap.get(wh.id)
            const pct = s && s.capacity > 0 ? Math.min(100, Math.round((s.used_capacity / s.capacity) * 100)) : 0
            return (
              <Card key={wh.id} className={wh.is_active ? "" : "opacity-60"}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2"><WarehouseIcon className="h-5 w-5" /> {wh.name}</span>
                    <div className="flex gap-2">
                      <Badge variant={wh.is_active ? "default" : "secondary"}>{wh.code}</Badge>
                      {!wh.is_active && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">Location: {wh.location || "-"}</p>

                  {s && (
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <Layers className="h-4 w-4 mx-auto mb-1" />
                        <span className="font-bold">{s.rack_count}</span>
                        <div className="text-xs text-muted-foreground">Racks</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <BarChart3 className="h-4 w-4 mx-auto mb-1" />
                        <span className="font-bold">{s.material_count}</span>
                        <div className="text-xs text-muted-foreground">Materials</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <WarehouseIcon className="h-4 w-4 mx-auto mb-1" />
                        <span className="font-bold">{pct}%</span>
                        <div className="text-xs text-muted-foreground">Used</div>
                      </div>
                    </div>
                  )}

                  {wh.capacity > 0 && (
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Capacity: {s ? s.used_capacity : 0} / {wh.capacity}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {wh.layout_image && (
                    <div className="relative">
                      <img src={wh.layout_image} alt="Layout" className="w-full h-24 object-cover rounded cursor-pointer" onClick={() => setShowLayout(wh.layout_image)} />
                      <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => setShowLayout(wh.layout_image)}><Eye className="h-3 w-3" /></Button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {can("manage_warehouse") && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => { setEditItem(wh); setForm({ name: wh.name, code: wh.code, location: wh.location, capacity: wh.capacity, is_active: wh.is_active }); setErrors({}); setShowForm(true) }}><Pencil className="h-4 w-4" /> Edit</Button>
                        <Button variant="outline" size="sm" onClick={() => { setZoneWhId(wh.id); setZoneName(""); setZoneCode(""); setShowZoneForm(true) }}><Layers className="h-4 w-4" /> Zones</Button>
                        <Button variant="outline" size="sm" onClick={() => { setLocWhId(wh.id); setLocParentId(null); setLocCode(""); setShowLocations(true) }}><TreePine className="h-4 w-4" /> Locations</Button>
                        <label className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3 gap-2">
                          <ImageIcon className="h-4 w-4" /> Layout
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleLayoutImage(e, wh)} />
                        </label>
                      </>
                    )}
                    {can("delete_any") && (
                      <Button variant="destructive" size="sm" onClick={() => { if (confirm("Delete this warehouse? This will also delete all zones and racks.")) deleteMut.mutate(wh.id) }}><Trash2 className="h-4 w-4" /> Delete</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) setErrors({}); setShowForm(v) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit Warehouse" : "Add Warehouse"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              {errors.code && <p className="text-sm text-destructive">{errors.code}</p>}
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              {errors.location && <p className="text-sm text-destructive">{errors.location}</p>}
            </div>
            <div className="space-y-2">
              <Label>Capacity (total storage units)</Label>
              <Input type="number" min={0} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
              {errors.capacity && <p className="text-sm text-destructive">{errors.capacity}</p>}
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4" />
              <Label htmlFor="is_active">Active</Label>
            </div>
            <Button onClick={() => { if (validate()) { if (editItem) { updateMut.mutate() } else { createMut.mutate() } } }} className="w-full" disabled={createMut.isPending || updateMut.isPending}>
              {editItem ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showZoneForm} onOpenChange={(v) => setShowZoneForm(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Manage Zones</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input placeholder="Zone name" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
              <Input placeholder="Code" value={zoneCode} onChange={(e) => setZoneCode(e.target.value)} className="w-24" />
              <Input type="number" min={0} placeholder="Capacity" value={zoneCapacity} onChange={(e) => setZoneCapacity(Number(e.target.value))} className="w-24" />
              <Button size="sm" onClick={() => createZoneMut.mutate()} disabled={!zoneName || !zoneCode || createZoneMut.isPending}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {zones?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No zones defined</p>
              ) : zones?.map((z) => (
                <div key={z.id} className="flex items-center justify-between bg-muted/50 rounded px-3 py-2">
                  <div>
                    <span className="font-medium">{z.name}</span>
                    <Badge variant="outline" className="ml-2">{z.code}</Badge>
                    {z.capacity > 0 && <Badge variant="secondary" className="ml-1">{z.capacity} cap</Badge>}
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { if (confirm("Delete zone?")) deleteZoneMut.mutate(z.id) }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showLocations} onOpenChange={(v) => { if (!v) setShowLocations(false) }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Manage Locations (Zone → Aisle → Rack → Bin)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input placeholder="Code (e.g. A-01-Z3)" value={locCode} onChange={(e) => setLocCode(e.target.value)} className="flex-1" />
              <select value={locType} onChange={(e) => setLocType(e.target.value)} className="flex h-9 w-24 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm">
                <option value="zone">Zone</option>
                <option value="aisle">Aisle</option>
                <option value="rack">Rack</option>
                <option value="bin">Bin</option>
              </select>
              <select value={locParentId || ""} onChange={(e) => setLocParentId(e.target.value || null)} className="flex h-9 w-32 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm">
                <option value="">Root</option>
                {locationTree?.filter((l) => l.type_ !== "bin").map((l) => <option key={l.id} value={l.id}>{l.code} ({l.type_})</option>)}
              </select>
              <Button size="sm" onClick={() => createLocationMut.mutate()} disabled={!locCode || createLocationMut.isPending}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {locationTree && locationTree.length > 0 ? (
                <div className="text-sm space-y-1">
                  {locationTree.filter((l) => !l.parent_id).map((root) => (
                    <LocationTreeNode key={root.id} node={root} all={locationTree} depth={0} onDelete={(id) => deleteLocationMut.mutate(id)} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No locations defined</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showLayout} onOpenChange={(v) => { if (!v) setShowLayout("") }}>
        <DialogContent className="sm:max-w-3xl">
          {showLayout && <img src={showLayout} alt="Warehouse layout" className="w-full max-h-[70vh] object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
