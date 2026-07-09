import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getMaterials, getWarehouses, getRacks, transferMaterial, transferMaterialsBulk, suggestPutaway, getTransferOrders, createTransferOrder, updateTransferOrderStatus, getTransferItems } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Label } from "../../components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Badge } from "../../components/ui/badge"
import { Select } from "../../components/ui/select"
import { ArrowLeftRight, Plus, Trash2, Lightbulb, Check, Send, RotateCcw, XCircle, ListOrdered, QrCode } from "lucide-react"
import { toast } from "../../hooks/use-toast"
import { formatDate } from "../../lib/utils"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

interface TransferItem {
  material_id: string
  from_warehouse_id: string
  to_warehouse_id: string
  quantity: number
  rack_id: string
}

const getBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
    draft: "secondary",
    submitted: "warning",
    in_transit: "default",
    received: "success",
    completed: "default",
    cancelled: "outline",
  }
  return map[status] || "default"
}

export default function TransferPage() {
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<"single" | "orders">("single")

  const [fromWh, setFromWh] = useState("")
  const [toWh, setToWh] = useState("")
  const [items, setItems] = useState<TransferItem[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [addMatId, setAddMatId] = useState("")
  const [addQty, setAddQty] = useState(0)
  const [addRackId, setAddRackId] = useState("")
  const [showSuggestion, setShowSuggestion] = useState(false)
  const [suggestionMatId, setSuggestionMatId] = useState("")

  const [showQrScanner, setShowQrScanner] = useState(false)
  const qrReaderRef = useRef<HTMLDivElement>(null)
  const qrScannerRef = useRef<any>(null)

  useEffect(() => {
    return () => { if (qrScannerRef.current) { try { qrScannerRef.current.stop().catch(() => {}) } catch {} } }
  }, [])

  const handleQrScan = (decodedText: string) => {
    try { if (qrScannerRef.current) qrScannerRef.current.stop().catch(() => {}); } catch {}
    setShowQrScanner(false)
    // Find transfer order by ID or transfer_number from QR content
    const order = transferOrders?.find((o) => o.id === decodedText || o.transfer_number === decodedText)
    if (order && order.status === "in_transit") {
      updateOrderMut.mutate({ id: order.id, status: "received" })
      toast({ title: "QR Received", description: `Transfer ${order.transfer_number} marked as received` })
    } else if (order) {
      toast({ title: "Info", description: `Order status is "${order.status}", cannot receive` })
    } else {
      toast({ title: "Not Found", description: "No matching transfer order found", variant: "destructive" })
    }
  }

  const startQrScanner = async () => {
    setShowQrScanner(true)
    setTimeout(async () => {
      if (!qrReaderRef.current) return
      try {
        const { Html5Qrcode } = await import("html5-qrcode")
        const scanner = new Html5Qrcode("qr-reader")
        qrScannerRef.current = scanner
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          handleQrScan,
          () => {}
        )
      } catch (e) {
        toast({ title: "Scanner Error", description: String(e), variant: "destructive" })
        setShowQrScanner(false)
      }
    }, 300)
  }

  const [statusFilter, setStatusFilter] = useState("")
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null)
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [newOrderFrom, setNewOrderFrom] = useState("")
  const [newOrderTo, setNewOrderTo] = useState("")
  const [newOrderNotes, setNewOrderNotes] = useState("")
  const [newOrderItems, setNewOrderItems] = useState<{ material_id: string; quantity: number }[]>([])
  const [newOrderMatId, setNewOrderMatId] = useState("")
  const [newOrderQty, setNewOrderQty] = useState(0)

  const { data: materials, isLoading: matLoading, isError: matError, error: matErrorObj, refetch: matRefetch } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: warehouses, isLoading: whLoading, isError: whError, error: whErrorObj, refetch: whRefetch } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: racks } = useQuery({ queryKey: ["racks"], queryFn: () => getRacks() })
  const { data: putawayResult } = useQuery({
    queryKey: ["putaway_suggestion", toWh, suggestionMatId],
    queryFn: () => suggestPutaway(toWh, suggestionMatId),
    enabled: !!toWh && !!suggestionMatId && showSuggestion,
  })
  const { data: transferOrders } = useQuery({
    queryKey: ["transfer_orders", statusFilter],
    queryFn: () => getTransferOrders(statusFilter || undefined),
  })
  const { data: transferItems } = useQuery({
    queryKey: ["transfer_items", selectedOrder],
    queryFn: () => getTransferItems(selectedOrder!),
    enabled: !!selectedOrder,
  })

  const filteredMaterials = materials?.filter((m) => m.warehouse_id === fromWh)
  const filteredRacks = racks?.filter((r) => r.warehouse_id === toWh)

  const singleMut = useMutation({
    mutationFn: () => transferMaterial(addMatId, fromWh, toWh, addQty, addRackId || undefined, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["materials"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      setAddMatId(""); setAddQty(0); setAddRackId(""); setShowAdd(false)
      toast({ title: "Transferred" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const bulkMut = useMutation({
    mutationFn: () => {
      const transfers = items.map((item) => ({
        material_id: item.material_id,
        from_warehouse_id: item.from_warehouse_id,
        to_warehouse_id: item.to_warehouse_id,
        quantity: item.quantity,
        rack_id: item.rack_id || null,
      }))
      return transferMaterialsBulk(transfers, user?.id)
    },
    onSuccess: (msg) => {
      queryClient.invalidateQueries({ queryKey: ["materials"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      setItems([])
      toast({ title: "Bulk Transfer Complete", description: msg })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const createOrderMut = useMutation({
    mutationFn: () => createTransferOrder(newOrderFrom, newOrderTo, newOrderNotes, newOrderItems.map((i) => ({ material_id: i.material_id, quantity: i.quantity }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer_orders"] })
      setShowNewOrder(false); setNewOrderFrom(""); setNewOrderTo(""); setNewOrderNotes(""); setNewOrderItems([])
      toast({ title: "Transfer order created" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const updateOrderMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateTransferOrderStatus(id, status),
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["transfer_orders"] })
      queryClient.invalidateQueries({ queryKey: ["transfer_items"] })
      toast({ title: `Status updated to ${status}` })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const addItem = () => {
    if (!addMatId || !addQty) return
    if (addQty > (filteredMaterials?.find((m) => m.id === addMatId)?.quantity || 0)) {
      toast({ title: "Error", description: "Quantity exceeds available stock", variant: "destructive" })
      return
    }
    setItems([...items, { material_id: addMatId, from_warehouse_id: fromWh, to_warehouse_id: toWh, quantity: addQty, rack_id: addRackId }])
    setAddMatId(""); setAddQty(0); setAddRackId(""); setShowAdd(false)
  }

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx))
  }

  const addNewOrderItem = () => {
    if (!newOrderMatId || !newOrderQty) return
    setNewOrderItems([...newOrderItems, { material_id: newOrderMatId, quantity: newOrderQty }])
    setNewOrderMatId(""); setNewOrderQty(0)
  }

  const removeNewOrderItem = (idx: number) => {
    setNewOrderItems(newOrderItems.filter((_, i) => i !== idx))
  }

  if (matLoading || whLoading) return <LoadingState text="Loading transfer data..." />
  if (matError || whError) return <ErrorState message={matErrorObj?.message || whErrorObj?.message || "Failed to load"} onRetry={() => { matRefetch(); whRefetch() }} />

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2"><ArrowLeftRight className="h-8 w-8" /> Inter-Warehouse Transfer</h1>

      <div className="flex gap-2 border-b pb-2">
        <Button variant={tab === "single" ? "default" : "outline"} size="sm" onClick={() => setTab("single")}>
          <ArrowLeftRight className="h-4 w-4" /> Single Transfer
        </Button>
        <Button variant={tab === "orders" ? "default" : "outline"} size="sm" onClick={() => setTab("orders")}>
          <ListOrdered className="h-4 w-4" /> Transfer Orders
        </Button>
      </div>

      {tab === "single" ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle>Bulk Transfer</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>From Warehouse</Label>
                    <Select value={fromWh} onChange={(e) => { setFromWh(e.target.value); setItems([]) }} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                      <option value="">Select...</option>
                      {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>To Warehouse</Label>
                    <Select value={toWh} onChange={(e) => setToWh(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                      <option value="">Select...</option>
                      {warehouses?.filter((w) => w.id !== fromWh).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                  </div>
                </div>

                {items.length > 0 && (
                  <div>
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Material</TableHead><TableHead>Qty</TableHead><TableHead>Rack</TableHead><TableHead></TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item, i) => (
                          <TableRow key={i}>
                            <TableCell>{materials?.find((m) => m.id === item.material_id)?.name || item.material_id}</TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell className="text-xs">{racks?.find((r) => r.id === item.rack_id)?.rack_name || "-"}</TableCell>
                            <TableCell><Button variant="ghost" size="icon" onClick={() => removeItem(i)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="text-sm text-muted-foreground mt-2">{items.length} item(s)</p>
                  </div>
                )}

                {fromWh && (
                  <Button variant="outline" onClick={() => { setAddMatId(""); setAddQty(0); setAddRackId(""); setShowAdd(true) }} className="w-full">
                    <Plus className="h-4 w-4" /> Add Item
                  </Button>
                )}

                {can("manage_warehouse") && items.length > 0 && (
                  <Button onClick={() => bulkMut.mutate()} className="w-full" disabled={bulkMut.isPending}>
                    <Check className="h-4 w-4" /> Execute Bulk Transfer ({items.length} items)
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Quick Single Transfer</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>From Warehouse</Label>
                  <Select value={fromWh} onChange={(e) => setFromWh(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                    <option value="">Select...</option>
                    {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Material</Label>
                  <Select value={addMatId} onChange={(e) => setAddMatId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                    <option value="">Select...</option>
                    {filteredMaterials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name} (Qty: {m.quantity})</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>To Warehouse</Label>
                  <Select value={toWh} onChange={(e) => setToWh(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                    <option value="">Select...</option>
                    {warehouses?.filter((w) => w.id !== fromWh).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Destination Rack</Label>
                  <div className="flex gap-2">
                    <Select value={addRackId} onChange={(e) => setAddRackId(e.target.value)} className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                      <option value="">Select...</option>
                      {filteredRacks?.map((r) => <option key={r.id} value={r.id}>{r.rack_name} - {r.bin_location}</option>)}
                    </Select>
                    <Button variant="outline" size="sm" onClick={() => { setSuggestionMatId(addMatId); setShowSuggestion(true) }} disabled={!addMatId || !toWh}>
                      <Lightbulb className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" value={addQty} onChange={(e) => setAddQty(Number(e.target.value))} min={1} />
                </div>
                <Button onClick={() => singleMut.mutate()} className="w-full" disabled={!addMatId || !fromWh || !toWh || !addQty || singleMut.isPending}>
                  Transfer Single Item
                </Button>
              </CardContent>
            </Card>
          </div>

          <Dialog open={showAdd} onOpenChange={(v) => setShowAdd(v)}>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Item to Batch</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Material</Label>
                  <Select value={addMatId} onChange={(e) => setAddMatId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                    <option value="">Select...</option>
                    {filteredMaterials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name} (Qty: {m.quantity})</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Destination Rack (optional)</Label>
                  <Select value={addRackId} onChange={(e) => setAddRackId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                    <option value="">Select...</option>
                    {filteredRacks?.map((r) => <option key={r.id} value={r.id}>{r.rack_name} - {r.bin_location}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" value={addQty} onChange={(e) => setAddQty(Number(e.target.value))} min={1} />
                </div>
                <Button onClick={addItem} className="w-full" disabled={!addMatId || !addQty}>
                  Add to Batch
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showSuggestion} onOpenChange={(v) => setShowSuggestion(v)}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Put-away Suggestion</DialogTitle></DialogHeader>
              {putawayResult && putawayResult.rack_id ? (
                <div className="space-y-3">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                    <Lightbulb className="h-8 w-8 mx-auto mb-2 text-green-600" />
                    <p className="font-medium">{putawayResult.rack_name}</p>
                    <div className="text-sm text-muted-foreground space-y-1 mt-2">
                      <p>Capacity: {putawayResult.max_capacity}</p>
                      <p>Used: {putawayResult.used}</p>
                      <p>Available: <strong>{putawayResult.available}</strong></p>
                    </div>
                  </div>
                  <Button onClick={() => { setAddRackId(putawayResult.rack_id); setShowSuggestion(false) }} className="w-full">
                    Use This Rack
                  </Button>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-4">
                  {putawayResult?.rack_name || "Select material and destination warehouse first"}
                </p>
              )}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm">
                <option value="">All Status</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="in_transit">In Transit</option>
                <option value="received">Received</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
              <Button variant="outline" size="sm" onClick={startQrScanner} disabled={showQrScanner}>
                <QrCode className="h-4 w-4" /> Scan QR
              </Button>
            </div>
            <Button onClick={() => { setNewOrderFrom(""); setNewOrderTo(""); setNewOrderNotes(""); setNewOrderItems([]); setShowNewOrder(true) }}>
              <Plus className="h-4 w-4" /> New Transfer Order
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Actions</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {transferOrders?.map((order) => {
                    const whFrom = warehouses?.find((w) => w.id === order.from_warehouse_id)
                    const whTo = warehouses?.find((w) => w.id === order.to_warehouse_id)
                    return (
                      <TableRow key={order.id} className="cursor-pointer" onClick={() => setSelectedOrder(order.id)}>
                        <TableCell className="font-mono text-xs">{order.transfer_number}</TableCell>
                        <TableCell className="text-xs">{whFrom?.name || "-"}</TableCell>
                        <TableCell className="text-xs">{whTo?.name || "-"}</TableCell>
                        <TableCell><Badge variant={getBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                        <TableCell className="text-xs">{formatDate(order.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {order.status === "draft" && (
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); updateOrderMut.mutate({ id: order.id, status: "submitted" }) }}>
                                <Send className="h-3 w-3" /> Submit
                              </Button>
                            )}
                            {order.status === "in_transit" && (
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); updateOrderMut.mutate({ id: order.id, status: "received" }) }}>
                                <RotateCcw className="h-3 w-3" /> Receive
                              </Button>
                            )}
                            {(order.status === "draft" || order.status === "submitted") && (
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); updateOrderMut.mutate({ id: order.id, status: "cancelled" }) }}>
                                <XCircle className="h-3 w-3" /> Cancel
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {(!transferOrders || transferOrders.length === 0) && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">No transfer orders</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={!!selectedOrder} onOpenChange={(v) => { if (!v) setSelectedOrder(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Transfer Order Details</DialogTitle></DialogHeader>
          {selectedOrder && (() => {
            const order = transferOrders?.find((o) => o.id === selectedOrder)
            if (!order) return null
            const whFrom = warehouses?.find((w) => w.id === order.from_warehouse_id)
            const whTo = warehouses?.find((w) => w.id === order.to_warehouse_id)
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Transfer #:</span> <strong>{order.transfer_number}</strong></div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant={getBadgeVariant(order.status)}>{order.status}</Badge></div>
                  <div><span className="text-muted-foreground">From:</span> {whFrom?.name || "-"}</div>
                  <div><span className="text-muted-foreground">To:</span> {whTo?.name || "-"}</div>
                  <div><span className="text-muted-foreground">Created:</span> {formatDate(order.created_at)}</div>
                  {order.notes && <div className="col-span-2"><span className="text-muted-foreground">Notes:</span> {order.notes}</div>}
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Items</p>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>SKU</TableHead><TableHead>Material</TableHead><TableHead>Qty</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {transferItems?.map((ti) => (
                        <TableRow key={ti.id}>
                          <TableCell className="font-mono text-xs">{ti.sku}</TableCell>
                          <TableCell className="text-sm">{ti.material_name}</TableCell>
                          <TableCell>{ti.quantity}</TableCell>
                        </TableRow>
                      ))}
                      {(!transferItems || transferItems.length === 0) && (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-2">Loading...</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setSelectedOrder(null)}>Close</Button>
                  {order.status === "draft" && (
                    <Button onClick={() => { updateOrderMut.mutate({ id: order.id, status: "submitted" }); setSelectedOrder(null) }}>
                      <Send className="h-4 w-4" /> Submit
                    </Button>
                  )}
                  {order.status === "in_transit" && (
                    <Button onClick={() => { updateOrderMut.mutate({ id: order.id, status: "received" }); setSelectedOrder(null) }}>
                      <RotateCcw className="h-4 w-4" /> Receive
                    </Button>
                  )}
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={showQrScanner} onOpenChange={(v) => { if (!v) { try { if (qrScannerRef.current) qrScannerRef.current.stop().catch(() => {}) } catch {} } setShowQrScanner(v) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Scan QR to Receive</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Point camera at transfer order QR code to auto-receive</p>
            <div id="qr-reader" ref={qrReaderRef} className="w-full aspect-square bg-muted rounded-lg overflow-hidden" />
            <Button variant="outline" className="w-full" onClick={() => { try { if (qrScannerRef.current) qrScannerRef.current.stop().catch(() => {}) } catch {} setShowQrScanner(false) }}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewOrder} onOpenChange={setShowNewOrder}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Transfer Order</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Warehouse</Label>
                <Select value={newOrderFrom} onChange={(e) => setNewOrderFrom(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                  <option value="">Select...</option>
                  {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>To Warehouse</Label>
                <Select value={newOrderTo} onChange={(e) => setNewOrderTo(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                  <option value="">Select...</option>
                  {warehouses?.filter((w) => w.id !== newOrderFrom).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={newOrderNotes} onChange={(e) => setNewOrderNotes(e.target.value)} />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Items</p>
              {newOrderItems.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Material</TableHead><TableHead>Qty</TableHead><TableHead></TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {newOrderItems.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{materials?.find((m) => m.id === item.material_id)?.name || item.material_id}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => removeNewOrderItem(i)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="flex gap-2 mt-2">
                <Select value={newOrderMatId} onChange={(e) => setNewOrderMatId(e.target.value)} className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm">
                  <option value="">Select material</option>
                  {materials?.filter((m) => m.warehouse_id === newOrderFrom).map((m) => (
                    <option key={m.id} value={m.id}>{m.sku} - {m.name}</option>
                  ))}
                </Select>
                <Input type="number" className="w-20 h-9" placeholder="Qty" value={newOrderQty} onChange={(e) => setNewOrderQty(Number(e.target.value))} min={1} />
                <Button variant="outline" size="sm" onClick={addNewOrderItem}><Plus className="h-4 w-4" /></Button>
              </div>
            </div>
            <Button onClick={() => createOrderMut.mutate()} className="w-full" disabled={!newOrderFrom || !newOrderTo || newOrderItems.length === 0 || createOrderMut.isPending}>
              Create Transfer Order
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

