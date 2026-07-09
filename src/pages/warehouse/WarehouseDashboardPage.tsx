import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getWarehouses, getMaterials, getRacks, getRackOccupancy, getDashboardKpi, getWarehouseStats, getPendingTransactions, getThroughputMetrics, getPickerActivity, getSlottingSuggestions, batchTransferRack } from "../../api"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Label } from "../../components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Warehouse, Package, Layers, BarChart3, AlertTriangle, ArrowLeftRight, Users, Move, Map as MapIcon } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { useNavigate } from "react-router-dom"
import { toast } from "../../hooks/use-toast"

export default function WarehouseDashboardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showBatchTransfer, setShowBatchTransfer] = useState(false)
  const [batchSourceRackId, setBatchSourceRackId] = useState("")
  const [batchDestWhId, setBatchDestWhId] = useState("")
  const [batchDestRackId, setBatchDestRackId] = useState("")

  const { data: warehouses, isLoading, isError, error, refetch } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: materials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: racks } = useQuery({ queryKey: ["racks"], queryFn: () => getRacks() })
  const { data: occupancy } = useQuery({ queryKey: ["rack_occupancy"], queryFn: getRackOccupancy })
  const { data: kpi } = useQuery({ queryKey: ["dashboard"], queryFn: getDashboardKpi })
  const { data: stats } = useQuery({ queryKey: ["warehouse_stats"], queryFn: getWarehouseStats })
  const { data: pendingTx } = useQuery({ queryKey: ["pending_tx"], queryFn: getPendingTransactions })
  const { data: throughput } = useQuery({ queryKey: ["throughput"], queryFn: getThroughputMetrics })
  const { data: pickerActivity } = useQuery({ queryKey: ["picker_activity"], queryFn: getPickerActivity })
  const { data: slotting } = useQuery({ queryKey: ["slotting"], queryFn: getSlottingSuggestions })

  const batchTransferMut = useMutation({
    mutationFn: () => batchTransferRack(batchSourceRackId, batchDestWhId, batchDestRackId || undefined),
    onSuccess: (msg) => {
      queryClient.invalidateQueries({ queryKey: ["materials"] })
      queryClient.invalidateQueries({ queryKey: ["rack_occupancy"] })
      setShowBatchTransfer(false)
      toast({ title: "Batch Transfer", description: msg })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const occMap = new Map((occupancy || []).map((o) => [o.rack_id, o]))
  const totalCapacity = (occupancy || []).reduce((s, o) => s + o.max_capacity, 0)
  const totalUsed = (occupancy || []).reduce((s, o) => s + o.total_quantity, 0)
  const overallUtilization = totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 100) : 0

  const lowStockMaterials = materials?.filter((m) => m.quantity <= m.min_stock && m.is_active) || []

  const getUtilizationClass = (pct: number) =>
    pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-yellow-500" : pct >= 40 ? "bg-green-500" : "bg-blue-400"

  if (isLoading) return <LoadingState text="Loading warehouse dashboard..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2"><BarChart3 className="h-8 w-8" /> Warehouse Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Warehouses</CardTitle>
            <Warehouse className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{warehouses?.length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Racks/Bins</CardTitle>
            <Layers className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{racks?.length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Materials in Stock</CardTitle>
            <Package className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpi?.total_materials || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Overall Utilization</CardTitle>
            <BarChart3 className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallUtilization}%</div>
            <div className="w-full h-2 rounded-full bg-muted mt-1 overflow-hidden">
              <div className={`h-full rounded-full ${getUtilizationClass(overallUtilization)}`} style={{ width: `${overallUtilization}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(throughput || []).map((tm) => (
          <Card key={tm.warehouse_id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{tm.warehouse_name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div><div className="text-lg font-bold text-green-600">{tm.in_qty}</div><div className="text-xs text-muted-foreground">IN</div></div>
                <div><div className="text-lg font-bold text-red-600">{tm.out_qty}</div><div className="text-xs text-muted-foreground">OUT</div></div>
                <div><div className="text-lg font-bold text-blue-600">{tm.tx_count}</div><div className="text-xs text-muted-foreground">Tx</div></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Low Stock Alerts ({lowStockMaterials.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lowStockMaterials.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">All materials have sufficient stock</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Qty</TableHead><TableHead>Min</TableHead><TableHead>Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {lowStockMaterials.slice(0, 10).map((m) => (
                    <TableRow key={m.id} className="cursor-pointer" onClick={() => navigate("/materials/stock")}>
                      <TableCell className="font-mono text-xs">{m.sku}</TableCell>
                      <TableCell>{m.name}</TableCell>
                      <TableCell className="font-bold text-red-600">{m.quantity}</TableCell>
                      <TableCell>{m.min_stock}</TableCell>
                      <TableCell>
                        <Badge variant={m.quantity === 0 ? "destructive" : "secondary"}>
                          {m.quantity === 0 ? "Out of Stock" : "Low Stock"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {lowStockMaterials.length > 10 && (
              <p className="text-xs text-muted-foreground mt-2 text-center">+{lowStockMaterials.length - 10} more</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-yellow-600" />
              Pending Transfers ({pendingTx?.filter((t) => t.type === "transfer").length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(pendingTx?.filter((t) => t.type === "transfer") || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No pending transfers</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {pendingTx?.filter((t) => t.type === "transfer").slice(0, 5).map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs">{tx.transaction_number}</TableCell>
                      <TableCell>{tx.quantity}</TableCell>
                      <TableCell><Badge variant="secondary">pending</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              Today's Picker Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(!pickerActivity || pickerActivity.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">No activity today</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Picker</TableHead><TableHead>Picks</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {pickerActivity.slice(0, 10).map((pa, i) => (
                    <TableRow key={pa.user_id}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>{pa.user_name}</TableCell>
                      <TableCell className="font-bold">{pa.pick_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-purple-600" />
              Slotting Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(!slotting || slotting.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">No suggestions</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Material</TableHead><TableHead>Current</TableHead><TableHead>Suggested</TableHead><TableHead>Reason</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {slotting.slice(0, 10).map((s) => (
                    <TableRow key={s.material_id}>
                      <TableCell className="text-xs">{s.name}</TableCell>
                      <TableCell className="text-xs">{s.current_rack}</TableCell>
                      <TableCell className="text-xs">{s.suggested_rack}</TableCell>
                      <TableCell className="text-xs">{s.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {warehouses?.length === 0 ? (
        <Card>
          <CardContent><p className="text-center text-muted-foreground py-8">No warehouses configured</p></CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {warehouses?.map((wh) => {
            const whMaterials = materials?.filter((m) => m.warehouse_id === wh.id) || []
            const whRacks = racks?.filter((r) => r.warehouse_id === wh.id) || []
            const whOccupancy = whRacks.map((r) => occMap.get(r.id)).filter(Boolean)
            const whTotalCap = whOccupancy.reduce((s, o) => s! + (o?.max_capacity || 0), 0)
            const whTotalUsed = whOccupancy.reduce((s, o) => s! + (o?.total_quantity || 0), 0)
            const whUtil = whTotalCap > 0 ? Math.round((whTotalUsed / whTotalCap) * 100) : 0

            return (
              <Card key={wh.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {wh.name}
                    <Badge variant={wh.is_active ? "default" : "secondary"}>{wh.code}</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{wh.location || "-"}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div><span className="text-muted-foreground">Materials:</span> <strong>{whMaterials.length}</strong></div>
                    <div><span className="text-muted-foreground">Racks:</span> <strong>{whRacks.length}</strong></div>
                    <div>
                      <span className="text-muted-foreground">Util:</span>
                      <strong className={whUtil >= 90 ? "text-red-600" : whUtil >= 70 ? "text-yellow-600" : "text-green-600"}>
                        {" "}{whUtil}%
                      </strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-sm">
                    {stats?.filter((s) => s.id === wh.id).map((s) => (
                      <div key={s.id} className="bg-muted/30 rounded p-2 text-center col-span-3 grid grid-cols-3">
                        <div><div className="text-lg font-bold">{s.rack_count}</div><div className="text-xs text-muted-foreground">Racks</div></div>
                        <div><div className="text-lg font-bold">{s.material_count}</div><div className="text-xs text-muted-foreground">Materials</div></div>
                        <div><div className="text-lg font-bold">{s.used_capacity.toFixed(0)}</div><div className="text-xs text-muted-foreground">Used Cap</div></div>
                      </div>
                    ))}
                  </div>

                  {whRacks.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium flex items-center gap-1"><MapIcon className="h-4 w-4" /> 2D Rack Map</p>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setBatchSourceRackId(""); setBatchDestWhId(""); setShowBatchTransfer(true) }}>
                          <Move className="h-3 w-3" /> Batch Transfer
                        </Button>
                      </div>
                      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
                        {whRacks.map((r) => {
                          const occ = occMap.get(r.id)
                          const pct = occ && occ.max_capacity > 0
                            ? Math.min(100, Math.round((occ.total_quantity / occ.max_capacity) * 100))
                            : 0
                          return (
                            <div
                              key={r.id}
                              className={`flex flex-col items-center p-1.5 rounded-md border cursor-pointer transition-all hover:scale-105 ${getUtilizationClass(pct)} text-white`}
                              title={`${r.rack_name}: ${pct}% (${occ?.total_quantity || 0}/${occ?.max_capacity || 0})`}
                              onClick={() => {
                                setBatchSourceRackId(r.id)
                                setBatchDestWhId("")
                                setShowBatchTransfer(true)
                              }}
                            >
                              <span className="text-[10px] font-bold leading-tight text-center">{r.rack_name}</span>
                              <span className="text-[9px] opacity-90">{pct}%</span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-400 inline-block" /> Low (&lt;40%)</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Good</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500 inline-block" /> Warning (&ge;70%)</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-destructive inline-block" /> Critical (&ge;90%)</span>
                      </div>
                    </div>
                  )}

                  {whMaterials.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>SKU</TableHead><TableHead>Material</TableHead><TableHead>Qty</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {whMaterials.slice(0, 5).map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="font-mono text-xs">{m.sku}</TableCell>
                            <TableCell className="text-sm">{m.name}</TableCell>
                            <TableCell>{m.quantity}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {whMaterials.length > 5 && (
                    <p className="text-xs text-muted-foreground">+{whMaterials.length - 5} more materials</p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      <Dialog open={showBatchTransfer} onOpenChange={setShowBatchTransfer}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Move className="h-5 w-5" /> Batch Rack Transfer</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Transfer all materials from source rack to destination warehouse</p>
            <div className="space-y-2">
              <Label>Source Rack</Label>
              <select value={batchSourceRackId} onChange={(e) => setBatchSourceRackId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="">Select source rack...</option>
                {racks?.map((r) => {
                  const wh = warehouses?.find((w) => w.id === r.warehouse_id)
                  return <option key={r.id} value={r.id}>{wh?.name || "?"} - {r.rack_name}</option>
                })}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Destination Warehouse</Label>
              <select value={batchDestWhId} onChange={(e) => setBatchDestWhId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="">Select destination warehouse...</option>
                {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Destination Rack (optional)</Label>
              <select value={batchDestRackId} onChange={(e) => setBatchDestRackId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="">Select destination rack...</option>
                {racks?.filter((r) => r.warehouse_id === batchDestWhId).map((r) => (
                  <option key={r.id} value={r.id}>{r.rack_name}</option>
                ))}
              </select>
            </div>
            <Button onClick={() => batchTransferMut.mutate()} className="w-full" disabled={!batchSourceRackId || !batchDestWhId || batchTransferMut.isPending}>
              <Move className="h-4 w-4" /> Execute Batch Transfer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
