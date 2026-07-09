import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  CommandDialog, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList,
} from "../components/ui/command"
import {
  LayoutDashboard, Package, ArrowRightLeft, BarChart3, Warehouse,
  FileText, Settings, QrCode, Tags, Truck, Users, ClipboardList,
  Plus, FileBarChart, Shield,
} from "lucide-react"
import { useAuth } from "../contexts/AuthContext"

interface PaletteAction {
  label: string
  icon: React.ComponentType<{ className?: string }>
  action: string
  permission?: string
}

const ALL_ACTIONS: PaletteAction[] = [
  { label: "Go to Dashboard", icon: LayoutDashboard, action: "/dashboard" },
  { label: "Go to Stock Management", icon: Package, action: "/materials/stock" },
  { label: "Go to QR Generator", icon: QrCode, action: "/materials/qr-generator" },
  { label: "Go to Label Printing", icon: Tags, action: "/materials/labels" },
  { label: "New Transaction In", icon: Plus, action: "/transactions/in", permission: "manage_transactions" },
  { label: "New Transaction Out", icon: ArrowRightLeft, action: "/transactions/out", permission: "manage_transactions" },
  { label: "Transaction History", icon: ClipboardList, action: "/transactions/history" },
  { label: "Analysis Dashboard", icon: BarChart3, action: "/analysis/dashboard" },
  { label: "Material Analysis", icon: BarChart3, action: "/analysis/material" },
  { label: "Consumption Analysis", icon: BarChart3, action: "/analysis/consumption" },
  { label: "Cost Analysis", icon: BarChart3, action: "/analysis/cost", permission: "view_cost" },
  { label: "ABC Analysis", icon: BarChart3, action: "/analysis/abc" },
  { label: "Forecaster", icon: BarChart3, action: "/analysis/forecaster" },
  { label: "Warehouse Dashboard", icon: Warehouse, action: "/warehouse/dashboard" },
  { label: "Warehouses", icon: Warehouse, action: "/warehouse/list" },
  { label: "Rack / Bin", icon: Warehouse, action: "/warehouse/racks" },
  { label: "Transfer", icon: ArrowRightLeft, action: "/warehouse/transfer", permission: "manage_warehouse" },
  { label: "Stock Opname", icon: ClipboardList, action: "/warehouse/opname", permission: "manage_warehouse" },
  { label: "Report Summary", icon: FileBarChart, action: "/reports/summary" },
  { label: "Stock Report", icon: FileText, action: "/reports/stock" },
  { label: "Transaction Report", icon: FileText, action: "/reports/transactions" },
  { label: "Opname Report", icon: FileText, action: "/reports/opname" },
  { label: "Multi-Warehouse Comparison", icon: BarChart3, action: "/reports/multi-warehouse" },
  { label: "Pivot Report", icon: FileText, action: "/reports/pivot" },
  { label: "System Settings", icon: Settings, action: "/settings/system" },
  { label: "Users", icon: Users, action: "/settings/users", permission: "manage_users" },
  { label: "Categories", icon: Tags, action: "/settings/categories", permission: "manage_settings" },
  { label: "Units", icon: Tags, action: "/settings/units", permission: "manage_settings" },
  { label: "Suppliers", icon: Truck, action: "/settings/suppliers", permission: "manage_settings" },
  { label: "Audit Log", icon: ClipboardList, action: "/settings/audit-log" },
  { label: "Roles", icon: Shield, action: "/settings/roles", permission: "manage_users" },
  { label: "Label Templates", icon: Tags, action: "/settings/label-templates", permission: "manage_settings" },
]

export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const actions = ALL_ACTIONS.filter((a) => !a.permission || can(a.permission))

  const run = useCallback((action: string) => {
    onOpenChange(false)
    navigate(action)
  }, [navigate, onOpenChange])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {actions.map((a) => (
            <CommandItem key={a.action} onSelect={() => run(a.action)}>
              <a.icon className="h-4 w-4" />
              <span>{a.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  return { open, setOpen }
}
