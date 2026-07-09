import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { getAnalysisAll, getWarehouses } from "../../api"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Select } from "../../components/ui/select"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import { Badge } from "../../components/ui/badge"
import { Search, TrendingUp, TrendingDown, BarChart3, Calculator } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

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

  const avgMonthly = seasonalData.reduce((s, d) => s + d.avg, 0) / (seasonalData.length || 1)
  const highSeason = seasonalData.filter((d) => d.avg > avgMonthly * 1.1)
  const lowSeason = seasonalData.filter((d) => d.avg < avgMonthly * 0.9)
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
          <CardContent><div className="text-2xl font-bold">{totalCons3mo.toFixed(0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">6-Month Usage</CardTitle>
            <TrendingUp className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalCons6mo.toFixed(0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">12-Month Usage</CardTitle>
            <BarChart3 className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalCons12mo.toFixed(0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Lead Time</CardTitle>
            <TrendingUp className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{avgLeadTime.toFixed(1)} days</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seasonal Consumption Pattern</CardTitle>
        </CardHeader>
        <CardContent>
          {seasonalData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No consumption data available</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={seasonalData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="avg" fill="#3b82f6" name="Avg Monthly Consumption" />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 text-sm text-muted-foreground">
                {highSeason.length > 0 && (
                  <span className="mr-4">High season: <span className="text-green-600 font-medium">{highSeason.map(d => d.name).join(", ")}</span></span>
                )}
                {lowSeason.length > 0 && (
                  <span>Low season: <span className="text-red-600 font-medium">{lowSeason.map(d => d.name).join(", ")}</span></span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Seasonal Index Table */}
      <Card>
        <CardHeader><CardTitle>Seasonal Index Table</CardTitle></CardHeader>
        <CardContent>
          {seasonalData.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No data</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Avg Consumption</TableHead>
                    <TableHead>Index</TableHead>
                    <TableHead>Season</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {seasonalData.map((d) => (
                    <TableRow key={d.name}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell>{d.avg}</TableCell>
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
                Index &gt; 1.1 = High season (increase safety stock), Index &lt; 0.9 = Low season, 0.9-1.1 = Normal
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Safety Stock Recommendations */}
      <Card>
        <CardHeader><CardTitle>Safety Stock Recommendations</CardTitle></CardHeader>
        <CardContent>
          {enriched.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No data</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>σ (StdDev)</TableHead>
                    <TableHead>Lead Time</TableHead>
                    <TableHead>Base SS</TableHead>
                    <TableHead>Seasonal Index</TableHead>
                    <TableHead>Recommended SS</TableHead>
                    <TableHead>ROP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enriched.slice(0, 20).map((item) => (
                    <TableRow key={item.material_id}>
                      <TableCell className="font-medium">{item.material_name}</TableCell>
                      <TableCell>{item.sigma.toFixed(2)}</TableCell>
                      <TableCell>{item.lead_time_days.toFixed(1)}d</TableCell>
                      <TableCell>{item.safetyStock.toFixed(1)}</TableCell>
                      <TableCell>
                        <span className={item.seasonalIndex > 1.1 ? "text-green-600 font-bold" : item.seasonalIndex < 0.9 ? "text-red-600" : ""}>
                          {item.seasonalIndex.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="font-bold">{item.seasonalSafetyStock}</TableCell>
                      <TableCell>{item.rop.toFixed(1)}</TableCell>
                    </TableRow>
                  ))}
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
                  <TableHead>Cons (3mo)</TableHead>
                  <TableHead>Cons (6mo)</TableHead>
                  <TableHead>Cons (12mo)</TableHead>
                  <TableHead>Safety Stock</TableHead>
                  <TableHead>ROP</TableHead>
                  <TableHead>Lead Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enriched.map((item) => (
                  <TableRow key={item.material_id}>
                    <TableCell className="font-medium">{item.material_name}</TableCell>
                    <TableCell className="font-mono">{item.sku}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{item.consumption_3mo.toFixed(0)}</TableCell>
                    <TableCell>{item.consumption_6mo.toFixed(0)}</TableCell>
                    <TableCell>{item.consumption_12mo.toFixed(0)}</TableCell>
                    <TableCell>{item.safetyStock.toFixed(1)}</TableCell>
                    <TableCell>{item.rop.toFixed(1)}</TableCell>
                    <TableCell>{item.lead_time_days.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-sm text-muted-foreground mt-2">{filtered.length} material(s) shown</p>
        </CardContent>
      </Card>
    </div>
  )
}
