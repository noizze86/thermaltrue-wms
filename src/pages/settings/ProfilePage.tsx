import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getCurrentUser, changeMyPassword, getAppConfig, getUserLoginHistory } from "../../api"
import type { LoginHistoryEntry } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Label } from "../../components/ui/label"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { KeyRound, History, LogIn, User, Shield, Mail, Clock } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const passwordSchema = z.object({
  oldPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(1, "New password is required"),
  confirmPassword: z.string().min(1, "Confirm password is required"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
})

export default function ProfilePage() {
  const { user: authUser } = useAuth()
  const queryClient = useQueryClient()
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passForm, setPassForm] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" })
  const [passErrors, setPassErrors] = useState<Record<string, string>>({})

  const { data: profile, isLoading, isError, error } = useQuery({
    queryKey: ["current_user"],
    queryFn: getCurrentUser,
  })

  const { data: appMinLength } = useQuery({
    queryKey: ["app_config", "password_min_length"],
    queryFn: () => getAppConfig("password_min_length"),
  })
  const { data: loginHistory } = useQuery({
    queryKey: ["login_history", "self"],
    queryFn: () => getUserLoginHistory(authUser?.id || "").catch(() => [] as LoginHistoryEntry[]),
    enabled: !!authUser?.id,
  })

  const minLen = (() => {
    if (appMinLength == null || appMinLength === "") return 8
    const n = Number(appMinLength)
    return Number.isFinite(n) ? n : 8
  })()
  const user = profile || authUser

  const changePwdMut = useMutation({
    mutationFn: () => changeMyPassword(passForm.oldPassword, passForm.newPassword),
    onSuccess: () => {
      toast({ title: "Password changed successfully" })
      setShowPasswordForm(false)
      setPassForm({ oldPassword: "", newPassword: "", confirmPassword: "" })
      setPassErrors({})
    },
    onError: (e: Error) => {
      toast({ title: "Failed to change password", description: e.message, variant: "destructive" })
    },
  })

  const handleChangePassword = () => {
    setPassErrors({})
    const result = passwordSchema.safeParse(passForm)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach((err) => { fieldErrors[String(err.path[0])] = err.message })
      setPassErrors(fieldErrors)
      return
    }
    if (passForm.newPassword.length < minLen) {
      setPassErrors({ newPassword: `Password must be at least ${minLen} characters` })
      return
    }
    changePwdMut.mutate()
  }

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={(error as Error)?.message} onRetry={() => queryClient.invalidateQueries({ queryKey: ["current_user"] })} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle><User className="h-5 w-5 inline mr-2" />Account Information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Full Name</Label><p className="text-lg font-medium">{user?.full_name || "-"}</p></div>
              <div><Label>Username</Label><p className="text-lg font-medium">{user?.username || "-"}</p></div>
              <div><Label>Email</Label><p className="text-lg font-medium"><Mail className="h-4 w-4 inline mr-1" />{user?.email || "-"}</p></div>
              <div><Label>Role</Label><p className="text-lg font-medium"><Shield className="h-4 w-4 inline mr-1" /><Badge>{user?.role || "-"}</Badge></p></div>
              <div><Label>Last Login</Label><p className="text-sm text-muted-foreground"><Clock className="h-4 w-4 inline mr-1" />{user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}</p></div>
              <div><Label>Password Last Changed</Label><p className="text-sm text-muted-foreground">{user?.password_changed_at ? new Date(user.password_changed_at).toLocaleString() : "Never"}</p></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle><KeyRound className="h-5 w-5 inline mr-2" />Password</CardTitle></CardHeader>
          <CardContent>
            {!showPasswordForm ? (
              <Button onClick={() => setShowPasswordForm(true)} className="w-full">
                <KeyRound className="h-4 w-4 mr-2" />Change Password
              </Button>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label>Current Password</Label>
                  <Input type="password" value={passForm.oldPassword}
                    onChange={(e) => setPassForm({ ...passForm, oldPassword: e.target.value })}
                    placeholder="Enter current password" />
                  {passErrors.oldPassword && <p className="text-xs text-red-500 mt-1">{passErrors.oldPassword}</p>}
                </div>
                <div>
                  <Label>New Password (min {minLen} chars)</Label>
                  <Input type="password" value={passForm.newPassword}
                    onChange={(e) => setPassForm({ ...passForm, newPassword: e.target.value })}
                    placeholder="Enter new password" />
                  {passErrors.newPassword && <p className="text-xs text-red-500 mt-1">{passErrors.newPassword}</p>}
                </div>
                <div>
                  <Label>Confirm New Password</Label>
                  <Input type="password" value={passForm.confirmPassword}
                    onChange={(e) => setPassForm({ ...passForm, confirmPassword: e.target.value })}
                    placeholder="Confirm new password" />
                  {passErrors.confirmPassword && <p className="text-xs text-red-500 mt-1">{passErrors.confirmPassword}</p>}
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleChangePassword} disabled={changePwdMut.isPending} className="flex-1">
                    {changePwdMut.isPending ? "Saving..." : "Save"}
                  </Button>
                  <Button variant="outline" onClick={() => { setShowPasswordForm(false); setPassErrors({}) }}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle><History className="h-5 w-5 inline mr-2" />Login History</CardTitle></CardHeader>
        <CardContent>
          {loginHistory && loginHistory.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><LogIn className="h-4 w-4 inline mr-1" />Date</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loginHistory.slice(0, 20).map((entry, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{new Date(entry.created_at || "").toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{entry.ip_address || "-"}</TableCell>
                    <TableCell><Badge variant={entry.status === "success" ? "default" : "destructive"} className="text-xs">{entry.status === "success" ? "Success" : "Failed"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No login history available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
