import { invoke } from "./invoke-adapter";

export class AppError extends Error {
  type: string;
  constructor(type: string, message: string) {
    super(message);
    this.type = type;
    this.name = "AppError";
  }
}

async function invokeAuth<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const token = localStorage.getItem("wms_token");
  const finalArgs = token ? { ...args, token } : (args || {});
  try {
    return await invoke<T>(cmd, finalArgs);
  } catch (e: unknown) {
    console.error(`[invokeAuth] ${cmd} failed:`, e);
    const err = e as { type?: string; message?: string };
    if (err?.type === "Auth") {
      localStorage.removeItem("wms_token");
      localStorage.removeItem("wms_user");
      window.location.hash = "#/login";
    }
    throw new AppError(err?.type || "Unknown", err?.message || String(e));
  }
}

export interface User {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  photo: string;
  last_login_at: string | null;
  last_login_ip: string;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  password_expired?: boolean;
}

export interface ImportResult {
  imported: number;
  errors: string[];
  total: number;
}

export interface Material {
  id: string;
  sku: string;
  name: string;
  description: string;
  category_id: string | null;
  category_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  rack_id: string | null;
  quantity: number;
  min_stock: number;
  max_stock: number;
  price: number;
  image: string;
  expiry_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  transaction_number: string;
  type: string;
  material_id: string;
  warehouse_id: string | null;
  rack_id: string | null;
  quantity: number;
  price: number;
  reference: string;
  notes: string;
  user_id: string | null;
  status: string;
  approved_by: string | null;
  po_number: string;
  invoice_no: string;
  destination: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TransactionItem {
  id: string;
  tx_id: string;
  material_id: string;
  batch_id: string | null;
  quantity: number;
  price: number;
  material_name: string;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string;
  status: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoItem {
  id: string;
  po_id: string;
  material_id: string;
  quantity: number;
  price: number;
  received_qty: number;
  material_name: string;
  created_at: string;
}

export interface SalesOrder {
  id: string;
  so_number: string;
  customer_name: string;
  customer_address: string;
  status: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SoItem {
  id: string;
  so_id: string;
  material_id: string;
  quantity: number;
  price: number;
  fulfilled_qty: number;
  material_name: string;
  created_at: string;
}

export interface TransactionAttachment {
  id: string;
  tx_id: string;
  filename: string;
  data_base64: string;
  created_at: string;
}

export interface QualityInspection {
  id: string;
  tx_id: string;
  material_id: string;
  status: string;
  notes: string;
  inspected_by: string | null;
  material_name: string;
  created_at: string;
}

export interface FifoFefoSuggestion {
  batch_id: string;
  batch_no: string;
  quantity: number;
  expiry_date: string | null;
  received_at: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  location: string;
  capacity: number;
  layout_image: string;
  is_active: boolean;
  created_at: string;
}

export interface WarehouseStats {
  id: string;
  name: string;
  code: string;
  location: string;
  is_active: boolean;
  capacity: number;
  layout_image: string;
  rack_count: number;
  material_count: number;
  used_capacity: number;
  created_at: string;
}

export interface Zone {
  id: string;
  warehouse_id: string;
  name: string;
  code: string;
  capacity: number;
  created_at: string;
}

export interface Rack {
  id: string;
  warehouse_id: string;
  area: string;
  rack_name: string;
  bin_location: string;
  max_capacity: number;
  location_id: string | null;
  created_at: string;
}

export interface RackOccupancyDetail {
  rack_id: string;
  warehouse_id: string;
  rack_name: string;
  area: string;
  max_capacity: number;
  material_count: number;
  total_quantity: number;
  recent_activity: string | null;
}

export interface UtilizationEntry {
  id: string;
  date: string;
  total_quantity: number;
  created_at: string;
}

export interface PutawaySuggestion {
  rack_id: string;
  rack_name: string;
  max_capacity: number;
  used: number;
  available: number;
}

export interface StockOpname {
  id: string;
  opname_number: string;
  warehouse_id: string | null;
  status: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  cycle_mode?: string;
  deadline?: string;
  blind_mode?: boolean;
  tolerance_pct?: number;
  assigned_to?: string;
  zone_id?: string;
  recount_of?: string;
}

export interface StockOpnameItem {
  id: string;
  opname_id: string;
  material_id: string;
  system_qty: number;
  physical_qty: number;
  difference: number;
  notes: string;
  cycle_round?: number;
  approved_status?: string;
  reviewer_id?: string;
  reviewed_at?: string;
  remark?: string;
}

export interface CycleScopeItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  min_stock: number | null;
  rack_id: string;
  category_id: string;
}

export interface CycleHistoryEntry {
  id: string;
  task_id: string;
  material_id: string;
  action: string;
  before_qty: number;
  after_qty: number;
  changed_by: string;
  created_at: string;
}

export interface CycleZone {
  id: string;
  zone_id: string;
  warehouse_id: string | null;
  assign_mode: string;
  last_date: string;
  next_date: string;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
  icon: string;
  color: string;
  created_at: string;
}

export interface CategoryTreeNode {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
  icon: string;
  color: string;
  created_at: string;
  children: CategoryTreeNode[];
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  category: string;
  created_at: string;
}

export interface UnitConversion {
  id: string;
  from_unit_id: string;
  to_unit_id: string;
  factor: number;
  from_unit_name: string;
  from_unit_symbol: string;
  to_unit_name: string;
  to_unit_symbol: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  contact_person: string;
  pic_phone: string;
  pic_email: string;
  created_at: string;
}

export interface SupplierRating {
  id: string;
  supplier_id: string;
  metric: string;
  score: number;
  period: string;
  notes: string;
  created_at: string;
}

export interface SupplierPrice {
  id: string;
  supplier_id: string;
  material_id: string;
  material_name: string;
  price: number;
  date: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  username?: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string;
  created_at: string;
}

export interface DashboardKpi {
  total_materials: number;
  total_transactions: number;
  low_stock_items: number;
  total_warehouses: number;
  recent_transactions: Transaction[];
  stock_value: number;
}

export interface AnalysisItem {
  material_id: string;
  material_name: string;
  sku: string;
  quantity: number;
  turnover: number;
  last_transaction: string | null;
  days_since_last: number;
  consumption_3mo: number;
  consumption_6mo: number;
  consumption_12mo: number;
  lead_time_days: number;
  abc_class: string | null;
  forecast_qty: number;
}

export interface AbcAnalysis {
  class_a: AnalysisItem[];
  class_b: AnalysisItem[];
  class_c: AnalysisItem[];
}

export interface CompanyProfile {
  id: string;
  company_name: string;
  address: string;
  phone: string;
  email: string;
  logo: string;
  npwp: string;
  updated_at: string;
}

export interface NotificationConfig {
  id: string;
  config_key: string;
  config_value: string;
}

export interface UserActivity {
  id: string;
  activity: string;
  details: string;
  ip_address: string;
  created_at: string;
}

// Auth
export const login = (username: string, password: string) =>
  invoke<AuthResponse>("login", { req: { username, password } });

export const logout = () => invokeAuth<void>("logout", {});

// Materials
export const getMaterials = (search?: string, category_id?: string, warehouse_id?: string) =>
  invokeAuth<Material[]>("get_materials", { search, categoryId: category_id, warehouseId: warehouse_id });
export const getMaterial = (id: string) => invokeAuth<Material>("get_material", { id });
export const createMaterial = (material: Material) => invokeAuth<Material>("create_material", { material });
export const updateMaterial = (material: Material) => invokeAuth<Material>("update_material", { material });
export const deleteMaterial = (id: string) => invokeAuth<void>("delete_material", { id });
export const deleteMaterialsBulk = (ids: string[]) => invokeAuth<string>("delete_materials_bulk", { ids });
export const updateMaterialsBulk = (ids: string[], updates: Record<string, unknown>) => invokeAuth<void>("update_materials_bulk", { ids, updates });
export const importMaterialsCsv = (csvContent: string) => invokeAuth<ImportResult>("import_materials_csv", { csvContent });
export const getMaterialsLowStock = () => invokeAuth<Material[]>("get_materials_low_stock");
export const getMaterialBySku = (sku: string) => invokeAuth<Material>("get_material_by_sku", { sku });
export const getExpiringMaterials = (days: number) => invokeAuth<Material[]>("get_expiring_materials", { days });

// Transactions
export const getTransactions = (search?: string, type_filter?: string, material_id?: string, warehouse_id?: string, date_start?: string, date_end?: string, limit?: number, status_filter?: string) =>
  invokeAuth<Transaction[]>("get_transactions", { search, typeFilter: type_filter, materialId: material_id, warehouseId: warehouse_id, dateStart: date_start, dateEnd: date_end, limit, statusFilter: status_filter });

export interface TransactionDetail {
  transaction: Transaction;
  items: TransactionItem[];
}
export const getTransaction = (id: string) => invokeAuth<TransactionDetail>("get_transaction", { id });
export const createTransaction = (tx: Transaction, items?: TransactionItem[]) => invokeAuth<Transaction>("create_transaction", { tx, items: items || [] });
export const approveTransaction = (id: string) => invokeAuth<void>("approve_transaction", { id });
export const rejectTransaction = (id: string) => invokeAuth<void>("reject_transaction", { id });
export const getPendingTransactions = () => invokeAuth<Transaction[]>("get_pending_transactions");

// Warehouses
export const getWarehouses = (search?: string) => invokeAuth<Warehouse[]>("get_warehouses", { search });
export const createWarehouse = (wh: Warehouse) => invokeAuth<Warehouse>("create_warehouse", { wh });
export const updateWarehouse = (wh: Warehouse) => invokeAuth<void>("update_warehouse", { wh });
export const deleteWarehouse = (id: string) => invokeAuth<void>("delete_warehouse", { id });

// Racks
export const getRacks = (warehouse_id?: string, search?: string) => invokeAuth<Rack[]>("get_racks", { warehouseId: warehouse_id, search });
export const createRack = (rack: Rack) => invokeAuth<Rack>("create_rack", { rack });
export const updateRack = (rack: Rack) => invokeAuth<void>("update_rack", { rack });
export const deleteRack = (id: string) => invokeAuth<void>("delete_rack", { id });
export const getRackOccupancy = () => invokeAuth<{ rack_id: string; max_capacity: number; material_count: number; total_quantity: number }[]>("get_rack_occupancy");
export const getRackOccupancyDetails = () => invokeAuth<RackOccupancyDetail[]>("get_rack_occupancy_details");
export const getRackUtilizationHistory = (rack_id: string) => invokeAuth<UtilizationEntry[]>("get_rack_utilization_history", { rackId: rack_id });
export const suggestPutaway = (warehouse_id: string, material_id: string) => invokeAuth<PutawaySuggestion>("suggest_putaway", { warehouseId: warehouse_id, materialId: material_id });
export const getWarehouseStats = () => invokeAuth<WarehouseStats[]>("get_warehouse_stats");
export const getZones = (warehouse_id?: string) => invokeAuth<Zone[]>("get_zones", { warehouseId: warehouse_id });
export const createZone = (warehouse_id: string, name: string, code: string, capacity?: number) => invokeAuth<Zone>("create_zone", { warehouseId: warehouse_id, name, code, capacity });
export const updateZone = (id: string, name: string, code: string, capacity: number) => invokeAuth<void>("update_zone", { id, name, code, capacity });
export const deleteZone = (id: string) => invokeAuth<void>("delete_zone", { id });

// Locations
export interface Location {
  id: string;
  parent_id: string | null;
  warehouse_id: string;
  type_: string;
  code: string;
  created_at: string;
}
export const getLocations = (warehouse_id?: string, parent_id?: string | null) =>
  invokeAuth<Location[]>("get_locations", { warehouseId: warehouse_id, parentId: parent_id });
export const createLocation = (warehouse_id: string, parent_id: string | null, type_: string, code: string) =>
  invokeAuth<Location>("create_location", { warehouseId: warehouse_id, parentId: parent_id, type: type_, code });
export const deleteLocation = (id: string) => invokeAuth<void>("delete_location", { id });

// Stock Opname
export const getStockOpnames = () => invokeAuth<StockOpname[]>("get_stock_opnames");
export const createStockOpname = (so: StockOpname) => invokeAuth<StockOpname>("create_stock_opname", { so });
export const updateStockOpnameStatus = (id: string, status: string) =>
  invokeAuth<void>("update_stock_opname_status", { id, status });
export const getStockOpnameItems = (opname_id: string) =>
  invokeAuth<StockOpnameItem[]>("get_stock_opname_items", { opnameId: opname_id });
export const saveStockOpnameItem = (item: StockOpnameItem) =>
  invokeAuth<void>("save_stock_opname_item", { item });

// Transfer
export const transferMaterial = (material_id: string, from_warehouse_id: string, to_warehouse_id: string, quantity: number, rack_id?: string, user_id?: string) =>
  invokeAuth<void>("transfer_material", { materialId: material_id, fromWarehouseId: from_warehouse_id, toWarehouseId: to_warehouse_id, rackId: rack_id, quantity, userId: user_id });
export const transferMaterialsBulk = (transfers: Record<string, unknown>[], user_id?: string) =>
  invokeAuth<string>("transfer_materials_bulk", { transfers, userId: user_id });

// Analysis
export const getDashboardKpi = () => invokeAuth<DashboardKpi>("get_dashboard_kpi");
export const getAnalysisAll = (warehouse_id?: string) =>
  invokeAuth<AnalysisItem[]>("get_analysis_all", { warehouseId: warehouse_id || null });
export const getAbcAnalysis = (warehouse_id?: string, mode?: string) =>
  invokeAuth<AbcAnalysis>("get_abc_analysis", { warehouseId: warehouse_id || null, mode: mode || "single" });

// Fase 5 — Dashboard Health Index
export interface HealthComponent {
  score: number;
  weight: number;
}
export interface HealthIndexResponse {
  score: number;
  status: "good" | "warning" | "critical";
  trend_direction?: "▲" | "▼" | "→";
  yesterday_score?: number;
  avg_7days_score?: number;
  components: {
    inventory_accuracy: HealthComponent;
    productivity: HealthComponent;
    on_time_rate: HealthComponent;
    space_utilization: HealthComponent;
    stock_availability: HealthComponent;
  };
}
export interface BiggestLossItem {
  material_id: string;
  material_name: string;
  sku: string;
  dead_stock_loss: number;
  stockout_loss: number;
  variance_loss: number;
  total_loss: number;
}
export interface CapacityPressure {
  total_capacity: number;
  used_capacity: number;
  available_capacity: number;
  utilization_pct: number;
  avg_daily_inbound: number;
  avg_daily_outbound: number;
  days_to_full: number;
  status: "normal" | "warning" | "critical";
  capacity_pressure_score?: number;
  predicted_full_date?: string;
}
export const getHealthIndex = (warehouseId?: string) => invokeAuth<HealthIndexResponse>("get_health_index", { warehouseId });
export const getBiggestLosses = (warehouseId?: string) => invokeAuth<BiggestLossItem[]>("get_biggest_losses", { warehouseId });
export const getCapacityPressure = (warehouseId?: string) => invokeAuth<CapacityPressure>("get_capacity_pressure", { warehouseId });

// Consolidated Dashboard Metrics (Latest Row)
export interface DashboardMetricsLatest {
  health_index: number;
  accuracy_rate: number;
  productivity_rate: number;
  on_time_shipping_rate: number;
  utilization_rate: number;
  stock_availability_rate: number;
  yesterday_health_index: number;
  avg_7days_health_index: number;
  trend_direction: "▲" | "▼" | "→";
  capacity_pressure_score: number;
  predicted_full_date: string;
  capacity_status: string;
  total_capacity: number;
  used_capacity: number;
  available_capacity: number;
  utilization_pct: number;
  avg_daily_inbound: number;
  avg_daily_outbound: number;
  days_to_full: number;
  metric_date: string;
  metric_hour: string;
  updated_at: string;
}
export const getMetricsLatest = () => invokeAuth<DashboardMetricsLatest>("get_metrics_latest");
export const getComputeAll = (wh?: string) => invokeAuth<Record<string, unknown>>("get_compute_all", wh ? { warehouseId: wh } : undefined);
export const getDemandForecast = (wh?: string) => invokeAuth<Record<string, unknown>[]>("get_demand_forecast", wh ? { warehouseId: wh } : undefined);
export const getReorderSuggestions = (wh?: string) => invokeAuth<Record<string, unknown>[]>("get_reorder_suggestions", wh ? { warehouseId: wh } : undefined);

// Fase 6 — Cost Analysis
export interface CostSummary {
  total_inventory_value: number;
  total_quantity: number;
  material_count: number;
  transactions_30d: number;
  carrying_cost_rate: number;
  estimated_annual_carrying_cost: number;
  avg_purchase_price_90d: number;
  avg_value_per_material: number;
  cost_trend?: "▲" | "▼" | "→";
  yesterday_total_cost?: number;
  avg_7days_total_cost?: number;
}
export interface CarryingCostItem {
  material_id: string;
  material_name: string;
  sku: string;
  quantity: number;
  price: number;
  inventory_value: number;
  carrying_cost: number;
  shrinkage_cost: number;
  storage_cost: number;
  total_carrying_cost: number;
  carrying_cost_rate: number;
  true_unit_cost: number;
}
export interface CarryingCostResponse {
  carrying_cost_rate: number;
  items: CarryingCostItem[];
}
export interface CostToServeItem {
  transaction_id: string;
  transaction_number: string;
  type: string;
  material_name: string;
  sku: string;
  picking_cost: number;
  packing_cost: number;
  admin_cost: number;
  total_cost: number;
  order_margin: number;
  is_profitable: boolean;
}
export interface CostToServeResponse {
  total_orders_analyzed: number;
  profitable_count: number;
  unprofitable_count: number;
  profitability_rate: number;
  total_cost_all: number;
  items: CostToServeItem[];
}
export interface EfficiencyPenaltyDetail {
  transaction_type: string;
  count: number;
  avg_actual_minutes: number;
  standard_minutes: number;
  variance_minutes: number;
  penalty_per_tx: number;
  total_penalty: number;
}
export interface EfficiencyPenaltyResponse {
  hourly_labor_rate: number;
  total_efficiency_penalty: number;
  details: EfficiencyPenaltyDetail[];
}
export const getCostSummary = () => invokeAuth<CostSummary>("get_cost_summary");
export const getCarryingCost = () => invokeAuth<CarryingCostResponse>("get_carrying_cost");
export const getCostToServe = () => invokeAuth<CostToServeResponse>("get_cost_to_serve");
export const getEfficiencyPenalty = () => invokeAuth<EfficiencyPenaltyResponse>("get_efficiency_penalty");

// Fase 7 — Material Analysis
export interface MaterialSummary {
  total_materials: number;
  dead_stock_count: number;
  slow_moving_count: number;
  avg_turnover_ratio: number;
  avg_stockout_risk: number;
  high_risk_count: number;
}
export interface MaterialDetail {
  material_id: string;
  material_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  inventory_value: number;
  min_stock: number;
  max_stock: number;
  consumption_3mo: number;
  consumption_6mo: number;
  consumption_12mo: number;
  inbound_30d: number;
  outbound_30d: number;
  turnover_ratio: number;
  days_cover: number;
  stockout_risk: number;
  is_dead_stock: boolean;
  is_slow_moving: boolean;
  days_since_last_tx: number;
  last_tx_date: string;
lead_time_days: number;
  abc_class?: string | null;
  xyz_class?: string | null;
}
export const getMaterialSummary = (warehouseId?: string) => invokeAuth<MaterialSummary>("get_material_analysis_summary", { warehouseId });
export const getMaterialDetails = (warehouseId?: string) => invokeAuth<MaterialDetail[]>("get_material_analysis_details", { warehouseId });

// Fase 8 — Consumption Analysis
export interface ConsumptionSummary {
  total_consumption_3mo: number;
  total_consumption_6mo: number;
  total_consumption_12mo: number;
  avg_lead_time_days: number;
}
export interface ConsumptionDetail {
  material_id: string;
  material_name: string;
  sku: string;
  current_qty: number;
  consumption_1mo: number;
  consumption_3mo: number;
  consumption_6mo: number;
  consumption_12mo: number;
  avg_monthly_1mo: number;
  avg_monthly_3mo: number;
  avg_monthly_6mo: number;
  avg_monthly_12mo: number;
  seasonal_index: number;
  is_seasonal_high: boolean;
  is_seasonal_low: boolean;
  std_dev: number;
  lead_time_days: number;
  safety_stock: number;
  reorder_point: number;
}
export interface SeasonalEntry {
  name: string;
  avg: number;
  index: number;
  season: string;
}
export const getConsumptionSummary = (warehouseId?: string) => invokeAuth<ConsumptionSummary>("get_consumption_summary", { warehouseId });
export const getConsumptionDetails = (warehouse_id?: string) =>
  invokeAuth<ConsumptionDetail[]>("get_consumption_details", { warehouseId: warehouse_id || null });
export const getConsumptionSeasonal = (warehouseId?: string) => invokeAuth<SeasonalEntry[]>("get_consumption_seasonal", { warehouseId });

// Reports
export const exportReportCsv = (report_type: string) => invokeAuth<string>("export_report_csv", { reportType: report_type });
export const generateReportPdf = (report_type: string, opts?: { dateStart?: string; dateEnd?: string; typeFilter?: string; statusFilter?: string }) =>
  invokeAuth<number[]>("generate_report_pdf", { reportType: report_type, dateStart: opts?.dateStart, dateEnd: opts?.dateEnd, typeFilter: opts?.typeFilter, statusFilter: opts?.statusFilter });

// Phase 7 — Reports Enhancement
export interface MomKpi { current_value: number; prev_value: number; change_pct: number }
export interface AgingItem { bucket: string; count: number; total_value: number }
export interface StockMovement { material_name: string; opening: number; qty_in: number; qty_out: number; closing: number }
export interface UserTxSummary { user_id: string; user_name: string; total_count: number; total_value: number }
export interface DailyTrend { date: string; count: number; value: number }
export interface OpnameVariance { category: string; total_diff: number }
export interface CategoryValue { name: string; count: number; value: number }
export interface ReportSchedule { id: string; report_type: string; email_to: string; frequency: string; day_of_week: number; hour: number; is_active: boolean; created_at: string }

export const getMomKpis = () => invokeAuth<MomKpi[]>("get_mom_kpis");
export interface MonthlyTrend { month: string; in_count: number; out_count: number }
export const getMonthlyTransactions = () => invokeAuth<MonthlyTrend[]>("get_monthly_transactions");
export const getAgingReport = () => invokeAuth<AgingItem[]>("get_aging_report");
export const getStockMovement = (period_start: string, period_end: string) => invokeAuth<StockMovement[]>("get_stock_movement", { periodStart: period_start, periodEnd: period_end });
export const getTxTypeSummary = () => invokeAuth<CategoryValue[]>("get_tx_type_summary");
export const getTxByUser = (date_start?: string, date_end?: string) => invokeAuth<UserTxSummary[]>("get_tx_by_user", { dateStart: date_start, dateEnd: date_end });
export const getDailyTrend = (date_start: string, date_end: string) => invokeAuth<DailyTrend[]>("get_daily_trend", { dateStart: date_start, dateEnd: date_end });
export const getTxDateComparison = (a_start: string, a_end: string, b_start: string, b_end: string) => invokeAuth<DailyTrend[]>("get_tx_date_comparison", { aStart: a_start, aEnd: a_end, bStart: b_start, bEnd: b_end });
export const getOpnameVariance = (opname_id: string) => invokeAuth<OpnameVariance[]>("get_opname_variance", { opnameId: opname_id });
export const approveOpnameAdjustment = (opname_id: string, approved: boolean, itemIds?: string[]) => invokeAuth<any>("approve_opname_adjustment", { opnameId: opname_id, approved, itemIds: itemIds ?? [] });
export const exportOpnameXlsx = (opname_id: string) => invokeAuth<number[]>("export_opname_xlsx", { opnameId: opname_id });
export const getReportSchedules = () => invokeAuth<ReportSchedule[]>("get_report_schedules");
export const saveReportSchedule = (schedule: ReportSchedule) => invokeAuth<void>("save_report_schedule", { schedule });
export const deleteReportSchedule = (id: string) => invokeAuth<void>("delete_report_schedule", { id });
export const getCategoryValueSummary = () => invokeAuth<CategoryValue[]>("get_category_value_summary");

// Settings - Users
export const getUsers = () => invokeAuth<User[]>("get_users");
export const createUser = (username: string, password: string, full_name: string, role: string) =>
  invokeAuth<void>("create_user", { username, password, fullName: full_name, role });
export const updateUser = (id: string, full_name: string, email: string, role: string, is_active: boolean) =>
  invokeAuth<void>("update_user", { id, fullName: full_name, email, role, isActive: is_active });
export const changePassword = (id: string, new_password: string) =>
  invokeAuth<void>("change_password", { id, newPassword: new_password });
export const deleteUser = (id: string) => invokeAuth<void>("delete_user", { id });
export const updateUserPhoto = (id: string, photo: string) =>
  invokeAuth<void>("update_user_photo", { id, photo });
export const getUserActivity = (user_id: string) =>
  invokeAuth<UserActivity[]>("get_user_activity", { userId: user_id });
export const logUserActivity = (user_id: string, activity: string, details: string, ip_address: string) =>
  invokeAuth<void>("log_user_activity", { userId: user_id, activity, details, ipAddress: ip_address });
export const getCurrentUser = () => invokeAuth<User>("get_current_user");
export const changeMyPassword = (old_password: string, new_password: string) =>
  invokeAuth<void>("change_my_password", { oldPassword: old_password, newPassword: new_password });

// Settings - Categories
export const getCategories = (search?: string) => invokeAuth<Category[]>("get_categories", { search });
export const getCategoryTree = () => invokeAuth<CategoryTreeNode[]>("get_category_tree");
export const createCategory = (name: string, description: string, parent_id?: string | null, icon?: string, color?: string) =>
  invokeAuth<void>("create_category", { name, description, parentId: parent_id, icon: icon || "", color: color || "#6b7280" });
export const updateCategory = (id: string, name: string, description: string, parent_id?: string | null, icon?: string, color?: string) =>
  invokeAuth<void>("update_category", { id, name, description, parentId: parent_id, icon: icon || "", color: color || "#6b7280" });
export const deleteCategory = (id: string) => invokeAuth<void>("delete_category", { id });

// Settings - Units
export const getUnits = (search?: string) => invokeAuth<Unit[]>("get_units", { search });
export const createUnit = (name: string, symbol: string, category?: string) =>
  invokeAuth<void>("create_unit", { name, symbol, category: category || "" });
export const updateUnit = (id: string, name: string, symbol: string, category?: string) =>
  invokeAuth<void>("update_unit", { id, name, symbol, category: category || "" });
export const deleteUnit = (id: string) => invokeAuth<void>("delete_unit", { id });

// Settings - Unit Conversions
export const getUnitConversions = () => invokeAuth<UnitConversion[]>("get_unit_conversions");
export const createUnitConversion = (from_unit_id: string, to_unit_id: string, factor: number) =>
  invokeAuth<void>("create_unit_conversion", { fromUnitId: from_unit_id, toUnitId: to_unit_id, factor });
export const deleteUnitConversion = (id: string) => invokeAuth<void>("delete_unit_conversion", { id });
export const convertUnit = (from_unit_id: string, to_unit_id: string, quantity: number) =>
  invokeAuth<number>("convert_unit", { fromUnitId: from_unit_id, toUnitId: to_unit_id, quantity });

// Settings - Suppliers
export const getSuppliers = (search?: string) => invokeAuth<Supplier[]>("get_suppliers", { search });
export const createSupplier = (supplier: Supplier) => invokeAuth<void>("create_supplier", { supplier });
export const updateSupplier = (supplier: Supplier) => invokeAuth<void>("update_supplier", { supplier });
export const deleteSupplier = (id: string) => invokeAuth<void>("delete_supplier", { id });

// Settings - Supplier Ratings
export const getSupplierRatings = (supplier_id: string) =>
  invokeAuth<SupplierRating[]>("get_supplier_ratings", { supplierId: supplier_id });
export const createSupplierRating = (supplier_id: string, metric: string, score: number, period: string, notes: string) =>
  invokeAuth<void>("create_supplier_rating", { supplierId: supplier_id, metric, score, period, notes });

// Settings - Supplier Prices
export const getSupplierPrices = (supplier_id: string) =>
  invokeAuth<SupplierPrice[]>("get_supplier_prices", { supplierId: supplier_id });
export const createSupplierPrice = (supplier_id: string, material_id: string, price: number, date: string) =>
  invokeAuth<void>("create_supplier_price", { supplierId: supplier_id, materialId: material_id, price, date });

// Settings - Audit Log
export const getAuditLogs = () => invokeAuth<AuditLog[]>("get_audit_logs");
export const getAuditLogsFiltered = (action?: string, entity?: string, user_id?: string, date_start?: string, date_end?: string, limit?: number) =>
  invokeAuth<AuditLog[]>("get_audit_logs_filtered", { action, entity, userId: user_id, dateStart: date_start, dateEnd: date_end, limit });
export const countAuditLogsFiltered = (action?: string, entity?: string, user_id?: string, date_start?: string, date_end?: string) =>
  invokeAuth<number>("count_audit_logs_filtered", { action, entity, userId: user_id, dateStart: date_start, dateEnd: date_end });
export const addAuditLog = (user_id: string | null, action: string, entity: string, entity_id: string | null, details: string) =>
  invokeAuth<void>("add_audit_log", { userId: user_id, action, entity, entityId: entity_id, details });
export const purgeOldAuditLogs = (months: number) =>
  invokeAuth<number>("purge_old_audit_logs", { months });

// Settings - System
export const getCompanyProfile = () => invokeAuth<CompanyProfile | null>("get_company_profile");
export const saveCompanyProfile = (company_name: string, address: string, phone: string, email: string, logo: string, npwp: string) =>
  invokeAuth<void>("save_company_profile", { companyName: company_name, address, phone, email, logo, npwp });
export const backupDatabase = () => invokeAuth<string>("backup_database");
export const restoreDatabase = (backup_path: string) =>
  invokeAuth<string>("restore_database", { backupPath: backup_path });
export const getDbStats = () => invokeAuth<Record<string, number>>("get_db_stats");
export const getAppConfig = async (key: string): Promise<string> => {
  const res = await invokeAuth<unknown>("get_app_config", { key })
  if (Array.isArray(res)) {
    const first = res[0] as { value?: unknown } | undefined
    return first?.value == null ? "" : String(first.value)
  }
  return res == null ? "" : String(res)
};
export const setAppConfig = (key: string, value: string) =>
  invokeAuth<void>("set_app_config", { key, value });
export const getNotificationConfig = () => invokeAuth<NotificationConfig[]>("get_notification_config");
export const setNotificationConfig = (config_key: string, config_value: string) =>
  invokeAuth<void>("set_notification_config", { configKey: config_key, configValue: config_value });
export interface EmailConfig {
  id: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  senderName: string;
  senderEmail: string;
  useTls: boolean;
}
export const getEmailConfig = () => invokeAuth<EmailConfig | null>("get_email_config");
export const saveEmailConfig = (cfg: Omit<EmailConfig, "id">) =>
  invokeAuth<void>("save_email_config", cfg);
export const generateQrCode = (data: string) => invokeAuth<string>("generate_qr_code", { data });

// Roles / RBAC
export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string;
  is_system: boolean;
  created_at: string;
}
export const getRoles = () => invokeAuth<Role[]>("get_roles");
export const cloneRole = (source_role_id: string, new_name: string, new_description: string) =>
  invokeAuth<Role>("clone_role", { sourceRoleId: source_role_id, newName: new_name, newDescription: new_description });
export const checkPermission = (permission: string) => invokeAuth<boolean>("check_permission", { permission });
export const updateRole = (id: string, name: string, description: string, permissions: string) =>
  invokeAuth<void>("update_role", { id, name, description, permissions });
export const createRole = (name: string, description: string, permissions: string) =>
  invokeAuth<Role>("create_role", { name, description, permissions });
export const deleteRole = (id: string) =>
  invokeAuth<void>("delete_role", { id });
export const getAllAppConfig = () => invokeAuth<{ key: string; value: string }[]>("get_all_app_config");
export const deleteAppConfig = (key: string) => invokeAuth<void>("delete_app_config", { key });
export const getInventorySettings = () => invokeAuth<{ key: string; value: string }[]>("get_inventory_settings");
export const saveInventorySetting = (key: string, value: string) => invokeAuth<void>("save_inventory_setting", { key, value });
export const getUserLoginHistory = (user_id: string, limit?: number) =>
  invokeAuth<LoginHistoryEntry[]>("get_user_login_history", { userId: user_id, limit: limit || 100 });
export const exportAuditCsvFiltered = (action?: string, entity?: string, user_id?: string, date_start?: string, date_end?: string, limit?: number) =>
  invokeAuth<string>("export_audit_csv_filtered", { action, entity, userId: user_id, dateStart: date_start, dateEnd: date_end, limit });

// Phase 3 — Batches, Images, XLSX, ZPL, Valuation
export interface MaterialBatch {
  id: string;
  material_id: string;
  batch_no: string;
  qty: number;
  expiry_date: string;
  received_at: string;
  created_at: string;
}
export const getMaterialBatches = (material_id: string) => invokeAuth<MaterialBatch[]>("get_material_batches", { materialId: material_id });
export const createMaterialBatch = (material_id: string, batch_no: string, qty: number, expiry_date: string, received_at: string) =>
  invokeAuth<MaterialBatch>("create_material_batch", { materialId: material_id, batchNo: batch_no, qty, expiryDate: expiry_date, receivedAt: received_at });
export const deleteMaterialBatch = (id: string) => invokeAuth<void>("delete_material_batch", { id });

export interface MaterialImage {
  id: string;
  material_id: string;
  url: string;
  sort_order: number;
  created_at: string;
}
export const getMaterialImages = (material_id: string) => invokeAuth<MaterialImage[]>("get_material_images", { materialId: material_id });
export const createMaterialImage = (material_id: string, url: string) =>
  invokeAuth<MaterialImage>("create_material_image", { materialId: material_id, url });
export const deleteMaterialImage = (id: string) => invokeAuth<void>("delete_material_image", { id });
export const reorderMaterialImages = (ids: string[]) => invokeAuth<void>("reorder_material_images", { ids });

export interface StockValuation {
  category: string;
  value: number;
  count: number;
}
export const getStockValuation = () => invokeAuth<StockValuation[]>("get_stock_valuation");
export const importMaterialsXlsx = (xlsxBase64: string) => invokeAuth<ImportResult>("import_materials_xlsx", { xlsxBase64 });
export const exportStockXlsx = () => invokeAuth<string>("export_stock_xlsx");
export const generateZpl = (material_id: string, template_id: string) => invokeAuth<string>("generate_zpl", { materialId: material_id, templateId: template_id });
export interface StockTimelineEntry { id: string; transaction_number: string; type_: string; quantity: number; qty_before: number; qty_after: number; reference: string; notes: string; user_name: string; created_at: string; }
export const getStockTimeline = (material_id: string) => invokeAuth<StockTimelineEntry[]>("get_stock_timeline", { materialId: material_id });

// Phase 4 — Transaction enhancements
export interface TransactionItem {
  id: string;
  tx_id: string;
  material_id: string;
  batch_id: string | null;
  quantity: number;
  price: number;
  material_name: string;
  created_at: string;
}
export interface SalesOrder {
  id: string;
  so_number: string;
  customer_name: string;
  customer_address: string;
  status: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface SalesOrderWithCount {
  so: SalesOrder;
  item_count: number;
}
export interface SoItem {
  id: string;
  so_id: string;
  material_id: string;
  quantity: number;
  price: number;
  fulfilled_qty: number;
  material_name: string;
  created_at: string;
}
export interface TransactionAttachment {
  id: string;
  tx_id: string;
  filename: string;
  data_base64: string;
  created_at: string;
}

// Phase 4 — Transaction Items & Reversal
export const getTransactionItems = (tx_id: string) => invokeAuth<TransactionItem[]>("get_transaction_items", { txId: tx_id });
export const reverseTransaction = (id: string) => invokeAuth<void>("reverse_transaction", { id });
export const reverseTransactionsBulk = (ids: string[]) => invokeAuth<string>("reverse_transactions_bulk", { ids });
export const deleteTransaction = (id: string) => invokeAuth<void>("delete_transaction", { id });
export const deleteTransactionsBulk = (ids: string[]) => invokeAuth<string>("delete_transactions_bulk", { ids });

// FIFO/FEFO
export const getFifoFefoSuggestion = (material_id: string, type_: string) =>
  invokeAuth<MaterialBatch[]>("get_fifo_fefo_suggestion", { materialId: material_id, type: type_ });
export const generateTxNumber = (type_: string) =>
  invokeAuth<string>("generate_tx_number", { type: type_ });

// Purchase Orders
export const getPurchaseOrders = (search?: string, status_filter?: string) =>
  invokeAuth<PurchaseOrder[]>("get_purchase_orders", { search, statusFilter: status_filter });
export const createPurchaseOrder = (po: PurchaseOrder) => invokeAuth<PurchaseOrder>("create_purchase_order", { po });
export const updatePurchaseOrderStatus = (id: string, status: string) =>
  invokeAuth<void>("update_purchase_order_status", { id, status });
export const getPoItems = (po_id: string) => invokeAuth<PoItem[]>("get_po_items", { poId: po_id });

// Sales Orders
export const getSalesOrders = (search?: string, status_filter?: string) =>
  invokeAuth<SalesOrderWithCount[]>("get_sales_orders", { search, statusFilter: status_filter });
export const createSalesOrder = (so: SalesOrder) => invokeAuth<SalesOrder>("create_sales_order", { so });
export const updateSalesOrderStatus = (id: string, status: string) =>
  invokeAuth<void>("update_sales_order_status", { id, status });
export const getSoItems = (so_id: string) => invokeAuth<SoItem[]>("get_so_items", { soId: so_id });

// Attachments
export const getTransactionAttachments = (tx_id: string) =>
  invokeAuth<TransactionAttachment[]>("get_transaction_attachments", { txId: tx_id });
export const createTransactionAttachment = (tx_id: string, filename: string, data_base64: string) =>
  invokeAuth<void>("create_transaction_attachment", { txId: tx_id, filename, dataBase64: data_base64 });
export const deleteTransactionAttachment = (id: string) => invokeAuth<void>("delete_transaction_attachment", { id });

// Quality Inspections
export const getQualityInspections = (tx_id: string) =>
  invokeAuth<QualityInspection[]>("get_quality_inspections", { txId: tx_id });
export const createQualityInspection = (tx_id: string, material_id: string, status: string, notes: string) =>
  invokeAuth<void>("create_quality_inspection", { txId: tx_id, materialId: material_id, status, notes });

// Phase 5 — Warehouse Operations
export interface ThroughputMetric { warehouse_id: string; warehouse_name: string; in_qty: number; out_qty: number; tx_count: number }
export interface PickerActivity { user_id: string; user_name: string; pick_count: number }
export interface SlottingSuggestion { material_id: string; sku: string; name: string; current_rack: string; suggested_rack: string; reason: string }
export interface TransferOrder { id: string; transfer_number: string; from_warehouse_id: string; to_warehouse_id: string; status: string; notes: string; created_by: string | null; approved_by: string | null; created_at: string; updated_at: string }
export interface CycleSchedule { id: string; warehouse_id: string | null; class: string; frequency_days: number; next_date: string; last_date: string | null; created_at: string }

export const getThroughputMetrics = () => invokeAuth<ThroughputMetric[]>("get_throughput_metrics");
export const getPickerActivity = () => invokeAuth<PickerActivity[]>("get_picker_activity");
export const getSlottingSuggestions = () => invokeAuth<SlottingSuggestion[]>("get_slotting_suggestions");
export const getTransferOrders = (status_filter?: string) => invokeAuth<TransferOrder[]>("get_transfer_orders", { statusFilter: status_filter });
export const createTransferOrder = (from_warehouse_id: string, to_warehouse_id: string, notes: string, items: Record<string, unknown>[]) => invokeAuth<TransferOrder>("create_transfer_order", { fromWarehouseId: from_warehouse_id, toWarehouseId: to_warehouse_id, notes, items });
export const updateTransferOrderStatus = (id: string, status: string) => invokeAuth<void>("update_transfer_order_status", { id, status });
export const getTransferItems = (transfer_id: string) => invokeAuth<{ id: string; material_id: string; batch_id: string | null; quantity: number; sku: string; material_name: string }[]>("get_transfer_items", { transferId: transfer_id });
export const getCycleSchedules = () => invokeAuth<CycleSchedule[]>("get_cycle_schedules");
export const createCycleSchedule = (warehouse_id: string | null, class_: string, frequency_days: number) => invokeAuth<CycleSchedule>("create_cycle_schedule", { warehouseId: warehouse_id, class: class_, frequencyDays: frequency_days });
export const deleteCycleSchedule = (id: string) => invokeAuth<void>("delete_cycle_schedule", { id });
export const getCycleScopeItems = (warehouse_id?: string | null, category_id?: string | null, rack_id?: string | null) =>
  invokeAuth<CycleScopeItem[]>("get_cycle_scope_items", { warehouseId: warehouse_id ?? null, categoryId: category_id ?? null, rackId: rack_id ?? null });
export const getCycleTaskHistory = (task_id: string) =>
  invokeAuth<CycleHistoryEntry[]>("get_cycle_task_history", { taskId: task_id });
export const getCycleZones = () => invokeAuth<CycleZone[]>("get_cycle_zones");
export const createZoneSchedule = (zone_id: string, warehouse_id: string | null, assign_mode: string) =>
  invokeAuth<CycleZone>("create_zone_schedule", { zoneId: zone_id, warehouseId: warehouse_id, assignMode: assign_mode });
export const deleteZoneSchedule = (id: string) => invokeAuth<void>("delete_zone_schedule", { id });
export const getOpnameConfig = () => invokeAuth<{ blind_count_mode: boolean; auto_adjust_threshold: number; cycle_low_stock_trigger?: boolean }>("get_opname_config");
export const setOpnameConfig = (key: string, value: string) => invokeAuth<void>("set_opname_config", { key, value });

// ── Cycle Count Reports (Fase 3) ──
export interface CycleSummary {
  totalTasks: number; openTasks: number; totalDiscrepancy: number; avgAccuracy: number;
  byStatus: Record<string, number>;
}
export interface CycleAccuracyPoint { date: string; accuracy: number; count: number }
export interface CycleByStaffRow { user_id: string; name: string | null; actions: number; total_diff: number }
export interface CycleByLocationRow { location: string; items: number; total_diff: number }
export const getCycleSummary = () => invokeAuth<CycleSummary>("get_cycle_summary");
export const getCycleAccuracy = (days?: number) => invokeAuth<CycleAccuracyPoint[]>("get_cycle_accuracy", { days: days ?? 30 });
export const getCycleByStaff = () => invokeAuth<CycleByStaffRow[]>("get_cycle_by_staff");
export const getCycleByLocation = () => invokeAuth<CycleByLocationRow[]>("get_cycle_by_location");
export const exportCycleXlsx = () => invokeAuth<number[]>("export_cycle_xlsx");

// ── Cycle Count Recount + In-App Notifications (Fase 4) ──
export const recountCycleTask = (task_id: string) => invokeAuth<StockOpname>("recount_cycle_task", { taskId: task_id });
export interface AppNotification { id: string; user_id: string; title: string; message: string; type: string; is_read: boolean; created_at: string }
export const getNotifications = () => invokeAuth<AppNotification[]>("get_notifications");
export const markNotificationRead = (id: string) => invokeAuth<void>("mark_notification_read", { id });
export const markAllNotificationsRead = () => invokeAuth<void>("mark_all_notifications_read");

// ── Phase 9A — Budgets ──
export const getBudgets = () => invokeAuth<Budget[]>("get_budgets");
export const saveBudget = (id: string, category_id: string, period: string, amount: number) => invokeAuth<void>("save_budget", { id, categoryId: category_id, period, amount });
export const deleteBudget = (id: string) => invokeAuth<void>("delete_budget", { id });

// ── Phase 9A — ABC Weights ──
export const getAbcWeights = () => invokeAuth<AbcWeight[]>("get_abc_weights");
export const setAbcWeight = (key: string, value: number) => invokeAuth<void>("set_abc_weight", { key, value });

// ── Fase 10 — Forecast Metrics ──
export interface ForecastMetricItem {
  material_id: string;
  material_name: string;
  sku: string;
  current_qty: number;
  min_stock: number;
  forecast_1mo: number;
  forecast_3mo: number;
  forecast_6mo: number;
  confidence_lower_1mo: number;
  confidence_upper_1mo: number;
  mape: number;
  mae: number;
  rmse: number;
  trend: string;
  is_seasonal: boolean;
  recommendations: string;
  consumption_3mo: number;
  consumption_6mo: number;
  consumption_12mo: number;
}
export interface ForecastGenerateResult {
  generated: number;
  period: string;
  items: ForecastMetricItem[];
}
export interface ForecastSummaryResult {
  total_materials: number;
  forecasted: number;
  trend_up: number;
  trend_down: number;
  seasonal_count: number;
  avg_mape: number;
}
export interface ForecastDetailsItem {
  material_id: string;
  material_name: string;
  sku: string;
  forecast_1mo: number;
  forecast_3mo: number;
  forecast_6mo: number;
  confidence_lower_1mo: number;
  confidence_upper_1mo: number;
  confidence_lower_3mo: number;
  confidence_upper_3mo: number;
  confidence_lower_6mo: number;
  confidence_upper_6mo: number;
  mape: number;
  mae: number;
  rmse: number;
  trend: string;
  is_seasonal: boolean;
  recommendations: string;
}
export interface ForecastDetailsResult {
  items: ForecastDetailsItem[];
  total: number;
  period: string;
}
export const forecastGenerate = (warehouse_id?: string) =>
  invokeAuth<ForecastGenerateResult>("forecast_generate", { warehouseId: warehouse_id || "" });
export const getForecastSummary = () => invokeAuth<ForecastSummaryResult>("get_forecast_summary");
export const getForecastDetails = (material_id?: string, warehouse_id?: string) =>
  invokeAuth<ForecastDetailsResult>("get_forecast_details", { materialId: material_id || "", warehouseId: warehouse_id || "" });

// ── Fase 9 — ABC Classification (persisted) ──
export interface AbcClassifiedItem {
  material_id: string;
  material_name: string;
  sku: string;
  current_qty: number;
  unit_price: number;
  inventory_value: number;
  consumption_12mo: number;
  turnover: number;
  abc_class: string;
  xyz_class: string;
  composite_score: number;
  value_contribution_pct: number;
  days_since_last_tx: number;
}
export interface AbcClassifyResult {
  class_a: AbcClassifiedItem[];
  class_b: AbcClassifiedItem[];
  class_c: AbcClassifiedItem[];
  mode: string;
  total_materials: number;
  weights: { value_w: number; turnover_w: number; recency_w: number };
}
export interface AbcSummaryResult {
  class_a_count: number;
  class_b_count: number;
  class_c_count: number;
  total_classified: number;
}
export const abcClassify = (mode?: string, warehouse_id?: string) =>
  invokeAuth<AbcClassifyResult>("abc_classify", { mode: mode || "single", warehouseId: warehouse_id || "" });
export const getAbcSummary = () => invokeAuth<AbcSummaryResult>("get_abc_summary");

// ── Phase 9A — Forecast Cache ──
export const getForecastCache = (material_id: string, model: string, horizon: number) => invokeAuth<ForecastCache | null>("get_forecast_cache", { materialId: material_id, model, horizon });
export const setForecastCache = (material_id: string, model: string, params: string, result: string, horizon: number) => invokeAuth<void>("set_forecast_cache", { materialId: material_id, model, params, result, horizon });
export const deleteForecastCache = (material_id: string, model: string) => invokeAuth<void>("delete_forecast_cache", { materialId: material_id, model });

// ── Phase 9A — Login History ──
export const getLoginHistory = (limit: number) => invokeAuth<LoginHistoryEntry[]>("get_login_history", { limit });
export const clearLoginHistory = () => invokeAuth<void>("clear_login_history");

// ── Phase 9B — QR ZIP ──
export const generateQrZip = (items: string[]) => invokeAuth<string>("generate_qr_zip", { items });
export const autoGenerateCycleOpname = () => invokeAuth<string>("auto_generate_cycle_opname");
export const batchTransferRack = (sourceRackId: string, destWarehouseId: string, destRackId?: string) =>
  invokeAuth<string>("batch_transfer_rack", { sourceRackId, destWarehouseId, destRackId: destRackId || null });
export const generateCountSheetPdf = (warehouse_id: string) => invokeAuth<number[]>("generate_count_sheet_pdf", { warehouseId: warehouse_id });

// ── Phase 14 — Reports & Export Mastery ──
export interface WarehouseComparisonItem {
  id: string; name: string; code: string; location: string;
  material_count: number; stock_value: number; rack_count: number;
  tx_30d: number; inbound_30d: number; outbound_30d: number; opname_90d: number;
}
export const runReportSchedule = (schedule_id: string) => invokeAuth<string>("run_report_schedule", { scheduleId: schedule_id });
export const getMultiWarehouseComparison = () => invokeAuth<WarehouseComparisonItem[]>("get_multi_warehouse_comparison");
export const getPivotReport = (row_field: string, col_field: string, value_field: string, agg_function: string, date_start?: string, date_end?: string) =>
  invokeAuth<{ columns: string[]; rows: Record<string, unknown>[]; rowField: string; colField: string; valueField: string; aggFunction: string }>("get_pivot_report", { rowField: row_field, colField: col_field, valueField: value_field, aggFunction: agg_function, dateStart: date_start, dateEnd: date_end });
export const getVarianceRootCause = (opname_id: string) => invokeAuth<Record<string, unknown>[]>("get_variance_root_cause", { opnameId: opname_id });
export const previewImportXlsx = async (base64: string) => { const res = await invokeAuth<{ preview: string[][] }>("preview_import_xlsx", { xlsxBase64: base64 }); return res?.preview ?? [] };
export const generateReceiptPdf = (tx_id: string) => invokeAuth<number[]>("generate_receipt_pdf", { txId: tx_id });
export const generatePickingListPdf = (tx_id: string) => invokeAuth<number[]>("generate_picking_list_pdf", { txId: tx_id });
export const generateDoPdf = (tx_id: string) => invokeAuth<number[]>("generate_do_pdf", { txId: tx_id });

// ── Phase 9A — Interfaces ──
export interface Budget { id: string; category_id: string; period: string; amount: number; created_at: string; updated_at: string }
export interface AbcWeight { key: string; value: number }
export interface ForecastCache { id: string; material_id: string; model: string; params: string; result: string; horizon: number; created_at: string }
export interface LoginHistoryEntry { id: string; user_id: string; username: string; ip_address: string; status: string; created_at: string }

// ── Label Templates ──
export interface LabelTemplate {
  id: string;
  name: string;
  layout_style: "standard" | "branded" | "rack" | "full_card" | "mini" | "qr_only" | "two_side";
  show_sku: boolean;
  show_name: boolean;
  show_company: boolean;
  show_qty: boolean;
  show_price: boolean;
  show_barcode: boolean;
  show_qr: boolean;
  show_category: boolean;
  show_supplier: boolean;
  show_location: boolean;
  show_expiry: boolean;
  show_batch: boolean;
  show_min_stock: boolean;
  show_logo: boolean;
  show_border: boolean;
  qr_size: "small" | "medium" | "large";
  border_style: "solid" | "dashed" | "none";
  font_scale: number;
  template_type: string;
  label_width_mm: number;
  label_height_mm: number;
  created_at: string;
  updated_at: string;
}
export const getLabelTemplates = () => invokeAuth<LabelTemplate[]>("get_label_templates");
export const getLabelTemplate = (id: string) => invokeAuth<LabelTemplate>("get_label_template", { id });
export const saveLabelTemplate = (template: LabelTemplate) =>
  invokeAuth<LabelTemplate>("save_label_template", { template });
export const deleteLabelTemplate = (id: string) =>
  invokeAuth<void>("delete_label_template", { id });
