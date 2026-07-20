import { useState, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { getDashboardKpi, getTransactions, getMaterials, getMaterialsLowStock, getExpiringMaterials, getDbStats, countAuditLogsFiltered } from "../../api"
import DashboardAlertCard from "../../components/DashboardAlertCard"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Button } from "../../components/ui/button"
import { Badge } from "../../components/ui/badge"
import { Input } from "../../components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { formatCurrency } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { Plus, FileText, ArrowUpDown, ChevronUp, ChevronDown, Database, Skull, Package, Repeat, Warehouse, DollarSign, AlertTriangle, TrendingUp, Activity, Clock, Shield } from "lucide-react"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, CartesianGrid, XAxis, YAxis } from "recharts"
import { useNavigate } from "react-router-dom"
import { format, subDays } from "date-fns"

const COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#f59e0b", "#06b6d4"]

interface WidgetDef { key: string; title: string; defaultOrder: number }

const ALL_WIDGETS: WidgetDef[] = [
  { key: "kpi", title: "KPI Cards", defaultOrder: 0 },
  { key: "stock", title: "Stock Status", defaultOrder: 1 },
  { key: "trend", title: "Transaction Trend", defaultOrder: 2 },
  { key: "turnover", title: "Stock Turnover", defaultOrder: 3 },
  { key: "recent", title: "Recent Transactions", defaultOrder: 4 },
  { key: "health", title: "System Health", defaultOrder: 5 },
  { key: "expiring", title: "Expiring Materials", defaultOrder: 6 },
]

function loadWidgetOrder(): string[] {
  try { return JSON.parse(localStorage.getItem("dash_widgets") || "null") || ALL_WIDGETS.map((w) => w.key) }
  catch { return ALL_WIDGETS.map((w) => w.key) }
}

function saveWidgetOrder(keys: string[]) { localStorage.setItem("dash_widgets", JSON.stringify(keys)) }

const DASHBOARD_STORAGE_KEY = "dash_date_range"

