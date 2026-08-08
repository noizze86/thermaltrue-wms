import { useState, useEffect, useRef, lazy, Suspense } from "react"
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "./contexts/AuthContext"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Toaster } from "./components/Toaster"
import { toast } from "./hooks/use-toast"
import { AppError } from "./api"
import { ensureServer, setDetectedBaseUrl, type ServerStatus } from "./api/invoke-adapter"
import { getDetectedUrl, getDetectedUrlDisplay } from "./api/lan-detector"
import { isTauri } from "./lib/tauri"
import { useUpdateLogger } from "./hooks/useUpdateLogger"
import DashboardLayout from "./layouts/DashboardLayout"

const LoginPage = lazy(() => import("./pages/LoginPage"))
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage"))
const StockPage = lazy(() => import("./pages/materials/StockPage"))
const QrGeneratorPage = lazy(() => import("./pages/materials/QrGeneratorPage"))
const LabelPrintPage = lazy(() => import("./pages/materials/LabelPrintPage"))
const TransactionInPage = lazy(() => import("./pages/transactions/TransactionInPage"))
const TransactionOutPage = lazy(() => import("./pages/transactions/TransactionOutPage"))
const TransactionHistoryPage = lazy(() => import("./pages/transactions/TransactionHistoryPage"))
const AnalysisDashboardPage = lazy(() => import("./pages/analysis/AnalysisDashboardPage"))
const MaterialAnalysisPage = lazy(() => import("./pages/analysis/MaterialAnalysisPage"))
const ConsumptionPage = lazy(() => import("./pages/analysis/ConsumptionPage"))
const CostAnalysisPage = lazy(() => import("./pages/analysis/CostAnalysisPage"))
const AbcAnalysisPage = lazy(() => import("./pages/analysis/AbcAnalysisPage"))
const ForecasterPage = lazy(() => import("./pages/analysis/ForecasterPage"))
const WarehouseDashboardPage = lazy(() => import("./pages/warehouse/WarehouseDashboardPage"))
const WarehouseListPage = lazy(() => import("./pages/warehouse/WarehouseListPage"))
const RackPage = lazy(() => import("./pages/warehouse/RackPage"))
const TransferPage = lazy(() => import("./pages/warehouse/TransferPage"))
const StockOpnamePage = lazy(() => import("./pages/warehouse/StockOpnamePage"))
const ReportSummaryPage = lazy(() => import("./pages/reports/ReportSummaryPage"))
const StockReportPage = lazy(() => import("./pages/reports/StockReportPage"))
const TransactionReportPage = lazy(() => import("./pages/reports/TransactionReportPage"))
const OpnameReportPage = lazy(() => import("./pages/reports/OpnameReportPage"))
const MultiWarehouseComparisonPage = lazy(() => import("./pages/reports/MultiWarehouseComparisonPage"))
const PivotReportPage = lazy(() => import("./pages/reports/PivotReportPage"))
const VarianceRootCausePage = lazy(() => import("./pages/reports/VarianceRootCausePage"))
const SystemPage = lazy(() => import("./pages/settings/SystemPage"))
const UsersPage = lazy(() => import("./pages/settings/UsersPage"))
const ProfilePage = lazy(() => import("./pages/settings/ProfilePage"))
const InventorySettingsPage = lazy(() => import("./pages/settings/InventorySettingsPage"))
const TransactionDetailPage = lazy(() => import("./pages/transactions/TransactionDetailPage"))
const CategoriesPage = lazy(() => import("./pages/settings/CategoriesPage"))
const UnitsPage = lazy(() => import("./pages/settings/UnitsPage"))
const SuppliersPage = lazy(() => import("./pages/settings/SuppliersPage"))
const AuditLogPage = lazy(() => import("./pages/settings/AuditLogPage"))
const RolesPage = lazy(() => import("./pages/settings/RolesPage"))
const LabelTemplatesPage = lazy(() => import("./pages/settings/LabelTemplatesPage"))
const ApiSettingsPage = lazy(() => import("./pages/settings/ApiSettingsPage"))
const NetworkTestPage = lazy(() => import("./pages/settings/NetworkTestPage"))
const EmailSettingsPage = lazy(() => import("./pages/settings/EmailSettingsPage"))
const UpdateTestPage = lazy(() => import("./pages/settings/UpdateTestPage"))
const MasterDataPage = lazy(() => import("./pages/MasterDataPage"))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 30,
    },
    mutations: {
      onError: (err: unknown) => {
        const message = err instanceof AppError ? err.message : String(err)
        toast({ title: "Error", description: message, variant: "destructive" })
      },
    },
  },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function ServerCheck({ children }: { children: React.ReactNode }) {
  const [check, setCheck] = useState<ServerStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await ensureServer()
      if (!cancelled) setCheck(result)
    })()
    return () => { cancelled = true }
  }, [])

  if (!check) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16 }}>
        <div style={{ width: 40, height: 40, border: "4px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "#6b7280", fontSize: 14 }}>Menghubungkan ke server...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (check.status === "running" || check.status === "started") {
    return <><TauriUpdateChecker /><LanToastDetector />{children}</>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, padding: 24, textAlign: "center" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: "#dc2626" }}>Server Tidak Dijangkau</h2>
      <p style={{ color: "#6b7280", maxWidth: 400 }}>{check.message}</p>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={() => { setCheck(null); ensureServer().then(r => setCheck(r)) }} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Coba Lagi</button>
        <button onClick={() => { const u = prompt("Masukkan URL server:", getDetectedUrl() || "http://127.0.0.1:3000"); if (u) { setDetectedBaseUrl(u); window.location.reload() } }} style={{ padding: "8px 16px", background: "#6b7280", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Ubah URL</button>
      </div>
    </div>
  )
}

