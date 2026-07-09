import { useState, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getAbcAnalysis, getAnalysisAll, getAbcWeights, setAbcWeight } from "../../api"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { formatCurrency } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { Treemap, PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { Search, Layers, PieChart as PieIcon, Sliders } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import type { AnalysisItem } from "../../api"

const PIE_COLORS = ["#ef4444", "#eab308", "#22c55e"]
const XYZ_COLORS: Record<string, string> = { X: "#22c55e", Y: "#eab308", Z: "#ef4444" }
const ACTION_CARDS = {
  A: { title: "Class A — Tight Control", desc: "Tight control, frequent review, accurate records", color: "red" },
  B: { title: "Class B — Moderate Control", desc: "Moderate control, periodic review", color: "yellow" },
  C: { title: "Class C — Simplified", desc: "Simplified procurement, annual review", color: "green" },
}

function computeXyz(item: AnalysisItem): { cv: number; xyz: string } {
  const monthly = [
    item.consumption_3mo / 3,
    item.consumption_6mo / 6,
    item.consumption_12mo / 12,
  ].filter((v) => v > 0)
  if (monthly.length < 2) return { cv: 0, xyz: "Z" }
  const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length
  const variance = monthly.reduce((s, v) => s + (v - mean) ** 2, 0) / monthly.length
  const cv = Math.sqrt(variance) / mean
  const xyz = cv < 0.5 ? "X" : cv < 1.0 ? "Y" : "Z"
  return { cv, xyz }
}

function computeMultiClass(
  items: AnalysisItem[],
  thresholdA: number,
  thresholdB: number,
  weights?: { value_w: number; turnover_w: number; recency_w: number },
): AnalysisItem[][] {
  if (items.length === 0) return [[], [], []]

  const values = items.map((i) => ({
    item: i,
    consumptionValue: i.quantity * i.turnover,
    turnoverRate: i.turnover,
    daysInv: 1 / (i.days_since_last + 1),
  }))

  const maxCV = Math.max(...values.map((v) => v.consumptionValue), 1)
  const maxTR = Math.max(...values.map((v) => v.turnoverRate), 1)
  const maxDI = Math.max(...values.map((v) => v.daysInv), 1)

  const w = weights || { value_w: 0.5, turnover_w: 0.3, recency_w: 0.2 }
  const normalizer = w.value_w + w.turnover_w + w.recency_w
  const scored = values.map((v) => ({
    ...v,
    composite:
      (v.consumptionValue / maxCV) * (w.value_w / normalizer) +
      (v.turnoverRate / maxTR) * (w.turnover_w / normalizer) +
      (v.daysInv / maxDI) * (w.recency_w / normalizer),
  })).sort((a, b) => b.composite - a.composite)

  const totalScore = scored.reduce((s, v) => s + v.composite, 0)
  const a: AnalysisItem[] = []
  const b: AnalysisItem[] = []
  const c: AnalysisItem[] = []

  let cumScore = 0
  for (const v of scored) {
    const pct = totalScore > 0 ? (cumScore / totalScore) * 100 : 0
    if (pct < thresholdA) {
      a.push(v.item)
    } else if (pct < thresholdB) {
      b.push(v.item)
    } else {
      c.push(v.item)
    }
    cumScore += v.composite
  }
  return [a, b, c]
}

export default function AbcAnalysisPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [useMultiFactor, setUseMultiFactor] = useState(false)
  const [thresholdA, setThresholdA] = useState(80)
  const [thresholdB, setThresholdB] = useState(95)
  const [showPie, setShowPie] = useState(true)
  const [showWeightDialog, setShowWeightDialog] = useState(false)
  const [weights, setWeights] = useState({ value_w: 0.5, turnover_w: 0.3, recency_w: 0.2 })

  const { data: abc, isLoading, isError, error, refetch } = useQuery({ queryKey: ["abc"], queryFn: () => getAbcAnalysis() })
  const { data: allItems } = useQuery({ queryKey: ["analysis"], queryFn: () => getAnalysisAll() })
  const { data: abcWeights } = useQuery({ queryKey: ["abc_weights"], queryFn: getAbcWeights })

  // Load custom weights from backend on mount
  useMemo(() => {
    if (abcWeights && abcWeights.length > 0) {
      const w = { value_w: 0.5, turnover_w: 0.3, recency_w: 0.2 }
      for (const aw of abcWeights) {
        if (aw.key === "value_w") w.value_w = aw.value
        else if (aw.key === "turnover_w") w.turnover_w = aw.value
        else if (aw.key === "recency_w") w.recency_w = aw.value
      }
      setWeights(w)
    }
  }, [abcWeights])

  const saveWeightMut = useMutation({
    mutationFn: async () => {
      await Promise.all([
        setAbcWeight("value_w", weights.value_w),
        setAbcWeight("turnover_w", weights.turnover_w),
        setAbcWeight("recency_w", weights.recency_w),
      ])
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["abc_weights"] }); setShowWeightDialog(false); toast({ title: "Weights saved" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const filterItems = useCallback((items: AnalysisItem[]) => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.material_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
  }, [search])

  // Compute classes based on mode
  const classes = useMemo(() => {
    if (useMultiFactor && allItems) {
      return computeMultiClass(allItems, thresholdA, thresholdB, weights)
    }
    if (!abc) return [[], [], []] as AnalysisItem[][]
    return [abc.class_a || [], abc.class_b || [], abc.class_c || []] as AnalysisItem[][]
  }, [abc, allItems, useMultiFactor, thresholdA, thresholdB, weights])

  const [classAItems, classBItems, classCItems] = classes

  const totalValue = (items: AnalysisItem[]) =>
    items.reduce((sum, i) => sum + i.quantity * i.turnover, 0)

  const classAValue = totalValue(classAItems)
  const classBValue = totalValue(classBItems)
  const classCValue = totalValue(classCItems)
  const grandTotal = classAValue + classBValue + classCValue

  const pieData = [
    { name: `Class A (${thresholdA}%)`, value: Math.round(classAValue) },
    { name: `Class B (${thresholdB - thresholdA}%)`, value: Math.round(classBValue) },
    { name: `Class C (${100 - thresholdB}%)`, value: Math.round(classCValue) },
  ].filter((d) => d.value > 0)

  // Treemap data
  const treemapData = useMemo(() => {
    const all = [...classAItems, ...classBItems, ...classCItems]
    const filtered = filterItems(all)
    return filtered.map((item) => {
      const cls = classAItems.includes(item) ? "A" : classBItems.includes(item) ? "B" : "C"
      return {
        name: item.material_name,
        size: Math.round(item.quantity * item.turnover),
        class: cls,
        sku: item.sku,
        fill: cls === "A" ? "#ef4444" : cls === "B" ? "#eab308" : "#22c55e",
      }
    }).filter((d) => d.size > 0)
  }, [classAItems, classBItems, classCItems, filterItems])

  if (isLoading) return <LoadingState text="Loading..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">ABC Analysis</h1>
          <p className="text-muted-foreground">
            {useMultiFactor
              ? "Multi-factor scoring (value×0.5 + turnover×0.3 + recency×0.2)"
              : "Classification based on inventory value"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant={useMultiFactor ? "default" : "outline"}
            onClick={() => setUseMultiFactor(!useMultiFactor)}
          >
            <Layers className="mr-1 h-4 w-4" />
            {useMultiFactor ? "Multi-Factor" : "Single Factor"}
          </Button>
          {useMultiFactor && (
            <Button size="sm" variant="outline" onClick={() => setShowWeightDialog(true)}>
              <Sliders className="mr-1 h-4 w-4" /> Weights ({weights.value_w.toFixed(1)}/{weights.turnover_w.toFixed(1)}/{weights.recency_w.toFixed(1)})
            </Button>
          )}
          <Button
            size="sm"
            variant={showPie ? "default" : "outline"}
            onClick={() => setShowPie(!showPie)}
          >
            <PieIcon className="mr-1 h-4 w-4" />
            {showPie ? "Pie" : "Tree"}
          </Button>
          <div className="relative w-56">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {useMultiFactor && (
        <Card>
          <CardHeader><CardTitle>Threshold Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Class A boundary: {thresholdA}%</label>
                <input type="range" min={1} max={99} value={thresholdA} onChange={(e) => { const v = parseInt(e.target.value); if (v < thresholdB) setThresholdA(v) }} className="w-full" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Class B boundary: {thresholdB}%</label>
                <input type="range" min={1} max={99} value={thresholdB} onChange={(e) => { const v = parseInt(e.target.value); if (v > thresholdA) setThresholdB(v) }} className="w-full" />
              </div>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="bg-red-500 transition-all" style={{ width: `${thresholdA}%` }} />
              <div className="bg-yellow-500 transition-all" style={{ width: `${thresholdB - thresholdA}%` }} />
              <div className="bg-green-500 transition-all" style={{ width: `${100 - thresholdB}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommended Action Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {(["A", "B", "C"] as const).map((cls) => {
          const items = cls === "A" ? classAItems : cls === "B" ? classBItems : classCItems
          const card = ACTION_CARDS[cls]
          const colorClass = card.color === "red" ? "border-red-300" : card.color === "yellow" ? "border-yellow-300" : "border-green-300"
          const textColor = card.color === "red" ? "text-red-600" : card.color === "yellow" ? "text-yellow-600" : "text-green-600"
          const value = cls === "A" ? classAValue : cls === "B" ? classBValue : classCValue
          const pct = grandTotal > 0 ? ((value / grandTotal) * 100).toFixed(1) : "0"
          return (
            <Card key={cls} className={colorClass}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm ${textColor}`}>{card.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${textColor}`}>{items.length}</div>
                <p className="text-xs text-muted-foreground">{card.desc}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(value)} ({pct}%)</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Chart area */}
      <div className="grid gap-6 md:grid-cols-2">
        {showPie ? (
          <Card>
            <CardHeader><CardTitle>Value Distribution (Pie)</CardTitle></CardHeader>
            <CardContent>
              {pieData.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle>Value Distribution (Treemap)</CardTitle></CardHeader>
            <CardContent>
              {treemapData.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <Treemap data={treemapData} dataKey="size" aspectRatio={4 / 3} stroke="#fff" fill="#8884d8">
                    <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                  </Treemap>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}

        {/* XYZ Summary */}
        <Card>
          <CardHeader><CardTitle>XYZ Classification (Stability)</CardTitle></CardHeader>
          <CardContent>
            {(() => {
              const all = [...classAItems, ...classBItems, ...classCItems]
              const filtered = filterItems(all)
              const xyzCounts = { X: 0, Y: 0, Z: 0 }
              for (const item of filtered) {
                const { xyz } = computeXyz(item)
                xyzCounts[xyz as keyof typeof xyzCounts]++
              }
              const totalXyz = filtered.length
              return (
                <div className="space-y-3">
                  {(["X", "Y", "Z"] as const).map((cls) => {
                    const cnt = xyzCounts[cls]
                    const pct = totalXyz > 0 ? ((cnt / totalXyz) * 100).toFixed(0) : "0"
                    const labels: Record<string, string> = { X: "X — Stable (CV<0.5)", Y: "Y — Fluctuating (0.5≤CV<1)", Z: "Z — Sporadic (CV≥1)" }
                    return (
                      <div key={cls} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: XYZ_COLORS[cls] }} />
                          <span className="text-sm font-medium">{labels[cls]}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold" style={{ color: XYZ_COLORS[cls] }}>{cnt}</div>
                          <div className="text-xs text-muted-foreground">{pct}%</div>
                        </div>
                      </div>
                    )
                  })}
                  {totalXyz === 0 && <p className="text-center text-muted-foreground py-4">No data</p>}
                </div>
              )
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Class tables */}
      {(["A", "B", "C"] as const).map((cls, idx) => {
        const allItems = idx === 0 ? classAItems : idx === 1 ? classBItems : classCItems
        if (allItems.length === 0 && !search) return null
        const items = filterItems(allItems)
        const clsValue = totalValue(allItems)
        const pct = grandTotal > 0 ? ((clsValue / grandTotal) * 100).toFixed(1) : "0"
        const colorClass = cls === "A" ? "border-red-300" : cls === "B" ? "border-yellow-300" : "border-green-300"
        return (
          <Card key={cls} className={colorClass}>
            <CardHeader>
              <CardTitle>
                Class {cls} ({items.length} of {allItems.length}) &mdash; {formatCurrency(clsValue)} ({pct}%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="py-4 text-center text-muted-foreground">No items match your search in Class {cls}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Stock</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>% of Total</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>XYZ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const itemVal = item.quantity * item.turnover
                      const itemPct = grandTotal > 0 ? ((itemVal / grandTotal) * 100).toFixed(1) : "0"
                      const { cv, xyz } = computeXyz(item)
                      return (
                        <TableRow key={item.material_id}>
                          <TableCell className="font-mono">{item.sku}</TableCell>
                          <TableCell className="font-medium">{item.material_name}</TableCell>
                          <TableCell>{item.quantity.toFixed(0)}</TableCell>
                          <TableCell>{formatCurrency(itemVal)}</TableCell>
                          <TableCell>{itemPct}%</TableCell>
                          <TableCell>
                            <Badge variant={cls === "A" ? "destructive" : cls === "B" ? "warning" : "secondary"}>
                              Class {cls}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="border-0"
                              style={{
                                backgroundColor: XYZ_COLORS[xyz] + "22",
                                color: XYZ_COLORS[xyz],
                              }}
                            >
                              {xyz} (CV: {cv.toFixed(2)})
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={3}>Subtotal ({items.length} items)</TableCell>
                      <TableCell>{formatCurrency(clsValue)}</TableCell>
                      <TableCell>{pct}%</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )
      })}
      <Dialog open={showWeightDialog} onOpenChange={setShowWeightDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sliders className="h-5 w-5" /> Custom ABC Weights</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Set custom scoring weights for multi-factor ABC analysis</p>
            <div className="space-y-3">
              <div>
                <Label>Inventory Value Weight: {weights.value_w.toFixed(2)}</Label>
                <input type="range" min="0" max="1" step="0.05" value={weights.value_w} onChange={(e) => setWeights((p) => ({ ...p, value_w: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <Label>Turnover Weight: {weights.turnover_w.toFixed(2)}</Label>
                <input type="range" min="0" max="1" step="0.05" value={weights.turnover_w} onChange={(e) => setWeights((p) => ({ ...p, turnover_w: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <Label>Recency Weight: {weights.recency_w.toFixed(2)}</Label>
                <input type="range" min="0" max="1" step="0.05" value={weights.recency_w} onChange={(e) => setWeights((p) => ({ ...p, recency_w: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              <p className="text-xs text-muted-foreground">Normalized automatically — sum can be any value</p>
            </div>
            <Button onClick={() => saveWeightMut.mutate()} className="w-full" disabled={saveWeightMut.isPending}>
              Save Weights
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