export default function DashboardPage() {
  const navigate = useNavigate()
  const [widgetOrder, setWidgetOrder] = useState<string[]>(loadWidgetOrder)
  const [dateRange, setDateRangeState] = useState<{ start: string; end: string }>(() => {
    try { return JSON.parse(localStorage.getItem(DASHBOARD_STORAGE_KEY) || "null") || { start: format(subDays(new Date(), 30), "yyyy-MM-dd"), end: format(new Date(), "yyyy-MM-dd") } }
    catch { return { start: format(subDays(new Date(), 30), "yyyy-MM-dd"), end: format(new Date(), "yyyy-MM-dd") } }
  })
  const notifiedLowRef = useRef(new Set<string>())
  const notifiedExpiringRef = useRef(new Set<string>())

  useEffect(() => { localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(dateRange)) }, [dateRange])

  const { data: kpi, isLoading, isError, error, refetch } = useQuery({ queryKey: ["dashboard"], queryFn: getDashboardKpi })
  const { data: recentAll } = useQuery({ queryKey: ["transactions", "recent", dateRange], queryFn: () => getTransactions(undefined, undefined, undefined, undefined, dateRange.start, dateRange.end, 50) })
  const { data: materials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: lowStock } = useQuery({ queryKey: ["low_stock"], queryFn: getMaterialsLowStock, refetchInterval: 60000 })
  const { data: expiring } = useQuery({ queryKey: ["expiring", 30], queryFn: () => getExpiringMaterials(30), refetchInterval: 60000 })
  const { data: dbStats } = useQuery({ queryKey: ["db_stats"], queryFn: getDbStats })
  const todayStr = format(new Date(), "yyyy-MM-dd")
  const { data: errorCount } = useQuery({
    queryKey: ["audit_error_count", todayStr],
    queryFn: () => countAuditLogsFiltered("error", undefined, undefined, todayStr, todayStr),
  })

  // Real-time notification polling
  useEffect(() => {
    if (!lowStock || !expiring) return
    for (const m of lowStock) {
      if (!notifiedLowRef.current.has(m.id)) {
        notifiedLowRef.current.add(m.id)
        toast({ title: "Low Stock Alert", description: `${m.sku} - ${m.name} (${m.quantity} remaining)`, variant: "destructive" })
      }
    }
    for (const m of expiring) {
      if (!notifiedExpiringRef.current.has(m.id)) {
        notifiedExpiringRef.current.add(m.id)
        toast({ title: "Expiring Soon", description: `${m.sku} - ${m.name} expires ${m.expiry_date || "soon"}`, variant: "destructive" })
      }
    }
  }, [lowStock, expiring])

  if (isLoading) return <LoadingState text="Loading dashboard..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load dashboard"} onRetry={refetch} />
  if (!kpi) return <LoadingState text="Loading dashboard..." />

  const moveWidget = (key: string, dir: -1 | 1) => {
    const idx = widgetOrder.indexOf(key)
    if (idx === -1) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= widgetOrder.length) return
    const next = [...widgetOrder]; [next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    setWidgetOrder(next)
    saveWidgetOrder(next)
  }

  const pieData = [
    { name: "Normal Stock", value: Math.max(0, (kpi.total_materials || 0) - (kpi.low_stock_items || 0)) },
    { name: "Low Stock", value: kpi.low_stock_items || 0 },
  ]

  const txCountByDay: Record<string, { in: number; out: number }> = {}
  recentAll?.forEach((tx) => {
    const day = tx.created_at?.slice(0, 10) || ""
    if (!txCountByDay[day]) txCountByDay[day] = { in: 0, out: 0 }
    if (tx.type === "in") txCountByDay[day].in++
    else if (tx.type === "out") txCountByDay[day].out++
  })
  const trendData = Object.entries(txCountByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([day, counts]) => ({ date: day.slice(5), In: counts.in, Out: counts.out }))

  const recentTx = (kpi.recent_transactions || []).slice(0, 10)

  // Stock turnover
  const turnoverOut = (recentAll?.filter((t) => t.type === "out") ?? []).reduce((s, t) => s + t.quantity * t.price, 0) || 0
  const turnoverRatio = kpi.stock_value > 0 ? turnoverOut / kpi.stock_value : 0

  // System health
  const dbSize = dbStats ? Object.values(dbStats).reduce((a, b) => a + (b || 0), 0) : 0
  const dbSizeMb = Math.round(dbSize / (1024 * 1024) * 100) / 100
  const errorCountVal = errorCount || 0
  const healthAlerts: { label: string; status: "ok" | "warn" | "critical"; detail: string }[] = []
  if (dbSizeMb > 1000) healthAlerts.push({ label: "DB Size", status: "critical", detail: `${dbSizeMb}MB exceeds 1GB limit` })
  else if (dbSizeMb > 500) healthAlerts.push({ label: "DB Size", status: "warn", detail: `${dbSizeMb}MB, consider cleanup` })
  else healthAlerts.push({ label: "DB Size", status: "ok", detail: `${dbSizeMb}MB` })
    if (errorCountVal > 10) healthAlerts.push({ label: "Error Rate", status: "critical", detail: `${errorCountVal} errors today` })
    else if (errorCountVal > 0) healthAlerts.push({ label: "Error Rate", status: "warn", detail: `${errorCountVal} errors today` })
  else healthAlerts.push({ label: "Error Rate", status: "ok", detail: "0 errors today" })

  const renderWidget = (key: string) => {
    switch (key) {
      case "kpi":
        const kpiItems = [
          { label: "Materials", value: kpi.total_materials, icon: Package, color: "from-blue-500 to-blue-600", route: "/materials/stock" },
          { label: "Transactions", value: kpi.total_transactions, icon: Repeat, color: "from-violet-500 to-violet-600", route: "/transactions/history" },
          { label: "Low Stock", value: kpi.low_stock_items, icon: AlertTriangle, color: "from-red-500 to-red-600", route: "/materials/stock?filter=low" },
          { label: "Warehouses", value: kpi.total_warehouses, icon: Warehouse, color: "from-emerald-500 to-emerald-600", route: "/warehouse/list" },
          { label: "Stock Value", value: formatCurrency(kpi.stock_value), icon: DollarSign, color: "from-amber-500 to-amber-600", route: "/reports/stock" },
        ]
        return (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {kpiItems.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.label}
                  onClick={() => navigate(item.route)}
                  className="relative overflow-hidden rounded-xl bg-gradient-to-br cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:shadow-lg active:scale-[0.98]"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-90`} />
                  <div className="absolute top-2 right-2 opacity-20">
                    <Icon className="h-12 w-12 text-white" />
                  </div>
                  <div className="relative p-4 text-white">
                    <p className="text-xs font-medium opacity-80">{item.label}</p>
                    <p className="text-2xl font-bold mt-1 tracking-tight">{item.value}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )
      case "stock":
        return (
          <Card key="stock" className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-blue-500" />Stock Status</CardTitle>
            </CardHeader>
            <CardContent>
              {kpi.total_materials === 0 ? <p className="text-center text-muted-foreground py-8">No materials</p> : (
                <div className="flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4}>
                        {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} stroke="transparent" />)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="flex justify-center gap-4 text-xs text-muted-foreground mt-1">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-500 inline-block" /> Normal</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-500 inline-block" /> Low Stock</span>
              </div>
            </CardContent>
          </Card>
        )
      case "trend":
        return (
          <Card key="trend" className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-green-500" />Transaction Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? <p className="text-center text-muted-foreground py-8">No data</p> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={trendData} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)" }} />
                    <Bar dataKey="In" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Out" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )
      case "turnover":
        return (
          <Card key="turnover" className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Repeat className="h-4 w-4 text-purple-500" />Stock Turnover (30d)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Out Value</span>
                  <span className="text-sm font-semibold">{formatCurrency(turnoverOut)}</span>
                </div>
                <div className="border-t border-border/50 pt-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Avg Stock Value</span>
                  <span className="text-sm font-semibold">{formatCurrency(kpi.stock_value)}</span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Turnover Ratio</p>
                <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{turnoverRatio.toFixed(2)}x</p>
              </div>
            </CardContent>
          </Card>
        )
      case "recent":
        return (
          <Card key="recent" className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-indigo-500" />Recent Transactions</CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate("/transactions/history")}>View All</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-b">
                    <TableHead className="text-xs h-8 px-3">Num</TableHead>
                    <TableHead className="text-xs h-8 px-3">Type</TableHead>
                    <TableHead className="text-xs h-8 px-3">Material</TableHead>
                    <TableHead className="text-xs h-8 px-3 text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentTx.map((tx) => (
                    <TableRow key={tx.id} className="border-b border-border/50">
                      <TableCell className="font-mono text-xs px-3 py-2">{tx.transaction_number}</TableCell>
                      <TableCell className="px-3 py-2">
                        <Badge variant={tx.type === "in" ? "default" : tx.type === "out" ? "destructive" : "secondary"} className="text-[10px] font-medium">
                          {tx.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs px-3 py-2 truncate max-w-[120px]">{materials?.find((m) => m.id === tx.material_id)?.name || "-"}</TableCell>
                      <TableCell className="text-xs px-3 py-2 text-right font-semibold">{tx.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      case "health":
        return (
          <Card key="health" className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-cyan-500" />System Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {healthAlerts.map((h) => (
                <div key={h.label} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                  <span className={`h-2 w-2 rounded-full ${h.status === "critical" ? "bg-red-500" : h.status === "warn" ? "bg-yellow-500" : "bg-green-500"}`} />
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{h.label}</span>
                    <span className={`text-sm font-medium ${h.status === "critical" ? "text-red-600 dark:text-red-400" : h.status === "warn" ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}`}>{h.detail}</span>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full text-xs mt-2" onClick={() => navigate("/settings/system")}>
                <Database className="h-3.5 w-3.5 mr-1" /> Backup Now
              </Button>
            </CardContent>
          </Card>
        )
      case "expiring":
        return (
          <Card key="expiring" className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Skull className="h-4 w-4 text-orange-500" />Expiring (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              {!expiring || expiring.length === 0 ? (
                <div className="text-center py-8">
                  <Shield className="h-8 w-8 mx-auto text-green-500 mb-2" />
                  <p className="text-xs text-muted-foreground">No expiring materials</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {expiring.slice(0, 10).map((m) => (
                    <div key={m.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{m.sku} - {m.name}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] ml-2 shrink-0 text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-700">
                        {m.expiry_date || "-"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      default: return null
    }
  }

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={error ? String(error) : "Failed to load dashboard"} onRetry={refetch} />
  if (!kpi) return <LoadingState />

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Overview of your warehouse operations</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-sm bg-muted/50 rounded-lg px-3 py-1.5">
            <span className="text-muted-foreground text-xs">From</span>
            <Input type="date" className="w-28 h-7 text-xs border-0 bg-transparent p-0 focus-visible:ring-0" value={dateRange.start} onChange={(e) => setDateRangeState({ ...dateRange, start: e.target.value })} />
            <span className="text-muted-foreground text-xs">To</span>
            <Input type="date" className="w-28 h-7 text-xs border-0 bg-transparent p-0 focus-visible:ring-0" value={dateRange.end} onChange={(e) => setDateRangeState({ ...dateRange, end: e.target.value })} />
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => navigate("/transactions/in")}><Plus className="h-3.5 w-3.5" /> In</Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/transactions/out")}><ArrowUpDown className="h-3.5 w-3.5" /> Out</Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/reports/stock")}><FileText className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      </div>

      <DashboardAlertCard />

      {renderWidget("kpi")}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {widgetOrder.filter((k) => k !== "kpi").map((key) => {
          const idx = widgetOrder.indexOf(key)
          return (
            <div key={key} className="relative group">
              <div className="absolute top-2 right-2 z-10 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-accent text-muted-foreground" onClick={() => moveWidget(key, -1)} disabled={idx === 0}><ChevronUp className="h-3 w-3" /></button>
                <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-accent text-muted-foreground" onClick={() => moveWidget(key, 1)} disabled={idx === widgetOrder.length - 1}><ChevronDown className="h-3 w-3" /></button>
              </div>
              {renderWidget(key)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
