import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getMaterials, getWarehouses, getTransactions, createTransaction,
  getPendingTransactions, approveTransaction, rejectTransaction,
  getPurchaseOrders, getPoItems, createTransactionAttachment,
  createQualityInspection, generateTxNumber, getMaterialBatches,
  generateReceiptPdf,
} from "../../api"
import type { Transaction, PurchaseOrder } from "../../api"
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
import { ArrowDownToLine, Scan, CheckCircle, XCircle, Clock, Printer, Plus, Trash2, FileText } from "lucide-react"

interface CartItem {
  materialId: string
  materialName: string
  sku: string
  batchId: string | null
  batchNo: string
  quantity: number
  price: number
  poItemId?: string
  remaining?: number
}

const singleSchema = z.object({
  material_id: z.string().min(1, "Material is required"),
  quantity: z.number().min(1, "Quantity must be at least 1"),
  price: z.number().min(0, "Price cannot be negative"),
})

export default function TransactionInPage() {
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<"single" | "multi">("single")

  // Single-item state
  const [materialId, setMaterialId] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [quantity, setQuantity] = useState(0)
  const [price, setPrice] = useState(0)
  const [reference, setReference] = useState("")
  const [notes, setNotes] = useState("")
  const [poNumber, setPoNumber] = useState("")
  const [invoiceNo, setInvoiceNo] = useState("")
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [skuInput, setSkuInput] = useState("")
  const [detailTx, setDetailTx] = useState<Transaction | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  // Multi-item state
  const [txNumber, setTxNumber] = useState("")
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null)
  const [showPoDialog, setShowPoDialog] = useState(false)
  const [addSkuInput, setAddSkuInput] = useState("")
  const [addMaterialId, setAddMaterialId] = useState("")
  const [addBatchId, setAddBatchId] = useState("")
  const [addBatchNo, setAddBatchNo] = useState("")
  const [addQty, setAddQty] = useState<number>(0)
  const [addPrice, setAddPrice] = useState<number>(0)
  const [attachmentFile, setAttachmentFile] = useState<{ name: string; data: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Inspection state
  const [showInspDialog, setShowInspDialog] = useState(false)
  const [inspections, setInspections] = useState<{ txId: string; materialId: string; status: string; notes: string }[]>([])

  // Queries
  const { data: materials, isLoading: materialsLoading, isError: materialsError, error: materialsErrorObj, refetch: refetchMaterials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: warehouses, isLoading: warehousesLoading } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: recentTx, isLoading: recentTxLoading, isError: recentTxError, error: recentTxErrorObj, refetch: refetchRecentTx } = useQuery({ queryKey: ["transactions", "in"], queryFn: () => getTransactions(undefined, "in", undefined, undefined, undefined, undefined, 20) })
  const { data: pendingTx } = useQuery({ queryKey: ["transactions", "pending"], queryFn: getPendingTransactions })
  const { data: poList } = useQuery({ queryKey: ["purchaseOrders", "open"], queryFn: () => getPurchaseOrders(undefined, "open,partial"), enabled: showPoDialog })
  const { data: batches } = useQuery({ queryKey: ["batches", addMaterialId], queryFn: () => getMaterialBatches(addMaterialId), enabled: !!addMaterialId })

  // Generate TX number for multi-item
  useEffect(() => {
    if (tab === "multi") {
      generateTxNumber("in").then(setTxNumber).catch(() => {})
    }
  }, [tab])

  // Single-item handlers
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

  const validateSingle = () => {
    const result = singleSchema.safeParse({ material_id: materialId, quantity, price })
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        fieldErrors[issue.path[0] as string] = issue.message
      }
      setErrors(fieldErrors)
      return false
    }
    setErrors({})
    return true
  }

  const resetForm = () => {
    setMaterialId(""); setQuantity(0); setPrice(0); setReference(""); setNotes(""); setPoNumber(""); setInvoiceNo(""); setSkuInput(""); setErrors({})
  }

  // Multi-item handlers
  const handleAddSkuLookup = () => {
    const match = materials?.find((m) => m.sku.toLowerCase() === addSkuInput.toLowerCase())
    if (match) {
      setAddMaterialId(match.id)
      setAddSkuInput("")
    } else {
      toast({ title: "Not Found", description: `No material with SKU "${addSkuInput}"`, variant: "destructive" })
    }
  }

  const handleAddToCart = () => {
    if (!addMaterialId || addQty <= 0) {
      toast({ title: "Validation", description: "Select material and quantity > 0", variant: "destructive" })
      return
    }
    const mat = materials?.find((m) => m.id === addMaterialId)
    setCartItems((prev) => [
      ...prev,
      {
        materialId: addMaterialId,
        materialName: mat?.name || "",
        sku: mat?.sku || "",
        batchId: addBatchId || null,
        batchNo: addBatchNo,
        quantity: addQty,
        price: addPrice,
      },
    ])
    setAddMaterialId(""); setAddSkuInput(""); setAddBatchId(""); setAddBatchNo(""); setAddQty(0); setAddPrice(0)
  }

  const handleRemoveCartItem = (index: number) => {
    setCartItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSelectPo = (po: PurchaseOrder) => {
    setSelectedPoId(po.id)
    getPoItems(po.id).then((items) => {
      const cart: CartItem[] = items.map((item) => {
        const mat = materials?.find((m) => m.id === item.material_id)
        return {
          materialId: item.material_id,
          materialName: item.material_name || mat?.name || "",
          sku: mat?.sku || "",
          batchId: null,
          batchNo: "",
          quantity: Math.max(0, item.quantity - item.received_qty),
          price: item.price,
          poItemId: item.id,
          remaining: Math.max(0, item.quantity - item.received_qty),
        }
      })
      setCartItems(cart)
      setPoNumber(po.po_number)
    }).catch((e) => toast({ title: "Error", description: String(e), variant: "destructive" }))
    setShowPoDialog(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setAttachmentFile({ name: file.name, data: reader.result as string })
    }
    reader.readAsDataURL(file)
  }

  // Mutations — single-item
  const txMut = useMutation({
    mutationFn: () => createTransaction({
      material_id: materialId, type: "in", warehouse_id: warehouseId || null,
      quantity, price, reference, notes, user_id: user?.id || null,
      rack_id: null, id: "", transaction_number: "", status: "",
      approved_by: null, po_number: poNumber, invoice_no: invoiceNo,
      created_at: "", updated_at: null, destination: "",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["materials"] })
      resetForm()
      toast({ title: "Success", description: "Incoming goods recorded" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  // Mutations — multi-item
  const multiTxMut = useMutation({
    mutationFn: async () => {
      const ids: string[] = []
      for (const item of cartItems) {
        const result = await createTransaction({
          material_id: item.materialId, type: "in", warehouse_id: warehouseId || null,
          quantity: item.quantity, price: item.price, reference: txNumber,
          notes, user_id: user?.id || null, rack_id: null,
          id: "", transaction_number: "", status: "",
          approved_by: null, po_number: poNumber, invoice_no: "",
          created_at: "", updated_at: null, destination: "",
        })
        ids.push(result.id)
      }
      return ids
    },
    onSuccess: (ids) => {
      if (attachmentFile && ids.length > 0) {
        createTransactionAttachment(ids[0], attachmentFile.name, attachmentFile.data).catch(() => {})
      }
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["materials"] })
      setInspections(ids.map((id, i) => ({
        txId: id,
        materialId: cartItems[i].materialId,
        status: "pass",
        notes: "",
      })))
      setShowInspDialog(true)
      setCartItems([])
      setAttachmentFile(null)
      setSelectedPoId(null)
      setPoNumber("")
      setNotes("")
      toast({ title: "Success", description: `${ids.length} items recorded` })
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

  const inspMut = useMutation({
    mutationFn: async () => {
      for (const insp of inspections) {
        await createQualityInspection(insp.txId, insp.materialId, insp.status, insp.notes)
      }
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Inspections recorded" })
      setShowInspDialog(false)
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  // Early returns (after all hooks)
  if (materialsLoading || warehousesLoading || recentTxLoading) return <LoadingState />
  if (materialsError) return <ErrorState message={materialsErrorObj?.message} onRetry={refetchMaterials} />
  if (recentTxError) return <ErrorState message={recentTxErrorObj?.message} onRetry={refetchRecentTx} />

  const printReceipt = (tx: Transaction) => {
    setDetailTx(tx)
    setTimeout(() => {
      const el = printRef.current
      if (el) {
        const win = window.open("", "_blank")
        if (win) {
          const safeHTML = el.innerHTML.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').replace(/on\w+="[^"]*"/gi, '')
          win.document.write(`<html><head><title>Receipt - ${tx.transaction_number}</title><style>
            body { font-family: monospace; padding: 20px; max-width: 300px; margin: 0 auto; }
            h2 { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; }
            table { width: 100%; }
            td { padding: 2px 4px; }
            .label { font-weight: bold; }
          </style></head><body>${safeHTML}</body></html>`)
          win.document.close()
          win.print()
        }
      }
    }, 100)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">
        <ArrowDownToLine className="h-8 w-8 text-green-600 dark:text-green-400" /> Goods In
      </h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <Button variant={tab === "single" ? "default" : "outline"} onClick={() => setTab("single")}>
          Single Item
        </Button>
        <Button variant={tab === "multi" ? "default" : "outline"} onClick={() => setTab("multi")}>
          Multi Item
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        {tab === "single" ? (
          <Card>
            <CardHeader><CardTitle>New Incoming Transaction</CardTitle></CardHeader>
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
              <div className="space-y-2">
                <Label>Warehouse</Label>
                <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">Select warehouse...</option>
                  {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} min={0} />
                  {errors.quantity && <p className="text-sm text-destructive">{errors.quantity}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Price</Label>
                  <Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={0} />
                  {errors.price && <p className="text-sm text-destructive">{errors.price}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>PO Number</Label>
                  <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-001" />
                </div>
                <div className="space-y-2">
                  <Label>Invoice No</Label>
                  <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-001" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Reference</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {can("manage_transactions") ? (
                <Button onClick={() => { if (validateSingle()) txMut.mutate() }} className="w-full" disabled={!materialId || !quantity || txMut.isPending}>
                  Record Incoming Goods
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">You don't have permission to create transactions.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Multi-Item Receiving</span>
                {txNumber && <Badge variant="outline" className="font-mono">{txNumber}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Warehouse</Label>
                <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">Select warehouse...</option>
                  {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </div>

              {/* PO Selection */}
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setShowPoDialog(true)} className="flex-1">
                  <FileText className="h-4 w-4 mr-2" />
                  {selectedPoId ? `PO: ${poNumber}` : "Select Purchase Order"}
                </Button>
                {selectedPoId && (
                  <Button variant="ghost" size="icon" onClick={() => { setSelectedPoId(null); setCartItems([]); setPoNumber("") }}>
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Add item form */}
              <div className="border rounded-lg p-3 space-y-3">
                <p className="text-sm font-medium">Add Item</p>
                <div className="flex gap-2">
                  <Input placeholder="SKU lookup..." value={addSkuInput} onChange={(e) => setAddSkuInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddSkuLookup() }} />
                  <Button variant="outline" size="icon" onClick={handleAddSkuLookup}><Scan className="h-4 w-4" /></Button>
                </div>
                <Select value={addMaterialId} onChange={(e) => setAddMaterialId(e.target.value)}>
                  <option value="">Select material...</option>
                  {materials?.map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name}</option>)}
                </Select>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Batch</Label>
                    <Select value={addBatchId} onChange={(e) => {
                      setAddBatchId(e.target.value)
                      const b = batches?.find((b) => b.id === e.target.value)
                      setAddBatchNo(b?.batch_no || "")
                    }}>
                      <option value="">None</option>
                      {batches?.map((b) => <option key={b.id} value={b.id}>{b.batch_no}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" value={addQty || ""} onChange={(e) => setAddQty(Number(e.target.value))} min={0} />
                  </div>
                  <div>
                    <Label className="text-xs">Price</Label>
                    <Input type="number" value={addPrice || ""} onChange={(e) => setAddPrice(Number(e.target.value))} min={0} />
                  </div>
                </div>
                <Button variant="secondary" onClick={handleAddToCart} disabled={!addMaterialId || addQty <= 0} className="w-full">
                  <Plus className="h-4 w-4 mr-2" /> Add to Cart
                </Button>
              </div>

              {/* Cart table */}
              {cartItems.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Batch</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        {selectedPoId && <TableHead className="text-right">Remaining</TableHead>}
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cartItems.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                          <TableCell>{item.materialName}</TableCell>
                          <TableCell className="text-xs">{item.batchNo || "-"}</TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">{item.price}</TableCell>
                          {selectedPoId && (
                            <TableCell className="text-right">
                              {item.remaining !== undefined ? (
                                <Badge variant={item.remaining > 0 ? "secondary" : "outline"}>{item.remaining}</Badge>
                              ) : "-"}
                            </TableCell>
                          )}
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => handleRemoveCartItem(i)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="p-2 text-right text-sm font-medium">
                    Total Items: {cartItems.length} | Total Qty: {cartItems.reduce((s, i) => s + i.quantity, 0)}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {/* File attachment */}
              <div className="space-y-2">
                <Label>Document Attachment</Label>
                <div className="flex items-center gap-2">
                  <Input ref={fileInputRef} type="file" onChange={handleFileChange} className="flex-1" />
                  {attachmentFile && (
                    <Badge variant="secondary" className="text-xs truncate max-w-[120px]">{attachmentFile.name}</Badge>
                  )}
                </div>
              </div>

              {can("manage_transactions") ? (
                <Button onClick={() => multiTxMut.mutate()} className="w-full" disabled={cartItems.length === 0 || multiTxMut.isPending}>
                  {multiTxMut.isPending ? "Recording..." : `Receive ${cartItems.length} Item(s)`}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">You don't have permission to create transactions.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Right column */}
        <div className="space-y-6">
          {pendingTx && pendingTx.filter((t) => t.type === "in").length > 0 && (
            <Card className="border-yellow-300">
              <CardHeader><CardTitle className="flex items-center gap-2 text-yellow-700"><Clock className="h-5 w-5" /> Pending Approval ({pendingTx.filter((t) => t.type === "in").length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>#</TableHead><TableHead>Material</TableHead><TableHead>Qty</TableHead><TableHead>Actions</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingTx.filter((t) => t.type === "in").slice(0, 5).map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-mono text-xs">{tx.transaction_number}</TableCell>
                        <TableCell>{materials?.find((m) => m.id === tx.material_id)?.name || "-"}</TableCell>
                        <TableCell>+{tx.quantity}</TableCell>
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
            <CardHeader><CardTitle>Recent Incoming</CardTitle></CardHeader>
            <CardContent>
              {recentTx?.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No incoming transactions yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Number</TableHead><TableHead>Material</TableHead><TableHead>Qty</TableHead><TableHead>PO/Invoice</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentTx?.map((tx) => (
                      <TableRow key={tx.id} className="cursor-pointer" onClick={() => setDetailTx(tx)}>
                        <TableCell className="font-mono text-xs">{tx.transaction_number}</TableCell>
                        <TableCell>{materials?.find((m) => m.id === tx.material_id)?.name || "-"}</TableCell>
                        <TableCell><Badge variant="success">+{tx.quantity}</Badge></TableCell>
                        <TableCell className="text-xs">{tx.po_number || tx.invoice_no ? `${tx.po_number || ""} ${tx.invoice_no ? "/ " + tx.invoice_no : ""}` : "-"}</TableCell>
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

      {/* Transaction Detail Dialog */}
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
                <div className="flex justify-between"><span className="font-medium">Price:</span><span>{detailTx.price}</span></div>
                <div className="flex justify-between"><span className="font-medium">PO Number:</span><span>{detailTx.po_number || "-"}</span></div>
                <div className="flex justify-between"><span className="font-medium">Invoice:</span><span>{detailTx.invoice_no || "-"}</span></div>
                <div className="flex justify-between"><span className="font-medium">Reference:</span><span>{detailTx.reference || "-"}</span></div>
                <div className="flex justify-between"><span className="font-medium">Status:</span><Badge>{detailTx.status}</Badge></div>
                <div className="flex justify-between"><span className="font-medium">Date:</span><span>{detailTx.created_at}</span></div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => printReceipt(detailTx)} className="flex-1">
                  <Printer className="h-4 w-4" /> Print
                </Button>
                <Button variant="outline" onClick={async () => {
                  try {
                    const data = await generateReceiptPdf(detailTx.id)
                    const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a"); a.href = url; a.download = `receipt-${detailTx.transaction_number}.pdf`; a.click()
                    URL.revokeObjectURL(url)
                  } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                }} className="flex-1">
                  <FileText className="h-4 w-4" /> PDF Receipt
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* PO Selector Dialog */}
      <Dialog open={showPoDialog} onOpenChange={setShowPoDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Select Purchase Order</DialogTitle></DialogHeader>
          {poList && poList.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poList.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono text-xs">{po.po_number}</TableCell>
                    <TableCell>{po.supplier_name || "-"}</TableCell>
                    <TableCell><Badge>{po.status}</Badge></TableCell>
                    <TableCell className="text-xs">{formatDate(po.created_at)}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => handleSelectPo(po)}>Select</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-4">No open purchase orders found.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Quality Inspection Dialog */}
      <Dialog open={showInspDialog} onOpenChange={setShowInspDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Quality Inspection</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {inspections.map((insp, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium">
                  {materials?.find((m) => m.id === insp.materialId)?.name || insp.materialId}
                </p>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Status:</Label>
                  <Select value={insp.status} onChange={(e) => {
                    const updated = [...inspections]
                    updated[i] = { ...updated[i], status: e.target.value }
                    setInspections(updated)
                  }}>
                    <option value="passed">Pass</option>
                    <option value="failed">Fail</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Input value={insp.notes} onChange={(e) => {
                    const updated = [...inspections]
                    updated[i] = { ...updated[i], notes: e.target.value }
                    setInspections(updated)
                  }} placeholder="Inspection notes..." />
                </div>
              </div>
            ))}
            <Button onClick={() => inspMut.mutate()} className="w-full" disabled={inspMut.isPending}>
              Submit Inspections
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
