import { useState, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { abcClassify, getAbcSummary, getAbcWeights, setAbcWeight } from "../../api"
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
import { Search, Layers, PieChart as PieIcon, Sliders, RefreshCw } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import type { AbcClassifiedItem, AbcClassifyResult, AbcSummaryResult } from "../../api"

const PIE_COLORS = ["#ef4444", "#eab308", "#22c55e"]
const XYZ_COLORS: Record<string, string> = { X: "#22c55e", Y: "#eab308", Z: "#ef4444" }
const ACTION_CARDS = {
  A: { title: "Class A — Tight Control", desc: "Tight control, frequent review, accurate records", color: "red" },
  B: { title: "Class B — Moderate Control", desc: "Moderate control, periodic review", color: "yellow" },
  C: { title: "Class C — Simplified", desc: "Simplified procurement, annual review", color: "green" },
}

function xyzLabel(xyz: string): string {
  if (xyz === "X") return "X — Stable (CV<0.5)"
  if (xyz === "Y") return "Y — Fluctuating (0.5≤CV<1)"
  return "Z — Sporadic (CV≥1)"
}

export default function AbcAnalysisPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [useMultiFactor, setUseMultiFactor] = useState(false)
  const [showPie, setShowPie] = useState(true)
  const [showWeightDialog, setShowWeightDialog] = useState(false)
  const [weights, setWeights] = useState({ value_w: 0.5, turnover_w: 0.3, recency_w: 0.2 })

  const { data: abc, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["abc_classify", useMultiFactor],
    queryFn: () => abcClassify(useMultiFactor ? "multi" : "single"),
  })
  const { data: summary } = useQuery({ queryKey: ["abc_summary"], queryFn: getAbcSummary })
  const { data: abcWeights } = useQuery({ queryKey: ["abc_weights"], queryFn: getAbcWeights })

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

  const classifyMut = useMutation({
    mutationFn: () => abcClassify(useMultiFactor ? "multi" : "single"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["abc_classify"] })
      queryClient.invalidateQueries({ queryKey: ["abc_summary"] })
      toast({ title: "Classification complete" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

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

  const classAItems = abc?.class_a || []
  const classBItems = abc?.class_b || []
  const classCItems = abc?.class_c || []
  const allClassified = [...classAItems, ...classBItems, ...classCItems]

  const filterItems = useCallback((items: AbcClassifiedItem[]) => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.material_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
  }, [search])

  const totalValue = (items: AbcClassifiedItem[]) =>
    items.reduce((sum, i) => sum + i.inventory_value, 0)

  const classAValue = totalValue(classAItems)
  const classBValue = totalValue(classBItems)
  const classCValue = totalValue(classCItems)
  const grandTotal = classAValue + classBValue + classCValue

  const pieData = [
    { name: "Class A", value: Math.round(classAValue) },
    { name: "Class B", value: Math.round(classBValue) },
    { name: "Class C", value: Math.round(classCValue) },
  ].filter((d) => d.value > 0)

  const treemapData = useMemo(() => {
    const all = filterItems(allClassified)
    return all.map((item) => ({
      name: item.material_name,
      size: Math.round(item.inventory_value),
      class: item.abc_class,
      sku: item.sku,
      fill: item.abc_class === "A" ? "#ef4444" : item.abc_class === "B" ? "#eab308" : "#22c55e",
    })).filter((d) => d.size > 0)
  }, [allClassified, filterItems])

  const xyzCounts = useMemo(() => {
    const counts = { X: 0, Y: 0, Z: 0 }
    for (const item of allClassified) {
      const x = item.xyz_class || "Z"
      counts[x as keyof typeof counts]++
    }
    return counts
  }, [allClassified])

  const totalXyz = allClassified.length

  if (isLoading) return <LoadingState text="Loading..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">ABC Analysis</h1>
          <p className="text-muted-foreground">
            {useMultiFactor
              ? "Multi-factor scoring"
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
          <Button size="sm" variant="outline" onClick={() => classifyMut.mutate()} disabled={classifyMut.isPending}>
            <RefreshCw className={`mr-1 h-4 w-4 ${classifyMut.isPending ? "animate-spin" : ""}`} />
            {classifyMut.isPending ? "Classifying..." : "Run Classification"}
          </Button>
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

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Classified</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold">{summary?.total_classified ?? allClassified.length}</div>
          </CardContent>
        </Card>
        <Card className="border-red-300">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600">Class A</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-red-600">{summary?.class_a_count ?? classAItems.length}</div>
          </CardContent>
        </Card>
        <Card className="border-yellow-300">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-yellow-600">Class B</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-yellow-600">{summary?.class_b_count ?? classBItems.length}</div>
          </CardContent>
        </Card>
        <Card className="border-green-300">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-green-600">Class C</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-green-600">{summary?.class_c_count ?? classCItems.length}</div>
          </CardContent>
        </Card>
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
            <div className="space-y-3">
              {(["X", "Y", "Z"] as const).map((cls) => {
                const cnt = xyzCounts[cls]
                const pct = totalXyz > 0 ? ((cnt / totalXyz) * 100).toFixed(0) : "0"
                return (
                  <div key={cls} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: XYZ_COLORS[cls] }} />
                      <span className="text-sm font-medium">{xyzLabel(cls)}</span>
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
          </CardContent>
        </Card>
      </div>

      {/* Class tables */}
      {(["A", "B", "C"] as const).map((cls) => {
        const items = cls === "A" ? classAItems : cls === "B" ? classBItems : classCItems
        if (items.length === 0 && !search) return null
        const filtered = filterItems(items)
        const clsValue = totalValue(items)
        const pct = grandTotal > 0 ? ((clsValue / grandTotal) * 100).toFixed(1) : "0"
        const colorClass = cls === "A" ? "border-red-300" : cls === "B" ? "border-yellow-300" : "border-green-300"
        return (
          <Card key={cls} className={colorClass}>
            <CardHeader>
              <CardTitle>
                Class {cls} ({filtered.length} of {items.length}) &mdash; {formatCurrency(clsValue)} ({pct}%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
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
                    {filtered.map((item) => {
                      const itemVal = item.inventory_value
                      const itemPct = grandTotal > 0 ? ((itemVal / grandTotal) * 100).toFixed(1) : "0"
                      return (
                        <TableRow key={item.material_id}>
                          <TableCell className="font-mono">{item.sku}</TableCell>
                          <TableCell className="font-medium">{item.material_name}</TableCell>
                          <TableCell>{item.current_qty.toFixed(0)}</TableCell>
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
                                backgroundColor: XYZ_COLORS[item.xyz_class] + "22",
                                color: XYZ_COLORS[item.xyz_class],
                              }}
                            >
                              {item.xyz_class} (Score: {item.composite_score.toFixed(3)})
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={3}>Subtotal ({filtered.length} items)</TableCell>
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
              <p className="text-xs text-muted-foreground">Normalized automatically</p>
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
