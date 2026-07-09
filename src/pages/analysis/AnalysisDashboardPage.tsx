import { useState, useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { getDashboardKpi, getAnalysisAll, getMaterials, getCategories, getMomKpis, getTransactions } from "../../api"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Button } from "../../components/ui/button"
import { Badge } from "../../components/ui/badge"
import { formatCurrency } from "../../lib/utils"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts"
import html2canvas from "html2canvas"
import { Download, TrendingUp } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#a855f7", "#eab308", "#06b6d4", "#f97316", "#6366f1"]

export default function AnalysisDashboardPage() {
  const navigate = useNavigate()
  const dashboardRef = useRef<HTMLDivElement>(null)
  const [dateRange, setDateRange] = useState({ start: "", end: "" })
  const [compareMode, setCompareMode] = useState<"mom" | "yoy">("mom")

  // Sync date range to query keys — use date as filter for analysis if set
  const dateParam = dateRange.start && dateRange.end
    ? `${dateRange.start}_${dateRange.end}`
    : "all"

  const { data: kpi, isLoading, isError, error, refetch } = useQuery({ queryKey: ["dashboard"], queryFn: getDashboardKpi })
  const { data: analysis } = useQuery({ queryKey: ["analysis", dateParam], queryFn: () => getAnalysisAll() })
  const { data: materials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => getCategories() })
  const { data: momKpis } = useQuery({ queryKey: ["momKpis"], queryFn: getMomKpis })
  const { data: filteredTxs } = useQuery({
    queryKey: ["txDateRange", dateRange.start, dateRange.end],
    queryFn: () => getTransactions(undefined, undefined, undefined, dateRange.start || undefined, dateRange.end || undefined),
    enabled: !!dateRange.start && !!dateRange.end,
  })

  // Apply date range filtering to analysis items
  const filteredAnalysis = useMemo(() => {
    if (!analysis) return []
    if (!dateRange.start || !dateRange.end) return analysis
    return analysis.filter((a) => {
      if (!a.last_transaction) return true
      return a.last_transaction >= dateRange.start && a.last_transaction <= dateRange.end + " 23:59:59"
    })
  }, [analysis, dateRange])

  const deadStock = filteredAnalysis.filter((a) => a.days_since_last > 90).length || 0
  const slowMoving = filteredAnalysis.filter((a) => a.days_since_last > 30 && a.days_since_last <= 90).length || 0
  const needsReorder = filteredAnalysis.filter((a) => a.forecast_qty > a.quantity).length || 0

  const chartData = filteredAnalysis.slice(0, 10).map((a) => ({
    name: a.material_name.length > 15 ? a.material_name.slice(0, 15) + "..." : a.material_name,
    stock: a.quantity,
    forecast: a.forecast_qty,
  })) || []

  const turnoverTop10 = [...filteredAnalysis].sort((a, b) => b.turnover - a.turnover).slice(0, 10).map((a) => ({
    name: a.material_name.length > 15 ? a.material_name.slice(0, 15) + "..." : a.material_name,
    turnover: Math.round(a.turnover * 100) / 100,
  }))

  const catValue = categories?.map((c) => ({
    name: c.name,
    value: materials?.filter((m) => m.category_id === c.id).reduce((s, m) => s + m.quantity * m.price, 0) || 0,
  })).filter((c) => c.value > 0).sort((a, b) => b.value - a.value) || []

  const pieData = [
    { name: "Low Stock", value: kpi?.low_stock_items || 0 },
    { name: "Normal", value: (kpi?.total_materials || 0) - (kpi?.low_stock_items || 0) },
  ]

  // Date-filtered transaction summary
  const txSummary = useMemo(() => {
    if (!filteredTxs || filteredTxs.length === 0) return null
    const totalIn = filteredTxs.filter((t) => t.type === "in").reduce((s, t) => s + t.quantity, 0)
    const totalOut = filteredTxs.filter((t) => t.type === "out").reduce((s, t) => s + t.quantity, 0)
    return { count: filteredTxs.length, totalIn, totalOut }
  }, [filteredTxs])

  const kpiCards = [
    { label: "Total Materials", value: String(kpi?.total_materials || 0), navigateTo: "/materials" },
    { label: "Stock Value", value: formatCurrency(kpi?.stock_value || 0), navigateTo: "/inventory" },
    { label: "Low Stock", value: String(kpi?.low_stock_items || 0), className: "text-red-600", navigateTo: "/materials?filter=lowstock" },
    { label: "Total Transactions", value: String(kpi?.total_transactions || 0), navigateTo: "/transactions" },
  ]

  const exportPng = async () => {
    if (!dashboardRef.current) return
    try {
      const canvas = await html2canvas(dashboardRef.current, { backgroundColor: "#fff", scale: 2 })
      const link = document.createElement("a")
      link.download = `dashboard-${new Date().toISOString().slice(0, 10)}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
    } catch (e) { console.error("Export PNG failed", e) }
  }

  const getChangePct = (idx: number): number | null => {
    if (!momKpis || idx >= momKpis.length) return null
    return momKpis[idx].change_pct ?? null
  }
  if (isLoading) return <LoadingState text="Loading dashboard data..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load dashboard data"} onRetry={refetch} />

  return (
    <div className="space-y-6" ref={dashboardRef}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Analysis Dashboard</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <label className="text-muted-foreground">From:</label>
                <input
                  type="date"
                  className="border rounded px-2 py-1 text-sm"
                  value={dateRange.start}
                  onChange={(e) => setDateRange((p) => ({ ...p, start: e.target.value }))}
                />
                <label className="text-muted-foreground">To:</label>
                <input
                  type="date"
                  className="border rounded px-2 py-1 text-sm"
                  value={dateRange.end}
                  onChange={(e) => setDateRange((p) => ({ ...p, end: e.target.value }))}
                />
                <Badge variant="outline" className="text-xs">
                  {dateRange.start && dateRange.end ? `${dateRange.start} – ${dateRange.end}` : "All time"}
                </Badge>
          </div>
          <div className="flex border rounded-md overflow-hidden">
            <button
              className={`px-3 py-1 text-xs font-medium ${compareMode === "mom" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              onClick={() => setCompareMode("mom")}
            >
              MoM
            </button>
            <button
              className={`px-3 py-1 text-xs font-medium ${compareMode === "yoy" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              onClick={() => setCompareMode("yoy")}
            >
              YoY
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={exportPng}>
            <Download className="h-4 w-4 mr-1" /> Export PNG
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card, idx) => (
          <Card key={card.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(card.navigateTo)}>
            <CardHeader><CardTitle className="text-sm">{card.label}</CardTitle></CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${card.className || ""}`}>{card.value}</div>
              {compareMode === "yoy" && (() => {
                const pct = getChangePct(idx)
                if (pct === null) return null
                return (
                  <div className={`flex items-center gap-1 text-xs mt-1 ${pct >= 0 ? "text-green-600" : "text-red-600"}`}>
                    <TrendingUp className="h-3 w-3" />
                    {pct >= 0 ? "+" : ""}{pct.toFixed(1)}% YoY
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-red-200"><CardHeader><CardTitle className="text-sm text-red-600">Dead Stock (&gt;90d)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-red-600">{deadStock}</div></CardContent></Card>
        <Card className="border-yellow-200"><CardHeader><CardTitle className="text-sm text-yellow-600">Slow Moving (30-90d)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-yellow-600">{slowMoving}</div></CardContent></Card>
        <Card className="border-orange-200"><CardHeader><CardTitle className="text-sm text-orange-600">Reorder Needed</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-orange-600">{needsReorder}</div></CardContent></Card>
        {txSummary && (
          <Card className="border-blue-200">
            <CardHeader><CardTitle className="text-sm text-blue-600">Tx in Range</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{txSummary.count}</div>
              <p className="text-xs text-muted-foreground">IN: {txSummary.totalIn.toFixed(0)} / OUT: {txSummary.totalOut.toFixed(0)}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Stock vs Forecast (Top 10)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="stock" fill="#3b82f6" name="Current Stock" />
                <Bar dataKey="forecast" fill="#22c55e" name="Forecast (3mo)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Stock Status Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top 10 by Turnover Rate</CardTitle></CardHeader>
          <CardContent>
            {turnoverTop10.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={turnoverTop10} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" fontSize={10} width={120} />
                  <Tooltip />
                  <Bar dataKey="turnover" fill="#a855f7" name="Turnover Rate" cursor="pointer" onClick={() => navigate("/analysis/material")} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Inventory Value by Category</CardTitle></CardHeader>
          <CardContent>
            {catValue.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={catValue} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                    {catValue.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
