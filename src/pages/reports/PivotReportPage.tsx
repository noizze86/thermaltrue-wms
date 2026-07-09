import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getPivotReport } from "../../api"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Select } from "../../components/ui/select"
import { Label } from "../../components/ui/label"
import { ArrowLeft, RotateCcw } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { useNavigate } from "react-router-dom"

const ROW_FIELDS = [
  { value: "category", label: "Category" },
  { value: "warehouse", label: "Warehouse" },
  { value: "month", label: "Month" },
  { value: "type", label: "Type" },
  { value: "status", label: "Status" },
  { value: "user", label: "User" },
]
const COL_FIELDS = [
  { value: "type", label: "Transaction Type" },
  { value: "status", label: "Status" },
  { value: "month", label: "Month" },
  { value: "category", label: "Category" },
  { value: "user", label: "User" },
]
const VALUE_FIELDS = [
  { value: "quantity", label: "Quantity" },
  { value: "value", label: "Value (Qty × Price)" },
  { value: "count", label: "Count" },
]
const AGG_FUNCTIONS = ["SUM", "COUNT", "AVG", "MIN", "MAX"]

export default function PivotReportPage() {
  const navigate = useNavigate()
  const [rowField, setRowField] = useState("category")
  const [colField, setColField] = useState("type")
  const [valueField, setValueField] = useState("quantity")
  const [aggFunction, setAggFunction] = useState("SUM")
  const [dateStart, setDateStart] = useState("")
  const [dateEnd, setDateEnd] = useState("")

  const { data: pivot, isFetching, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["pivot_report", rowField, colField, valueField, aggFunction, dateStart, dateEnd],
    queryFn: () => getPivotReport(rowField, colField, valueField, aggFunction, dateStart || undefined, dateEnd || undefined),
  })

  const totalByRow = pivot?.data?.map((row) => {
    const rowKey = row.row as string
    let sum = 0
    for (const c of pivot.cols || []) {
      sum += (row[c] as number) || 0
    }
    return { row: rowKey, total: Math.round(sum * 100) / 100 }
  }) || []

  const grandTotal = totalByRow.reduce((s, r) => s + r.total, 0)

  if (isLoading) return <LoadingState text="Loading..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/reports/summary")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-3xl font-bold flex items-center gap-2"><RotateCcw className="h-8 w-8" /> Pivot Report</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Pivot Configuration</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Row Field</Label>
              <Select value={rowField} onChange={(e) => setRowField(e.target.value)}>
                {ROW_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Column Field</Label>
              <Select value={colField} onChange={(e) => setColField(e.target.value)}>
                {COL_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Value Field</Label>
              <Select value={valueField} onChange={(e) => setValueField(e.target.value)}>
                {VALUE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Aggregation</Label>
              <Select value={aggFunction} onChange={(e) => setAggFunction(e.target.value)}>
                {AGG_FUNCTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date From</Label>
              <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date To</Label>
              <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </div>
          </div>
          <Button onClick={() => refetch()} className="mt-4" disabled={isFetching}>
            {isFetching ? "Loading..." : "Generate Pivot"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Pivot: {ROW_FIELDS.find((f) => f.value === rowField)?.label} × {COL_FIELDS.find((f) => f.value === colField)?.label}
            <span className="text-sm font-normal text-muted-foreground ml-2">
              ({aggFunction} of {VALUE_FIELDS.find((f) => f.value === valueField)?.label})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!pivot || pivot.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No data. Click "Generate Pivot" above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold">{ROW_FIELDS.find((f) => f.value === rowField)?.label}</TableHead>
                  {(pivot.cols || []).map((c) => (
                    <TableHead key={c} className="text-right font-bold">{c}</TableHead>
                  ))}
                  <TableHead className="text-right font-bold">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pivot.data || []).map((row, i) => {
                  const rowKey = row.row as string
                  const rowTotal = totalByRow[i]?.total || 0
                  return (
                    <TableRow key={rowKey}>
                      <TableCell className="font-medium">{rowKey}</TableCell>
                      {(pivot.cols || []).map((c) => (
                        <TableCell key={c} className="text-right font-mono text-sm">
                          {(row[c] as number)?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || "0"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-bold font-mono">{rowTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <tfoot>
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>Grand Total</TableCell>
                  {(pivot.cols || []).map((c) => {
                    const colTotal = (pivot.data || []).reduce((s, row) => s + ((row[c] as number) || 0), 0)
                    return <TableCell key={c} className="text-right font-mono">{colTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  })}
                  <TableCell className="text-right font-mono">{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                </TableRow>
              </tfoot>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Aggregation: {aggFunction}. Rows: {ROW_FIELDS.find((f) => f.value === rowField)?.label}. Columns: {COL_FIELDS.find((f) => f.value === colField)?.label}. Value: {VALUE_FIELDS.find((f) => f.value === valueField)?.label}.
      </p>
    </div>
  )
}