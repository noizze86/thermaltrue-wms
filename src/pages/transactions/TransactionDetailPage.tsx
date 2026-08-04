import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getTransaction, approveTransaction, rejectTransaction, reverseTransaction } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { toast } from "../../hooks/use-toast"
import { ArrowLeft, CheckCircle, XCircle, RotateCcw, Package, Building2, Hash, FileText, User, Calendar } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  reversed: "secondary",
}

const txTypeLabel: Record<string, string> = {
  in: "Goods In",
  out: "Goods Out",
  transfer: "Transfer",
  adjustment: "Adjustment",
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | "reverse" | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["transaction", id],
    queryFn: () => getTransaction(id!),
    enabled: !!id,
  })

  const approveMut = useMutation({
    mutationFn: () => approveTransaction(id!),
    onSuccess: () => { toast({ title: "Transaction approved" }); queryClient.invalidateQueries({ queryKey: ["transaction", id] }); setConfirmAction(null) },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  })

  const rejectMut = useMutation({
    mutationFn: () => rejectTransaction(id!),
    onSuccess: () => { toast({ title: "Transaction rejected" }); queryClient.invalidateQueries({ queryKey: ["transaction", id] }); setConfirmAction(null) },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  })

  const reverseMut = useMutation({
    mutationFn: () => reverseTransaction(id!),
    onSuccess: () => { toast({ title: "Transaction reversed" }); queryClient.invalidateQueries({ queryKey: ["transaction", id] }); setConfirmAction(null) },
    onError: (e: Error) => toast({ title: "Reverse failed", description: e.message, variant: "destructive" }),
  })

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={(error as Error)?.message} onRetry={() => queryClient.invalidateQueries({ queryKey: ["transaction", id] })} />
  if (!data) return <ErrorState message="Transaction not found" />

  const tx = data.transaction
  const items = data.items || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></Button>
          <h1 className="text-2xl font-bold tracking-tight">{tx.transaction_number}</h1>
          <Badge variant={statusVariant[tx.status] || "outline"} className="text-sm">{tx.status}</Badge>
        </div>
        <div className="flex gap-2">
          {tx.status === "pending" && (
            <>
              {can("manage_transactions") && (
                <Button variant="default" onClick={() => setConfirmAction("approve")}>
                  <CheckCircle className="h-4 w-4 mr-2" />Approve
                </Button>
              )}
              <Button variant="destructive" onClick={() => setConfirmAction("reject")}>
                <XCircle className="h-4 w-4 mr-2" />Reject
              </Button>
            </>
          )}
          {tx.status === "approved" && can("manage_transactions") && (
            <Button variant="secondary" onClick={() => setConfirmAction("reverse")}>
              <RotateCcw className="h-4 w-4 mr-2" />Reverse
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>Transaction Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-sm text-muted-foreground">Type</p><p className="font-medium"><Package className="h-4 w-4 inline mr-1" />{txTypeLabel[tx.type] || tx.type}</p></div>
              <div><p className="text-sm text-muted-foreground">Status</p><Badge variant={statusVariant[tx.status] || "outline"}>{tx.status}</Badge></div>
              <div><p className="text-sm text-muted-foreground">Warehouse</p><p className="font-medium"><Building2 className="h-4 w-4 inline mr-1" />{tx.warehouse_id || "-"}</p></div>
              <div><p className="text-sm text-muted-foreground">Rack</p><p className="font-medium">{tx.rack_id || "-"}</p></div>
              <div><p className="text-sm text-muted-foreground">PO Number</p><p className="font-medium"><Hash className="h-4 w-4 inline mr-1" />{tx.po_number || "-"}</p></div>
              <div><p className="text-sm text-muted-foreground">Invoice No</p><p className="font-medium"><FileText className="h-4 w-4 inline mr-1" />{tx.invoice_no || "-"}</p></div>
              <div><p className="text-sm text-muted-foreground">Destination</p><p className="font-medium">{tx.destination || "-"}</p></div>
              <div><p className="text-sm text-muted-foreground">Reference</p><p className="font-medium">{tx.reference || "-"}</p></div>
              <div><p className="text-sm text-muted-foreground">User</p><p className="font-medium"><User className="h-4 w-4 inline mr-1" />{tx.user_id || "-"}</p></div>
              <div><p className="text-sm text-muted-foreground">Approved By</p><p className="font-medium">{tx.approved_by || "-"}</p></div>
              <div><p className="text-sm text-muted-foreground">Created</p><p className="font-medium"><Calendar className="h-4 w-4 inline mr-1" />{new Date(tx.created_at).toLocaleString()}</p></div>
              <div><p className="text-sm text-muted-foreground">Updated</p><p className="font-medium">{tx.updated_at ? new Date(tx.updated_at).toLocaleString() : "-"}</p></div>
            </div>
            {tx.notes && <div className="mt-4"><p className="text-sm text-muted-foreground">Notes</p><p className="mt-1 p-3 bg-muted rounded-md text-sm">{tx.notes}</p></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-sm text-muted-foreground">Items</p><p className="text-2xl font-bold">{items.length}</p></div>
            <div><p className="text-sm text-muted-foreground">Total Quantity</p><p className="text-2xl font-bold">{items.reduce((s, i) => s + i.quantity, 0)}</p></div>
            <div><p className="text-sm text-muted-foreground">Total Value</p><p className="text-2xl font-bold">{items.reduce((s, i) => s + i.quantity * i.price, 0).toLocaleString()}</p></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, i) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>{item.material_name || item.material_id}</TableCell>
                  <TableCell className="text-xs">{item.batch_id || "-"}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{item.price.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-medium">{(item.quantity * item.price).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No items</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmAction(null)}>
          <div className="bg-background p-6 rounded-lg shadow-lg max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">
              {confirmAction === "approve" ? "Approve Transaction" : confirmAction === "reject" ? "Reject Transaction" : "Reverse Transaction"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {confirmAction === "approve" ? "Are you sure you want to approve this transaction?" : confirmAction === "reject" ? "Are you sure you want to reject this transaction?" : "This will reverse the transaction. Continue?"}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button
                variant={confirmAction === "reject" ? "destructive" : "default"}
                disabled={approveMut.isPending || rejectMut.isPending || reverseMut.isPending}
                onClick={() => {
                  if (confirmAction === "approve") approveMut.mutate()
                  else if (confirmAction === "reject") rejectMut.mutate()
                  else reverseMut.mutate()
                }}
              >
                {confirmAction === "approve" ? "Approve" : confirmAction === "reject" ? "Reject" : "Reverse"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
