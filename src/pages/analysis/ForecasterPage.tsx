import { useState, useMemo, useCallback, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { getAnalysisAll, getForecastCache, setForecastCache, deleteForecastCache } from "../../api"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Select } from "../../components/ui/select"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { Package, ShoppingCart, AlertTriangle, DollarSign, Download, Save, RefreshCw, Database } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { toast } from "../../hooks/use-toast"

type ModelKey = "SMA3" | "SMA6" | "SMA12" | "WMA" | "SES" | "Holt" | "HoltWinters" | "LinReg"

const MODEL_LABELS: Record<ModelKey, string> = {
  SMA3: "SMA (n=3)",
  SMA6: "SMA (n=6)",
  SMA12: "SMA (n=12)",
  WMA: "WMA",
  SES: "SES (α)",
  Holt: "Holt (α+β)",
  HoltWinters: "Holt-Winters (α+β+γ)",
  LinReg: "Linear Regression",
}

const MODEL_COLORS: Record<ModelKey, string> = {
  SMA3: "#8884d8",
  SMA6: "#82ca9d",
  SMA12: "#ffc658",
  WMA: "#a4de6c",
  SES: "#d0ed57",
  Holt: "#ff7300",
  HoltWinters: "#ff0000",
  LinReg: "#00bcd4",
}

// --- forecast helpers ---

function buildHistory(item: { consumption_3mo: number; consumption_6mo: number; consumption_12mo: number }, periodMonths: number): number[] {
  const months: number[] = []
  const months6 = Math.min(6, Math.floor(periodMonths * 0.5))
  const months3 = Math.min(3, Math.floor(periodMonths * 0.25))
  const monthsLast = periodMonths - months6 - months3
  const first6 = Math.max(0, item.consumption_12mo - item.consumption_6mo) / months6
  const mid3 = Math.max(0, item.consumption_6mo - item.consumption_3mo) / months3
  const last3 = item.consumption_3mo / monthsLast
  for (let i = 0; i < months6; i++) months.push(Math.round(first6 * (1 + 0.12 * Math.sin(i * 1.2))))
  for (let i = 0; i < months3; i++) months.push(Math.round(mid3 * (1 + 0.12 * Math.sin((i + months6) * 1.2))))
  for (let i = 0; i < monthsLast; i++) months.push(Math.round(last3 * (1 + 0.12 * Math.sin((i + months6 + months3) * 1.2))))
  return months.map((v) => Math.max(1, v))
}

function sma(data: number[], n: number): number {
  if (data.length === 0) return 0
  const slice = data.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function wma(data: number[]): number {
  if (data.length === 0) return 0
  let wSum = 0
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * (i + 1)
    wSum += i + 1
  }
  return sum / wSum
}

function ses(data: number[], alpha: number): number {
  if (data.length === 0) return 0
  let s = data[0]
  for (let i = 1; i < data.length; i++) s = alpha * data[i] + (1 - alpha) * s
  return s
}

function holt(data: number[], alpha: number, beta: number): number {
  if (data.length < 2) return data[data.length - 1] || 0
  let level = data[0]
  let trend = data[1] - data[0]
  for (let i = 1; i < data.length; i++) {
    const newLevel = alpha * data[i] + (1 - alpha) * (level + trend)
    const newTrend = beta * (newLevel - level) + (1 - beta) * trend
    level = newLevel
    trend = newTrend
  }
  return Math.max(0, level + trend)
}

function holtWinters(data: number[], alpha: number, beta: number, gamma: number, period = 4): number {
  if (data.length < period * 2) return sma(data, Math.min(6, data.length))
  const season: number[] = []
  for (let i = 0; i < period; i++) {
    let sum = 0
    let cnt = 0
    for (let j = i; j < data.length; j += period) { sum += data[j]; cnt++ }
    season.push(sum / cnt)
  }
  const avg = season.reduce((a, b) => a + b, 0) / period
  for (let i = 0; i < period; i++) season[i] = avg > 0 ? season[i] / avg : 1
  let level = data[0] / season[0]
  let trend = (data[Math.min(period, data.length - 1)] / season[Math.min(period, data.length - 1) % period] - level) / Math.min(period, data.length - 1)
  for (let i = 1; i < data.length; i++) {
    const si = i % period
    const newLevel = alpha * (data[i] / season[si]) + (1 - alpha) * (level + trend)
    const newTrend = beta * (newLevel - level) + (1 - beta) * trend
    level = newLevel
    trend = newTrend
    const nextSi = (i + 1) % period
    season[nextSi] = gamma * (data[i] / level) + (1 - gamma) * season[nextSi]
  }
  const fSi = data.length % period
  return Math.max(0, (level + trend) * season[fSi])
}

function linearRegression(data: number[]): number {
  const n = data.length
  if (n < 2) return data[n - 1] || 0
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += data[i]; sumXY += i * data[i]; sumX2 += i * i
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n
  return Math.max(0, slope * n + intercept)
}

function computeInSample(data: number[], modelFn: (d: number[]) => number): number[] {
  const preds: number[] = []
  for (let i = 1; i < data.length; i++) preds.push(modelFn(data.slice(0, i)))
  return preds
}

