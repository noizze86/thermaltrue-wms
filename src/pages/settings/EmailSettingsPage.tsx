import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getEmailConfig, saveEmailConfig } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Label } from "../../components/ui/label"
import { Badge } from "../../components/ui/badge"
import { Separator } from "../../components/ui/separator"
import { Mail, ShieldAlert, Save } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { toast } from "../../hooks/use-toast"

export default function EmailSettingsPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: emailCfg, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["email_config"],
    queryFn: getEmailConfig,
  })

  const [form, setForm] = useState({
    smtpHost: "", smtpPort: 587, smtpUser: "", smtpPass: "",
    senderName: "", senderEmail: "", useTls: true,
  })

  useEffect(() => {
    if (emailCfg) {
      setForm({
        smtpHost: emailCfg.smtpHost,
        smtpPort: emailCfg.smtpPort,
        smtpUser: emailCfg.smtpUser,
        smtpPass: emailCfg.smtpPass,
        senderName: emailCfg.senderName,
        senderEmail: emailCfg.senderEmail,
        useTls: emailCfg.useTls,
      })
    }
  }, [emailCfg])

  const saveMut = useMutation({
    mutationFn: () => saveEmailConfig(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email_config"] })
      toast({ title: "Saved", description: "Email configuration updated" })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  if (!can("manage_settings")) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <ShieldAlert className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">You don't have permission to manage email settings.</p>
      </div>
    )
  }

  if (isLoading) return <LoadingState text="Loading email config..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load"} onRetry={refetch} />

  const update = (field: string, value: string | boolean | number) => setForm((prev) => ({ ...prev, [field]: value }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Mail className="h-6 w-6" /> Email Configuration</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>SMTP Server</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SMTP Host</Label>
              <Input value={form.smtpHost} onChange={(e) => update("smtpHost", e.target.value)} placeholder="smtp.gmail.com" />
            </div>
            <div className="space-y-2">
              <Label>SMTP Port</Label>
              <Input type="number" value={form.smtpPort} onChange={(e) => update("smtpPort", Number(e.target.value))} placeholder="587" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SMTP Username</Label>
              <Input value={form.smtpUser} onChange={(e) => update("smtpUser", e.target.value)} placeholder="user@gmail.com" />
            </div>
            <div className="space-y-2">
              <Label>SMTP Password</Label>
              <Input type="password" value={form.smtpPass} onChange={(e) => update("smtpPass", e.target.value)} placeholder="Kosongkan untuk mempertahankan password lama" />
              <p className="text-xs text-muted-foreground">Password tidak pernah ditampilkan kembali. Kosongkan jika tidak ingin mengubahnya.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={form.useTls ? "default" : "secondary"}
              className="cursor-pointer text-sm px-4 py-1"
              onClick={() => update("useTls", !form.useTls)}
            >
              TLS: {form.useTls ? "ON" : "OFF"}
            </Badge>
            <Label className="text-sm text-muted-foreground">Use TLS (click to toggle)</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sender Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Sender Name</Label>
              <Input value={form.senderName} onChange={(e) => update("senderName", e.target.value)} placeholder="Warehouse System" />
            </div>
            <div className="space-y-2">
              <Label>Sender Email</Label>
              <Input value={form.senderEmail} onChange={(e) => update("senderEmail", e.target.value)} placeholder="noreply@example.com" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Save className="mr-2 h-4 w-4" /> {saveMut.isPending ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </div>
  )
}
