import { useState, useEffect } from "react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { useTheme } from "../contexts/ThemeContext"
import { useOffline } from "../contexts/OfflineContext"
import { cn } from "../lib/utils"
import CommandPalette, { useCommandPalette } from "../components/CommandPalette"
import {
  LayoutDashboard, Package, ArrowRightLeft, BarChart3, Warehouse,
  FileText, Settings, LogOut, Menu, X, ChevronDown, QrCode,
  Tags, Truck, Users, ClipboardList, FileBarChart, Sun, Moon, Shield,
  Plus, Search,
} from "lucide-react"

const menuItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    label: "Materials", icon: Package,
    children: [
      { to: "/materials/stock", label: "Stock Management", icon: Package },
      { to: "/materials/qr-generator", label: "QR Generator", icon: QrCode },
      { to: "/materials/labels", label: "Label Printing", icon: Tags },
    ],
  },
  {
    label: "Transactions", icon: ArrowRightLeft,
    children: [
      { to: "/transactions/in", label: "Goods In", icon: ArrowRightLeft },
      { to: "/transactions/out", label: "Goods Out", icon: ArrowRightLeft },
      { to: "/transactions/history", label: "History", icon: ClipboardList },
    ],
  },
  {
    label: "Analysis", icon: BarChart3,
    children: [
      { to: "/analysis/dashboard", label: "Analysis Dashboard", icon: BarChart3 },
      { to: "/analysis/material", label: "Material Analysis", icon: BarChart3 },
      { to: "/analysis/consumption", label: "Consumption", icon: BarChart3 },
      { to: "/analysis/cost", label: "Cost Analysis", icon: BarChart3 },
      { to: "/analysis/abc", label: "ABC Analysis", icon: BarChart3 },
      { to: "/analysis/forecaster", label: "Forecaster", icon: BarChart3 },
    ],
  },
  {
    label: "Warehouse", icon: Warehouse,
    children: [
      { to: "/warehouse/dashboard", label: "Warehouse Dashboard", icon: Warehouse },
      { to: "/warehouse/list", label: "Warehouses", icon: Warehouse },
      { to: "/warehouse/racks", label: "Rack/Bin", icon: Warehouse },
      { to: "/warehouse/transfer", label: "Transfer", icon: ArrowRightLeft },
      { to: "/warehouse/opname", label: "Stock Opname", icon: ClipboardList },
    ],
  },
  {
    label: "Reports", icon: FileText,
    children: [
      { to: "/reports/summary", label: "Material Summary", icon: FileBarChart },
      { to: "/reports/stock", label: "Stock Report", icon: FileText },
      { to: "/reports/transactions", label: "Transaction Report", icon: FileText },
      { to: "/reports/opname", label: "Opname Report", icon: FileText },
      { to: "/reports/multi-warehouse", label: "Multi-Warehouse", icon: BarChart3 },
      { to: "/reports/pivot", label: "Pivot Report", icon: FileText },
    ],
  },
  {
    label: "Settings", icon: Settings,
    children: [
      { to: "/settings/system", label: "System", icon: Settings },
      { to: "/settings/users", label: "Users", icon: Users },
      { to: "/settings/categories", label: "Categories", icon: Tags },
      { to: "/settings/units", label: "Units", icon: Tags },
      { to: "/settings/suppliers", label: "Suppliers", icon: Truck },
      { to: "/settings/audit-log", label: "Audit Log", icon: ClipboardList },
      { to: "/settings/roles", label: "Roles", icon: Shield },
      { to: "/settings/label-templates", label: "Label Templates", icon: Tags },
      { to: "/settings/api", label: "API Settings", icon: Settings },
    ],
  },
]

interface MenuItem {
  to?: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  children?: MenuItem[]
}

const bottomNavItems = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/materials/stock", label: "Stock", icon: Package },
  { to: "/transactions/in", label: "In", icon: Plus },
  { to: "/transactions/out", label: "Out", icon: ArrowRightLeft },
  { to: "/settings/system", label: "More", icon: Settings },
]