function TauriUpdateChecker() {
  const { phase, updateVersion } = useUpdateLogger()
  const notified = useRef(false)

  useEffect(() => {
    if (notified.current) return
    if (phase === "downloading") {
      notified.current = true
      toast({
        title: "Downloading Update",
        description: `Installing version ${updateVersion}...`,
      })
    }
    if (phase === "error") {
      notified.current = true
    }
    if (phase === "idle" || phase === "available") {
      notified.current = false
    }
  }, [phase, updateVersion])

  return null
}

function modeLabel(): string {
  if (isTauri()) return "Tauri Desktop"
  const mode = import.meta.env.MODE
  if (mode === "development") return "Development"
  return "Browser"
}

function urlSource(): string {
  if (import.meta.env.VITE_API_URL) return "Konfigurasi (.env)"
  const display = getDetectedUrlDisplay()
  if (display && !display.isExpired) return "Cache tersimpan"
  return "LAN Scan"
}

function LanToastDetector() {
  const [notified, setNotified] = useState(false);
  useEffect(() => {
    if (notified) return;
    const url = getDetectedUrl();
    if (url) {
      toast({
        title: "Terhubung ke server",
        description: `API: ${url}\nMode: ${modeLabel()} | Sumber: ${urlSource()}`,
      });
    }
    setNotified(true);
  }, [notified]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ServerCheck>
        <AuthProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </AuthProvider>
      </ServerCheck>
    </QueryClientProvider>
  )
}

function AppRoutes() {
  const location = useLocation()
  return (
    // key=pathname: error boundary reset when navigating to a different page,
    // so a crashed page never blocks the rest of the app.
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading&hellip;</div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="materials/master-data" element={<MasterDataPage />} />
            <Route path="materials/stock" element={<StockPage />} />
            <Route path="materials/qr-generator" element={<QrGeneratorPage />} />
            <Route path="materials/labels" element={<LabelPrintPage />} />
            <Route path="transactions/in" element={<TransactionInPage />} />
            <Route path="transactions/out" element={<TransactionOutPage />} />
            <Route path="transactions/history" element={<TransactionHistoryPage />} />
            <Route path="transactions/:id" element={<TransactionDetailPage />} />
            <Route path="analysis/dashboard" element={<AnalysisDashboardPage />} />
            <Route path="analysis/material" element={<MaterialAnalysisPage />} />
            <Route path="analysis/consumption" element={<ConsumptionPage />} />
            <Route path="analysis/cost" element={<CostAnalysisPage />} />
            <Route path="analysis/abc" element={<AbcAnalysisPage />} />
            <Route path="analysis/forecaster" element={<ForecasterPage />} />
            <Route path="warehouse/dashboard" element={<WarehouseDashboardPage />} />
            <Route path="warehouse/list" element={<WarehouseListPage />} />
            <Route path="warehouse/racks" element={<RackPage />} />
            <Route path="warehouse/transfer" element={<TransferPage />} />
            <Route path="warehouse/opname" element={<StockOpnamePage />} />
            <Route path="reports/summary" element={<ReportSummaryPage />} />
            <Route path="reports/stock" element={<StockReportPage />} />
            <Route path="reports/transactions" element={<TransactionReportPage />} />
            <Route path="reports/opname" element={<OpnameReportPage />} />
            <Route path="reports/multi-warehouse" element={<MultiWarehouseComparisonPage />} />
            <Route path="reports/pivot" element={<PivotReportPage />} />
            <Route path="reports/variance/:opnameId" element={<VarianceRootCausePage />} />
            <Route path="settings/profile" element={<ProfilePage />} />
            <Route path="settings/system" element={<SystemPage />} />
            <Route path="settings/users" element={<UsersPage />} />
            <Route path="settings/categories" element={<CategoriesPage />} />
            <Route path="settings/units" element={<UnitsPage />} />
            <Route path="settings/suppliers" element={<SuppliersPage />} />
            <Route path="settings/audit-log" element={<AuditLogPage />} />
            <Route path="settings/roles" element={<RolesPage />} />
            <Route path="settings/label-templates" element={<LabelTemplatesPage />} />
            <Route path="settings/email" element={<EmailSettingsPage />} />
            <Route path="settings/inventory" element={<InventorySettingsPage />} />
            <Route path="settings/api" element={<ApiSettingsPage />} />
            <Route path="settings/network-test" element={<NetworkTestPage />} />
            <Route path="settings/update-test" element={<UpdateTestPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </ErrorBoundary>
  )
}
