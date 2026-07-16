import { useState, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import * as api from "../api"
import { resources } from "../dataProvider/resources"
import type { ResourceColumn } from "../dataProvider/resources"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Select } from "../components/ui/select"
import { Label } from "../components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { LoadingState, ErrorState } from "../components/ui/data-state"
import { toast } from "../hooks/use-toast"
import {
  Package, Tags, Ruler, Truck, Warehouse, Layers, LayoutGrid,
  ArrowRightLeft, Users, Shield, ClipboardList, PackageSearch, FileText,
  Plus, Search, Pencil, Trash2,
} from "lucide-react"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Package, Tags, Ruler, Truck, Warehouse, Layers, LayoutGrid,
  ArrowRightLeft, Users, Shield, ClipboardList, PackageSearch, FileText,
}

type CrudHandler = {
  list: (params?: Record<string, string>) => Promise<unknown[]>
  create: (data: Record<string, unknown>) => Promise<unknown>
  update: (data: Record<string, unknown>) => Promise<unknown>
  remove: (id: string) => Promise<void>
}

function getHandlers(key: string): CrudHandler | null {
  switch (key) {
    case "materials": return {
      list: (p) => api.getMaterials(p?.search, p?.category_id, p?.warehouse_id),
      create: (d) => api.createMaterial(d as unknown as api.Material),
      update: (d) => api.updateMaterial(d as unknown as api.Material),
      remove: (id) => api.deleteMaterial(id),
    }
    case "categories": return {
      list: (p) => api.getCategories(p?.search),
      create: (d) => api.createCategory(d.name as string, d.description as string, d.parent_id as string | null, d.icon as string, d.color as string),
      update: (d) => api.updateCategory(d.id as string, d.name as string, d.description as string, d.parent_id as string | null, d.icon as string, d.color as string),
      remove: (id) => api.deleteCategory(id),
    }
    case "units": return {
      list: (p) => api.getUnits(p?.search),
      create: (d) => api.createUnit(d.name as string, d.symbol as string, d.category as string),
      update: (d) => api.updateUnit(d.id as string, d.name as string, d.symbol as string, d.category as string),
      remove: (id) => api.deleteUnit(id),
    }
    case "suppliers": return {
      list: (p) => api.getSuppliers(p?.search),
      create: (d) => api.createSupplier(d as unknown as api.Supplier),
      update: (d) => api.updateSupplier(d as unknown as api.Supplier),
      remove: (id) => api.deleteSupplier(id),
    }
    case "warehouses": return {
      list: (p) => api.getWarehouses(p?.search),
      create: (d) => api.createWarehouse(d as unknown as api.Warehouse),
      update: (d) => api.updateWarehouse(d as unknown as api.Warehouse),
      remove: (id) => api.deleteWarehouse(id),
    }
    case "zones": return {
      list: (p) => api.getZones(p?.warehouse_id),
      create: (d) => api.createZone(d.warehouse_id as string, d.name as string, d.code as string, d.capacity as number | undefined),
      update: (d) => api.updateZone(d.id as string, d.name as string, d.code as string, d.capacity as number),
      remove: (id) => api.deleteZone(id),
    }
    case "racks": return {
      list: (p) => api.getRacks(p?.warehouse_id, p?.search),
      create: (d) => api.createRack(d as unknown as api.Rack),
      update: (d) => api.updateRack(d as unknown as api.Rack),
      remove: (id) => api.deleteRack(id),
    }
    case "transactions": return {
      list: (p) => api.getTransactions(p?.search, p?.type_filter, p?.material_id, p?.warehouse_id, p?.date_start, p?.date_end),
      create: (d) => api.createTransaction(d as unknown as api.Transaction),
      update: () => Promise.reject(new Error("Update not supported for transactions")),
      remove: () => Promise.reject(new Error("Delete not supported for transactions")),
    }
    case "users": return {
      list: () => api.getUsers(),
      create: (d) => api.createUser(d.username as string, d.password as string, d.full_name as string, d.role as string),
      update: (d) => api.updateUser(d.id as string, d.full_name as string, d.email as string, d.role as string, d.is_active as boolean),
      remove: (id) => api.deleteUser(id),
    }
    case "roles": return {
      list: () => api.getRoles(),
      create: () => Promise.reject(new Error("Create not supported for roles")),
      update: (d) => api.updateRole(d.id as string, d.name as string, d.description as string, d.permissions as string),
      remove: () => Promise.reject(new Error("Delete not supported for roles")),
    }
    case "audit_log": return {
      list: (p) => api.getAuditLogsFiltered(p?.action, p?.entity, p?.user_id, p?.date_start, p?.date_end),
      create: () => Promise.reject(new Error("Create not supported for audit log")),
      update: () => Promise.reject(new Error("Update not supported for audit log")),
      remove: () => Promise.reject(new Error("Delete not supported for audit log")),
    }
    case "inventory": return {
      list: (p) => api.getMaterials(p?.search, p?.category_id, p?.warehouse_id),
      create: () => Promise.reject(new Error("Use Materials for create/update")),
      update: () => Promise.reject(new Error("Use Materials for create/update")),
      remove: () => Promise.reject(new Error("Use Materials for delete")),
    }
    case "reports": return {
      list: () => api.exportReportCsv("stock").then((csv) => [{ report_type: "stock", generated_at: new Date().toISOString(), csv }]),
      create: () => Promise.reject(new Error("Reports are generated, not created")),
      update: () => Promise.reject(new Error("Reports are generated, not updated")),
      remove: () => Promise.reject(new Error("Reports are not deletable")),
    }
    default: return null
  }
}

