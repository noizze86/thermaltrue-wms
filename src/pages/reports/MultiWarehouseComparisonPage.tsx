import { useQuery } from "@tanstack/react-query"
import { getMultiWarehouseComparison, type WarehouseComparisonItem } from "../../api"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { formatCurrency } from "../../lib/utils"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { Warehouse, ArrowLeft } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { Button } from "../../components/ui/button"
import { useNavigate } from "react-router-dom"

export default function MultiWarehouseComparisonPage() {
  const navigate = useNavigate()
  const { data: comp, isLoading, isError, error, refetch } = useQuery({ queryKey: ["multi_warehouse_comparison"], queryFn: getMultiWarehouseComparison })

  const chartData = (comp || []).map((w: WarehouseComparisonItem) => ({
    name: w.name.length > 12 ? w.name.slice(0, 12) + "..." : w.name,
    "Materials": w.material_count,
    "Racks": w.rack_count,
    "TX (30d)": w.tx_30d,
  }))

  const valueData = (comp || []).map((w: WarehouseComparisonItem) => ({
    name: w.name.length > 12 ? w.name.slice(0, 12) + "..." : w.name,
    "Stock Value": Math.round(w.stock_value / 1000),
    "Inbound (30d)": Math.round(w.inbound_30d / 10),
    "Outbound (30d)": Math.round(w.outbound_30d / 10),
  }))

  if (isLoading) return <LoadingState text="Loading..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/reports/summary")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Warehouse className="h-8 w-8" /> Multi-Warehouse Comparison</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Inventory & Activity by Warehouse</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="Materials" fill="#3b82f6" />
                <Bar dataKey="Racks" fill="#22c55e" />
                <Bar dataKey="TX (30d)" fill="#eab308" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Value & Flow (K)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={valueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="Stock Value" fill="#a855f7" />
                <Bar dataKey="Inbound (30d)" fill="#06b6d4" />
                <Bar dataKey="Outbound (30d)" fill="#f97316" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Detailed Comparison</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warehouse</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Materials</TableHead>
                <TableHead>Racks</TableHead>
                <TableHead>Stock Value</TableHead>
                <TableHead>TX (30d)</TableHead>
                <TableHead>Inbound (30d)</TableHead>
                <TableHead>Outbound (30d)</TableHead>
                <TableHead>Opname (90d)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(comp || []).length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No warehouses</TableCell></TableRow>
              ) : (comp || []).map((w: WarehouseComparisonItem) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell><Badge variant="outline">{w.code}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{w.location}</TableCell>
                  <TableCell className="font-bold">{w.material_count.toLocaleString()}</TableCell>
                  <TableCell>{w.rack_count.toLocaleString()}</TableCell>
                  <TableCell className="font-mono">{formatCurrency(w.stock_value)}</TableCell>
                  <TableCell><Badge>{w.tx_30d.toLocaleString()}</Badge></TableCell>
                  <TableCell className="text-green-600">{w.inbound_30d.toFixed(0)}</TableCell>
                  <TableCell className="text-red-600">{w.outbound_30d.toFixed(0)}</TableCell>
                  <TableCell>{w.opname_90d.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}