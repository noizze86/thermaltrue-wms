import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getDbStats, backupDatabase, restoreDatabase, getCompanyProfile, saveCompanyProfile, getNotificationConfig, setNotificationConfig, getAllAppConfig, setAppConfig, deleteAppConfig, getAppConfig } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs"
import { Label } from "../../components/ui/label"
import { Download, Database, ShieldAlert, Upload, Building2, Bell, Activity, Settings2, Plus, Trash2, Save, Clock } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"
import { toast } from "../../hooks/use-toast"

export default function SystemPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: stats, isLoading, isError, error, refetch } = useQuery({ queryKey: ["db_stats"], queryFn: getDbStats })
  const { data: profile } = useQuery({ queryKey: ["company_profile"], queryFn: getCompanyProfile })
  const { data: notifications } = useQuery({ queryKey: ["notification_config"], queryFn: getNotificationConfig })
  const { data: allConfig } = useQuery({ queryKey: ["all_app_config"], queryFn: getAllAppConfig })
  const { data: backupInterval } = useQuery({ queryKey: ["app_config", "backup_interval_days"], queryFn: () => getAppConfig("backup_interval_days") })
  const [backupPath, setBackupPath] = useState<string | null>(null)
  const [restorePath, setRestorePath] = useState<string>("")
  const [profileForm, setProfileForm] = useState({
    company_name: "", address: "", phone: "", email: "", logo: "", npwp: "",
  })
  const [notifForm, setNotifForm] = useState<Record<string, string>>({})
  const [newConfigKey, setNewConfigKey] = useState("")
  const [newConfigValue, setNewConfigValue] = useState("")
  const [editConfigKey, setEditConfigKey] = useState<string | null>(null)
  const [editConfigValue, setEditConfigValue] = useState("")
  const [backupIntervalDays, setBackupIntervalDays] = useState(7)

  useEffect(() => {
    if (profile) {
      setProfileForm({
        company_name: profile.company_name,
        address: profile.address,
        phone: profile.phone,
        email: profile.email,
        logo: profile.logo,
        npwp: profile.npwp,
      })
    }
  }, [profile])

  useEffect(() => {
    if (notifications && notifications.length > 0) {
      const init: Record<string, string> = {}
      for (const n of notifications) init[n.config_key] = n.config_value
      setNotifForm(init)
    }
  }, [notifications])

  useEffect(() => {
    if (backupInterval) {
      setBackupIntervalDays(Number(backupInterval))
    }
  }, [backupInterval])

  const backupMut = useMutation({
    mutationFn: backupDatabase,
    onSuccess: (path) => setBackupPath(path),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const restoreMut = useMutation({
    mutationFn: () => restoreDatabase(restorePath),
    onSuccess: (msg) => { toast({ title: "Restored", description: msg }); queryClient.invalidateQueries({ queryKey: ["db_stats"] }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const profileMut = useMutation({
    mutationFn: () => saveCompanyProfile(profileForm.company_name, profileForm.address, profileForm.phone, profileForm.email, profileForm.logo, profileForm.npwp),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["company_profile"] }); toast({ title: "Saved", description: "Company profile updated" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const notifMut = useMutation({
    mutationFn: (data: { key: string; value: string }) => setNotificationConfig(data.key, data.value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification_config"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setProfileForm({ ...profileForm, logo: reader.result as string })
    reader.readAsDataURL(file)
  }

  if (isLoading) return <LoadingState text="Loading..." />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2"><Database className="h-8 w-8" /> System</h1>

      <Tabs defaultValue="stats">
        <TabsList>
          <TabsTrigger value="stats"><Activity className="h-4 w-4" /> Statistics</TabsTrigger>
          <TabsTrigger value="profile"><Building2 className="h-4 w-4" /> Company Profile</TabsTrigger>
          <TabsTrigger value="backup"><Download className="h-4 w-4" /> Backup & Restore</TabsTrigger>
          <TabsTrigger value="config"><Settings2 className="h-4 w-4" /> App Config</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="h-4 w-4" /> Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="stats">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader><CardTitle>Materials</CardTitle></CardHeader>
              <CardContent><p className="text-3xl font-bold">{stats?.materials ?? "..."}</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Transactions</CardTitle></CardHeader>
              <CardContent><p className="text-3xl font-bold">{stats?.transactions ?? "..."}</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Users</CardTitle></CardHeader>
              <CardContent><p className="text-3xl font-bold">{stats?.users ?? "..."}</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Categories</CardTitle></CardHeader>
              <CardContent><p className="text-3xl font-bold">{stats?.categories ?? "..."}</p></CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="profile">
          <Card>
            <CardHeader><CardTitle>Company Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {profileForm.logo ? (
                  <img src={profileForm.logo} alt="Logo" className="w-16 h-16 object-contain rounded border" />
                ) : (
                  <div className="w-16 h-16 rounded border flex items-center justify-center text-muted-foreground"><Building2 className="h-8 w-8" /></div>
                )}
                <label className="text-sm text-primary cursor-pointer hover:underline">
                  Upload Logo
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Company Name</Label>
                  <Input value={profileForm.company_name} onChange={(e) => setProfileForm({ ...profileForm, company_name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>NPWP</Label>
                  <Input value={profileForm.npwp} onChange={(e) => setProfileForm({ ...profileForm, npwp: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Address</Label>
                  <Input value={profileForm.address} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} />
                </div>
              </div>
              {can("manage_settings") && (
                <Button onClick={() => {
                  const errs: string[] = []
                  if (profileForm.email && !profileForm.email.includes("@")) errs.push("Format email tidak valid (harus mengandung @)")
                  if (profileForm.phone) {
                    const digits = profileForm.phone.replace(/\D/g, "")
                    if (digits.length < 10) errs.push("Nomor telepon minimal 10 digit")
                  }
                  if (profileForm.npwp) {
                    const npwpDigits = profileForm.npwp.replace(/\D/g, "")
                    if (npwpDigits.length < 15 || npwpDigits.length > 16) errs.push("NPWP harus 15-16 digit")
                  }
                  if (errs.length > 0) { errs.forEach(e => toast({ title: "Validation Error", description: e, variant: "destructive" })); return }
                  profileMut.mutate()
                }} disabled={profileMut.isPending}>Save Profile</Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backup">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Backup Database</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {can("manage_settings") ? (
                  <Button onClick={() => backupMut.mutate()} disabled={backupMut.isPending} className="w-full">
                    <Download className="h-4 w-4" /> {backupMut.isPending ? "Backing up..." : "Backup Database"}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm text-muted-foreground">
                    <ShieldAlert className="h-4 w-4" /> Only managers and admins can backup.
                  </div>
                )}
                {backupPath && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 rounded-md text-sm">
                    Backup saved:<br />
                    <code className="text-xs break-all">{backupPath}</code>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Restore Database</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {can("manage_settings") ? (
                  <>
                    <div className="space-y-2">
                      <Label>Backup File Path</Label>
                      <Input value={restorePath} onChange={(e) => setRestorePath(e.target.value)} placeholder="C:\path\to\backup.db" />
                    </div>
                    <Button onClick={() => restoreMut.mutate()} variant="destructive" disabled={!restorePath || restoreMut.isPending} className="w-full">
                      <Upload className="h-4 w-4" /> {restoreMut.isPending ? "Restoring..." : "Restore Database"}
                    </Button>
                    <p className="text-xs text-muted-foreground">Warning: This will overwrite the current database.</p>
                  </>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm text-muted-foreground">
                    <ShieldAlert className="h-4 w-4" /> Only managers and admins can restore.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {/* Scheduled Backup */}
          <Card className="mt-4">
            <CardHeader><CardTitle><Clock className="h-4 w-4 inline mr-1" /> Scheduled Backup</CardTitle></CardHeader>
            <CardContent>
              {can("manage_settings") ? (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label>Auto backup every</Label>
                    <Input type="number" min={1} max={365} className="w-20" value={backupIntervalDays}
                      onChange={(e) => setBackupIntervalDays(Number(e.target.value))} />
                    <span className="text-sm">days</span>
                  </div>
                  <Button size="sm" onClick={async () => {
                    try {
                      await setAppConfig("backup_interval_days", String(backupIntervalDays));
                      await setAppConfig("backup_last_at", "");
                      queryClient.invalidateQueries({ queryKey: ["app_config"] });
                      toast({ title: "Saved", description: `Backup schedule set to every ${backupIntervalDays} days` });
                    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                  }}>
                    <Save className="h-3 w-3 mr-1" /> Save Schedule
                  </Button>
                  <Badge variant="outline" className="text-xs">
                    {backupIntervalDays > 0 ? `Every ${backupIntervalDays} day${backupIntervalDays > 1 ? "s" : ""}` : "Disabled"}
                  </Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm text-muted-foreground">
                  <ShieldAlert className="h-4 w-4" /> Only managers and admins can configure backup schedule.
                </div>
              )}
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground mt-4">
            Default login: <strong>admin</strong> / <strong>admin123</strong>
          </p>
        </TabsContent>

        <TabsContent value="config">
          <Card>
            <CardHeader><CardTitle><Settings2 className="h-4 w-4 inline mr-1" /> Application Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {can("manage_settings") && (
                <div className="flex items-center gap-2 mb-4">
                  <Input placeholder="Key" className="w-48" value={newConfigKey} onChange={(e) => setNewConfigKey(e.target.value)} />
                  <Input placeholder="Value" className="w-64" value={newConfigValue} onChange={(e) => setNewConfigValue(e.target.value)} />
                  <Button size="sm" onClick={async () => {
                    try {
                      if (!newConfigKey) return;
                      await setAppConfig(newConfigKey, newConfigValue);
                      setNewConfigKey(""); setNewConfigValue("");
                      queryClient.invalidateQueries({ queryKey: ["all_app_config"] });
                      toast({ title: "Added", description: `Config key '${newConfigKey}' saved` });
                    } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                  }} disabled={!newConfigKey}><Plus className="h-3 w-3" /> Add</Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Key</TableHead><TableHead>Value</TableHead>{can("manage_settings") && <TableHead className="w-[120px]">Actions</TableHead>}</TableRow>
                </TableHeader>
                <TableBody>
                  {(allConfig || []).map((c) => (
                    <TableRow key={c.key}>
                      <TableCell className="font-mono text-sm">{c.key}</TableCell>
                      <TableCell>
                        {editConfigKey === c.key ? (
                          <div className="flex items-center gap-1">
                            <Input value={editConfigValue} onChange={(e) => setEditConfigValue(e.target.value)} className="h-8 text-sm" />
                            <Button size="sm" variant="ghost" className="h-8" onClick={async () => {
                              try {
                                await setAppConfig(c.key, editConfigValue);
                                setEditConfigKey(null);
                                queryClient.invalidateQueries({ queryKey: ["all_app_config"] });
                                toast({ title: "Updated" });
                              } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                            }}><Save className="h-3 w-3" /></Button>
                          </div>
                        ) : (
                          <span className="text-sm">{c.value}</span>
                        )}
                      </TableCell>
                      {can("manage_settings") && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditConfigKey(c.key); setEditConfigValue(c.value) }}>
                              <Settings2 className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={async () => {
                              try {
                                if (confirm(`Delete config '${c.key}'?`)) {
                                  await deleteAppConfig(c.key);
                                  queryClient.invalidateQueries({ queryKey: ["all_app_config"] });
                                  toast({ title: "Deleted" });
                                }
                              } catch (e: unknown) { toast({ title: "Error", description: String(e), variant: "destructive" }) }
                            }}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader><CardTitle>Notification Thresholds</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Low Stock Alert (%)</Label>
                  <Input
                    type="number" min={0} max={100}
                    value={notifForm["low_stock_threshold"] ?? "20"}
                    onChange={(e) => setNotifForm({ ...notifForm, low_stock_threshold: e.target.value })}
                    onBlur={() => notifMut.mutate({ key: "low_stock_threshold", value: notifForm["low_stock_threshold"] || "20" })}
                  />
                  <p className="text-xs text-muted-foreground">Alert when stock drops below this % of min_stock</p>
                </div>
                <div className="space-y-1">
                  <Label>Expiry Warning (days)</Label>
                  <Input
                    type="number" min={1} max={365}
                    value={notifForm["expiry_warning_days"] ?? "30"}
                    onChange={(e) => setNotifForm({ ...notifForm, expiry_warning_days: e.target.value })}
                    onBlur={() => notifMut.mutate({ key: "expiry_warning_days", value: notifForm["expiry_warning_days"] || "30" })}
                  />
                  <p className="text-xs text-muted-foreground">Warn when material expires within this many days</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
