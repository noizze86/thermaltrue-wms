import { HashRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "./contexts/AuthContext"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Toaster } from "./components/Toaster"
import { toast } from "./hooks/use-toast"
import { AppError } from "./api"
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

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      onError: (err) => {
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
            </Route>
          </Routes>
          <Toaster />
          </ErrorBoundary>
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