export default function MasterDataPage() {
  const queryClient = useQueryClient()
  const [selectedKey, setSelectedKey] = useState<string>("materials")
  const [searchQuery, setSearchQuery] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})

  const selectedResource = resources.find((r) => r.key === selectedKey) || resources[0]
  const handlers = getHandlers(selectedKey)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["master_data", selectedKey, searchQuery],
    queryFn: () => handlers?.list?.(searchQuery ? { search: searchQuery } : undefined) ?? Promise.resolve([]),
  })

  const createMut = useMutation({
    mutationFn: (d: Record<string, unknown>) => handlers?.create?.(d) ?? Promise.reject(new Error("No handler")),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["master_data", selectedKey] }); setShowForm(false); setEditItem(null); toast({ title: "Created", description: `${selectedResource.label} created successfully` }) },
  })
  const updateMut = useMutation({
    mutationFn: (d: Record<string, unknown>) => handlers?.update?.(d) ?? Promise.reject(new Error("No handler")),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["master_data", selectedKey] }); setShowForm(false); setEditItem(null); toast({ title: "Updated", description: `${selectedResource.label} updated successfully` }) },
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => handlers?.remove?.(id) ?? Promise.reject(new Error("No handler")),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["master_data", selectedKey] }); toast({ title: "Deleted" }) },
  })

  const canCreate = !["audit_log", "inventory", "reports", "roles"].includes(selectedKey)
  const canEdit = !["audit_log", "inventory", "reports", "transactions", "roles"].includes(selectedKey)
  const canDelete = !["audit_log", "inventory", "reports", "transactions", "roles"].includes(selectedKey)

  const openCreateForm = useCallback(() => {
    const initial: Record<string, unknown> = {}
    for (const col of selectedResource.columns) {
      initial[col.key] = col.type === "number" ? 0 : ""
    }
    setFormData(initial)
    setEditItem(null)
    setShowForm(true)
  }, [selectedResource])

  const openEditForm = useCallback((item: Record<string, unknown>) => {
    const form: Record<string, unknown> = {}
    for (const col of selectedResource.columns) {
      form[col.key] = item[col.key] ?? (col.type === "number" ? 0 : "")
    }
    form.id = item.id
    setFormData(form)
    setEditItem(item)
    setShowForm(true)
  }, [selectedResource])

  const handleSubmit = () => {
    if (editItem) {
      updateMut.mutate(formData)
    } else {
      createMut.mutate(formData)
    }
  }

  const renderFormField = (col: ResourceColumn) => {
    const value = formData[col.key] ?? (col.type === "number" ? 0 : "")
    if (col.type === "select") {
      return (
        <Select
          value={String(value)}
          onChange={(e) => setFormData({ ...formData, [col.key]: e.target.value })}
        >
          <option value="">Select {col.label}</option>
          {col.options?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </Select>
      )
    }
    return (
      <Input
        type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
        value={value as string | number}
        onChange={(e) => setFormData({ ...formData, [col.key]: col.type === "number" ? Number(e.target.value) : e.target.value })}
      />
    )
  }

  const rows = Array.isArray(data) ? data : []
  const Icon = iconMap[selectedResource.icon] || Package

  return (
    <div className="flex gap-6 h-full">
      <div className="w-56 shrink-0 space-y-1">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">Master Data</h2>
        {resources.map((r) => {
          const IconItem = iconMap[r.icon] || Package
          return (
            <button
              key={r.key}
              onClick={() => { setSelectedKey(r.key); setSearchQuery("") }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${selectedKey === r.key ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              <IconItem className="h-4 w-4 shrink-0" />
              {r.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Icon className="h-6 w-6" />
            {selectedResource.label}
          </h1>
          <div className="flex gap-2">
            {canCreate && (
              <Button onClick={openCreateForm}><Plus className="h-4 w-4" /> Add {selectedResource.label}</Button>
            )}
          </div>
        </div>

        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">{selectedResource.label} List</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <LoadingState text={`Loading ${selectedResource.label}...`} />
            ) : isError ? (
              <ErrorState message={error?.message || "Failed to load"} onRetry={refetch} />
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No {selectedResource.label.toLowerCase()} found</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {selectedResource.columns.map((col) => (
                      <TableHead key={col.key}>{col.label}</TableHead>
                    ))}
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item, idx) => {
                    const id = String((item as Record<string, unknown>).id ?? idx)
                    return (
                      <TableRow key={id}>
                        {selectedResource.columns.map((col) => (
                          <TableCell key={col.key}>
                            {col.type === "date"
                              ? String((item as Record<string, unknown>)[col.key] ?? "").slice(0, 10)
                              : String((item as Record<string, unknown>)[col.key] ?? "-")}
                          </TableCell>
                        ))}
                        <TableCell>
                          <div className="flex gap-1">
                            {canEdit && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditForm(item as Record<string, unknown>)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => {
                                  if (confirm(`Delete this ${selectedResource.label.toLowerCase()}?`)) {
                                    deleteMut.mutate(id)
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setEditItem(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editItem ? `Edit ${selectedResource.label}` : `Add ${selectedResource.label}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedResource.columns.map((col) => (
              <div key={col.key} className="space-y-1.5">
                <Label>{col.label}</Label>
                {renderFormField(col)}
              </div>
            ))}
            <Button onClick={handleSubmit} className="w-full" disabled={createMut.isPending || updateMut.isPending}>
              {editItem ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
