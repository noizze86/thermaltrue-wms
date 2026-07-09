import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getUsers, createUser, updateUser, deleteUser, changePassword, updateUserPhoto, getUserActivity, getAppConfig, getUserLoginHistory } from "../../api"
import type { LoginHistoryEntry } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { Plus, Pencil, Trash2, KeyRound, ShieldAlert, Upload, Clock, History, LogIn, Search } from "lucide-react"
import { LoadingState, ErrorState, EmptyState } from "../../components/ui/data-state"

export default function UsersPage() {
  const { user: currentUser, can } = useAuth()
  const queryClient = useQueryClient()
  const { data: users, isLoading, isError, error, refetch } = useQuery({ queryKey: ["users"], queryFn: getUsers })
  const { data: appMinLength } = useQuery({ queryKey: ["app_config", "password_min_length"], queryFn: () => getAppConfig("password_min_length") })
  const { data: appExpiryDays } = useQuery({ queryKey: ["app_config", "password_expiry_days"], queryFn: () => getAppConfig("password_expiry_days") })

  const minLen = Number(appMinLength ?? 8)
  const expiryDays = Number(appExpiryDays ?? 90)
  const isExpiryEnabled = expiryDays > 0

  const [showForm, setShowForm] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showActivity, setShowActivity] = useState<string | null>(null)
  const [showLoginHistory, setShowLoginHistory] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ username: "", password: "", full_name: "", email: "", role: "operator" })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [passwordForm, setPasswordForm] = useState({ id: "", newPassword: "" })
  const [photoUpload, setPhotoUpload] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const pageSize = 20

  const filtered = useMemo(() => {
    if (!search) return users || []
    const q = search.toLowerCase()
    return (users || []).filter(u => u.username.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q))
  }, [users, search])

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)
  const totalPages = Math.ceil(filtered.length / pageSize)

  const { data: userActivities } = useQuery({
    queryKey: ["user_activity", showActivity],
    queryFn: () => getUserActivity(showActivity!),
    enabled: !!showActivity,
  })

  const { data: userLoginHistory } = useQuery({
    queryKey: ["user_login_history", showLoginHistory],
    queryFn: () => getUserLoginHistory(showLoginHistory!, 50),
    enabled: !!showLoginHistory,
  })

  const createMut = useMutation({
    mutationFn: () => createUser(form.username, form.password, form.full_name, form.role),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setShowForm(false); setForm({ username: "", password: "", full_name: "", email: "", role: "operator" }); setErrors({}); toast({ title: "Created", description: "User created" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const updateMut = useMutation({
    mutationFn: () => updateUser(editId!, form.full_name, form.email, form.role, true),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setShowForm(false); setErrors({}); toast({ title: "Updated", description: "User updated" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const passwordMut = useMutation({
    mutationFn: () => changePassword(passwordForm.id, passwordForm.newPassword),
    onSuccess: () => { setShowPassword(false); setPasswordForm({ id: "", newPassword: "" }); toast({ title: "Success", description: "Password changed" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const photoMut = useMutation({
    mutationFn: () => updateUserPhoto(editId!, photoUpload!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setPhotoUpload(null); toast({ title: "Updated", description: "Photo updated" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  if (!can("manage_users")) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <ShieldAlert className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">Only administrators can manage users.</p>
      </div>
    )
  }
  if (isLoading) return <LoadingState text="Loading users..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load users"} onRetry={refetch} />

  const validate = (edit: boolean) => {
    const passwordReq = edit
      ? z.string().or(z.literal(""))
      : z.string().min(minLen, `Min ${minLen} characters (policy)`)
    const schema = z.object({
      username: z.string().min(3, "Min 3 characters").max(50, "Max 50 characters"),
      password: passwordReq,
      full_name: z.string().min(1, "Full name is required").max(255, "Max 255 characters"),
      email: z.string().max(255, "Max 255 characters").email("Invalid email").or(z.literal("")),
    })
    const result = schema.safeParse(edit ? { ...form, password: form.password || "dummy12345678" } : form)
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

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhotoUpload(reader.result as string)
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Users</h1>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search users..." className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <Button onClick={() => { setEditId(null); setForm({ username: "", password: "", full_name: "", email: "", role: "operator" }); setErrors({}); setShowForm(true) }}><Plus className="h-4 w-4" /> Add User</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>System Users</CardTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">Policy: min {minLen} chars{isExpiryEnabled ? `, expires ${expiryDays}d` : ""}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title={search ? "No users match your search" : "No users found"} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Photo</TableHead><TableHead>Username</TableHead><TableHead>Full Name</TableHead><TableHead>Role</TableHead><TableHead>Active</TableHead><TableHead>Password</TableHead><TableHead>Last Login</TableHead><TableHead>Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      {u.photo ? (
                        <img src={u.photo} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs">{u.full_name.charAt(0)}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>{u.full_name}</TableCell>
                    <TableCell><Badge>{u.role}</Badge></TableCell>
                    <TableCell><Badge variant={u.is_active ? "default" : "secondary"}>{u.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell>
                      {isExpiryEnabled && u.password_changed_at ? (
                        (() => {
                          const changed = new Date(u.password_changed_at);
                          const daysSince = Math.floor((Date.now() - changed.getTime()) / 86400000);
                          return daysSince > expiryDays
                            ? <Badge variant="destructive" className="text-xs">Expired</Badge>
                            : <Badge variant="outline" className="text-xs">{expiryDays - daysSince}d left</Badge>
                        })()
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.last_login_at ? new Date(u.last_login_at).toLocaleString("id-ID") : "Never"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditId(u.id); setForm({ username: u.username, password: "", full_name: u.full_name, email: u.email, role: u.role }); setErrors({}); setShowForm(true) }}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { setPasswordForm({ id: u.id, newPassword: "" }); setShowPassword(true) }}><KeyRound className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setShowActivity(u.id)}><History className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setShowLoginHistory(u.id)}><LogIn className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" disabled={u.id === currentUser?.id} onClick={() => { if (confirm("Delete this user?")) deleteMut.mutate(u.id) }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">Page {page} of {totalPages} ({filtered.length} total)</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) setErrors({}); setShowForm(v) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? "Edit User" : "Add User"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {editId && (
              <div className="flex flex-col items-center gap-2">
                {photoUpload ? (
                  <img src={photoUpload} alt="" className="w-20 h-20 rounded-full object-cover" />
                ) : users?.find((u) => u.id === editId)?.photo ? (
                  <img src={users?.find((u) => u.id === editId)?.photo} alt="" className="w-20 h-20 rounded-full object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center"><Upload className="h-6 w-6 text-muted-foreground" /></div>
                )}
                <label className="text-sm text-primary cursor-pointer hover:underline">
                  Upload Photo
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                </label>
                {photoUpload && <Button size="sm" onClick={() => photoMut.mutate()} disabled={photoMut.isPending}>Save Photo</Button>}
              </div>
            )}
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!editId} />
              {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
            </div>
            {!editId && <div className="space-y-2">
              <Label>Password (min {minLen} chars)</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
            </div>}
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              {errors.full_name && <p className="text-sm text-destructive">{errors.full_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="operator">Operator</option>
                <option value="viewer">Viewer</option>
              </Select>
            </div>
            <Button onClick={() => { if (validate(!!editId)) { if (editId) { updateMut.mutate() } else { createMut.mutate() } } }} className="w-full" disabled={createMut.isPending || updateMut.isPending}>
              {editId ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPassword} onOpenChange={setShowPassword}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change Password</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>New Password (min {minLen} chars)</Label>
              <Input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} />
            </div>
            <Button onClick={() => passwordMut.mutate()} className="w-full" disabled={passwordMut.isPending}>Change Password</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showActivity} onOpenChange={(v) => { if (!v) setShowActivity(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>User Activity</DialogTitle></DialogHeader>
          {userActivities?.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No activity recorded</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {userActivities?.map((act) => (
                <div key={act.id} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50">
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{act.activity}</p>
                    {act.details && <p className="text-xs text-muted-foreground truncate">{act.details}</p>}
                    <p className="text-xs text-muted-foreground">{new Date(act.created_at).toLocaleString("id-ID")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Login History Dialog */}
      <Dialog open={!!showLoginHistory} onOpenChange={(v) => { if (!v) setShowLoginHistory(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Login History</DialogTitle></DialogHeader>
          {!userLoginHistory || userLoginHistory.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No login history recorded</p>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Date</TableHead><TableHead>IP</TableHead><TableHead>Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {userLoginHistory.map((lh: LoginHistoryEntry) => (
                    <TableRow key={lh.id}>
                      <TableCell className="text-xs">{new Date(lh.created_at).toLocaleString("id-ID")}</TableCell>
                      <TableCell className="text-xs font-mono">{lh.ip_address || "-"}</TableCell>
                      <TableCell><Badge variant={lh.status === "success" ? "success" : "destructive"} className="text-xs">{lh.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
