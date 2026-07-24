import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { getMaterials, getCategories, getWarehouses, getExpiringMaterials, getAgingReport, getStockMovement, getCategoryValueSummary, exportReportCsv, generateReportPdf } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Select } from "../../components/ui/select"
import { Label } from "../../components/ui/label"
import { formatCurrency } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { useSearchParams } from "react-router-dom"
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts"
import { FileDown, FileText, Search, AlertTriangle, Clock, DollarSign, PieChart as PieChartIcon } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#a855f7", "#eab308", "#06b6d4", "#f97316", "#6366f1"]

export default function StockReportPage() {
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [warehouseFilter, setWarehouseFilter] = useState("")
  const [lowStockOnly, setLowStockOnly] = useState(searchParams.get("low") === "true")
  const [agingDays, setAgingDays] = useState("90")
  const [movementStart, setMovementStart] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10)
  })
  const [movementEnd, setMovementEnd] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: allMaterials, isLoading, isError, error, refetch } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => getCategories() })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: expiring } = useQuery({ queryKey: ["expiring", agingDays], queryFn: () => getExpiringMaterials(Number(agingDays)) })
  const { data: aging } = useQuery({ queryKey: ["aging_report"], queryFn: getAgingReport })
  const { data: movement } = useQuery({ queryKey: ["stock_movement", movementStart, movementEnd], queryFn: () => getStockMovement(movementStart, movementEnd) })
  const { data: catValue } = useQuery({ queryKey: ["cat_value_summary"], queryFn: getCategoryValueSummary })

  const materials = (allMaterials || [])
    .filter((m) => !debouncedSearch || m.name.toLowerCase().includes(debouncedSearch.toLowerCase()) || m.sku.toLowerCase().includes(debouncedSearch.toLowerCase()))
    .filter((m) => !categoryFilter || m.category_id === categoryFilter)
    .filter((m) => !warehouseFilter || m.warehouse_id === warehouseFilter)
    .filter((m) => !lowStockOnly || (m.quantity <= m.min_stock && m.min_stock > 0))

  const totalValue = allMaterials?.reduce((s, m) => s + m.quantity * m.price, 0) || 0
  const totalQty = allMaterials?.reduce((s, m) => s + m.quantity, 0) || 0
  const lowStockCount = allMaterials?.filter((m) => m.quantity <= m.min_stock && m.min_stock > 0).length || 0

  const handleCsv = async () => { try { const csv = await exportReportCsv("materials"); const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "stock_report.csv"; a.click(); URL.revokeObjectURL(url); toast({ title: "Exported" }) } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) } }
  const handlePdf = async () => { try { const data = await generateReportPdf("stock"); const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "stock_report.pdf"; a.click(); URL.revokeObjectURL(url); toast({ title: "Exported" }) } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) } }

  if (isLoading) return <LoadingState text="Loading stock report..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Stock Report</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCsv}><FileDown className="h-4 w-4" /> CSV</Button>
          <Button variant="outline" onClick={handlePdf}><FileText className="h-4 w-4" /> PDF</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Value</CardTitle><DollarSign className="h-5 w-5 text-emerald-600" /></CardHeader><CardContent><div className="text-2xl font-bold">{formatCurrency(totalValue)}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Quantity</CardTitle><PieChartIcon className="h-5 w-5 text-blue-600" /></CardHeader><CardContent><div className="text-2xl font-bold">{totalQty.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Low Stock</CardTitle><AlertTriangle className="h-5 w-5 text-red-600" /></CardHeader><CardContent><div className="text-2xl font-bold text-red-600">{lowStockCount}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Items</CardTitle><Search className="h-5 w-5 text-purple-600" /></CardHeader><CardContent><div className="text-2xl font-bold">{allMaterials?.length || 0}</div></CardContent></Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Category Pie Chart */}
        <Card>
          <CardHeader><CardTitle>Inventory Value by Category</CardTitle></CardHeader>
          <CardContent>
            {catValue && catValue.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={catValue} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {catValue.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: unknown) => formatCurrency(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground py-8">No data</p>}
          </CardContent>
        </Card>

        {/* Aging Report */}
        <Card>
          <CardHeader><CardTitle>Aging Report (Days Since Last Transaction)</CardTitle></CardHeader>
          <CardContent>
            {aging && aging.length > 0 ? (
              <div className="space-y-3">
                {aging.map((a) => (
                  <div key={a.bucket}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{a.bucket}</span>
                      <span className="font-medium">{a.count} items</span>
                    </div>
                    <div className="h-3 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${a.bucket.includes("90+") ? "bg-red-500" : a.bucket.includes("60") ? "bg-yellow-500" : "bg-blue-500"}`}
                        style={{ width: `${Math.min((a.count / Math.max(...aging.map((x) => x.count), 1)) * 100, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-center text-muted-foreground py-4">No data</p>}
          </CardContent>
        </Card>
      </div>

      {/* Stock Movement Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Stock Movement Summary</CardTitle>
            <div className="flex gap-2 items-center">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={movementStart} onChange={(e) => setMovementStart(e.target.value)} className="w-36" /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={movementEnd} onChange={(e) => setMovementEnd(e.target.value)} className="w-36" /></div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="max-h-80 overflow-y-auto">
          {movement && movement.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Opening</TableHead><TableHead>In</TableHead><TableHead>Out</TableHead><TableHead>Closing</TableHead></TableRow></TableHeader>
              <TableBody>
                {movement.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{m.material_name}</TableCell>
                    <TableCell>{m.opening}</TableCell>
                    <TableCell className="text-green-600 font-medium">{m.qty_in}</TableCell>
                    <TableCell className="text-red-600 font-medium">{m.qty_out}</TableCell>
                    <TableCell className="font-bold">{m.closing}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-center text-muted-foreground py-4">No movement data for this period</p>}
        </CardContent>
      </Card>

      {/* Expiring + Filter */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-orange-600" /> Expiring Materials</CardTitle>
            <Select value={agingDays} onChange={(e) => setAgingDays(e.target.value)} className="max-w-[160px]">
              <option value="30">Next 30 days</option><option value="60">Next 60 days</option><option value="90">Next 90 days</option><option value="180">Next 180 days</option>
            </Select>
          </CardHeader>
          <CardContent>
            {expiring && expiring.length > 0 ? <div className="space-y-1 max-h-48 overflow-y-auto">{expiring.map((m) => <div key={m.id} className="flex justify-between text-sm border-b pb-1"><span className="truncate">{m.sku} - {m.name}</span><span className="text-red-600 font-medium ml-2 shrink-0">{m.expiry_date}</span></div>)}</div>
            : <p className="text-sm text-muted-foreground text-center py-4">No expiring materials</p>}
          </CardContent>
        </Card>

        {/* Stock Table Filters */}
        <Card>
          <CardHeader><CardTitle>Stock Level Filters</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search by name or SKU..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">All Categories</option>{categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              <Select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}><option value="">All Warehouses</option>{warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
            </div>
            <Button variant={lowStockOnly ? "default" : "outline"} size="sm" onClick={() => setLowStockOnly(!lowStockOnly)}><AlertTriangle className="h-4 w-4" /> Low Stock Only</Button>
          </CardContent>
        </Card>
      </div>

      {/* Stock Table */}
      <Card>
        <CardContent>
          {materials.length === 0 ? <p className="text-center text-muted-foreground py-8">No materials match your filters</p>
          : <Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Warehouse</TableHead><TableHead>Quantity</TableHead><TableHead>Min Stock</TableHead><TableHead>Value</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{materials.map((m) => <TableRow key={m.id}><TableCell className="font-mono">{m.sku}</TableCell><TableCell className="font-medium">{m.name}</TableCell><TableCell>{m.category_name || m.category_id || "-"}</TableCell><TableCell>{warehouses?.find((w) => w.id === m.warehouse_id)?.name || "-"}</TableCell><TableCell>{m.quantity}</TableCell><TableCell>{m.min_stock}</TableCell><TableCell>{formatCurrency(m.quantity * m.price)}</TableCell><TableCell><Badge variant={m.quantity <= m.min_stock ? "destructive" : "default"}>{m.quantity <= m.min_stock ? "Low" : "OK"}</Badge></TableCell></TableRow>)}</TableBody></Table>}
          <p className="text-sm text-muted-foreground mt-2">{materials.length} material(s) shown</p>
        </CardContent>
      </Card>
    </div>
  )
}