function computeErrorMetrics(actual: number[], predicted: number[]): { mape: number; mae: number; rmse: number } {
  let sumAPE = 0, sumAE = 0, sumSE = 0, count = 0
  for (let i = 0; i < actual.length && i < predicted.length; i++) {
    if (actual[i] === 0) continue
    const err = actual[i] - predicted[i]
    sumAPE += Math.abs(err / actual[i]) * 100
    sumAE += Math.abs(err)
    sumSE += err * err
    count++
  }
  return {
    mape: count > 0 ? sumAPE / count : 0,
    mae: count > 0 ? sumAE / count : 0,
    rmse: count > 0 ? Math.sqrt(sumSE / count) : 0,
  }
}

type ModelResult = { key: ModelKey; forecast: number; inSample: number[]; mape: number; mae: number; rmse: number }

function runForecast(data: number[], alpha: number, beta: number, gamma: number): ModelResult[] {
  const models: { key: ModelKey; fn: (d: number[]) => number }[] = [
    { key: "SMA3", fn: (d) => sma(d, 3) },
    { key: "SMA6", fn: (d) => sma(d, 6) },
    { key: "SMA12", fn: (d) => sma(d, 12) },
    { key: "WMA", fn: wma },
    { key: "SES", fn: (d) => ses(d, alpha) },
    { key: "Holt", fn: (d) => holt(d, alpha, beta) },
    { key: "HoltWinters", fn: (d) => holtWinters(d, alpha, beta, gamma) },
    { key: "LinReg", fn: linearRegression },
  ]
  return models.map(({ key, fn }) => {
    const forecast = fn(data)
    const inSample = computeInSample(data, fn)
    const metrics = computeErrorMetrics(data.slice(1), inSample)
    return { forecast, inSample, ...metrics, key: key }
  })
}

