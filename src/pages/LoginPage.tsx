import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { login, changePassword } from "../api"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Label } from "../components/ui/label"
import { toast } from "../hooks/use-toast"
import { Package, AlertTriangle } from "lucide-react"

export default function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [passwordExpired, setPasswordExpired] = useState(false)
  const [userForExpiry, setUserForExpiry] = useState<{ id: string; token: string } | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [changingPassword, setChangingPassword] = useState(false)
  const { login: setAuth } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await login(username, password)
      setAuth(res.user, res.token)
      if (res.password_expired) {
        setPasswordExpired(true)
        setUserForExpiry({ id: res.user.id, token: res.token })
      } else {
        navigate("/dashboard")
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleForceChangePassword = async () => {
    if (newPassword.length < 8) { toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" }); return }
    if (!userForExpiry) return
    setChangingPassword(true)
    try {
      await changePassword(userForExpiry.id, newPassword)
      setPasswordExpired(false)
      toast({ title: "Password Changed", description: "Please login again with your new password" })
      window.location.reload()
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
            <Package className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Thermaltrue WMS</CardTitle>
          <p className="text-sm text-muted-foreground">Warehouse Management System</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
            <p className="text-xs text-center text-muted-foreground">Default: admin / admin123</p>
          </form>
        </CardContent>
      </Card>

      <Dialog open={passwordExpired} onOpenChange={(v) => { if (!v) { setPasswordExpired(false); navigate("/login") } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Password Expired
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your password has expired. Please set a new password to continue.
            </p>
            <div className="space-y-2">
              <Label>New Password (min 8 characters)</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <Button onClick={handleForceChangePassword} className="w-full" disabled={changingPassword || !newPassword}>
              {changingPassword ? "Changing..." : "Set New Password"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
