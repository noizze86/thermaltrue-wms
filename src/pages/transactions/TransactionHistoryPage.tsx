import { useState, useEffect, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getTransactions, getMaterials, getWarehouses, getUsers, getCategories,
  reverseTransaction, reverseTransactionsBulk, getTransactionItems, getTransactionAttachments, generateReportPdf,
  generateReceiptPdf, generateDoPdf,
} from "../../api"
import type { Transaction, TransactionItem, TransactionAttachment } from "../../api"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Select } from "../../components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Button } from "../../components/ui/button"
import { formatDate } from "../../lib/utils"
import { toast } from "../../hooks/use-toast"
import { Search, Eye, RotateCcw, Download, FileText, Paperclip, Clock, CheckCircle, XCircle, Trash2, ChevronLeft, ChevronRight } from "lucide-react"
import { LoadingState, ErrorState, EmptyState } from "../../components/ui/data-state"

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
  reversed: "outline",
}

export default function TransactionHistoryPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [warehouseFilter, setWarehouseFilter] = useState("")
  const [userFilter, setUserFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [dateStart, setDateStart] = useState("")
  const [dateEnd, setDateEnd] = useState("")
  const [detailTx, setDetailTx] = useState<Transaction | null>(null)
  const [txItems, setTxItems] = useState<TransactionItem[]>([])
  const [txAttachments, setTxAttachments] = useState<TransactionAttachment[]>([])
  const [selectedTx, setSelectedTx] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [typeFilter, statusFilter, warehouseFilter, userFilter, categoryFilter, dateStart, dateEnd, debouncedSearch])

  const { data: transactions, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["transactions", debouncedSearch, typeFilter, statusFilter, warehouseFilter, dateStart, dateEnd, userFilter, categoryFilter],
    queryFn: () => getTransactions(
      debouncedSearch || undefined,
      typeFilter !== "all" ? typeFilter : undefined,
      undefined,
      warehouseFilter || undefined,
      dateStart || undefined,
      dateEnd || undefined,
    ),
  })
  const { data: materials } = useQuery({ queryKey: ["materials"], queryFn: () => getMaterials() })
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: () => getWarehouses() })
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => getUsers() })
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => getCategories() })

  const filtered = (transactions || []).filter((tx) => {
    if (statusFilter !== "all" && tx.status !== statusFilter) return false
    if (userFilter && tx.user_id !== userFilter) return false
    if (categoryFilter) {
      const mat = materials?.find((m) => m.id === tx.material_id)
      if (mat?.category_id !== categoryFilter) return false
    }
    return true
  })
  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])
  const reverseMut = useMutation({
    mutationFn: (id: string) => reverseTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["materials"] })
      toast({ title: "Success", description: "Transaction reversed successfully" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const bulkReverseMut = useMutation({
    mutationFn: (ids: string[]) => reverseTransactionsBulk(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["materials"] })
      setSelectedTx(new Set())
      toast({ title: "Bulk Reversed", description: "Selected transactions reversed" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  if (isLoading) return <LoadingState text="Loading transactions..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load transactions"} onRetry={refetch} />

  const handleReverse = (tx: Transaction) => {
    if (tx.status === "reversed") {
      toast({ title: "Already Reversed", variant: "destructive" })
      return
    }
    if (confirm(`Reverse transaction ${tx.transaction_number}? This will adjust stock.`)) {
      reverseMut.mutate(tx.id)
    }
  }

  const handleViewDetail = async (tx: Transaction) => {
    setDetailTx(tx)
    try {
      const [items, attachments] = await Promise.all([
        getTransactionItems(tx.id),
        getTransactionAttachments(tx.id),
      ])
      setTxItems(items)
      setTxAttachments(attachments)
    } catch {
      setTxItems([])
      setTxAttachments([])
    }
  }

  const handleExportPdf = async () => {
    try {
      const data = await generateReportPdf("transactions", {
        dateStart: dateStart || undefined,
        dateEnd: dateEnd || undefined,
        typeFilter: typeFilter !== "all" ? typeFilter : undefined,
        statusFilter: statusFilter !== "all" ? statusFilter : undefined,
      })
      const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = `transactions_${Date.now()}.pdf`; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "PDF exported with current filters" })
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message || "Export failed", variant: "destructive" })
    }
  }

  const statusBadge = (status: string) => {
    const variant = statusColors[status] || "outline"
    const iconMap: Record<string, React.ReactNode> = {
      approved: <CheckCircle className="h-3 w-3" />,
      pending: <Clock className="h-3 w-3" />,
      rejected: <XCircle className="h-3 w-3" />,
    }
    return (
      <Badge variant={variant} className="flex items-center gap-1 w-fit">
        {iconMap[status] || null}
        {status}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Transaction History</h1>
        <div className="flex gap-2">
          {selectedTx.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Reverse ${selectedTx.size} transaction(s)?`)) bulkReverseMut.mutate(Array.from(selectedTx)) }} disabled={bulkReverseMut.isPending}>
              <Trash2 className="h-4 w-4" /> Void ({selectedTx.size})
            </Button>
          )}
          <Button variant="outline" onClick={handleExportPdf}>
            <Download className="h-4 w-4" /> Export PDF
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All Transactions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap items-end">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search number, ref, PO, invoice..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="in">Incoming</option>
              <option value="out">Outgoing</option>
              <option value="transfer">Transfer</option>
              <option value="opname">Opname</option>
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="reversed">Reversed</option>
            </Select>
            <Select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
              <option value="">All Warehouses</option>
              {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">All Users</option>
              {users?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </Select>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <div className="flex items-center gap-1">
              <Input type="date" className="w-36" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
              <span className="text-muted-foreground">-</span>
              <Input type="date" className="w-36" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No transactions found" description="Try adjusting your filters" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input type="checkbox" className="h-4 w-4" checked={filtered.length > 0 && selectedTx.size === filtered.length} onChange={(e) => { if (e.target.checked) setSelectedTx(new Set(filtered.map((t) => t.id))); else setSelectedTx(new Set()) }} />
                    </TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="h-4 w-4" checked={selectedTx.has(tx.id)} onChange={() => setSelectedTx((prev) => { const next = new Set(prev); if (next.has(tx.id)) next.delete(tx.id); else next.add(tx.id); return next })} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{tx.transaction_number}</TableCell>
                      <TableCell>
                        <Badge variant={tx.type === "in" ? "default" : tx.type === "out" ? "destructive" : "secondary"}>
                          {tx.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{materials?.find((m) => m.id === tx.material_id)?.name || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{warehouses?.find((w) => w.id === tx.warehouse_id)?.name || "-"}</TableCell>
                      <TableCell className={tx.type === "in" ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                        {tx.type === "in" ? "+" : "-"}{tx.quantity}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {tx.reference || tx.po_number || tx.invoice_no ? [tx.reference, tx.po_number, tx.invoice_no].filter(Boolean).join(", ") : "-"}
                      </TableCell>
                      <TableCell>{statusBadge(tx.status)}</TableCell>
                      <TableCell className="text-xs">{formatDate(tx.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleViewDetail(tx)} title="View Detail"><Eye className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleReverse(tx)} title="Reverse" disabled={tx.status === "reversed"}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-between items-center mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Drawer */}
      <Dialog open={!!detailTx} onOpenChange={() => { setDetailTx(null); setTxItems([]); setTxAttachments([]) }}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
          {detailTx && (
            <>
              <DialogHeader><DialogTitle>Transaction Detail</DialogTitle></DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="font-medium block text-muted-foreground text-xs">Number</span>{detailTx.transaction_number}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Type</span><Badge>{detailTx.type.toUpperCase()}</Badge></div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Material</span>{materials?.find((m) => m.id === detailTx.material_id)?.name || "-"}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Warehouse</span>{warehouses?.find((w) => w.id === detailTx.warehouse_id)?.name || "-"}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Quantity</span>{detailTx.quantity}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Price</span>{detailTx.price || 0}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">PO Number</span>{detailTx.po_number || "-"}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Invoice</span>{detailTx.invoice_no || "-"}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Reference</span>{detailTx.reference || "-"}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Status</span>{statusBadge(detailTx.status)}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Created by</span>{users?.find((u) => u.id === detailTx.user_id)?.full_name || "-"}</div>
                  <div><span className="font-medium block text-muted-foreground text-xs">Date</span>{detailTx.created_at}</div>
                </div>

                {/* Transaction Items */}
                <div>
                  <h4 className="font-medium flex items-center gap-1 mb-2"><FileText className="h-4 w-4" /> Items</h4>
                  {txItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No item details</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Material</TableHead><TableHead>Batch</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {txItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>{item.material_name || item.material_id}</TableCell>
                            <TableCell className="font-mono text-xs">{item.batch_id || "-"}</TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>{item.price}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Attachments */}
                <div>
                  <h4 className="font-medium flex items-center gap-1 mb-2"><Paperclip className="h-4 w-4" /> Attachments ({txAttachments.length})</h4>
                  {txAttachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No attachments</p>
                  ) : (
                    <div className="space-y-1">
                      {txAttachments.map((att) => (
                        <div key={att.id} className="flex items-center gap-2 text-xs">
                          <FileText className="h-3 w-3 text-muted-foreground" />
                          <span>{att.filename}</span>
                          <span className="text-muted-foreground">{formatDate(att.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Status Timeline */}
                <div>
                  <h4 className="font-medium flex items-center gap-1 mb-2"><Clock className="h-4 w-4" /> Status</h4>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span>Created: {detailTx.created_at}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${detailTx.status === "approved" ? "bg-green-500" : detailTx.status === "rejected" ? "bg-red-500" : detailTx.status === "reversed" ? "bg-yellow-500" : "bg-gray-300 dark:bg-gray-600"}`} />
                      <span>Status: {detailTx.status}{detailTx.approved_by ? ` by ${users?.find((u) => u.id === detailTx.approved_by)?.full_name || detailTx.approved_by}` : ""}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                {detailTx.type === "in" && (
                  <Button variant="outline" size="sm" className="flex-1" onClick={async () => {
                    try { const data = await generateReceiptPdf(detailTx.id); const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `receipt-${detailTx.transaction_number}.pdf`; a.click(); URL.revokeObjectURL(url) } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                  }}>
                    <FileText className="h-4 w-4" /> PDF Receipt
                  </Button>
                )}
                {detailTx.type === "out" && (
                  <Button variant="outline" size="sm" className="flex-1" onClick={async () => {
                    try { const data = await generateDoPdf(detailTx.id); const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `DO-${detailTx.transaction_number}.pdf`; a.click(); URL.revokeObjectURL(url) } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                  }}>
                    <FileText className="h-4 w-4" /> PDF DO
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
