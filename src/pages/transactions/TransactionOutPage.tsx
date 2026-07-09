import { useState, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getMaterials, getTransactions,
  createTransaction, getPendingTransactions, approveTransaction, rejectTransaction,
  getFifoFefoSuggestion, getSalesOrders, getSoItems, generateTxNumber,
  generateDoPdf, generatePickingListPdf,
} from "../../api"
import type { Transaction, MaterialBatch, SalesOrderWithCount, SoItem, TransactionItem } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Badge } from "../../components/ui/badge"
import { formatDate } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { ArrowUpFromLine, Scan, CheckCircle, XCircle, Clock, Printer, Trash2, FileText, PackageSearch } from "lucide-react"

interface CartItem {
  material_id: string
  material_name: string
  sku: string
  quantity: number
  batch_id: string | null
  batch_no: string
  price: number
}

export default function TransactionOutPage() {
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<"single" | "multi">("single")

  // Single-item form
  const [materialId, setMaterialId] = useState("")
  const [quantity, setQuantity] = useState(0)
  const [reference, setReference] = useState("")
  const [notes, setNotes] = useState("")
  const [destination, setDestination] = useState("")
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [skuInput, setSkuInput] = useState("")
  const [detailTx, setDetailTx] = useState<Transaction | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  // Multi-item cart
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartMaterialId, setCartMaterialId] = useState("")
  const [cartSkuInput, setCartSkuInput] = useState("")
  const [cartQty, setCartQty] = useState(0)

  // FIFO/FEFO
  const [showFifo, setShowFifo] = useState(false)
  const [fifoMaterialId, setFifoMaterialId] = useState("")
  const [fifoSuggestions, setFifoSuggestions] = useState<MaterialBatch[]>([])
  const [fifoMethod, setFifoMethod] = useState<"fifo" | "fefo">("fifo")

  // SO dialog
  const [showSoDialog, setShowSoDialog] = useState(false)

  const { data: materials, isLoading: materialsLoading, isError: materialsError, error: materialsErrorObj, refetch: refetchMaterials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: recentTx, isLoading: recentTxLoading, isError: recentTxError, error: recentTxErrorObj, refetch: refetchRecentTx } = useQuery({ queryKey: ["transactions", "out"], queryFn: () => getTransactions(undefined, "out", undefined, undefined, undefined, undefined, 20) })
  const { data: pendingTx } = useQuery({ queryKey: ["transactions", "pending"], queryFn: getPendingTransactions })
  const { data: salesOrders } = useQuery({
    queryKey: ["salesOrders", "open"],
    queryFn: () => getSalesOrders(undefined, "open"),
    enabled: showSoDialog,
  })

  const selectedMaterial = materials?.find((m) => m.id === materialId)
  const handleSkuLookup = () => {
    const match = materials?.find((m) => m.sku.toLowerCase() === skuInput.toLowerCase())
    if (match) {
      setMaterialId(match.id)
      setSkuInput("")
      setErrors({})
    } else {
      toast({ title: "Not Found", description: `No material with SKU "${skuInput}"`, variant: "destructive" })
    }
  }

  const handleCartSkuLookup = () => {
    const match = materials?.find((m) => m.sku.toLowerCase() === cartSkuInput.toLowerCase())
    if (match) {
      setCartMaterialId(match.id)
      setCartSkuInput("")
    } else {
      toast({ title: "Not Found", description: `No material with SKU "${cartSkuInput}"`, variant: "destructive" })
    }
  }

  const handleFifoSuggest = async (matId: string) => {
    if (!matId) return
    try {
      const data = await getFifoFefoSuggestion(matId, fifoMethod)
      setFifoSuggestions(data)
      setFifoMaterialId(matId)
      setShowFifo(true)
    } catch {
      toast({ title: "Error", description: "Failed to get batch suggestions", variant: "destructive" })
    }
  }

  const addToCart = (batchId: string | null, batchNo: string, qty: number) => {
    if (!cartMaterialId || qty <= 0) return
    const mat = materials?.find((m) => m.id === cartMaterialId)
    if (!mat) return
    setCart((prev) => {
      const existing = prev.find(
        (c) => c.material_id === cartMaterialId && c.batch_id === batchId
      )
      if (existing) {
        return prev.map((c) =>
          c.material_id === cartMaterialId && c.batch_id === batchId
            ? { ...c, quantity: c.quantity + qty }
            : c
        )
      }
      return [...prev, { material_id: mat.id, material_name: mat.name, sku: mat.sku, quantity: qty, batch_id: batchId, batch_no: batchNo, price: mat.price }]
    })
    setShowFifo(false)
    setCartQty(0)
  }

  const removeFromCart = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx))
  }

  const loadSoItems = async (so: SalesOrderWithCount) => {
    try {
      const items = await getSoItems(so.so.id)
      if (items.length === 0) {
        toast({ title: "Info", description: "SO has no items" })
        return
      }
      const newCart: CartItem[] = items.map((item: SoItem) => ({
        material_id: item.material_id,
        material_name: item.material_name || "",
        sku: "",
        quantity: item.quantity - item.fulfilled_qty,
        batch_id: null,
        batch_no: "",
        price: item.price,
      })).filter((c) => c.quantity > 0)
      setCart((prev) => {
        const merged = [...prev]
        for (const nc of newCart) {
          const idx = merged.findIndex((c) => c.material_id === nc.material_id)
          if (idx >= 0) {
            merged[idx] = { ...merged[idx], quantity: merged[idx].quantity + nc.quantity }
          } else {
            merged.push(nc)
          }
        }
        return merged
      })
      setDestination(so.so.customer_name)
      setReference(so.so.so_number)
      setShowSoDialog(false)
      setTab("multi")
      toast({ title: "SO Loaded", description: `${so.so.so_number} items added to cart` })
    } catch (e) {
      toast({ title: "Error", description: "Failed to load SO items: " + String(e), variant: "destructive" })
    }
  }

  const schema = z.object({
    material_id: z.string().min(1, "Material is required"),
    quantity: z.number().min(1, "Quantity must be at least 1"),
  })

  const validate = () => {
    const result = schema.safeParse({ material_id: materialId, quantity })
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        fieldErrors[issue.path[0] as string] = issue.message
      }
      setErrors(fieldErrors)
      return false
    }
    if (quantity > (selectedMaterial?.quantity || 0)) {
      setErrors({ quantity: `Quantity exceeds available stock (${selectedMaterial?.quantity || 0})` })
      return false
    }
    setErrors({})
    return true
  }

  const resetForm = () => {
    setMaterialId(""); setQuantity(0); setReference(""); setNotes(""); setDestination(""); setSkuInput(""); setErrors({})
  }

  const txMut = useMutation({
    mutationFn: async () => {
      const txNum = await generateTxNumber("out")
      if (tab === "multi") {
        const items: TransactionItem[] = cart.map((c) => ({
          id: "", tx_id: "", material_id: c.material_id, batch_id: c.batch_id,
          quantity: c.quantity, price: c.price, material_name: c.material_name, created_at: "",
        }))
        return createTransaction({
          id: "", transaction_number: txNum, type: "out", material_id: cart[0]?.material_id || "",
          warehouse_id: null, rack_id: null, quantity: cart.reduce((s, c) => s + c.quantity, 0),
          price: 0, reference, notes,           user_id: user?.id || null, status: "approved", approved_by: null,
          po_number: "", invoice_no: "", destination, created_at: "", updated_at: null,
        }, items)
      }
      return createTransaction({
        id: "", transaction_number: txNum, type: "out", material_id: materialId,
        warehouse_id: null, rack_id: null, quantity, price: selectedMaterial?.price || 0,
        reference, notes, user_id: user?.id || null, status: "approved", approved_by: null,
        po_number: "", invoice_no: "", destination, created_at: "", updated_at: null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["materials"] })
      if (tab === "multi") {
        setCart([]); setCartMaterialId(""); setCartQty(0); setReference(""); setNotes(""); setDestination("")
      } else {
        resetForm()
      }
      toast({ title: "Success", description: "Outgoing goods recorded" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const approveMut = useMutation({
    mutationFn: (id: string) => approveTransaction(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transactions"] }); queryClient.invalidateQueries({ queryKey: ["materials"] }); toast({ title: "Approved" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectTransaction(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transactions"] }); toast({ title: "Rejected" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  // Early returns (after all hooks)
  if (materialsLoading || recentTxLoading) return <LoadingState />
  if (materialsError) return <ErrorState message={materialsErrorObj?.message} onRetry={refetchMaterials} />
  if (recentTxError) return <ErrorState message={recentTxErrorObj?.message} onRetry={refetchRecentTx} />

  const printDeliveryOrder = () => {
    const lineItems = detailTx
      ? [{ name: materials?.find((m) => m.id === detailTx.material_id)?.name || detailTx.material_id, qty: detailTx.quantity }]
      : cart.length > 0
        ? cart.map((c) => ({ name: c.material_name, qty: c.quantity }))
        : []
    const dest = destination || detailTx?.destination || detailTx?.po_number || ""
    const ref = reference || detailTx?.reference || ""
    const num = detailTx?.transaction_number || ""

    const html = `<html><head><title>DO - ${num}</title>
      <style>
        body { font-family: monospace; padding: 20px; max-width: 400px; margin: 0 auto; }
        h2 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #000; padding: 4px 8px; text-align: left; }
        th { background: #eee; }
        .footer { text-align: center; margin-top: 24px; font-size: 12px; }
      </style></head>
      <body>
        <h2>DELIVERY ORDER</h2>
        <p><strong>No:</strong> ${num}</p>
        <p><strong>Destination:</strong> ${dest}</p>
        <p><strong>Ref:</strong> ${ref}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        <table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>
        ${lineItems.map((li) => `<tr><td>${li.name}</td><td>${li.qty}</td></tr>`).join("")}
        </tbody></table>
        <div class="footer">--- Delivery Order ---</div>
      </body></html>`
    const win = window.open("", "_blank")
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2"><ArrowUpFromLine className="h-8 w-8 text-red-600 dark:text-red-400" /> Goods Out</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant={tab === "single" ? "default" : "outline"} onClick={() => setTab("single")}>Single Item</Button>
            <Button variant={tab === "multi" ? "default" : "outline"} onClick={() => setTab("multi")}>Multi Item</Button>
            <Button variant="outline" onClick={() => setShowSoDialog(true)} className="ml-auto">
              <FileText className="h-4 w-4" /> Load SO
            </Button>
          </div>

          {tab === "single" ? (
            <Card>
              <CardHeader><CardTitle>Single Outgoing</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Quick SKU Lookup</Label>
                  <div className="flex gap-2">
                    <Input placeholder="Scan or type SKU..." value={skuInput} onChange={(e) => setSkuInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSkuLookup() }} />
                    <Button variant="outline" onClick={handleSkuLookup}><Scan className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Material</Label>
                  <Select value={materialId} onChange={(e) => { setMaterialId(e.target.value); setErrors({}) }}>
                    <option value="">Select material...</option>
                    {materials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name} (Stock: {m.quantity})</option>)}
                  </Select>
                  {errors.material_id && <p className="text-sm text-destructive">{errors.material_id}</p>}
                </div>
                {selectedMaterial && (
                  <div className="bg-muted/50 rounded p-3 text-sm space-y-1">
                    <p>Available stock: <strong>{selectedMaterial.quantity}</strong></p>
                    <p>Price: <strong>{selectedMaterial.price}</strong></p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} min={0} />
                  {errors.quantity && <p className="text-sm text-destructive">{errors.quantity}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Destination / Customer</Label>
                  <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Customer name or destination" />
                </div>
                <div className="space-y-2">
                  <Label>Reference (DO/SJ)</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="DO-001" />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                {can("manage_transactions") ? (
                  <Button onClick={() => { if (validate()) txMut.mutate() }} className="w-full" disabled={!materialId || !quantity || txMut.isPending}>
                    Record Outgoing Goods
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-2">You don't have permission to create transactions.</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader><CardTitle>Multi-Item Dispatch ({cart.length} items)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Quick SKU Lookup</Label>
                  <div className="flex gap-2">
                    <Input placeholder="Scan or type SKU..." value={cartSkuInput} onChange={(e) => setCartSkuInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCartSkuLookup() }} />
                    <Button variant="outline" onClick={handleCartSkuLookup}><Scan className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Material</Label>
                  <Select value={cartMaterialId} onChange={(e) => { setCartMaterialId(e.target.value); setFifoMaterialId("") }}>
                    <option value="">Select material...</option>
                    {materials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name} (Stock: {m.quantity})</option>)}
                  </Select>
                </div>
                {cartMaterialId && (
                  <div className="flex gap-2 items-center">
                    <Input type="number" placeholder="Qty" value={cartQty} onChange={(e) => setCartQty(Number(e.target.value))} min={0} className="w-24" />
                    <Button variant="outline" onClick={() => addToCart(null, "", cartQty)} disabled={!cartMaterialId || cartQty <= 0}>
                      Add
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleFifoSuggest(cartMaterialId)}>
                      <PackageSearch className="h-4 w-4" /> {fifoMethod.toUpperCase()}
                    </Button>
                  </div>
                )}
                {cart.length > 0 && (
                  <div className="border rounded divide-y max-h-60 overflow-y-auto">
                    {cart.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 text-sm">
                        <span className="flex-1">{item.sku} - {item.material_name}</span>
                        <span className="text-muted-foreground mx-2">{item.batch_no ? `Batch: ${item.batch_no}` : ""}</span>
                        <span className="font-medium mx-2">{item.quantity}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeFromCart(idx)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Destination / Customer</Label>
                  <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Customer name or destination" />
                </div>
                <div className="space-y-2">
                  <Label>Reference (SO/DO)</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="SO-001" />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                {can("manage_transactions") ? (
                  <Button onClick={() => { if (cart.length > 0) txMut.mutate() }} className="w-full" disabled={cart.length === 0 || txMut.isPending}>
                    Dispatch {cart.length} Item(s)
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-2">You don't have permission to create transactions.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {pendingTx && pendingTx.filter((t) => t.type === "out").length > 0 && (
            <Card className="border-yellow-300">
              <CardHeader><CardTitle className="flex items-center gap-2 text-yellow-700"><Clock className="h-5 w-5" /> Pending Approval ({pendingTx.filter((t) => t.type === "out").length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>#</TableHead><TableHead>Material</TableHead><TableHead>Qty</TableHead><TableHead>Actions</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingTx.filter((t) => t.type === "out").slice(0, 5).map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-mono text-xs">{tx.transaction_number}</TableCell>
                        <TableCell>{materials?.find((m) => m.id === tx.material_id)?.name || "-"}</TableCell>
                        <TableCell className="text-red-600 dark:text-red-400">-{tx.quantity}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="text-green-600 dark:text-green-400" onClick={() => approveMut.mutate(tx.id)} title="Approve"><CheckCircle className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-red-600 dark:text-red-400" onClick={() => { if (confirm("Reject?")) rejectMut.mutate(tx.id) }} title="Reject"><XCircle className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Recent Outgoing</CardTitle></CardHeader>
            <CardContent>
              {recentTx?.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No outgoing transactions yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Number</TableHead><TableHead>Material</TableHead><TableHead>Qty</TableHead><TableHead>Destination</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentTx?.map((tx) => (
                      <TableRow key={tx.id} className="cursor-pointer" onClick={() => setDetailTx(tx)}>
                        <TableCell className="font-mono text-xs">{tx.transaction_number}</TableCell>
                        <TableCell>{materials?.find((m) => m.id === tx.material_id)?.name || "-"}</TableCell>
                        <TableCell><Badge variant="destructive">-{tx.quantity}</Badge></TableCell>
                        <TableCell className="text-xs">{tx.destination || tx.po_number || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={tx.status === "approved" ? "default" : tx.status === "pending" ? "secondary" : "destructive"}>
                            {tx.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{formatDate(tx.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* FIFO/FEFO Suggestion Dialog */}
      <Dialog open={showFifo} onOpenChange={setShowFifo}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Batch Suggestion ({fifoMethod.toUpperCase()})</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 mb-2">
            <Label>Method</Label>
            <Select value={fifoMethod} onChange={(e) => { setFifoMethod(e.target.value as "fifo" | "fefo"); handleFifoSuggest(fifoMaterialId) }}>
              <option value="fifo">FIFO (First In First Out)</option>
              <option value="fefo">FEFO (First Expired First Out)</option>
            </Select>
          </div>
          {fifoSuggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No batches available</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Batch</TableHead><TableHead>Qty</TableHead><TableHead>Expiry</TableHead><TableHead>Received</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {fifoSuggestions.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.batch_no}</TableCell>
                    <TableCell>{b.qty}</TableCell>
                    <TableCell className="text-xs">{b.expiry_date || "-"}</TableCell>
                    <TableCell className="text-xs">{b.received_at}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => addToCart(b.id, b.batch_no, Math.min(cartQty || 1, b.qty))}>
                        Add
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      {/* SO Selector Dialog */}
      <Dialog open={showSoDialog} onOpenChange={setShowSoDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Select Sales Order</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>SO#</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Items</TableHead><TableHead>Date</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(salesOrders || []).map((sowc) => (
                  <TableRow key={sowc.so.id}>
                    <TableCell className="font-mono text-xs">{sowc.so.so_number}</TableCell>
                    <TableCell>{sowc.so.customer_name}</TableCell>
                    <TableCell><Badge>{sowc.so.status}</Badge></TableCell>
                    <TableCell>{sowc.item_count}</TableCell>
                    <TableCell className="text-xs">{formatDate(sowc.so.created_at)}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => loadSoItems(sowc)}>Select</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(!salesOrders || salesOrders.length === 0) && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">No open sales orders</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog / Receipt */}
      <Dialog open={!!detailTx} onOpenChange={() => setDetailTx(null)}>
        <DialogContent className="max-w-md">
          {detailTx && (
            <>
              <DialogHeader><DialogTitle>Transaction Detail - {detailTx.transaction_number}</DialogTitle></DialogHeader>
              <div ref={printRef} className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="font-medium">Number:</span><span>{detailTx.transaction_number}</span></div>
                <div className="flex justify-between"><span className="font-medium">Type:</span><Badge variant={detailTx.type === "in" ? "default" : "destructive"}>{detailTx.type.toUpperCase()}</Badge></div>
                <div className="flex justify-between"><span className="font-medium">Material:</span><span>{materials?.find((m) => m.id === detailTx.material_id)?.name || detailTx.material_id}</span></div>
                <div className="flex justify-between"><span className="font-medium">Quantity:</span><span>{detailTx.quantity}</span></div>
                <div className="flex justify-between"><span className="font-medium">Destination:</span><span>{detailTx.destination || detailTx.po_number || "-"}</span></div>
                <div className="flex justify-between"><span className="font-medium">Reference:</span><span>{detailTx.reference || "-"}</span></div>
                <div className="flex justify-between"><span className="font-medium">Status:</span><Badge>{detailTx.status}</Badge></div>
                <div className="flex justify-between"><span className="font-medium">Date:</span><span>{detailTx.created_at}</span></div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={printDeliveryOrder} className="flex-1">
                  <Printer className="h-4 w-4" /> Print DO
                </Button>
                <Button variant="outline" onClick={async () => {
                  try {
                    const data = await generateDoPdf(detailTx.id)
                    const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a"); a.href = url; a.download = `DO-${detailTx.transaction_number}.pdf`; a.click()
                    URL.revokeObjectURL(url)
                  } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                }} className="flex-1">
                  <FileText className="h-4 w-4" /> PDF DO
                </Button>
                <Button variant="outline" onClick={async () => {
                  try {
                    const data = await generatePickingListPdf(detailTx.id)
                    const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a"); a.href = url; a.download = `picking-${detailTx.transaction_number}.pdf`; a.click()
                    URL.revokeObjectURL(url)
                  } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                }} className="flex-1">
                  <FileText className="h-4 w-4" /> Picking List
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