export default function ForecasterPage() {
  const { data: items, isLoading, isError, error, refetch } = useQuery({ queryKey: ["analysis"], queryFn: () => getAnalysisAll() })
  const [selectedId, setSelectedId] = useState("")
  const [horizon, setHorizon] = useState("3")
  const [periodMonths, setPeriodMonths] = useState(12)
  const [alpha, setAlpha] = useState(0.3)
  const [beta, setBeta] = useState(0.1)
  const [gamma, setGamma] = useState(0.1)
  const [cacheStatus, setCacheStatus] = useState<string>("")

  const selected = useMemo(() => {
    if (!items || !selectedId) return null
    return items.find((i) => i.material_id === selectedId) || null
  }, [items, selectedId])

  const { data: cachedForecast, refetch: refetchCache } = useQuery({
    queryKey: ["forecast_cache", selectedId, periodMonths],
    queryFn: () => getForecastCache(selectedId, `holtwinters_${periodMonths}`, parseInt(horizon)),
    enabled: !!selectedId,
  })

  const { history, models, bestModel } = useMemo(() => {
    if (!selected) return { history: [] as number[], models: null as ModelResult[] | null, bestModel: null as ModelKey | null }
    if (cachedForecast?.result) {
      try {
        const parsed = JSON.parse(cachedForecast.result)
        return { history: parsed.history || [], models: parsed.models || null, bestModel: parsed.bestModel || null }
      } catch {}
    }
    const hist = buildHistory(selected, periodMonths)
    const results = runForecast(hist, alpha, beta, gamma)
    let best: ModelKey | null = null
    let bestMape = Infinity
    for (const r of results) {
      if (r.mape > 0 && r.mape < bestMape) { bestMape = r.mape; best = r.key }
    }
    return { history: hist, models: results, bestModel: best }
  }, [selected, alpha, beta, gamma, periodMonths, cachedForecast])

  const saveToCache = async () => {
    if (!selected || !models) return
    try {
      await setForecastCache(selectedId, `holtwinters_${periodMonths}`, JSON.stringify({ alpha, beta, gamma, horizon }), JSON.stringify({ history, models, bestModel }), parseInt(horizon))
      setCacheStatus("Saved to cache")
      toast({ title: "Cache Saved", description: `Forecast for ${selected.material_name} cached` })
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  const clearCache = async () => {
    try {
      await deleteForecastCache(selectedId, `holtwinters_${periodMonths}`)
      setCacheStatus("Cache cleared")
      refetchCache()
      toast({ title: "Cache Cleared" })
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  useEffect(() => {
    if (cachedForecast) setCacheStatus("Loaded from cache")
    else setCacheStatus("Live computation")
  }, [cachedForecast])

  const chartData = useMemo(() => {
    if (!history.length || !models) return []
    const result: Record<string, number | string>[] = []
    history.forEach((v: number, i: number) => {
      const point: Record<string, number | string> = { period: `M${i + 1}`, Actual: v }
      for (const m of models) {
        if (i > 0 && i - 1 < m.inSample.length) point[m.key] = Math.round(m.inSample[i - 1])
      }
      result.push(point)
    })
    const h = parseInt(horizon)
    for (let f = 0; f < h; f++) {
      const fPoint: Record<string, number | string> = { period: `M${history.length + f + 1}` }
      for (const m of models) {
        // First forecast step uses model forecast; subsequent steps use simple extrapolation
        const mk = m.key as ModelKey
        fPoint[mk] = f === 0 ? Math.round(m.forecast) : Math.round(m.forecast * (1 + f * 0.02))
      }
      result.push(fPoint)
    }
    return result
  }, [history, models, horizon])

  const needsReorder = (items || []).filter((i) => i.forecast_qty > i.quantity)
  const reorderValue = needsReorder.reduce((s, i) => s + i.forecast_qty - i.quantity, 0)
  const sufficient = (items || []).filter((i) => i.forecast_qty <= i.quantity)
  const coverageRatio = items?.length ? Math.round((sufficient.length / items.length) * 100) : 0

  const exportCsv = useCallback(() => {
    if (!models) return
    const rows = [["Model", "Forecast", "MAPE (%)", "MAE", "RMSE"]]
    for (const m of models) {
      rows.push([MODEL_LABELS[m.key as ModelKey], m.forecast.toFixed(2), m.mape.toFixed(2), m.mae.toFixed(2), m.rmse.toFixed(2)])
    }
    const csv = rows.map((r) => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `forecast_${selected?.material_name?.replace(/\s+/g, "_") || "data"}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [models, selected])

  if (isLoading) return <LoadingState text="Loading..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Forecaster</h1>
      <p className="text-muted-foreground">Multi-model demand forecasting engine</p>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Total Materials</CardTitle>
            <Package className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{items?.length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Reorder Needed</CardTitle>
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{needsReorder.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Stock Coverage</CardTitle>
            <ShoppingCart className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{coverageRatio}%</div>
            <p className="text-xs text-muted-foreground">{sufficient.length} of {items?.length} items</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Reorder Qty</CardTitle>
            <DollarSign className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-orange-600">{reorderValue.toFixed(0)}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Forecast Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="text-xs">
              <Database className="h-3 w-3 mr-1" />{cacheStatus}
            </Badge>
            <Button size="sm" variant="ghost" onClick={saveToCache} disabled={!selected || !models}>
              <Save className="h-3 w-3" /> Save Cache
            </Button>
            <Button size="sm" variant="ghost" onClick={clearCache} disabled={!selected}>
              <RefreshCw className="h-3 w-3" /> Clear Cache
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            <div>
              <label className="mb-1 block text-sm font-medium">Material</label>
              <Select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setCacheStatus("") }}>
                <option value="">-- Select material --</option>
                {(items || []).map((i) => (
                  <option key={i.material_id} value={i.material_id}>{i.material_name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">History Period</label>
              <Select value={String(periodMonths)} onChange={(e) => setPeriodMonths(Number(e.target.value))}>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
                <option value="24">24 months</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Horizon</label>
              <Select value={horizon} onChange={(e) => setHorizon(e.target.value)}>
                <option value="1">1 month</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">α = {alpha.toFixed(2)}</label>
              <input type="range" min="0.01" max="0.99" step="0.01" value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">β = {beta.toFixed(2)}</label>
              <input type="range" min="0.01" max="0.99" step="0.01" value={beta} onChange={(e) => setBeta(parseFloat(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">γ = {gamma.toFixed(2)}</label>
              <input type="range" min="0.01" max="0.99" step="0.01" value={gamma} onChange={(e) => setGamma(parseFloat(e.target.value))} className="w-full" />
            </div>
          </div>
        </CardContent>
      </Card>

      {selected && models && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Forecast Comparison — {selected.material_name}</CardTitle>
              <Button size="sm" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />Export CSV</Button>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" fontSize={12} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Actual" stroke="#000" strokeWidth={2} dot={{ r: 3 }} name="Actual" />
                  {models.map((m: ModelResult) => {
                    const mk = m.key
                    return (
                    <Line
                      key={mk}
                      type="monotone"
                      dataKey={mk}
                      stroke={MODEL_COLORS[mk]}
                      strokeDasharray="4 4"
                      dot={false}
                      connectNulls
                      name={MODEL_LABELS[mk]}
                    />)
                  })}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Model Accuracy Comparison</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Forecast</TableHead>
                    <TableHead>MAPE (%)</TableHead>
                    <TableHead>MAE</TableHead>
                    <TableHead>RMSE</TableHead>
                    <TableHead>Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((m: ModelResult) => {
                    const mk = m.key
                    const isBest = mk === bestModel
                    return (
                      <TableRow key={mk} className={isBest ? "bg-green-50 dark:bg-green-950/30" : ""}>
                        <TableCell className="font-medium">{MODEL_LABELS[mk]}</TableCell>
                        <TableCell className="font-semibold">{m.forecast.toFixed(2)}</TableCell>
                        <TableCell>{m.mape.toFixed(2)}</TableCell>
                        <TableCell>{m.mae.toFixed(2)}</TableCell>
                        <TableCell>{m.rmse.toFixed(2)}</TableCell>
                        <TableCell>{isBest ? <Badge variant="success">Best Model (lowest MAPE)</Badge> : null}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {!selected && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Select a material above to view forecast models
          </CardContent>
        </Card>
      )}
    </div>
  )
}
