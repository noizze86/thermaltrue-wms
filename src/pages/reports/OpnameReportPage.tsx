import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getStockOpnames, getStockOpnameItems, getWarehouses, getMaterials, exportOpnameXlsx, generateReportPdf, getOpnameVariance, approveOpnameAdjustment } from "../../api"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { formatDate } from "../../lib/utils"
import { Button } from "../../components/ui/button"
import { toast } from "../../hooks/use-toast"
import { useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { FileDown, FileText, AlertTriangle, CheckCircle2, ClipboardCheck, ThumbsUp, ThumbsDown, BarChart3, Search } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { useNavigate } from "react-router-dom"

export default function OpnameReportPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: opnames, isLoading, isError, error, refetch } = useQuery({ queryKey: ["stock_opnames"], queryFn: getStockOpnames })
  const { data: items } = useQuery({ queryKey: ["opname_items", selectedId], queryFn: () => getStockOpnameItems(selectedId!), enabled: !!selectedId })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: materials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: variance } = useQuery({ queryKey: ["opname_variance", selectedId], queryFn: () => getOpnameVariance(selectedId!), enabled: !!selectedId })

  const completed = opnames?.filter((so) => so.status === "completed") || []
  const allItems = items || []

  const discrepancies = allItems.filter((i) => i.difference !== 0)
  const totalDiscrepancy = discrepancies.reduce((s, i) => s + Math.abs(i.difference), 0)
  const discrepancyCount = discrepancies.length
  const matchedCount = allItems.length - discrepancyCount

  const varianceChartData = (variance || []).map((v) => ({
    name: v.category.length > 12 ? v.category.slice(0, 12) + "..." : v.category,
    diff: Math.round(v.total_diff),
  }))

  const exportXlsx = async (id: string) => {
    try {
      const data = await exportOpnameXlsx(id)
      const blob = new Blob([new Uint8Array(data)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `opname_${id.slice(0, 8)}.xlsx`; a.click(); URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "XLSX downloaded" })
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  const exportFormalPdf = async (id: string) => {
    try {
      const data = await generateReportPdf("opname")
      const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" })
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `opname_${id.slice(0, 8)}.pdf`; a.click(); URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Formal PDF downloaded" })
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  const handleApprove = async (id: string, approved: boolean) => {
    try {
      await approveOpnameAdjustment(id, approved)
      toast({ title: approved ? "Approved" : "Rejected", description: `Opname ${approved ? "approved" : "rejected"} successfully` })
      queryClient.invalidateQueries({ queryKey: ["stock_opnames"] })
      if (selectedId === id) setSelectedId(null)
    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
  }

  if (isLoading) return <LoadingState text="Loading..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Stock Opname Report</h1>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Completed</CardTitle><ClipboardCheck className="h-5 w-5 text-green-600" /></CardHeader><CardContent><div className="text-2xl font-bold">{completed.length}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Items Counted</CardTitle><CheckCircle2 className="h-5 w-5 text-blue-600" /></CardHeader><CardContent><div className="text-2xl font-bold">{completed.reduce((s) => s + 1, 0)}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Discrepancy</CardTitle><AlertTriangle className="h-5 w-5 text-red-600" /></CardHeader><CardContent><div className="text-2xl font-bold text-red-600">{totalDiscrepancy}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Affected Items</CardTitle><BarChart3 className="h-5 w-5 text-orange-600" /></CardHeader><CardContent><div className="text-2xl font-bold text-orange-600">{discrepancyCount}</div></CardContent></Card>
      </div>

      {selectedId && varianceChartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Variance by Category</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={varianceChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis />
                <Tooltip formatter={(v: unknown) => Number(v).toFixed(0)} />
                <Bar dataKey="diff" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Completed Opnames</CardTitle></CardHeader>
        <CardContent>
          {completed.length === 0 ? <p className="text-center text-muted-foreground py-8">No completed opnames found</p>
          : <Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Warehouse</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>{completed.map((so) => (<TableRow key={so.id}><TableCell className="font-mono">{so.opname_number}</TableCell><TableCell>{warehouses?.find((w) => w.id === so.warehouse_id)?.name || "-"}</TableCell><TableCell><Badge variant="default">Completed</Badge></TableCell><TableCell>{formatDate(so.created_at)}</TableCell>
              <TableCell><div className="flex gap-1 flex-wrap"><Button variant="outline" size="sm" onClick={() => setSelectedId(selectedId === so.id ? null : so.id)}>{selectedId === so.id ? "Hide" : "Details"}</Button><Button variant="outline" size="sm" onClick={() => exportXlsx(so.id)}><FileDown className="h-3 w-3" /></Button><Button variant="outline" size="sm" onClick={() => exportFormalPdf(so.id)}><FileText className="h-3 w-3" /></Button></div></TableCell></TableRow>))}</TableBody></Table>}
        </CardContent>
      </Card>

      {selectedId && items && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-4">
                <CardTitle>Opname Items</CardTitle>
                <Badge variant="outline" className="text-green-600">{matchedCount} matched</Badge>
                <Badge variant="outline" className="text-red-600">{discrepancyCount} discrepancies</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate(`/reports/variance/${selectedId}`)}><Search className="h-4 w-4" /> Root Cause</Button>
                <Button variant="outline" size="sm" onClick={() => handleApprove(selectedId, true)} className="text-green-600"><ThumbsUp className="h-4 w-4" /> Approve</Button>
                <Button variant="outline" size="sm" onClick={() => handleApprove(selectedId, false)} className="text-red-600"><ThumbsDown className="h-4 w-4" /> Reject</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? <p className="text-center text-muted-foreground py-4">No items found</p>
            : <Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead>System</TableHead><TableHead>Physical</TableHead><TableHead>Difference</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
              <TableBody>{items.map((item) => (<TableRow key={item.id} className={item.difference !== 0 ? "bg-red-50 dark:bg-red-950/20" : ""}><TableCell>{materials?.find((m) => m.id === item.material_id)?.name || "-"}</TableCell><TableCell>{item.system_qty}</TableCell><TableCell>{item.physical_qty}</TableCell><TableCell className={item.difference !== 0 ? "text-red-600 font-bold" : "text-green-600"}>{item.difference > 0 ? "+" : ""}{item.difference}</TableCell><TableCell>{item.notes || "-"}</TableCell></TableRow>))}</TableBody></Table>}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
