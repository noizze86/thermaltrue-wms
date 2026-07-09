import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getAuditLogsFiltered, getUsers, purgeOldAuditLogs, exportAuditCsvFiltered, generateReportPdf } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { formatDate } from "../../lib/utils"
import { ClipboardList, Filter, Download, Trash2, Eye, FileText } from "lucide-react"
import { LoadingState, ErrorState, EmptyState } from "../../components/ui/data-state"
import { toast } from "../../hooks/use-toast"

const ACTIONS = ["create", "update", "delete", "login", "logout", "import", "export", "transfer", "adjust"]
const ENTITIES = ["material", "category", "unit", "supplier", "user", "warehouse", "rack", "transaction", "opname"]

export default function AuditLogPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [showFilters, setShowFilters] = useState(false)
  const [showDetail, setShowDetail] = useState<string | null>(null)
  const [showPurge, setShowPurge] = useState(false)
  const [purgeMonths, setPurgeMonths] = useState(6)

  const [filters, setFilters] = useState({
    action: "", entity: "", user_id: "", date_start: "", date_end: "", limit: 500,
  })

  const { data: logs, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["audit_logs_filtered", filters],
    queryFn: () => getAuditLogsFiltered(
      filters.action || undefined,
      filters.entity || undefined,
      filters.user_id || undefined,
      filters.date_start || undefined,
      filters.date_end || undefined,
      filters.limit,
    ),
  })
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: getUsers })
  const purgeMut = useMutation({
    mutationFn: () => purgeOldAuditLogs(purgeMonths),
    onSuccess: (count) => { queryClient.invalidateQueries({ queryKey: ["audit_logs_filtered"] }); toast({ title: "Purged", description: `${count} old logs deleted` }); setShowPurge(false) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const handleExportFilteredCsv = async () => {
    try {
      const csv = await exportAuditCsvFiltered(
        filters.action || undefined,
        filters.entity || undefined,
        filters.user_id || undefined,
        filters.date_start || undefined,
        filters.date_end || undefined,
        filters.limit,
      )
      const blob = new Blob([csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Filtered audit log exported as CSV" })
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    }
  }

  const handleExportPdf = async () => {
    try {
      const result = await generateReportPdf("audit_log_filtered", {
        dateStart: filters.date_start || undefined,
        dateEnd: filters.date_end || undefined,
      })
      if (result && result.length > 0) {
        toast({ title: "Exported", description: "Audit log PDF generated" })
      }
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    }
  }

  const detailLog = logs?.find((l) => l.id === showDetail)
  let parsedDetails: Record<string, { old: unknown; new: unknown }> | null = null
  if (detailLog?.details) {
    try {
      const parsed = JSON.parse(detailLog.details)
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedDetails = parsed
      }
    } catch { /* not JSON - show as text */ }
  }

  const activeFilterCount = [filters.action, filters.entity, filters.user_id, filters.date_start, filters.date_end].filter(Boolean).length
  if (isLoading) return <LoadingState text="Loading audit logs..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load audit logs"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2"><ClipboardList className="h-8 w-8" /> Audit Log</h1>
        <div className="flex gap-2">
          {can("manage_settings") && (
            <Button variant="outline" onClick={() => setShowPurge(true)}><Trash2 className="h-4 w-4" /> Purge Old</Button>
          )}
          <Button variant="outline" onClick={handleExportFilteredCsv} title="Export filtered view as CSV"><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="outline" onClick={handleExportPdf} title="Export filtered view as PDF"><FileText className="h-4 w-4" /> PDF</Button>
          <Button variant={activeFilterCount > 0 ? "default" : "outline"} onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4" /> Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Action</Label>
                <Select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
                  <option value="">All</option>
                  {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Entity</Label>
                <Select value={filters.entity} onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
                  <option value="">All</option>
                  {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">User</Label>
                <Select value={filters.user_id} onChange={(e) => setFilters({ ...filters, user_id: e.target.value })}>
                  <option value="">All</option>
                  {users?.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date From</Label>
                <Input type="date" value={filters.date_start} onChange={(e) => setFilters({ ...filters, date_start: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date To</Label>
                <Input type="date" value={filters.date_end} onChange={(e) => setFilters({ ...filters, date_end: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Limit</Label>
                <Input type="number" value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: Number(e.target.value) })} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {logs?.length === 0 ? (
            <EmptyState title="No audit logs found" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs?.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDate(log.created_at)}</TableCell>
                    <TableCell>{users?.find((u) => u.id === log.user_id)?.username || "System"}</TableCell>
                    <TableCell><span className="text-xs bg-muted px-2 py-0.5 rounded">{log.action}</span></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.entity}{log.entity_id ? `#${log.entity_id.slice(0, 8)}` : ""}</TableCell>
                    <TableCell className="max-w-[300px] truncate text-xs">{log.details}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowDetail(log.id)}>
                        <Eye className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!showDetail} onOpenChange={(v) => { if (!v) setShowDetail(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Audit Log Detail</DialogTitle></DialogHeader>
          {detailLog && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Date:</span> {formatDate(detailLog.created_at)}</div>
                <div><span className="text-muted-foreground">User:</span> {users?.find((u) => u.id === detailLog.user_id)?.username || "System"}</div>
                <div><span className="text-muted-foreground">Action:</span> {detailLog.action}</div>
                <div><span className="text-muted-foreground">Entity:</span> {detailLog.entity} {detailLog.entity_id && `(${detailLog.entity_id.slice(0, 8)}...)`}</div>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Details:</span>
                {parsedDetails ? (
                  <div className="mt-2 space-y-1 border rounded-md p-2">
                    {Object.entries(parsedDetails).map(([field, vals]) => (
                      <div key={field} className="grid grid-cols-3 gap-2 text-xs">
                        <span className="font-medium">{field}</span>
                        <span className="text-red-600 dark:text-red-400 line-through">{String(vals.old ?? "")}</span>
                        <span className="text-green-600 dark:text-green-400">{String(vals.new ?? "")}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="mt-1 text-xs bg-muted p-2 rounded whitespace-pre-wrap break-all">{detailLog.details}</pre>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showPurge} onOpenChange={setShowPurge}>
        <DialogContent>
          <DialogHeader><DialogTitle>Purge Old Audit Logs</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Delete audit logs older than:</p>
            <div className="flex items-center gap-2">
              <Input type="number" value={purgeMonths} onChange={(e) => setPurgeMonths(Number(e.target.value))} min={1} max={120} className="w-24" />
              <span className="text-sm">months</span>
            </div>
            <Button onClick={() => purgeMut.mutate()} variant="destructive" className="w-full" disabled={purgeMut.isPending}>
              {purgeMut.isPending ? "Purging..." : `Delete logs older than ${purgeMonths} months`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
