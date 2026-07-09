import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { useParams, useNavigate } from "react-router-dom"
import { getVarianceRootCause } from "../../api"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { ArrowLeft, Search, AlertTriangle } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"

const ROOT_CAUSE_COLORS: Record<string, string> = {
  "inbound_error": "#ef4444",
  "outbound_error": "#f97316",
  "misplacement": "#eab308",
  "counting_error": "#a855f7",
  "system_error": "#3b82f6",
  "theft_loss": "#dc2626",
  "damage": "#6b7280",
  "other": "#9ca3af",
}
const ROOT_CAUSE_LABELS: Record<string, string> = {
  inbound_error: "Inbound Error",
  outbound_error: "Outbound Error",
  misplacement: "Misplacement",
  counting_error: "Counting Error",
  system_error: "System Error",
  theft_loss: "Theft/Loss",
  damage: "Damage",
  other: "Other",
}

export default function VarianceRootCausePage() {
  const { opnameId } = useParams<{ opnameId: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!opnameId) navigate("/reports", { replace: true })
  }, [opnameId, navigate])

  const { data: items, isLoading } = useQuery({
    queryKey: ["variance_root_cause", opnameId],
    queryFn: () => getVarianceRootCause(opnameId!),
    enabled: !!opnameId,
  })

  const causeDistribution = (items || []).reduce<Record<string, { count: number; qty: number; value: number }>>((acc, i) => {
    const cause = (i.root_cause as string) || "other"
    if (!acc[cause]) acc[cause] = { count: 0, qty: 0, value: 0 }
    acc[cause].count++
    acc[cause].qty += (i.qty_diff as number) || 0
    acc[cause].value += (i.value_diff as number) || 0
    return acc
  }, {})

  const pieData = Object.entries(causeDistribution).map(([cause, vals]) => ({
    name: ROOT_CAUSE_LABELS[cause] || cause,
    value: Math.abs(vals.count),
    qty: Math.abs(vals.qty),
    color: ROOT_CAUSE_COLORS[cause] || "#9ca3af",
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/reports/opname")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Search className="h-8 w-8" /> Variance Root Cause Analysis</h1>
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading...</p>
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-2" />
            <p>No variance data found for this opname.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Root Cause Distribution (Count)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(({ name, percent }: Record<string, unknown>) => `${String(name ?? "")} ${(Number(percent ?? 0) * 100).toFixed(0)}%`) as never}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Quantity Variance by Cause</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={pieData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="qty" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Variance Items Detail</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>System Qty</TableHead>
                    <TableHead>Actual Qty</TableHead>
                    <TableHead>Qty Diff</TableHead>
                    <TableHead>Value Diff</TableHead>
                    <TableHead>Root Cause</TableHead>
                    <TableHead>Recommendation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(items || []).map((i, idx) => (
                    <TableRow key={i.material_id as string || idx}>
                      <TableCell className="font-medium">{i.material_name as string}</TableCell>
                      <TableCell><Badge variant="outline">{i.material_code as string}</Badge></TableCell>
                      <TableCell className="text-right">{(i.system_qty as number)?.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{(i.actual_qty as number)?.toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-mono font-bold ${(i.qty_diff as number) < 0 ? "text-red-600" : "text-green-600"}`}>
                        {(i.qty_diff as number)?.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${(i.value_diff as number) < 0 ? "text-red-600" : "text-green-600"}`}>
                        {(i.value_diff as number)?.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge style={{ backgroundColor: ROOT_CAUSE_COLORS[(i.root_cause as string) || "other"] + "22", color: ROOT_CAUSE_COLORS[(i.root_cause as string) || "other"] }}>
                          {ROOT_CAUSE_LABELS[(i.root_cause as string) || "other"] || (i.root_cause as string)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{i.recommendation as string}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}