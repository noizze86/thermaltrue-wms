import { useState, useEffect } from "react"
import { HashRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "./contexts/AuthContext"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Toaster } from "./components/Toaster"
import { toast } from "./hooks/use-toast"
import { AppError } from "./api"
import { ensureServer, type ServerStatus } from "./api/invoke-adapter"
import DashboardLayout from "./layouts/DashboardLayout"
import LoginPage from "./pages/LoginPage"
import DashboardPage from "./pages/dashboard/DashboardPage"
import StockPage from "./pages/materials/StockPage"
import QrGeneratorPage from "./pages/materials/QrGeneratorPage"
import LabelPrintPage from "./pages/materials/LabelPrintPage"
import TransactionInPage from "./pages/transactions/TransactionInPage"
import TransactionOutPage from "./pages/transactions/TransactionOutPage"
import TransactionHistoryPage from "./pages/transactions/TransactionHistoryPage"
import AnalysisDashboardPage from "./pages/analysis/AnalysisDashboardPage"
import MaterialAnalysisPage from "./pages/analysis/MaterialAnalysisPage"
import ConsumptionPage from "./pages/analysis/ConsumptionPage"
import CostAnalysisPage from "./pages/analysis/CostAnalysisPage"
import AbcAnalysisPage from "./pages/analysis/AbcAnalysisPage"
import ForecasterPage from "./pages/analysis/ForecasterPage"
import WarehouseDashboardPage from "./pages/warehouse/WarehouseDashboardPage"
import WarehouseListPage from "./pages/warehouse/WarehouseListPage"
import RackPage from "./pages/warehouse/RackPage"
import TransferPage from "./pages/warehouse/TransferPage"
import StockOpnamePage from "./pages/warehouse/StockOpnamePage"
import ReportSummaryPage from "./pages/reports/ReportSummaryPage"
import StockReportPage from "./pages/reports/StockReportPage"
import TransactionReportPage from "./pages/reports/TransactionReportPage"
import OpnameReportPage from "./pages/reports/OpnameReportPage"
import MultiWarehouseComparisonPage from "./pages/reports/MultiWarehouseComparisonPage"
import PivotReportPage from "./pages/reports/PivotReportPage"
import VarianceRootCausePage from "./pages/reports/VarianceRootCausePage"
import SystemPage from "./pages/settings/SystemPage"
import UsersPage from "./pages/settings/UsersPage"
import CategoriesPage from "./pages/settings/CategoriesPage"
import UnitsPage from "./pages/settings/UnitsPage"
import SuppliersPage from "./pages/settings/SuppliersPage"
import AuditLogPage from "./pages/settings/AuditLogPage"
import RolesPage from "./pages/settings/RolesPage"
import LabelTemplatesPage from "./pages/settings/LabelTemplatesPage"
import ApiSettingsPage from "./pages/settings/ApiSettingsPage"
import MasterDataPage from "./pages/MasterDataPage"

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
  const [diag, setDiag] = useState<string[]>([])
  const addDiag = (msg: string) => {
    setDiag(prev => [...prev, msg])
    console.log("[DIAG]", msg)
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      addDiag("ServerCheck mounted")
      addDiag(`window.__TAURI__: ${"__TAURI__" in window}`)
      addDiag(`window.__TAURI_INTERNALS__: ${"__TAURI_INTERNALS__" in window}`)
      addDiag(`typeof window.__TAURI_INTERNALS__: ${typeof (window as any).__TAURI_INTERNALS__}`)
      try {
        const mod = await import("@tauri-apps/api/core")
        addDiag(`core module loaded, typeof invoke: ${typeof mod.invoke}`)
        try {
          const result = await mod.invoke<ServerStatus>("ensure_server_running")
          addDiag(`invoke OK: ${result.status} - ${result.message}`)
          if (!cancelled) setCheck(result)
        } catch (e2) {
          addDiag(`invoke threw: ${e2}`)
          // fallback via ensureServer
          const result = await ensureServer()
          if (!cancelled) setCheck(result)
        }
      } catch (e1) {
        addDiag(`core import threw: ${e1}`)
        // try original ensureServer
        const result = await ensureServer()
        if (!cancelled) setCheck(result)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  if (!check) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16 }}>
        <div style={{ width: 40, height: 40, border: "4px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "#6b7280", fontSize: 14 }}>Menghubungkan ke server...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        <pre style={{ fontSize: 10, color: "#9ca3af", maxWidth: 500, whiteSpace: "pre-wrap", textAlign: "left", marginTop: 16 }}>
          {diag.join("\n")}
        </pre>
      </div>
    )
  }

  if (check.status === "running" || check.status === "started") {
    return <>{children}</>
  }

  if (check.status === "not_installed") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, padding: 24, textAlign: "center" }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#dc2626" }}>Server Belum Terinstal</h2>
        <p style={{ color: "#6b7280", maxWidth: 400 }}>{check.message}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => window.location.reload()} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Coba Lagi</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, padding: 24, textAlign: "center" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: "#dc2626" }}>Server Tidak Dijangkau</h2>
      <p style={{ color: "#6b7280", maxWidth: 400 }}>{check.message}</p>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={() => window.location.reload()} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Coba Lagi</button>
        <button onClick={() => { const u = prompt("Masukkan URL server:", localStorage.getItem("wms_api_url") || "http://localhost:3000"); if (u) { localStorage.setItem("wms_api_url", u); window.location.reload() } }} style={{ padding: "8px 16px", background: "#6b7280", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Ubah URL</button>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ServerCheck>
        <AuthProvider>
          <HashRouter>
            <ErrorBoundary>
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
                <Route path="settings/system" element={<SystemPage />} />
                <Route path="settings/users" element={<UsersPage />} />
                <Route path="settings/categories" element={<CategoriesPage />} />
                <Route path="settings/units" element={<UnitsPage />} />
                <Route path="settings/suppliers" element={<SuppliersPage />} />
                <Route path="settings/audit-log" element={<AuditLogPage />} />
                <Route path="settings/roles" element={<RolesPage />} />
                <Route path="settings/label-templates" element={<LabelTemplatesPage />} />
                <Route path="settings/api" element={<ApiSettingsPage />} />
              </Route>
            </Routes>
            <Toaster />
            </ErrorBoundary>
          </HashRouter>
        </AuthProvider>
      </ServerCheck>
    </QueryClientProvider>
  )
}
