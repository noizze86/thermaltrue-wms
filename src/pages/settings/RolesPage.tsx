import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getRoles, cloneRole, updateRole, createRole, deleteRole } from "../../api"
import type { Role as RoleType } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Checkbox } from "../../components/ui/checkbox"
import { Separator } from "../../components/ui/separator"
import { toast } from "../../hooks/use-toast"
import { ShieldAlert, Shield, Copy, Plus, Pencil, Trash2 } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const ALL_PERMISSIONS = [
  { group: "Materials", perms: ["view_materials", "manage_materials"] },
  { group: "Transactions", perms: ["view_transactions", "manage_transactions", "approve_transactions"] },
  { group: "Warehouse", perms: ["view_warehouse", "manage_warehouse", "approve_transfer", "cycle_count"] },
  { group: "Reports", perms: ["view_reports", "export_data"] },
  { group: "Analysis", perms: ["view_analysis", "view_cost"] },
  { group: "Settings", perms: ["manage_settings", "manage_users", "purge_logs", "restore_database"] },
  { group: "Operations", perms: ["delete_any", "adjust_opname"] },
]

export default function RolesPage() {
  const { can, refreshRoles } = useAuth()
  const queryClient = useQueryClient()
  const { data: roles, isLoading, isError, error, refetch } = useQuery({ queryKey: ["roles"], queryFn: getRoles })

  const [cloneDialog, setCloneDialog] = useState<RoleType | null>(null)
  const [cloneName, setCloneName] = useState("")
  const [cloneDesc, setCloneDesc] = useState("")

  const [permDialog, setPermDialog] = useState<RoleType | null>(null)
  const [permValues, setPermValues] = useState<string[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createDesc, setCreateDesc] = useState("")
  const [createPerms, setCreatePerms] = useState<string[]>([])

  const [deleteTarget, setDeleteTarget] = useState<RoleType | null>(null)

  const cloneMut = useMutation({
    mutationFn: () => cloneRole(cloneDialog!.id, cloneName, cloneDesc),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["roles"] }); refreshRoles(); setCloneDialog(null); setCloneName(""); setCloneDesc(""); toast({ title: "Cloned", description: "Role cloned successfully" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const updatePermMut = useMutation({
    mutationFn: () => updateRole(permDialog!.id, permDialog!.name, permDialog!.description, JSON.stringify(permValues)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["roles"] }); refreshRoles(); setPermDialog(null); toast({ title: "Updated", description: "Permissions updated" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const createMut = useMutation({
    mutationFn: () => createRole(createName, createDesc, JSON.stringify(createPerms)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["roles"] }); refreshRoles(); setCreateOpen(false); setCreateName(""); setCreateDesc(""); setCreatePerms([]); toast({ title: "Created", description: "Role created successfully" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteRole(deleteTarget!.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["roles"] }); refreshRoles(); setDeleteTarget(null); toast({ title: "Deleted", description: "Role deleted" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  if (!can("manage_users")) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <ShieldAlert className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">Only administrators can manage roles.</p>
      </div>
    )
  }

  const openPermEditor = (role: RoleType) => {
    let perms: string[] = []
    try { perms = JSON.parse(role.permissions); if (!Array.isArray(perms)) perms = [] } catch { perms = [] }
    setPermValues(perms)
    setPermDialog(role)
  }

  const togglePerm = (p: string, setter: (fn: (prev: string[]) => string[]) => void) => {
    setter((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])
  }

  if (isLoading) return <LoadingState text="Loading roles..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load roles"} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2"><Shield className="h-8 w-8" /> Roles</h1>
        <Button onClick={() => { setCreateOpen(true); setCreatePerms([]) }}>
          <Plus className="h-4 w-4 mr-2" />Create Role
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>System Roles & Permissions</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Type</TableHead><TableHead>Permissions</TableHead><TableHead>Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {roles?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No roles defined</TableCell></TableRow>
              ) : roles?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.description || "-"}</TableCell>
                  <TableCell><Badge variant={r.is_system ? "default" : "secondary"}>{r.is_system ? "System" : "Custom"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(() => {
                        try {
                          const perms: string[] = JSON.parse(r.permissions);
                          return perms.length === 1 && perms[0] === "*"
                            ? [<Badge key="*" variant="outline" className="text-xs">All (*)</Badge>]
                            : perms.map((p) => <Badge key={p} variant="outline" className="text-xs capitalize">{p.replace(/_/g, " ")}</Badge>)
                        } catch {
                          return <span className="text-xs text-muted-foreground">Invalid JSON</span>
                        }
                      })()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openPermEditor(r)} title={r.is_system ? "Edit permissions (system role)" : "Edit permissions"}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => { setCloneDialog(r); setCloneName(`${r.name} (clone)`); setCloneDesc(r.description) }} title="Clone role">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(r)} disabled={r.is_system} title="Delete role">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!cloneDialog} onOpenChange={(v) => { if (!v) setCloneDialog(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Clone Role</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Cloning from: <strong>{cloneDialog?.name}</strong></p>
            <div className="space-y-2">
              <Label>New Role Name</Label>
              <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={cloneDesc} onChange={(e) => setCloneDesc(e.target.value)} />
            </div>
            <Button onClick={() => cloneMut.mutate()} className="w-full" disabled={cloneMut.isPending || !cloneName}>
              <Plus className="h-4 w-4" /> Clone Role
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!permDialog} onOpenChange={(v) => { if (!v) setPermDialog(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Permissions — {permDialog?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {ALL_PERMISSIONS.map((group) => (
              <div key={group.group}>
                <h4 className="text-sm font-semibold mb-2">{group.group}</h4>
                <div className="space-y-2 pl-2">
                  {group.perms.map((p) => (
                    <label key={p} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox checked={permValues.includes(p)} onCheckedChange={() => togglePerm(p, setPermValues)} />
                      <span className="capitalize">{p.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
                <Separator className="my-2" />
              </div>
            ))}
            <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <Checkbox checked={permValues.includes("*")} onCheckedChange={() => togglePerm("*", setPermValues)} />
                <span>All permissions (*)</span>
              </label>
            </div>
          </div>
          <Button onClick={() => updatePermMut.mutate()} className="w-full" disabled={updatePermMut.isPending}>
            {updatePermMut.isPending ? "Saving..." : "Save Permissions"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) setCreateOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Role</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Role Name</Label>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. supervisor" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="Optional description" />
            </div>
            <Separator />
            <p className="text-sm font-medium">Permissions</p>
            <div className="max-h-64 overflow-y-auto space-y-3">
              {ALL_PERMISSIONS.map((group) => (
                <div key={group.group}>
                  <h4 className="text-sm font-semibold mb-1">{group.group}</h4>
                  <div className="space-y-1 pl-2">
                    {group.perms.map((p) => (
                      <label key={p} className="flex items-center gap-2 cursor-pointer text-sm">
                        <Checkbox checked={createPerms.includes(p)} onCheckedChange={() => togglePerm(p, setCreatePerms)} />
                        <span className="capitalize">{p.replace(/_/g, " ")}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <Checkbox checked={createPerms.includes("*")} onCheckedChange={() => togglePerm("*", setCreatePerms)} />
                  <span>All permissions (*)</span>
                </label>
              </div>
            </div>
            <Button onClick={() => createMut.mutate()} className="w-full" disabled={createMut.isPending || !createName}>
              {createMut.isPending ? "Creating..." : "Create Role"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Role</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?<br />
            Users assigned to this role will lose their current permissions until reassigned.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
