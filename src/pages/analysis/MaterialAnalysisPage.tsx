import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { getTransactions, getAnalysisAll, getSupplierPrices, getSuppliers } from "../../api"
import { Input } from "../../components/ui/input"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Select } from "../../components/ui/select"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from "recharts"
import { Search } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

export default function MaterialAnalysisPage() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sortBy, setSortBy] = useState<"days_since_last" | "turnover" | "name">("days_since_last")
  const [selectedMaterialId, setSelectedMaterialId] = useState("")
  const [movementFilter, setMovementFilter] = useState<"all" | "slow" | "fast">("all")

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: items, isLoading, isError, error, refetch } = useQuery({ queryKey: ["analysis"], queryFn: () => getAnalysisAll() })
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => getSuppliers() })
  const { data: txs } = useQuery({
    queryKey: ["transactions", selectedMaterialId],
    queryFn: () => getTransactions(undefined, undefined, selectedMaterialId),
    enabled: !!selectedMaterialId,
  })
  // Purchase prices for price trend overlay
  const { data: supplierPrices } = useQuery({
    queryKey: ["supplierPricesMaterial", selectedMaterialId],
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

  const movementFiltered = useMemo(() => {
    if (!items) return []
    return items.filter((i) => {
      if (movementFilter === "slow") return i.turnover < 1
      if (movementFilter === "fast") return i.turnover > 6
      return true
    })
  }, [items, movementFilter])

  const filtered = movementFiltered.filter((i) => {
    if (!debouncedSearch) return true
    const q = debouncedSearch.toLowerCase()
    return i.material_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "name") return a.material_name.localeCompare(b.material_name)
    if (sortBy === "turnover") return b.turnover - a.turnover
    return b.days_since_last - a.days_since_last
  })

  const trendChartData = useMemo(() => {
    if (!txs || txs.length === 0) return []
    const daily: Record<string, number> = {}
    const priceByDate: Record<string, number> = {}
    for (const tx of txs) {
      const date = tx.created_at.slice(0, 10)
      const sign = tx.type === "in" ? 1 : -1
      daily[date] = (daily[date] || 0) + sign * tx.quantity
      // Track purchase price for "in" transactions
      if (tx.type === "in" && tx.price > 0) priceByDate[date] = tx.price
    }
    // Also add supplier prices
    if (supplierPrices) {
      for (const sp of supplierPrices) {
        const date = sp.date.slice(0, 10)
        if (!priceByDate[date] || sp.date > date) priceByDate[date] = sp.price
      }
    }
    const entries = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))
    const raw = entries.map(([date, netQty]) => ({ date, qty: netQty, price: priceByDate[date] || null }))
    return raw.map((d, i) => {
      const window7 = raw.slice(Math.max(0, i - 6), i + 1)
      const window30 = raw.slice(Math.max(0, i - 29), i + 1)
      const ma7 = window7.reduce((s, x) => s + x.qty, 0) / window7.length
      const ma30 = window30.reduce((s, x) => s + x.qty, 0) / window30.length
      return {
        date: d.date,
        qty: Math.round(d.qty * 100) / 100,
        ma7: Math.round(ma7 * 100) / 100,
        ma30: Math.round(ma30 * 100) / 100,
        price: d.price,
      }
    })
  }, [txs, supplierPrices])

  const deadStock = filtered.filter((i) => i.days_since_last > 90)
  const slowMoving = filtered.filter((i) => i.days_since_last > 30 && i.days_since_last <= 90)

  const turnoverChartData = [...filtered]
    .sort((a, b) => {
      const itrA = a.quantity > 0 ? a.consumption_12mo / a.quantity : 0
      const itrB = b.quantity > 0 ? b.consumption_12mo / b.quantity : 0
      return itrB - itrA
    })
    .slice(0, 10)
    .map((i) => ({
      name: i.material_name.length > 12 ? i.material_name.slice(0, 12) + "..." : i.material_name,
      itr: Math.round((i.quantity > 0 ? i.consumption_12mo / i.quantity : 0) * 100) / 100,
    }))

  if (isLoading) return <LoadingState text="Loading material analysis..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Material Analysis</h1>

      <div className="grid gap-6 md:grid-cols-4">
        <Card className="border-red-200">
          <CardHeader><CardTitle className="text-red-600 dark:text-red-400">Dead Stock (&gt;90 days)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">{deadStock.length}</div>
            <p className="text-sm text-muted-foreground">materials</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-200">
          <CardHeader><CardTitle className="text-yellow-600 dark:text-yellow-400">Slow Moving (30-90 days)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{slowMoving.length}</div>
            <p className="text-sm text-muted-foreground">materials</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200 dark:border-gray-700">
          <CardHeader><CardTitle className="text-gray-600 dark:text-gray-400">Total Materials</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{filtered.length}</div>
            <p className="text-sm text-muted-foreground">materials (filtered)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Avg Days Since Tx</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{filtered.length > 0 ? Math.round(filtered.reduce((s, i) => s + i.days_since_last, 0) / filtered.length) : 0}</div>
            <p className="text-sm text-muted-foreground">days avg</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Transaction Trend</CardTitle>
            <Select
              value={selectedMaterialId}
              onChange={(e) => setSelectedMaterialId(e.target.value)}
              className="max-w-[250px]"
            >
              <option value="">-- Select Material --</option>
              {(items || []).map((i) => (
                <option key={i.material_id} value={i.material_id}>
                  {i.material_name} ({i.sku})
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedMaterialId ? (
            <p className="text-center text-muted-foreground py-8">Select a material to view transaction trend</p>
          ) : trendChartData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No transactions found for this material</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={10} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="qty" stroke="#3b82f6" name="Net Qty" dot={false} />
                <Line type="monotone" dataKey="ma7" stroke="#f59e0b" name="MA-7" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="ma30" stroke="#ef4444" name="MA-30" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="price" stroke="#22c55e" name="Purchase Price" dot strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top 10 by ITR (Inventory Turnover)</CardTitle></CardHeader>
        <CardContent>
          {turnoverChartData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No data available</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={turnoverChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="itr" fill="#a855f7" name="ITR" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>All Material Analysis</CardTitle>
            <div className="flex gap-2 items-center flex-wrap">
              <div className="flex border rounded-md overflow-hidden">
                <Button
                  variant={movementFilter === "all" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setMovementFilter("all")}
                >
                  All
                </Button>
                <Button
                  variant={movementFilter === "slow" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setMovementFilter("slow")}
                >
                  Slow (&lt;1/yr)
                </Button>
                <Button
                  variant={movementFilter === "fast" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setMovementFilter("fast")}
                >
                  Fast (&gt;6/yr)
                </Button>
              </div>
              <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="max-w-[160px]">
                <option value="days_since_last">Days Since Last Tx</option>
                <option value="turnover">Turnover</option>
                <option value="name">Name</option>
              </Select>
              <div className="relative w-56">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search by name or SKU..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No materials match your search</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Days Since Transaction</TableHead>
                  <TableHead>ITR</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((item) => {
                  const itr = item.quantity > 0 ? item.consumption_12mo / item.quantity : 0
                  let badgeVariant: "success" | "warning" | "destructive" = "success"
                  let label = "Active"
                  if (item.days_since_last > 90) { badgeVariant = "destructive"; label = "Dead Stock" }
                  else if (item.days_since_last > 30) { badgeVariant = "warning"; label = "Slow Moving" }
                  return (
                    <TableRow key={item.material_id}>
                      <TableCell className="font-mono">{item.sku}</TableCell>
                      <TableCell className="font-medium">{item.material_name}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.days_since_last > 999 ? "Never" : `${item.days_since_last} days`}</TableCell>
                      <TableCell>{itr.toFixed(2)}</TableCell>
                      <TableCell><Badge variant={badgeVariant}>{label}</Badge></TableCell>
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
