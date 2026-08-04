import { useState } from "react"
import { z } from "zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getStockOpnames, createStockOpname, updateStockOpnameStatus, getStockOpnameItems, saveStockOpnameItem, getWarehouses, getMaterials, getRacks, generateReportPdf, getCycleSchedules, createCycleSchedule, deleteCycleSchedule, getOpnameConfig, setOpnameConfig, autoGenerateCycleOpname, generateCountSheetPdf, getCycleScopeItems, approveOpnameAdjustment, getCycleTaskHistory, getCategories, getCycleZones, createZoneSchedule, deleteZoneSchedule, getZones, recountCycleTask, type CycleHistoryEntry } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { formatDate } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { Select } from "../../components/ui/select"
import { Plus, ClipboardCheck, Download, Filter, CheckCircle2, Calendar, Clock, Eye, EyeOff, FileSpreadsheet, Zap, XCircle, History, Check, RotateCcw } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const physicalQtySchema = z.number().min(0, "Physical quantity cannot be negative")

export default function StockOpnamePage() {
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedOpname, setSelectedOpname] = useState<string | null>(null)
  const [whId, setWhId] = useState("")
  const [notes, setNotes] = useState("")
  const [physicalQtys, setPhysicalQtys] = useState<Record<string, number>>({})
  const [qtyErrors, setQtyErrors] = useState<Record<string, string>>({})
  const [rackFilter, setRackFilter] = useState("")
  const [showReconcile, setShowReconcile] = useState(false)

  const [showCycleAdd, setShowCycleAdd] = useState(false)
  const [cycleWhId, setCycleWhId] = useState("")
  const [cycleClass, setCycleClass] = useState("A")
  const [adjustThreshold, setAdjustThreshold] = useState(5)

  const [taskDeadline, setTaskDeadline] = useState("")
  const [taskBlind, setTaskBlind] = useState(false)
  const [taskAssigned, setTaskAssigned] = useState("")
  const [taskCategory, setTaskCategory] = useState("")
  const [taskRack, setTaskRack] = useState("")
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set())
  const [scopeLoaded, setScopeLoaded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyData, setHistoryData] = useState<CycleHistoryEntry[]>([])

  const { data: scopeItems, isFetching: scopeLoading } = useQuery({
    queryKey: ["cycle_scope", taskCategory, taskRack, whId],
    queryFn: () => getCycleScopeItems(whId, taskCategory, taskRack),
    enabled: scopeLoaded,
  })

  const { data: opnames, isLoading, isError, error, refetch } = useQuery({ queryKey: ["stock_opnames"], queryFn: getStockOpnames })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: materials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => getCategories() })
  const { data: racks } = useQuery({ queryKey: ["racks"], queryFn: () => getRacks() })
  const { data: zones } = useQuery({ queryKey: ["zones"], queryFn: () => getZones() })
  const { data: opnameItems } = useQuery({
    queryKey: ["opname_items", selectedOpname],
    queryFn: () => getStockOpnameItems(selectedOpname!),
    enabled: !!selectedOpname,
  })
  const { data: cycleSchedules } = useQuery({ queryKey: ["cycle_schedules"], queryFn: getCycleSchedules })
  const { data: cycleZones } = useQuery({ queryKey: ["cycle_zones"], queryFn: getCycleZones })
  const { data: opnameConfig } = useQuery({ queryKey: ["opname_config"], queryFn: getOpnameConfig })
  const [showZoneAdd, setShowZoneAdd] = useState(false)
  const [zoneSel, setZoneSel] = useState("")
  const [zoneMode, setZoneMode] = useState("daily")

  const blindMode = opnameConfig?.blind_count_mode ?? false
  const autoThreshold = opnameConfig?.auto_adjust_threshold ?? 5

  const createMut = useMutation({
    mutationFn: () => createStockOpname({
      id: "", opname_number: "", warehouse_id: whId || null, status: "draft", notes, created_by: user?.id || null, created_at: "", updated_at: "",
      cycle_mode: "manual", deadline: taskDeadline, blind_mode: taskBlind, assigned_to: taskAssigned,
      ...(selectedMaterials.size > 0 ? { material_ids: Array.from(selectedMaterials) } : {}),
    } as any),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["stock_opnames"] }); setShowCreate(false); setWhId(""); setNotes(""); setTaskDeadline(""); setTaskBlind(false); setTaskAssigned(""); setSelectedMaterials(new Set()); setScopeLoaded(false) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selectedOpname) return
      for (const [materialId, physicalQty] of Object.entries(physicalQtys)) {
        const parsed = physicalQtySchema.safeParse(physicalQty)
        if (!parsed.success) {
          throw new Error(`Material ${materialId}: ${parsed.error.issues[0].message}`)
        }
        const item = opnameItems?.find((i) => i.material_id === materialId)
        await saveStockOpnameItem({
          id: item?.id || "", opname_id: selectedOpname, material_id: materialId,
          system_qty: item?.system_qty || 0, physical_qty: physicalQty,
          difference: physicalQty - (item?.system_qty || 0), notes: "",
        })
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["opname_items", selectedOpname] }); toast({ title: "Saved" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const completeMut = useMutation({
    mutationFn: () => updateStockOpnameStatus(selectedOpname!, "completed"),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["stock_opnames"] }); setSelectedOpname(null); toast({ title: "Completed" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const approveItemMut = useMutation({
    mutationFn: (itemId: string) => approveOpnameAdjustment(selectedOpname!, true, [itemId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opname_items", selectedOpname] })
      queryClient.invalidateQueries({ queryKey: ["stock_opnames"] })
      toast({ title: "Approved", description: "Stock adjusted and journaled" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const rejectItemMut = useMutation({
    mutationFn: (itemId: string) => approveOpnameAdjustment(selectedOpname!, false, [itemId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opname_items", selectedOpname] })
      queryClient.invalidateQueries({ queryKey: ["stock_opnames"] })
      toast({ title: "Rejected", description: "Recount requested for this item" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const recountMut = useMutation({
    mutationFn: () => recountCycleTask(selectedOpname!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock_opnames"] })
      setSelectedOpname(null)
      toast({ title: "Recount task created", description: "New round created for unresolved items" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const loadHistory = async (taskId: string) => {
    try {
      const data = await getCycleTaskHistory(taskId)
      setHistoryData(data)
      setShowHistory(true)
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    }
  }

  const createCycleMut = useMutation({
    mutationFn: () => {
      const freqMap: Record<string, number> = { A: 30, B: 90, C: 180 }
      return createCycleSchedule(cycleWhId || null, cycleClass, freqMap[cycleClass] || 30)
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["cycle_schedules"] }); setShowCycleAdd(false); setCycleWhId(""); setCycleClass("A"); toast({ title: "Cycle schedule added" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const deleteCycleMut = useMutation({
    mutationFn: (id: string) => deleteCycleSchedule(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["cycle_schedules"] }); toast({ title: "Schedule deleted" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const toggleBlindMut = useMutation({
    mutationFn: () => setOpnameConfig("blind_count_mode", blindMode ? "false" : "true"),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["opname_config"] }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const setThresholdMut = useMutation({
    mutationFn: () => setOpnameConfig("auto_adjust_threshold", String(adjustThreshold)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["opname_config"] }); toast({ title: "Threshold saved" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const autoGenMut = useMutation({
    mutationFn: () => autoGenerateCycleOpname(),
    onSuccess: (res) => { queryClient.invalidateQueries({ queryKey: ["stock_opnames"] }); toast({ title: "Auto-generate", description: JSON.stringify(res) }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const lowStockMut = useMutation({
    mutationFn: () => setOpnameConfig("cycle_low_stock_trigger", opnameConfig?.cycle_low_stock_trigger ? "false" : "true"),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["opname_config"] }); toast({ title: "Low-stock trigger updated" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const createZoneMut = useMutation({
    mutationFn: () => createZoneSchedule(zoneSel, whId || null, zoneMode),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["cycle_zones"] }); setShowZoneAdd(false); setZoneSel(""); toast({ title: "Zone schedule added" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const deleteZoneMut = useMutation({
    mutationFn: (id: string) => deleteZoneSchedule(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["cycle_zones"] }); toast({ title: "Zone schedule deleted" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const handleCountSheetPdf = async () => {
    try {
      const data = selectedOpnameData
      if (!data?.warehouse_id) { toast({ title: "Error", description: "No warehouse selected", variant: "destructive" }); return }
      const whId = data.warehouse_id
      const bytes = await generateCountSheetPdf(whId)
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `count_sheet_${selectedOpnameData?.opname_number || whId}.pdf`; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Count sheet downloaded" })
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    }
  }

  const startOpname = (opnameId: string) => {
    setSelectedOpname(opnameId)
    setPhysicalQtys({})
    setQtyErrors({})
    updateStockOpnameStatus(opnameId, "in_progress").catch(() => {})
  }

  const selectedOpnameData = opnames?.find((o) => o.id === selectedOpname)

  const statusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge variant="default">Completed</Badge>
      case "in_progress": return <Badge variant="secondary">In Progress</Badge>
      case "pending_review": return <Badge variant="warning">Pending Review</Badge>
      case "expired": return <Badge variant="destructive">Expired</Badge>
      case "rejected": return <Badge variant="destructive">Rejected</Badge>
      case "open": return <Badge variant="outline">Open</Badge>
      default: return <Badge variant="outline">{status}</Badge>
    }
  }

  const allItems = (opnameItems?.length ? opnameItems : materials?.map((m) => ({
    id: "", opname_id: selectedOpname || "", material_id: m.id,
    system_qty: m.quantity, physical_qty: 0, difference: 0, notes: "",
    approved_status: "", cycle_round: 1,
  })) || [])

  const filteredItems = allItems.filter((item) => {
    const mat = materials?.find((m) => m.id === item.material_id)
    if (rackFilter && mat?.rack_id !== rackFilter) return false
    return true
  })

  const diffItems = allItems.filter((item) => {
    const qty = physicalQtys[item.material_id] ?? (item.physical_qty || item.system_qty)
    return Math.abs(qty - item.system_qty) >= autoThreshold
  })

  const discrepancies = diffItems.length

  const handleExportPdf = async () => {
    try {
      const bytes = await generateReportPdf("opname")
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `opname_report_${selectedOpname?.slice(0, 8) || "all"}.pdf`; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Opname report downloaded" })
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    }
  }
  if (isLoading) return <LoadingState text="Loading stock opname data..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load stock opname data"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold flex items-center gap-2"><ClipboardCheck className="h-8 w-8" /> Stock Opname</h1>
        <div className="flex gap-2 items-center">
          {can("manage_warehouse") && (
            <Button variant="outline" size="sm" onClick={() => toggleBlindMut.mutate()} disabled={toggleBlindMut.isPending}>
              {blindMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {blindMode ? "Blind: ON" : "Blind: OFF"}
            </Button>
          )}
          {can("manage_warehouse") && (
            <Button variant="outline" size="sm" onClick={() => autoGenMut.mutate()} disabled={autoGenMut.isPending}>
              <Zap className="h-4 w-4" /> Auto Generate
            </Button>
          )}
          {can("manage_warehouse") && (
            <Button variant="outline" size="sm" onClick={() => lowStockMut.mutate()} disabled={lowStockMut.isPending}>
              Low-stock trigger: {opnameConfig?.cycle_low_stock_trigger ? "ON" : "OFF"}
            </Button>
          )}
          {can("manage_warehouse") && <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New Opname</Button>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Opname List</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>WH</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {opnames?.map((so) => (
                    <TableRow key={so.id} className={selectedOpname === so.id ? "bg-muted/50" : ""}>
                      <TableCell className="font-mono text-xs">{so.opname_number}</TableCell>
                      <TableCell className="text-xs">{warehouses?.find((w) => w.id === so.warehouse_id)?.name || "-"}</TableCell>
                      <TableCell>
                        {statusBadge(so.status)}
                        {so.deadline && <p className="text-[10px] text-muted-foreground mt-0.5">Due {formatDate(so.deadline)}</p>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {can("manage_warehouse") ? (
                            <Button size="sm" variant="outline" onClick={() => startOpname(so.id)} disabled={so.status === "completed"}>
                              {so.status === "draft" || so.status === "open" ? "Start" : selectedOpname === so.id ? "Viewing" : "View"}
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" disabled>View</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => loadHistory(so.id)} title="Task history">
                            <History className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!opnames || opnames.length === 0) && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No opnames yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {selectedOpname && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Filter className="h-5 w-5" /> Filter</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Rack Filter</Label>
                  <Select value={rackFilter} onChange={(e) => setRackFilter(e.target.value)} className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm">
                    <option value="">All Racks</option>
                    {racks?.filter((r) => r.warehouse_id === selectedOpnameData?.warehouse_id).map((r) => (
                      <option key={r.id} value={r.id}>{r.rack_name}</option>
                    ))}
                  </Select>
                </div>
                <div className="text-sm text-muted-foreground">
                  <p>Items: <strong>{filteredItems.length}</strong></p>
                  {discrepancies > 0 && (
                    <p className="text-red-600">Discrepancies: <strong>{discrepancies}</strong></p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Auto-adjust Threshold</Label>
                  <div className="flex gap-2">
                    <Input type="number" className="h-8" value={adjustThreshold} onChange={(e) => setAdjustThreshold(Number(e.target.value))} min={0} />
                    <Button size="sm" variant="outline" onClick={() => setThresholdMut.mutate()} disabled={setThresholdMut.isPending}>Save</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Discrepancies below threshold will auto-adjust on complete</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" /> Cycle Schedules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cycleSchedules && cycleSchedules.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Class</TableHead><TableHead>WH</TableHead><TableHead>Freq</TableHead><TableHead>Next</TableHead><TableHead></TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {cycleSchedules.map((cs) => (
                      <TableRow key={cs.id}>
                        <TableCell><Badge variant={cs.class === "A" ? "destructive" : cs.class === "B" ? "warning" : "secondary"}>{cs.class}</Badge></TableCell>
                        <TableCell className="text-xs">{warehouses?.find((w) => w.id === cs.warehouse_id)?.name || "All"}</TableCell>
                        <TableCell className="text-xs">{cs.frequency_days}d</TableCell>
                        <TableCell className="text-xs">{formatDate(cs.next_date)}</TableCell>
                        <TableCell>
                          {can("manage_warehouse") && (
                            <Button size="sm" variant="ghost" onClick={() => deleteCycleMut.mutate(cs.id)} disabled={deleteCycleMut.isPending}>
                              <Clock className="h-3 w-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">No schedules</p>
              )}
              {can("manage_warehouse") && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => { setCycleWhId(""); setCycleClass("A"); setShowCycleAdd(true) }}>
                  <Plus className="h-4 w-4" /> Add Schedule
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" /> Zone Rotation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cycleZones && cycleZones.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Zone</TableHead><TableHead>WH</TableHead><TableHead>Mode</TableHead><TableHead>Next</TableHead><TableHead></TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {cycleZones.map((z) => (
                      <TableRow key={z.id}>
                        <TableCell className="text-xs">{z.zone_id.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs">{warehouses?.find((w) => w.id === z.warehouse_id)?.name || "All"}</TableCell>
                        <TableCell><Badge variant="secondary">{z.assign_mode}</Badge></TableCell>
                        <TableCell className="text-xs">{formatDate(z.next_date)}</TableCell>
                        <TableCell>
                          {can("manage_warehouse") && (
                            <Button size="sm" variant="ghost" onClick={() => deleteZoneMut.mutate(z.id)} disabled={deleteZoneMut.isPending}>
                              <Clock className="h-3 w-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">No zone rotations</p>
              )}
              {can("manage_warehouse") && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setShowZoneAdd(true)}>
                  <Plus className="h-4 w-4" /> Add Zone Rotation
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {selectedOpname ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>
                    Opname Details
                    {selectedOpnameData && (
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        {warehouses?.find((w) => w.id === selectedOpnameData.warehouse_id)?.name} - {formatDate(selectedOpnameData.created_at)}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleExportPdf}>
                      <Download className="h-4 w-4" /> Report
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleCountSheetPdf}>
                      <FileSpreadsheet className="h-4 w-4" /> Count Sheet
                    </Button>
                    {can("manage_warehouse") && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                          Save
                        </Button>
                        {selectedOpnameData?.status === "pending_review" && (
                          <Button variant="outline" size="sm" onClick={() => { if (confirm("Start a new recount round for unresolved items?")) recountMut.mutate() }} disabled={recountMut.isPending}>
                            <RotateCcw className="h-4 w-4" /> Recount
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setShowReconcile(true)} disabled={discrepancies === 0}>
                          <CheckCircle2 className="h-4 w-4" /> Reconcile ({discrepancies})
                        </Button>
                        <Button size="sm" onClick={() => {
                          if (confirm("Complete this opname? Material quantities will be updated.")) completeMut.mutate()
                        }} disabled={completeMut.isPending}>
                          Complete
                        </Button>
                      </>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Rack</TableHead>
                      {!blindMode && <TableHead>System</TableHead>}
                      <TableHead>Physical</TableHead>
                      <TableHead>Diff</TableHead>
                      <TableHead>Review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => {
                      const mat = materials?.find((m) => m.id === item.material_id)
                      const rack = racks?.find((r) => r.id === mat?.rack_id)
                      const pQty = physicalQtys[item.material_id] ?? (item.physical_qty || item.system_qty)
                      const diff = pQty - item.system_qty
                      const isSignificantDiff = Math.abs(diff) >= autoThreshold
                      return (
                        <TableRow key={item.material_id} className={isSignificantDiff ? "bg-red-50" : diff !== 0 ? "bg-yellow-50" : ""}>
                          <TableCell className="font-mono text-xs">{mat?.sku || "-"}</TableCell>
                          <TableCell className="text-sm">{mat?.name || "-"}</TableCell>
                          <TableCell className="text-xs">{rack?.rack_name || "-"}</TableCell>
                          {!blindMode && <TableCell>{item.system_qty}</TableCell>}
                          <TableCell>
                              <div>
                                <Input
                                  type="number"
                                  className={`w-20 h-8 ${qtyErrors[item.material_id] ? "border-destructive" : ""}`}
                                  value={pQty}
                                  onChange={(e) => {
                                    const val = Number(e.target.value)
                                    setPhysicalQtys((prev) => ({ ...prev, [item.material_id]: val }))
                                    const parsed = physicalQtySchema.safeParse(val)
                                    setQtyErrors((prev) => ({ ...prev, [item.material_id]: parsed.success ? "" : parsed.error.issues[0].message }))
                                  }}
                                />
                                {qtyErrors[item.material_id] && <p className="text-xs text-destructive mt-0.5">{qtyErrors[item.material_id]}</p>}
                              </div>
                          </TableCell>
                          <TableCell className={isSignificantDiff ? "text-red-600 font-bold" : diff !== 0 ? "text-yellow-600 font-bold" : ""}>
                            {!blindMode ? (diff > 0 ? "+" : "") + diff.toFixed(0) : "-"}
                          </TableCell>
                          <TableCell>
                            {item.approved_status === "flagged" && can("manage_warehouse") && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => approveItemMut.mutate(item.id)} disabled={approveItemMut.isPending}>
                                  <Check className="h-3 w-3" /> Approve
                                </Button>
                                <Button size="sm" variant="outline" className="h-6 px-2 text-xs text-destructive" onClick={() => rejectItemMut.mutate(item.id)} disabled={rejectItemMut.isPending}>
                                  <XCircle className="h-3 w-3" /> Reject
                                </Button>
                              </div>
                            )}
                            {item.approved_status === "approved" && (
                              <Badge variant="default">Approved</Badge>
                            )}
                            {item.approved_status === "rejected" && (
                              <Badge variant="destructive">Rejected</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {filteredItems.length === 0 && (
                      <TableRow><TableCell colSpan={blindMode ? 6 : 7} className="text-center text-muted-foreground py-8">No items found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <div className="text-center">
                <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Select or create a stock opname to begin</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={(v) => { setShowCreate(v); if (v) setScopeLoaded(true) }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Stock Opname / Cycle Task</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <Select value={whId} onChange={(e) => setWhId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="">Select...</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Deadline</Label>
                <Input type="date" value={taskDeadline} onChange={(e) => setTaskDeadline(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Assigned To</Label>
                <Input value={taskAssigned} onChange={(e) => setTaskAssigned(e.target.value)} placeholder="Staff name" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="taskBlind" checked={taskBlind} onChange={(e) => setTaskBlind(e.target.checked)} className="h-4 w-4" />
              <Label htmlFor="taskBlind">Blind Count (hide system qty)</Label>
            </div>
            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label>Scope Items (optional — empty = all materials)</Label>
                {scopeItems && scopeItems.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => {
                    if (selectedMaterials.size === scopeItems.length) setSelectedMaterials(new Set())
                    else setSelectedMaterials(new Set(scopeItems.map((s) => s.id)))
                  }}>
                    {selectedMaterials.size === scopeItems.length ? "Clear all" : "Select all"}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={taskCategory} onChange={(e) => setTaskCategory(e.target.value)} className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm">
                  <option value="">All Categories</option>
                  {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Select value={taskRack} onChange={(e) => setTaskRack(e.target.value)} className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm">
                  <option value="">All Racks</option>
                  {racks?.filter((r) => !whId || r.warehouse_id === whId).map((r) => <option key={r.id} value={r.id}>{r.rack_name}</option>)}
                </Select>
              </div>
              {scopeLoading ? (
                <p className="text-xs text-muted-foreground">Loading scope items...</p>
              ) : (
                <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                  {scopeItems && scopeItems.length > 0 ? scopeItems.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMaterials.has(s.id)}
                        onChange={() => {
                          const next = new Set(selectedMaterials)
                          if (next.has(s.id)) next.delete(s.id)
                          else next.add(s.id)
                          setSelectedMaterials(next)
                        }}
                        className="h-3.5 w-3.5"
                      />
                      <span className="font-mono">{s.sku}</span>
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="text-muted-foreground">{s.quantity} on hand</span>
                    </label>
                  )) : (
                    <p className="text-xs text-muted-foreground text-center py-3">No materials match the selected scope</p>
                  )}
                </div>
              )}
              {selectedMaterials.size > 0 && (
                <p className="text-xs text-muted-foreground">{selectedMaterials.size} material(s) selected</p>
              )}
            </div>
            <Button onClick={() => createMut.mutate()} className="w-full" disabled={!whId || createMut.isPending}>
              {selectedMaterials.size > 0 ? "Create Task" : "Create Opname (All Items)"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showReconcile} onOpenChange={setShowReconcile}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Reconciliation Summary
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {discrepancies} material(s) have differences above threshold ({autoThreshold}) between system and physical count.
            </p>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Material</TableHead>{!blindMode && <TableHead>System</TableHead>}<TableHead>Physical</TableHead><TableHead>Diff</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {diffItems.slice(0, 10).map((item) => {
                  const mat = materials?.find((m) => m.id === item.material_id)
                  const pQty = physicalQtys[item.material_id] ?? (item.physical_qty || item.system_qty)
                  const diff = pQty - item.system_qty
                  return (
                    <TableRow key={item.material_id}>
                      <TableCell className="text-xs">{mat?.name || "-"}</TableCell>
                      {!blindMode && <TableCell>{item.system_qty}</TableCell>}
                      <TableCell>{pQty}</TableCell>
                      <TableCell className={diff !== 0 ? "text-red-600 font-bold" : ""}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(0)}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {diffItems.length > 10 && <TableRow><TableCell colSpan={blindMode ? 3 : 4} className="text-xs text-muted-foreground text-center">+{diffItems.length - 10} more</TableCell></TableRow>}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowReconcile(false)}>Close</Button>
              <Button onClick={() => {
                saveMut.mutate()
                setShowReconcile(false)
              }}>Save & Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-md max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Task History
            </DialogTitle>
          </DialogHeader>
          {historyData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No activity recorded for this task</p>
          ) : (
            <div className="space-y-2">
              {historyData.map((h) => (
                <div key={h.id} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm">
                  <div>
                    <Badge variant={h.action === "approve" ? "default" : h.action === "reject" ? "destructive" : "secondary"} className="mr-2">
                      {h.action}
                    </Badge>
                    <span className="font-mono text-xs">{h.material_id.slice(0, 8)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {h.before_qty} → {h.after_qty}
                    <span className="block">{formatDate(h.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showCycleAdd} onOpenChange={setShowCycleAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Cycle Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Class</Label>
              <Select value={cycleClass} onChange={(e) => setCycleClass(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="A">A — 30 days</option>
                <option value="B">B — 90 days</option>
                <option value="C">C — 180 days</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Warehouse (optional)</Label>
              <Select value={cycleWhId} onChange={(e) => setCycleWhId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="">All Warehouses</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </div>
            <Button onClick={() => createCycleMut.mutate()} className="w-full" disabled={createCycleMut.isPending}>
              Add Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showZoneAdd} onOpenChange={setShowZoneAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Zone Rotation</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Zone</Label>
              <Select value={zoneSel} onChange={(e) => setZoneSel(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="">Select zone...</option>
                {zones?.map((z) => <option key={z.id} value={z.id}>{z.name || z.code}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rotation Mode</Label>
              <Select value={zoneMode} onChange={(e) => setZoneMode(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </Select>
            </div>
            <Button onClick={() => createZoneMut.mutate()} className="w-full" disabled={!zoneSel || createZoneMut.isPending}>
              Add Rotation
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
