import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getTransactions, getWarehouses, exportReportCsv, getTxTypeSummary, getTxByUser, getDailyTrend, getTxDateComparison } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Select } from "../../components/ui/select"
import { Label } from "../../components/ui/label"
import { formatDate, formatCurrency } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts"
import { FileDown, TrendingUp, TrendingDown, ArrowUpDown } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#a855f7"]

export default function TransactionReportPage() {
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [warehouseFilter, setWarehouseFilter] = useState("")
  const [dateStart, setDateStart] = useState("")
  const [dateEnd, setDateEnd] = useState("")
  const [comparisonAStart, setComparisonAStart] = useState("")
  const [comparisonAEnd, setComparisonAEnd] = useState("")
  const [comparisonBStart, setComparisonBStart] = useState("")
  const [comparisonBEnd, setComparisonBEnd] = useState("")
  const [userDateStart, setUserDateStart] = useState("")
  const [userDateEnd, setUserDateEnd] = useState("")

  const { data: transactions, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["transactions", "report", typeFilter, statusFilter, warehouseFilter, dateStart, dateEnd],
    queryFn: () => getTransactions(undefined, typeFilter !== "all" ? typeFilter : undefined, statusFilter !== "all" ? statusFilter : undefined, warehouseFilter || undefined, dateStart || undefined, dateEnd || undefined),
  })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: txTypes } = useQuery({ queryKey: ["tx_type_summary"], queryFn: getTxTypeSummary })
  const { data: dailyTrend } = useQuery({ queryKey: ["daily_trend", dateStart, dateEnd], queryFn: () => getDailyTrend(dateStart || "2000-01-01", dateEnd || "2099-12-31"), enabled: !!dateStart && !!dateEnd })
  const { data: byUser } = useQuery({ queryKey: ["tx_by_user", userDateStart, userDateEnd], queryFn: () => getTxByUser(userDateStart || undefined, userDateEnd || undefined) })
  const { data: comparison } = useQuery({ queryKey: ["tx_comparison", comparisonAStart, comparisonAEnd, comparisonBStart, comparisonBEnd], queryFn: () => getTxDateComparison(comparisonAStart, comparisonAEnd, comparisonBStart, comparisonBEnd), enabled: !!comparisonAStart && !!comparisonAEnd && !!comparisonBStart && !!comparisonBEnd })

  const totalIn = transactions?.filter((t) => t.type === "in").reduce((s, t) => s + t.quantity, 0) || 0
  const totalOut = transactions?.filter((t) => t.type === "out").reduce((s, t) => s + t.quantity, 0) || 0

  const seriesA = comparison?.filter((d) => d.date.startsWith("A_")) || []
  const seriesB = comparison?.filter((d) => d.date.startsWith("B_")) || []

  const handleCsv = async () => { try { const csv = await exportReportCsv("transaction_details"); const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a"); const suffix = dateStart || dateEnd ? "_" + (dateStart || "any") + "_" + (dateEnd || "any") : ""; a.href = URL.createObjectURL(blob); a.download = "transaction_report" + suffix + ".csv"; a.click(); toast({ title: "Exported" }) } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) } }

  if (isLoading) return <LoadingState text="Loading transaction report..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Transaction Report</h1>
        <Button variant="outline" onClick={handleCsv}><FileDown className="h-4 w-4" /> Export CSV</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Incoming</CardTitle><TrendingUp className="h-5 w-5 text-green-600" /></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{totalIn.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Outgoing</CardTitle><TrendingDown className="h-5 w-5 text-red-600" /></CardHeader><CardContent><div className="text-2xl font-bold text-red-600">{totalOut.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Value</CardTitle><ArrowUpDown className="h-5 w-5 text-blue-600" /></CardHeader><CardContent><div className="text-2xl font-bold">{transactions ? formatCurrency(transactions.reduce((s, t) => s + t.quantity * t.price, 0)) : "0"}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total TX</CardTitle><FileDown className="h-5 w-5 text-purple-600" /></CardHeader><CardContent><div className="text-2xl font-bold">{transactions?.length || 0}</div></CardContent></Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Pie Chart by Type */}
        <Card>
          <CardHeader><CardTitle>Transaction Type Distribution</CardTitle></CardHeader>
          <CardContent>
            {txTypes && txTypes.length > 0 ? <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={txTypes} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>{(txTypes || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>
            : <p className="text-center text-muted-foreground py-8">No data</p>}
          </CardContent>
        </Card>

        {/* Group by User */}
        <Card>
          <CardHeader>
            <CardTitle>Transactions by User</CardTitle>
            <div className="flex gap-2"><Input type="date" value={userDateStart} onChange={(e) => setUserDateStart(e.target.value)} className="w-32" /><Input type="date" value={userDateEnd} onChange={(e) => setUserDateEnd(e.target.value)} className="w-32" /></div>
          </CardHeader>
          <CardContent className="max-h-60 overflow-y-auto">
            {byUser && byUser.length > 0 ? <Table><TableHeader><TableRow><TableHead>User</TableHead><TableHead>Count</TableHead><TableHead>Value</TableHead></TableRow></TableHeader>
              <TableBody>{byUser.map((u) => <TableRow key={u.user_id}><TableCell>{u.user_name}</TableCell><TableCell>{u.total_count}</TableCell><TableCell>{formatCurrency(u.total_value)}</TableCell></TableRow>)}</TableBody></Table>
            : <p className="text-center text-muted-foreground py-4">No data</p>}
          </CardContent>
        </Card>
      </div>

      {/* Daily Trend */}
      {(dateStart && dateEnd) && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Transaction Trend</CardTitle>
            <div className="flex gap-2 items-center">
              <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-36" />
              <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-36" />
            </div>
          </CardHeader>
          <CardContent>
            {dailyTrend && dailyTrend.length > 0 ? <ResponsiveContainer width="100%" height={300}><LineChart data={dailyTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" fontSize={10} /><YAxis /><Tooltip /><Line type="monotone" dataKey="count" stroke="#3b82f6" name="Transactions" /><Line type="monotone" dataKey="value" stroke="#22c55e" name="Value" /></LineChart></ResponsiveContainer>
            : <p className="text-center text-muted-foreground py-4">Select date range to view trend</p>}
          </CardContent>
        </Card>
      )}

      {/* Date Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Period Comparison</CardTitle>
          <div className="flex gap-2 flex-wrap items-end">
            <div><Label className="text-xs">Period A From</Label><Input type="date" value={comparisonAStart} onChange={(e) => setComparisonAStart(e.target.value)} className="w-32" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={comparisonAEnd} onChange={(e) => setComparisonAEnd(e.target.value)} className="w-32" /></div>
            <div><Label className="text-xs">Period B From</Label><Input type="date" value={comparisonBStart} onChange={(e) => setComparisonBStart(e.target.value)} className="w-32" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={comparisonBEnd} onChange={(e) => setComparisonBEnd(e.target.value)} className="w-32" /></div>
          </div>
        </CardHeader>
        <CardContent>
          {comparison && comparison.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[
                { name: "Period A", count: seriesA.reduce((s, d) => s + d.count, 0), value: seriesA.reduce((s, d) => s + d.value, 0) },
                { name: "Period B", count: seriesB.reduce((s, d) => s + d.count, 0), value: seriesB.reduce((s, d) => s + d.value, 0) },
              ]}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Legend />
                <Bar dataKey="count" fill="#3b82f6" name="Count" />
                <Bar dataKey="value" fill="#22c55e" name="Value" />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-muted-foreground py-4">Select two periods to compare</p>}
        </CardContent>
      </Card>

      {/* Filter + Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Transactions</CardTitle>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="space-y-1"><Label className="text-xs">Type</Label><Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="max-w-[140px]"><option value="all">All Types</option><option value="in">Incoming</option><option value="out">Outgoing</option><option value="transfer">Transfer</option><option value="opname">Opname</option></Select></div>
            <div className="space-y-1"><Label className="text-xs">Status</Label><Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[140px]"><option value="all">All Status</option><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option></Select></div>
            <div className="space-y-1"><Label className="text-xs">Warehouse</Label><Select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className="max-w-[140px]"><option value="">All</option>{warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
            <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-36" /></div>
            <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-36" /></div>
          </div>
        </CardHeader>
        <CardContent className="max-h-80 overflow-y-auto">
          {transactions?.length === 0 ? <p className="text-center text-muted-foreground py-8">No transactions found</p>
          : <Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Type</TableHead><TableHead>Warehouse</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead><TableHead>Reference</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>{transactions?.map((tx) => (<TableRow key={tx.id}><TableCell className="font-mono text-xs">{tx.transaction_number}</TableCell><TableCell><Badge variant={tx.type === "in" ? "default" : tx.type === "out" ? "destructive" : "secondary"}>{tx.type.toUpperCase()}</Badge></TableCell><TableCell className="text-xs">{warehouses?.find((w) => w.id === tx.warehouse_id)?.name || "-"}</TableCell><TableCell className={tx.type === "in" ? "text-green-600 font-medium" : "text-red-600 font-medium"}>{tx.type === "in" ? "+" : "-"}{tx.quantity}</TableCell><TableCell><Badge variant={tx.status === "approved" ? "default" : tx.status === "pending" ? "secondary" : "destructive"}>{tx.status || "approved"}</Badge></TableCell><TableCell className="text-xs">{tx.reference || "-"}</TableCell><TableCell className="text-xs">{formatDate(tx.created_at)}</TableCell></TableRow>))}</TableBody></Table>}
          <p className="text-sm text-muted-foreground mt-2">{transactions?.length || 0} transaction(s)</p>
        </CardContent>
      </Card>

      {/* Filter for trend - also show date inputs without trend card */}
      {(!dateStart || !dateEnd) && (
        <Card>
          <CardHeader><CardTitle>Daily Trend</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 items-end">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-36" /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-36" /></div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
