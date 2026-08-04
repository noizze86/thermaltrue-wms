import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getInventorySettings, saveInventorySetting, deleteAppConfig } from "../../api"
import { useAuth } from "../../contexts/AuthContext"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Label } from "../../components/ui/label"
import { Separator } from "../../components/ui/separator"
import { toast } from "../../hooks/use-toast"
import { Package, Plus, Trash2, ShieldAlert } from "lucide-react"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const PRESET_FIELDS = [
  { key: "reorder_point_multiplier", label: "Reorder Point Multiplier", type: "number", desc: "Multiply min_stock for auto-reorder calculation (default: 1.5)", min: 0.5, max: 5, step: 0.1 },
  { key: "abc_threshold_a", label: "ABC Threshold A (%)", type: "number", desc: "Top % to classify as A-class (default: 70)", min: 1, max: 99, step: 1 },
  { key: "abc_threshold_c", label: "ABC Threshold C (%)", type: "number", desc: "Bottom % to classify as C-class (default: 10)", min: 1, max: 99, step: 1 },
  { key: "safety_stock_days", label: "Safety Stock Days", type: "number", desc: "Default safety stock coverage in days", min: 0, max: 365, step: 1 },
  { key: "default_lead_time", label: "Default Lead Time (days)", type: "number", desc: "Default supplier lead time in days", min: 0, max: 365, step: 1 },
  { key: "auto_backup_enabled", label: "Auto Backup Enabled", type: "checkbox", desc: "Enable scheduled database backup" },
  { key: "auto_backup_time", label: "Auto Backup Time", type: "text", desc: "Scheduled backup time (HH:MM format)" },
]

export default function InventorySettingsPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: settingsList, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["inventory_settings"],
    queryFn: getInventorySettings,
  })

  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")

  const settingsMap = useMemo(() => {
    const map: Record<string, string> = {}
    settingsList?.forEach((s) => { map[s.key.replace(/^inventory_/, "")] = s.value })
    return map
  }, [settingsList])

  const saveMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => saveInventorySetting(key, value),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["inventory_settings"] }); toast({ title: "Saved" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: (key: string) => deleteAppConfig(`inventory_${key}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["inventory_settings"] }); toast({ title: "Deleted" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  if (!can("manage_settings")) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <ShieldAlert className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">You don't have permission to manage inventory settings.</p>
      </div>
    )
  }

  if (isLoading) return <LoadingState text="Loading inventory settings..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load"} onRetry={refetch} />

  const handleSavePreset = (key: string, value: string) => saveMut.mutate({ key, value })
  const handleAddCustom = () => {
    if (!newKey.trim()) return
    saveMut.mutate({ key: newKey.trim(), value: newValue }, {
      onSuccess: () => { setNewKey(""); setNewValue("") },
    })
  }

  const customKeys = Object.keys(settingsMap).filter((k) => !PRESET_FIELDS.find((p) => p.key === k))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Package className="h-6 w-6" /> Inventory Settings</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Preset Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {PRESET_FIELDS.map((field) => {
            const currentVal = settingsMap[field.key] ?? ""
            return (
              <div key={field.key} className="flex items-center gap-4">
                <div className="flex-1">
                  <Label className="font-medium">{field.label}</Label>
                  <p className="text-xs text-muted-foreground">{field.desc}</p>
                </div>
                <div className="flex items-center gap-2 w-64">
                  {field.type === "checkbox" ? (
                    <Badge
                      variant={currentVal === "true" ? "default" : "secondary"}
                      className="cursor-pointer text-sm px-4 py-1"
                      onClick={() => handleSavePreset(field.key, currentVal === "true" ? "false" : "true")}
                    >
                      {currentVal === "true" ? "Enabled" : "Disabled"}
                    </Badge>
                  ) : (
                    <Input
                      type={field.type}
                      value={currentVal}
                      placeholder="Not set"
                      onChange={(e) => handleSavePreset(field.key, e.target.value)}
                      className="w-32"
                    />
                  )}
                  {currentVal && (
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(field.key)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Custom Settings</CardTitle></CardHeader>
        <CardContent>
          {customKeys.length === 0 && (!newKey || !newValue) ? (
            <p className="text-sm text-muted-foreground mb-4">No custom settings yet. Add one below.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Key</TableHead><TableHead>Value</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {customKeys.map((k) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">inventory_{k}</TableCell>
                    <TableCell>{settingsMap[k]}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(k)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Separator className="my-4" />
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label>Key</Label>
              <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g. my_custom_setting" />
            </div>
            <div className="flex-1">
              <Label>Value</Label>
              <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value" />
            </div>
            <Button onClick={handleAddCustom} disabled={!newKey.trim() || saveMut.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
