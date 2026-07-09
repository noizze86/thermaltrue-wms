import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getMaterials, getCategories, getUnits, getSuppliers, getWarehouses, getExpiringMaterials, getMomKpis, getReportSchedules, saveReportSchedule, deleteReportSchedule, exportReportCsv, generateReportPdf, runReportSchedule } from "../../api"
import { Select } from "../../components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Button } from "../../components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Input } from "../../components/ui/input"
import { Badge } from "../../components/ui/badge"
import { formatCurrency } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { useNavigate } from "react-router-dom"
import { Package, Tags, Ruler, Truck, Warehouse as WarehouseIcon, DollarSign, AlertTriangle, FileDown, FileText, Clock, Settings2, Play, BarChart3, Crosshair } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const WIDGET_KEYS = ["materials", "value", "lowstock", "expiring", "categories", "units", "suppliers", "warehouses"]

export default function ReportSummaryPage() {
  const navigate = useNavigate()
  const { data: materials, isLoading, isError, error, refetch } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => getCategories() })
  const { data: units } = useQuery({ queryKey: ["units"], queryFn: () => getUnits() })
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => getSuppliers() })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: expiring } = useQuery({ queryKey: ["expiring", "30"], queryFn: () => getExpiringMaterials(30) })
  const { data: mom } = useQuery({ queryKey: ["mom_kpis"], queryFn: getMomKpis })
  const { data: schedules } = useQuery({ queryKey: ["report_schedules"], queryFn: getReportSchedules })

  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("report_hidden_widgets") || "[]") } catch { return [] }
  })
  const [scheduleEmail, setScheduleEmail] = useState("")
  const [schedReportType, setSchedReportType] = useState("materials")
  useEffect(() => { localStorage.setItem("report_hidden_widgets", JSON.stringify(hiddenWidgets)) }, [hiddenWidgets])

  const toggleWidget = (k: string) => {
    setHiddenWidgets((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k])
  }

  const totalValue = materials?.reduce((s, m) => s + m.quantity * m.price, 0) || 0
  const lowStockCount = materials?.filter((m) => m.quantity <= m.min_stock && m.min_stock > 0).length || 0

  const momData = mom || []

  const queryClient = useQueryClient()
  const runSchedMut = useMutation({
    mutationFn: (id: string) => runReportSchedule(id),
    onSuccess: (msg) => { toast({ title: "Run Complete", description: msg }); queryClient.invalidateQueries({ queryKey: ["report_schedules"] }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  if (isLoading) return <LoadingState text="Loading material summary..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load summary data"} onRetry={refetch} />

  const addSchedule = async () => {
    if (!scheduleEmail) { toast({ title: "Error", description: "Email is required", variant: "destructive" }); return }
    try {
      await saveReportSchedule({
        id: crypto.randomUUID(), report_type: schedReportType, email_to: scheduleEmail,
        frequency: "weekly", day_of_week: 1, hour: 8, is_active: true, created_at: new Date().toISOString(),
      })
      toast({ title: "Scheduled", description: `Weekly ${schedReportType} report set` })
      setScheduleEmail("")
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  const removeSchedule = async (id: string) => {
    try { await deleteReportSchedule(id); toast({ title: "Deleted" }) } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  const handleExportCsv = async () => { try { const csv = await exportReportCsv("materials"); const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "material_summary.csv"; a.click(); URL.revokeObjectURL(url); toast({ title: "Exported" }) } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) } }
  const handleExportPdf = async () => { try { const data = await generateReportPdf("materials"); const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "material_summary.pdf"; a.click(); URL.revokeObjectURL(url); toast({ title: "Exported" }) } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) } }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Material Summary</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/reports/multi-warehouse")}><BarChart3 className="h-4 w-4" /> Multi-WH</Button>
          <Button variant="outline" onClick={() => navigate("/reports/pivot")}><Crosshair className="h-4 w-4" /> Pivot</Button>
          <Button variant="outline" onClick={handleExportCsv}><FileDown className="h-4 w-4" /> CSV</Button>
          <Button variant="outline" onClick={handleExportPdf}><FileText className="h-4 w-4" /> PDF</Button>
        </div>
      </div>

      {/* Widget Toggle */}
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <Settings2 className="h-4 w-4" />
        {WIDGET_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={!hiddenWidgets.includes(k)} onChange={() => toggleWidget(k)} className="h-3 w-3" />
            <span className="capitalize">{k.replace("lowstock", "Low Stock").replace("expiring", "Expiring")}</span>
          </label>
        ))}
      </div>

      {/* KPI Cards with MoM */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {!hiddenWidgets.includes("materials") && (
          <Card className="cursor-pointer hover:shadow-md" onClick={() => navigate("/reports/stock")}>
            <div className="flex items-center justify-between px-6 pt-6"><Package className="h-5 w-5 text-blue-600 dark:text-blue-400" /><span className="text-xs text-muted-foreground">MoM: <span className={momData[0]?.change_pct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{momData[0]?.change_pct.toFixed(1)}%</span></span></div>
            <CardContent><div className="text-2xl font-bold">{materials?.length || 0}</div><p className="text-xs text-muted-foreground">Total Materials</p></CardContent>
          </Card>
        )}
        {!hiddenWidgets.includes("value") && (
          <Card>
            <div className="flex items-center justify-between px-6 pt-6"><DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /><span className="text-xs text-muted-foreground">MoM: <span className={momData[1]?.change_pct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{momData[1]?.change_pct.toFixed(1)}%</span></span></div>
            <CardContent><div className="text-2xl font-bold">{formatCurrency(totalValue)}</div><p className="text-xs text-muted-foreground">Inventory Value</p></CardContent>
          </Card>
        )}
        {!hiddenWidgets.includes("lowstock") && (
          <Card className="cursor-pointer hover:shadow-md" onClick={() => navigate("/reports/stock?low=true")}>
            <div className="flex items-center justify-between px-6 pt-6"><AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" /><span className="text-xs text-muted-foreground">MoM: <span className={momData[2]?.change_pct <= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{momData[2]?.change_pct.toFixed(1)}%</span></span></div>
            <CardContent><div className="text-2xl font-bold text-red-600 dark:text-red-400">{lowStockCount}</div><p className="text-xs text-muted-foreground">Low Stock Items</p></CardContent>
          </Card>
        )}
        {!hiddenWidgets.includes("expiring") && (
          <Card>
            <div className="flex items-center justify-between px-6 pt-6"><Clock className="h-5 w-5 text-orange-600" /></div>
            <CardContent><div className="text-2xl font-bold text-orange-600">{expiring?.length || 0}</div><p className="text-xs text-muted-foreground">Expiring (30 days)</p></CardContent>
          </Card>
        )}
      </div>

      {!hiddenWidgets.includes("categories") && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card onClick={() => navigate("/settings/categories")} className="cursor-pointer hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Categories</CardTitle><Tags className="h-5 w-5 text-green-600 dark:text-green-400" /></CardHeader>
            <CardContent><div className="text-2xl font-bold">{categories?.length || 0}</div></CardContent>
          </Card>
          <Card onClick={() => navigate("/settings/units")} className="cursor-pointer hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Units</CardTitle><Ruler className="h-5 w-5 text-purple-600" /></CardHeader>
            <CardContent><div className="text-2xl font-bold">{units?.length || 0}</div></CardContent>
          </Card>
          <Card onClick={() => navigate("/settings/suppliers")} className="cursor-pointer hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Suppliers</CardTitle><Truck className="h-5 w-5 text-orange-600" /></CardHeader>
            <CardContent><div className="text-2xl font-bold">{suppliers?.length || 0}</div></CardContent>
          </Card>
          <Card onClick={() => navigate("/warehouse/list")} className="cursor-pointer hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Warehouses</CardTitle><WarehouseIcon className="h-5 w-5 text-cyan-600" /></CardHeader>
            <CardContent><div className="text-2xl font-bold">{warehouses?.length || 0}</div></CardContent>
          </Card>
        </div>
      )}

      {/* Scheduled Email Reports */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Clock className="h-4 w-4" /> Scheduled Email Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end mb-4 flex-wrap">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Report Type</label>
              <Select value={schedReportType} onChange={(e) => setSchedReportType(e.target.value)}>
                <option value="materials">Material Summary</option>
                <option value="stock">Stock Report</option>
                <option value="transactions">Transaction Report</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Email To</label>
              <Input type="email" placeholder="user@company.com" value={scheduleEmail} onChange={(e) => setScheduleEmail(e.target.value)} className="w-56" />
            </div>
            <Button onClick={addSchedule}>Add Schedule</Button>
          </div>
          {schedules && schedules.length > 0 && (
            <Table>
              <TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Email</TableHead><TableHead>Frequency</TableHead><TableHead>Day/Hr</TableHead><TableHead>Active</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="capitalize">{s.report_type}</TableCell>
                    <TableCell className="text-xs">{s.email_to}</TableCell>
                    <TableCell>{s.frequency}</TableCell>
                    <TableCell>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][s.day_of_week] || "Mon"} @ {s.hour}:00</TableCell>
                    <TableCell>{s.is_active ? <Badge variant="success" className="text-xs">Active</Badge> : <Badge variant="secondary" className="text-xs">Inactive</Badge>}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => runSchedMut.mutate(s.id)} disabled={runSchedMut.isPending}><Play className="h-3 w-3" /> Run Now</Button>
                        <Button variant="destructive" size="sm" onClick={() => removeSchedule(s.id)}>Remove</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {(!schedules || schedules.length === 0) && <p className="text-sm text-muted-foreground">No scheduled reports</p>}
        </CardContent>
      </Card>

      {/* Expiring Materials */}
      {!hiddenWidgets.includes("expiring") && expiring && expiring.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-orange-600"><Clock className="h-5 w-5" /> Expiring Materials (Next 30 Days)</CardTitle></CardHeader>
          <CardContent>
            <Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Qty</TableHead><TableHead>Expiry Date</TableHead></TableRow></TableHeader>
            <TableBody>{expiring.map((m) => <TableRow key={m.id}><TableCell className="font-mono text-xs">{m.sku}</TableCell><TableCell>{m.name}</TableCell><TableCell>{m.quantity}</TableCell><TableCell className="text-red-600 dark:text-red-400 font-medium">{m.expiry_date}</TableCell></TableRow>)}</TableBody></Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
