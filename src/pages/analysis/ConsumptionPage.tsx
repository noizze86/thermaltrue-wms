import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { getAnalysisAll, getWarehouses, getConsumptionSummary, getConsumptionDetails, getConsumptionSeasonal } from "../../api"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Button } from "../../components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Select } from "../../components/ui/select"
import {
  ComposedChart, Area, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import { Badge } from "../../components/ui/badge"
import { Search, TrendingUp, TrendingDown, BarChart3, Calculator, FileDown } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { downloadXlsx } from "../../lib/export-xlsx"

export default function ConsumptionPage() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [zValue, setZValue] = useState(1.65)
  const [warehouseId, setWarehouseId] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: items, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["analysis", warehouseId],
    queryFn: () => getAnalysisAll(warehouseId || undefined),
  })
  const { data: consSummary } = useQuery({ queryKey: ["consSummary"], queryFn: () => getConsumptionSummary() })
  const { data: consDetails } = useQuery({ queryKey: ["consDetails", warehouseId], queryFn: () => getConsumptionDetails(warehouseId || undefined) })
  const { data: consSeasonal } = useQuery({ queryKey: ["consSeasonal"], queryFn: () => getConsumptionSeasonal() })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })

  const filtered = (items || []).filter((i) => {
    if (!debouncedSearch) return true
    const q = debouncedSearch.toLowerCase()
    return i.material_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
  })

  const seasonalData = useMemo(() => {
    if (!items || items.length === 0) return []
    const n = items.length
    const total3mo = items.reduce((s, i) => s + i.consumption_3mo, 0) / n
    const total6mo = items.reduce((s, i) => s + i.consumption_6mo, 0) / n
    const total12mo = items.reduce((s, i) => s + i.consumption_12mo, 0) / n
    const m1 = total3mo / 3
    const m2 = (total6mo - total3mo) / 3
    const m3 = (total12mo - total6mo) / 6
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    const overallAvg = m1 + m2 + m3 / 3
    return months.map((name, idx) => {
      const avg = idx < 3 ? m1 : idx < 6 ? m2 : m3
      const index = overallAvg > 0 ? avg / overallAvg : 1.0
      return {
        name,
        avg: Math.round(avg),
        index: Math.round(index * 100) / 100,
        season: index > 1.1 ? "High" : index < 0.9 ? "Low" : "Normal",
      }
    })
  }, [items])

  const enriched = useMemo(() => {
    return (filtered || []).map((item) => {
      const m1 = item.consumption_3mo / 3
      const m2 = (item.consumption_6mo - item.consumption_3mo) / 3
      const m3 = (item.consumption_12mo - item.consumption_6mo) / 6
      const monthlyVals = [m1, m2, m3]
      const mu = monthlyVals.reduce((s, v) => s + v, 0) / monthlyVals.length
      const variance = monthlyVals.reduce((s, v) => s + (v - mu) ** 2, 0) / monthlyVals.length
      const sigma = Math.sqrt(variance)
      const lt = item.lead_time_days
      const safetyStock = zValue * sigma * Math.sqrt(Math.max(lt, 1))
      const avgDaily = item.consumption_12mo / 365
      const rop = avgDaily * lt + safetyStock
      // Seasonal index for this material
      const period3 = m1 > 0 ? m1 / mu : 1
      const period6 = m2 > 0 ? m2 / mu : 1
      const si = Math.max(0.5, Math.min(1.5, (period3 + period6) / 2))
      // Recommended safety stock based on seasonality
      const seasonalSafetyStock = Math.round(safetyStock * si)
      return { ...item, safetyStock, rop, avgDaily, sigma, seasonalIndex: Math.round(si * 100) / 100, seasonalSafetyStock }
    })
  }, [filtered, zValue])

  const totalCons3mo = filtered.reduce((s, i) => s + i.consumption_3mo, 0)
  const totalCons6mo = filtered.reduce((s, i) => s + i.consumption_6mo, 0)
  const totalCons12mo = filtered.reduce((s, i) => s + i.consumption_12mo, 0)
  const avgLeadTime = filtered.length > 0 ? filtered.reduce((s, i) => s + i.lead_time_days, 0) / filtered.length : 0

  const [exporting, setExporting] = useState(false)

  const exportXlsx = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const details = consDetails || enriched
      const seasonalRows = (consSeasonal || seasonalData).map((d) => [d.name, Number(d.index.toFixed(2)), d.season])
      const safetyRows = details.map((item: any) => {
        const sd = item.std_dev ?? item.sigma
        const lt = item.lead_time_days ?? 0
        const ss = item.safety_stock ?? item.safetyStock
        const si = item.seasonal_index ?? item.seasonalIndex ?? 1
        const rp = item.reorder_point ?? item.rop
        const rss = item.seasonal_safety_stock ?? item.seasonalSafetyStock ?? ss
        return [item.material_name, sd ? Number(sd.toFixed(2)) : "", Number(lt.toFixed(1)), ss ? Number(ss.toFixed(1)) : "", Number(si.toFixed(2)), Math.round(rss), rp ? Number(rp.toFixed(1)) : ""]
      })
      const detailRows = details.map((item: any) => {
        const c3 = item.consumption_3mo ?? 0
        const c6 = item.consumption_6mo ?? 0
        const ss = item.safety_stock ?? item.safetyStock ?? 0
        const rp = item.reorder_point ?? item.rop ?? 0
        const trend = item.consumption_trend ?? (c6 > c3 ? "▲" : c6 < c3 ? "▼" : "→")
        return [item.material_name, item.sku, item.current_qty ?? item.quantity, trend, Number(c3.toFixed(0)), Number(c6.toFixed(0)), Number(ss.toFixed(1)), Number(rp.toFixed(1))]
      })
      await downloadXlsx("consumption-analysis.xlsx", [
        { name: "Seasonal Index", header: ["Month", "Index", "Season"], rows: seasonalRows },
        { name: "Safety Stock", header: ["Material", "σ", "Lead Time", "Base SS", "S. Index", "Rec. SS", "ROP"], rows: safetyRows },
        { name: "Consumption Details", header: ["Material", "SKU", "Stock", "Trend", "Cons (3mo)", "Cons (6mo)", "Safety Stock", "ROP"], rows: detailRows },
      ])
    } finally {
      setExporting(false)
    }
  }

  if (isLoading) return <LoadingState text="Loading consumption data..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load consumption data"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Consumption Analysis</h1>
      <p className="text-muted-foreground">Material consumption based on average usage over 3, 6, and 12 months</p>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">3-Month Usage</CardTitle>
            <TrendingDown className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{consSummary ? consSummary.total_consumption_3mo.toFixed(0) : totalCons3mo.toFixed(0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">6-Month Usage</CardTitle>
            <TrendingUp className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{consSummary ? consSummary.total_consumption_6mo.toFixed(0) : totalCons6mo.toFixed(0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">12-Month Usage</CardTitle>
            <BarChart3 className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{consSummary ? consSummary.total_consumption_12mo.toFixed(0) : totalCons12mo.toFixed(0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Lead Time</CardTitle>
            <TrendingUp className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(consSummary ? consSummary.avg_lead_time_days : avgLeadTime).toFixed(1)} days</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seasonal Consumption Pattern</CardTitle>
        </CardHeader>
        <CardContent>
          {(consSeasonal || seasonalData).length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No consumption data available</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={consSeasonal || seasonalData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine
                    y={1}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: "Average", fontSize: 10, fill: "#f59e0b", position: "insideTopRight" }}
                  />
                  <Area type="monotone" dataKey="index" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} name="Seasonal Index" />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="mt-2 text-sm text-muted-foreground">
                {(consSeasonal || seasonalData).filter((d) => d.season === "High").length > 0 && (
                  <span className="mr-4">High season: <span className="text-green-600 font-medium">{(consSeasonal || seasonalData).filter((d) => d.season === "High").map(d => d.name).join(", ")}</span></span>
                )}
                {(consSeasonal || seasonalData).filter((d) => d.season === "Low").length > 0 && (
                  <span>Low season: <span className="text-red-600 font-medium">{(consSeasonal || seasonalData).filter((d) => d.season === "Low").map(d => d.name).join(", ")}</span></span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Seasonal Index Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Seasonal Index Table</CardTitle>
          <Button size="sm" variant="outline" onClick={exportXlsx} disabled={exporting}>
            <FileDown className="h-4 w-4" /> {exporting ? "Exporting..." : "Export XLSX"}
          </Button>
        </CardHeader>
        <CardContent>
          {(consSeasonal || seasonalData).length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No data</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Index</TableHead>
                    <TableHead>Season</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(consSeasonal || seasonalData).map((d) => (
                    <TableRow key={d.name}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell>
                        <span className={d.index > 1.1 ? "text-green-600 font-bold" : d.index < 0.9 ? "text-red-600" : ""}>
                          {d.index.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.season === "High" ? "success" : d.season === "Low" ? "secondary" : "outline"}>
                          {d.season}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-2">
                Index &gt; 1.1 = High season, Index &lt; 0.9 = Low season
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Safety Stock Recommendations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Safety Stock Recommendations</CardTitle>
          <Button size="sm" variant="outline" onClick={exportXlsx} disabled={exporting}>
            <FileDown className="h-4 w-4" /> {exporting ? "Exporting..." : "Export XLSX"}
          </Button>
        </CardHeader>
        <CardContent>
          {enriched.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No data</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>σ</TableHead>
                    <TableHead>Lead Time</TableHead>
                    <TableHead>Base SS</TableHead>
                    <TableHead>S. Index</TableHead>
                    <TableHead>Rec. SS</TableHead>
                    <TableHead>ROP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(consDetails || enriched).slice(0, 20).map((item: any) => {
                    const sd = item.std_dev ?? item.sigma
                    const lt = item.lead_time_days ?? 0
                    const ss = item.safety_stock ?? item.safetyStock
                    const si = item.seasonal_index ?? item.seasonalIndex ?? 1
                    const rp = item.reorder_point ?? item.rop
                    const rss = item.seasonal_safety_stock ?? item.seasonalSafetyStock ?? ss
                    return (
                      <TableRow key={item.material_id}>
                        <TableCell className="font-medium">{item.material_name}</TableCell>
                        <TableCell>{sd?.toFixed(2) ?? "—"}</TableCell>
                        <TableCell>{lt.toFixed(1)}d</TableCell>
                        <TableCell>{ss?.toFixed(1) ?? "—"}</TableCell>
                        <TableCell>
                          <span className={si > 1.1 ? "text-green-600 font-bold" : si < 0.9 ? "text-red-600" : ""}>
                            {si.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="font-bold">{Math.round(rss)}</TableCell>
                        <TableCell>{rp?.toFixed(1) ?? "—"}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" /> Safety Stock Calculator
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              SS = Z × σ × √LT &nbsp; (Z = 1.65 at 95% service level)
            </p>
            <p className="text-sm text-muted-foreground mb-2">
              σ = stddev of monthly consumption, LT = lead time (days)
            </p>
            {enriched.length > 0 && (
              <p className="text-sm">
                Avg Safety Stock:{" "}
                <span className="font-bold">
                  {(enriched.reduce((s, i) => s + i.safetyStock, 0) / enriched.length).toFixed(1)}
                </span>
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" /> ROP Calculator
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              ROP = (avg_daily_usage × lead_time) + safety_stock
            </p>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm">Z value:</label>
              <Input
                type="number"
                step={0.1}
                min={0}
                className="w-20 h-8"
                value={zValue}
                onChange={(e) => setZValue(Number(e.target.value) || 1.65)}
              />
            </div>
            {enriched.length > 0 && (
              <p className="text-sm">
                Avg ROP:{" "}
                <span className="font-bold">
                  {(enriched.reduce((s, i) => s + i.rop, 0) / enriched.length).toFixed(1)}
                </span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Consumption Details</CardTitle>
            <div className="flex gap-2 items-center">
              <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="max-w-[200px]">
                <option value="">All Warehouses</option>
                {(warehouses || []).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
              <div className="relative w-64">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search by name or SKU..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" onClick={exportXlsx} disabled={exporting}>
                <FileDown className="h-4 w-4" /> {exporting ? "Exporting..." : "Export XLSX"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Filter consumption data by warehouse.</p>
        </CardHeader>
        <CardContent>
          {enriched.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No materials match your search</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Trend</TableHead>
                    <TableHead>Cons (3mo)</TableHead>
                    <TableHead>Cons (6mo)</TableHead>
                    <TableHead>Safety Stock</TableHead>
                    <TableHead>ROP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                  {(consDetails || enriched).map((item: any) => {
                    const cd = item.consumption_3mo ?? item.consumption_3mo
                    const c6 = item.consumption_6mo ?? 0
                    const ss = item.safety_stock ?? item.safetyStock ?? 0
                    const rp = item.reorder_point ?? item.rop ?? 0
                    const trend = item.consumption_trend ?? (c6 > cd ? "▲" : c6 < cd ? "▼" : "→")
                    return (
                      <TableRow key={item.material_id}>
                        <TableCell className="font-medium">{item.material_name}</TableCell>
                        <TableCell className="font-mono">{item.sku}</TableCell>
                        <TableCell>{item.current_qty ?? item.quantity}</TableCell>
                        <TableCell className={`text-lg font-bold ${trend === "▲" ? "text-green-600" : trend === "▼" ? "text-red-600" : "text-muted-foreground"}`}>{trend}</TableCell>
                        <TableCell>{cd.toFixed(0)}</TableCell>
                        <TableCell>{c6.toFixed(0)}</TableCell>
                        <TableCell>{ss.toFixed(1)}</TableCell>
                        <TableCell>{rp.toFixed(1)}</TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          )}
          <p className="text-sm text-muted-foreground mt-2">{filtered.length} material(s) shown</p>
        </CardContent>
      </Card>
    </div>
  )
}
