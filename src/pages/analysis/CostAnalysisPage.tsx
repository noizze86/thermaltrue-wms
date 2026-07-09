import { useState, useEffect, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getAnalysisAll, getMaterials, getCategories, getTransactions, getSupplierPrices, getSuppliers, getCategoryValueSummary, exportReportCsv, getBudgets, saveBudget, deleteBudget } from "../../api"
import { Input } from "../../components/ui/input"
import { Select } from "../../components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Button } from "../../components/ui/button"
import { Badge } from "../../components/ui/badge"
import { formatCurrency } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts"
import { Search, FileDown, DollarSign, TrendingUp, Package, Percent, Save, Trash2, BarChart3 } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#a855f7", "#eab308", "#06b6d4", "#f97316"]

export default function CostAnalysisPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("")
  const [budget, setBudget] = useState({ id: "", categoryId: "", period: "", amount: 0 })

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: items, isLoading, isError, error, refetch } = useQuery({ queryKey: ["analysis"], queryFn: () => getAnalysisAll() })
  const { data: materials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => getCategories() })
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => getSuppliers() })
  const { data: catValues } = useQuery({ queryKey: ["catValueSummary"], queryFn: getCategoryValueSummary })
  const { data: budgets } = useQuery({ queryKey: ["budgets"], queryFn: getBudgets })

  const { data: purchaseTxs } = useQuery({
    queryKey: ["purchaseTx", selectedMaterialId],
    queryFn: () => getTransactions(undefined, "in", selectedMaterialId || undefined),
    enabled: !!selectedMaterialId,
  })

  const { data: supplierPrices } = useQuery({
    queryKey: ["supplierPricesMulti", selectedMaterialId],
    queryFn: async () => {
      if (!suppliers || !selectedMaterialId) return []
      const results = await Promise.all(
        suppliers.map((s) =>
          getSupplierPrices(s.id).then((prices) =>
            prices.filter((p) => p.material_id === selectedMaterialId).map((p) => ({ ...p, supplier_name: s.name }))
          )
        )
      )
      return results.flat()
    },
    enabled: !!selectedMaterialId && !!suppliers,
  })

  const filtered = (items || []).filter((i) => {
    if (!debouncedSearch) return true
    const q = debouncedSearch.toLowerCase()
    return i.material_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
  })

  const sorted = [...filtered].sort((a, b) => (b.quantity * b.turnover) - (a.quantity * a.turnover))

  const chartData = sorted.slice(0, 10).map((i) => ({
    name: i.material_name.length > 12 ? i.material_name.slice(0, 12) + "..." : i.material_name,
    value: Math.round(i.quantity * i.turnover),
  }))

  const totalStockValue = filtered.reduce((sum, i) => sum + i.quantity * i.turnover, 0)
  const totalQty = filtered.reduce((sum, i) => sum + i.quantity, 0)
  const avgValue = filtered.length > 0 ? totalStockValue / filtered.length : 0

  const catPieData = categories?.map((c) => ({
    name: c.name,
    value: materials?.filter((m) => m.category_id === c.id).reduce((s, m) => s + m.quantity * m.price, 0) || 0,
  })).filter((c) => c.value > 0) || []

  const costTrendData = useMemo(() => {
    if (!purchaseTxs) return []
    const sortedTxs = [...purchaseTxs].filter((tx) => tx.created_at).sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime())
    return sortedTxs.map((tx, i) => ({
      date: tx.created_at.slice(0, 10),
      price: tx.price,
      variance: i === 0 ? 0 : ((tx.price - sortedTxs[i - 1].price) / sortedTxs[i - 1].price) * 100,
    }))
  }, [purchaseTxs])

  const supplierChartData = useMemo(() => {
    if (!supplierPrices) return []
    const grouped: Record<string, { price: number; supplier_name: string; date: string }> = {}
    for (const sp of supplierPrices) {
      if (!grouped[sp.supplier_name] || sp.date > grouped[sp.supplier_name].date) {
        grouped[sp.supplier_name] = { price: sp.price, supplier_name: sp.supplier_name, date: sp.date }
      }
    }
    return Object.values(grouped).sort((a, b) => b.price - a.price)
  }, [supplierPrices])

  // Budget persistence
  const saveBudgetMut = useMutation({
    mutationFn: () => saveBudget(budget.id, budget.categoryId, budget.period, budget.amount),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["budgets"] }); toast({ title: "Budget saved" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const deleteBudgetMut = useMutation({
    mutationFn: () => deleteBudget(budget.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["budgets"] }); setBudget({ id: "", categoryId: "", period: "", amount: 0 }); toast({ title: "Budget deleted" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  // Load budget when category+period selected
  useEffect(() => {
    if (!budget.categoryId || !budget.period || !budgets) return
    const found = budgets.find((b) => b.category_id === budget.categoryId && b.period === budget.period)
    if (found) setBudget((p) => ({ ...p, id: found.id, amount: found.amount }))
    else setBudget((p) => ({ ...p, id: "", amount: 0 }))
  }, [budget.categoryId, budget.period, budgets])

  // Budget comparison chart data
  const budgetChartData = useMemo(() => {
    if (!budgets || !catValues || !categories) return []
    return budgets.slice(0, 12).map((b) => {
      const cat = categories.find((c) => c.id === b.category_id)
      const actual = catValues.find((cv) => cv.name === cat?.name)?.value || 0
      return { name: cat?.name || "?", budget: b.amount, actual }
    })
  }, [budgets, catValues, categories])

  const selectedCatBudget = budget.categoryId && budget.period
  const actualValue = useMemo(() => {
    if (!budget.categoryId || !catValues) return 0
    const cat = categories?.find((c) => c.id === budget.categoryId)
    if (!cat) return 0
    const match = catValues.find((cv) => cv.name === cat.name)
    return match?.value || 0
  }, [budget.categoryId, catValues, categories])

  const exportCsv = async () => {
    try {
      const csv = await exportReportCsv("materials")
      const blob = new Blob([csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = "cost_analysis.csv"; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Cost analysis CSV downloaded" })
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  if (isLoading) return <LoadingState text="Loading cost analysis..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Cost Analysis</h1>
        <Button variant="outline" onClick={exportCsv}><FileDown className="h-4 w-4" /> Export CSV</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Total Inventory Value</CardTitle>
            <DollarSign className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{formatCurrency(totalStockValue)}</div>
            <p className="text-sm text-muted-foreground">{filtered.length} material(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Total Quantity</CardTitle>
            <Package className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalQty.toFixed(0)}</div>
            <p className="text-sm text-muted-foreground">units across all materials</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Avg Value per Material</CardTitle>
            <TrendingUp className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatCurrency(avgValue)}</div>
            <p className="text-sm text-muted-foreground">average per item</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Material Cost Trend</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={selectedMaterialId} onChange={(e) => setSelectedMaterialId(e.target.value)}>
                <option value="">-- Select Material --</option>
                {(materials || []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>
                ))}
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedMaterialId ? (
            <p className="text-center text-muted-foreground py-8">Select a material to view cost trend</p>
          ) : costTrendData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No purchase transactions found for this material</p>
          ) : (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={costTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis />
                  <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="price" stroke="#3b82f6" name="Purchase Price" dot />
                </LineChart>
              </ResponsiveContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Variance %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costTrendData.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>{row.date}</TableCell>
                      <TableCell>{formatCurrency(row.price)}</TableCell>
                      <TableCell>
                        <span className={`flex items-center gap-1 ${row.variance >= 0 ? "text-red-600" : "text-green-600"}`}>
                          <Percent className="h-3 w-3" />
                          {row.variance >= 0 ? "+" : ""}{row.variance.toFixed(2)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedMaterialId && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Supplier Price Comparison</CardTitle></CardHeader>
            <CardContent>
              {supplierChartData.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No supplier prices available</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={supplierChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="supplier_name" fontSize={10} />
                    <YAxis />
                    <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                    <Bar dataKey="price" fill="#6366f1" name="Price" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Budget vs Actual</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Category</label>
                  <Select value={budget.categoryId} onChange={(e) => { setBudget((p) => ({ ...p, categoryId: e.target.value, id: "" })) }}>
                    <option value="">-- Select --</option>
                    {(categories || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Period (month)</label>
                  <Input
                    type="month"
                    value={budget.period}
                    onChange={(e) => setBudget((p) => ({ ...p, period: e.target.value, id: "" }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Budget (IDR)</label>
                  <Input
                    type="number"
                    value={budget.amount || ""}
                    onChange={(e) => setBudget((p) => ({ ...p, amount: Number(e.target.value) }))}
                  />
                </div>
              </div>
              {selectedCatBudget ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Card className="bg-green-50 dark:bg-green-950">
                      <CardContent className="pt-4">
                        <div className="text-sm text-muted-foreground">Budget</div>
                        <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                          {formatCurrency(budget.amount)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-blue-50 dark:bg-blue-950">
                      <CardContent className="pt-4">
                        <div className="text-sm text-muted-foreground">Actual</div>
                        <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                          {formatCurrency(actualValue)}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveBudgetMut.mutate()} disabled={saveBudgetMut.isPending}>
                      <Save className="h-4 w-4" /> {budget.id ? "Update" : "Save"} Budget
                    </Button>
                    {budget.id && (
                      <Button size="sm" variant="destructive" onClick={() => deleteBudgetMut.mutate()} disabled={deleteBudgetMut.isPending}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </Button>
                    )}
                    <Badge variant={budget.id ? "default" : "outline"} className="ml-auto">
                      {budget.id ? "Persisted" : "Local only"}
                    </Badge>
                  </div>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-4">Select category and period</p>
              )}
            </CardContent>
          </Card>
          {budgetChartData.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Budget vs Actual Comparison</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={budgetChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis />
                    <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                    <Legend />
                    <Bar dataKey="budget" fill="#22c55e" name="Budget" />
                    <Bar dataKey="actual" fill="#3b82f6" name="Actual" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top 10 by Value</CardTitle></CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No cost data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis />
                  <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                  <Bar dataKey="value" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Value by Category</CardTitle></CardHeader>
          <CardContent>
            {catPieData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No category data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={catPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                    {catPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Cost Details</CardTitle>
            <div className="relative w-44">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="max-h-[400px] overflow-y-auto">
          {sorted.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No materials found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Stock Qty</TableHead>
                  <TableHead>Turnover</TableHead>
                  <TableHead>Stock Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((item) => (
                  <TableRow key={item.material_id}>
                    <TableCell className="font-medium">{item.material_name}</TableCell>
                    <TableCell className="font-mono">{item.sku}</TableCell>
                    <TableCell>{item.quantity.toFixed(0)}</TableCell>
                    <TableCell>{item.turnover.toFixed(2)}</TableCell>
                    <TableCell>{formatCurrency(item.quantity * item.turnover)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