function SidebarItem({ item, collapsed }: { item: MenuItem; collapsed: boolean }) {
  const [open, setOpen] = useState(false)
  const Icon = item.icon

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
            collapsed && "justify-center"
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {!collapsed && <>{item.label} <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", open && "rotate-180")} /></>}
        </button>
        {open && !collapsed && (
          <div className="ml-4 space-y-1">
            {item.children.map((child) => (
              <NavLink
                key={child.to}
                to={child.to!}
                className={({ isActive }) =>
                  cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground", isActive && "bg-accent text-accent-foreground")
                }
              >
                <child.icon className="h-4 w-4" />
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <NavLink
      to={item.to!}
      className={({ isActive }) =>
        cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground", isActive && "bg-accent text-accent-foreground", collapsed && "justify-center")
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && item.label}
    </NavLink>
  )
}

function filterMenu(items: MenuItem[], can: (perm: string) => boolean): MenuItem[] {
  return items
    .map((item) => {
      if (item.to === "/settings/users" && !can("manage_users")) return null
      if (item.to === "/settings/categories" && !can("manage_settings")) return null
      if (item.to === "/settings/units" && !can("manage_settings")) return null
      if (item.to === "/settings/suppliers" && !can("manage_settings")) return null
      if (item.children) {
        const filtered = item.children.filter((child) => {
          if (child.to?.startsWith("/settings") && !can("manage_settings")) return false
          if (child.to === "/warehouse/transfer" && !can("manage_warehouse")) return false
          if (child.to === "/warehouse/opname" && !can("manage_warehouse")) return false
          return true
        })
        if (filtered.length === 0) return null
        return { ...item, children: filtered }
      }
      return item
    })
    .filter(Boolean) as MenuItem[]
}

export default function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const { user, logout, can } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()
  const { isOnline, queueLength, triggerSync, isSyncing } = useOffline()
  const navigate = useNavigate()
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette()

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        navigate("/transactions/in")
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [navigate])

  const handleLogout = () => {
    logout()
    navigate("/login")
  }

  const sidebar = (
    <aside className={cn(
      "border-r bg-background transition-all duration-300 flex flex-col",
      collapsed ? "w-16" : "w-64",
      isMobile && "fixed inset-y-0 left-0 z-40 shadow-xl",
      isMobile && !mobileOpen && "-translate-x-full"
    )}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        {!collapsed && <span className="text-lg font-bold">Thermaltrue</span>}
        {isMobile ? (
          <button onClick={() => setMobileOpen(false)} className="ml-auto rounded-md p-1 hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        ) : (
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto rounded-md p-1 hover:bg-accent">
            {collapsed ? <Menu className="h-5 w-5" /> : <X className="h-5 w-5" />}
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {filterMenu(menuItems, can).map((item) => (
          <SidebarItem key={item.label} item={item} collapsed={collapsed} />
        ))}
      </nav>
      <div className="border-t p-2 space-y-1">
        {!collapsed && user && (
          <div className="px-3 py-2 text-sm">
            <p className="font-medium">{user.full_name}</p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
              <span className={cn("inline-block h-2 w-2 rounded-full", isOnline ? "bg-green-500" : "bg-red-500")} title={isOnline ? "Online" : "Offline"} />
              {!isOnline && <span className="text-xs text-red-500">Offline</span>}
              {queueLength > 0 && (
                <span className="text-xs text-amber-500 cursor-pointer" onClick={triggerSync}>{isSyncing ? "syncing..." : `${queueLength} pending`}</span>
              )}
            </div>
          </div>
        )}
        <button onClick={() => setPaletteOpen(true)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-left">Search...</span>}
          {!collapsed && <kbd className="ml-auto text-xs text-muted-foreground border rounded px-1.5 py-0.5">Ctrl+K</kbd>}
        </button>
        <button onClick={toggleTheme} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
          {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
          {!collapsed && (
            <span className="flex-1 text-left">{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          )}
          {!collapsed && (
            <div className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors pointer-events-none",
              theme === "dark" ? "bg-primary" : "bg-muted-foreground/30"
            )}>
              <span className={cn("inline-block h-4 w-4 rounded-full bg-white transition-transform", theme === "dark" ? "translate-x-4" : "translate-x-0")} />
            </div>
          )}
        </button>
        <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors">
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && "Logout"}
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {isMobile && mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setMobileOpen(false)} />
      )}

      {/* Desktop sidebar / Mobile drawer */}
      {!isMobile && sidebar}
      {isMobile && sidebar}

      {/* Main content */}
      <main className={cn("flex-1 overflow-y-auto bg-muted/30", isMobile && "pb-16")}>
        {/* Mobile header */}
        {isMobile && (
          <div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-4 py-3">
            <button onClick={() => setMobileOpen(true)} className="rounded-md p-1 hover:bg-accent">
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-lg font-bold">Thermaltrue</span>
            <button onClick={() => setPaletteOpen(true)} className="ml-auto rounded-md p-1 hover:bg-accent">
              <Search className="h-5 w-5" />
            </button>
            <button onClick={toggleTheme} className="rounded-md p-1 hover:bg-accent">
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        )}
        <div className="p-4 md:p-6">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background flex items-center justify-around py-1 pb-2">
          {bottomNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn("flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground")
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}