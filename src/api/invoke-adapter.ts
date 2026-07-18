const STORAGE_KEY = "wms_api_url";

function getApiBase(): string {
  return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_API_URL || "http://localhost:3000";
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window && !import.meta.env.VITE_FORCE_HTTP;
}

function isInWebView(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

// Tauri 2 blocks native fetch() from webview — use @tauri-apps/plugin-http instead
let tauriFetch: typeof globalThis.fetch | null = null;
async function resolveFetch(): Promise<typeof globalThis.fetch> {
  if (!isInWebView()) return globalThis.fetch;
  if (tauriFetch) return tauriFetch;
  const mod = await import("@tauri-apps/plugin-http");
  tauriFetch = mod.fetch;
  return tauriFetch;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface Route {
  method: HttpMethod;
  path: string | ((args: any) => string);
  body?: boolean;
}

const ROUTES: Record<string, Route> = {
  // Auth
  login:               { method: "POST", path: "/api/login", body: true },
  logout:              { method: "POST", path: "/api/logout", body: false },

  // Users
  get_users:           { method: "GET", path: "/api/users" },
  get_current_user:    { method: "GET", path: "/api/users/me" },
  create_user:         { method: "POST", path: "/api/users", body: true },
  update_user:         { method: "PUT", path: (a) => `/api/users/${a.id}`, body: true },
  delete_user:         { method: "DELETE", path: (a) => `/api/users/${a.id}` },
  change_password:     { method: "POST", path: (a) => `/api/users/${a.id}/change-password`, body: true },
  update_user_photo:   { method: "PUT", path: (a) => `/api/users/${a.id}/photo`, body: true },
  get_user_activity:   { method: "GET", path: (a) => `/api/users/${a.userId}/activity` },
  log_user_activity:   { method: "POST", path: (a) => `/api/users/${a.userId}/log-activity`, body: true },
  change_my_password:  { method: "POST", path: "/api/users/me/change-password", body: true },

  // Materials
  get_materials:       { method: "GET", path: "/api/materials" },
  get_material:        { method: "GET", path: (a) => `/api/materials/${a.id}` },
  create_material:     { method: "POST", path: "/api/materials", body: true },
  update_material:     { method: "PUT", path: (a) => `/api/materials/${a.material?.id || a.id}`, body: true },
  delete_material:     { method: "DELETE", path: (a) => `/api/materials/${a.id}` },
  delete_materials_bulk: { method: "POST", path: "/api/materials/bulk-delete", body: true },
  update_materials_bulk: { method: "PUT", path: "/api/materials/bulk-update", body: true },
  import_materials_csv: { method: "POST", path: "/api/materials/import-csv", body: true },
  get_materials_low_stock: { method: "GET", path: "/api/materials/low-stock" },
  get_expiring_materials: { method: "GET", path: (a) => `/api/materials/expiring/${a.days}` },
  import_materials_xlsx:  { method: "POST", path: "/api/materials/import-xlsx", body: true },
  preview_import_xlsx:    { method: "POST", path: "/api/materials/preview-import-xlsx", body: true },
  export_stock_xlsx:      { method: "GET", path: "/api/materials/export-stock-xlsx" },
  generate_zpl:           { method: "POST", path: "/api/materials/generate-zpl", body: true },
  get_stock_timeline:     { method: "GET", path: (a) => `/api/materials/stock-timeline/${a.materialId}` },
  get_material_batches:   { method: "GET", path: (a) => `/api/materials/${a.materialId}/batches` },
  create_material_batch:  { method: "POST", path: "/api/materials/batches", body: true },
  delete_material_batch:  { method: "DELETE", path: (a) => `/api/materials/batches/${a.id}` },
  get_material_images:    { method: "GET", path: (a) => `/api/materials/${a.materialId}/images` },
  create_material_image:  { method: "POST", path: "/api/materials/images", body: true },
  delete_material_image:  { method: "DELETE", path: (a) => `/api/materials/images/${a.id}` },
  reorder_material_images:{ method: "PUT", path: "/api/materials/images/reorder", body: true },

  // Categories
  get_categories:      { method: "GET", path: "/api/categories" },
  get_category_tree:   { method: "GET", path: "/api/categories/tree" },
  create_category:     { method: "POST", path: "/api/categories", body: true },
  update_category:     { method: "PUT", path: "/api/categories", body: true },
  delete_category:     { method: "DELETE", path: (a) => `/api/categories/${a.id}` },

  // Units
  get_units:           { method: "GET", path: "/api/units" },
  create_unit:         { method: "POST", path: "/api/units", body: true },
  update_unit:         { method: "PUT", path: "/api/units", body: true },
  delete_unit:         { method: "DELETE", path: (a) => `/api/units/${a.id}` },
  get_unit_conversions: { method: "GET", path: "/api/units/conversions" },
  create_unit_conversion: { method: "POST", path: "/api/units/conversions", body: true },

  // Suppliers
  get_suppliers:       { method: "GET", path: "/api/suppliers" },
  create_supplier:     { method: "POST", path: "/api/suppliers", body: true },
  update_supplier:     { method: "PUT", path: "/api/suppliers", body: true },
  delete_supplier:     { method: "DELETE", path: (a) => `/api/suppliers/${a.id}` },
  get_supplier_ratings: { method: "GET", path: (a) => `/api/suppliers/${a.supplierId}/ratings` },
  create_supplier_rating: { method: "POST", path: "/api/suppliers/ratings", body: true },
  get_supplier_prices: { method: "GET", path: (a) => `/api/suppliers/${a.supplierId}/prices` },
  create_supplier_price: { method: "POST", path: "/api/suppliers/prices", body: true },

  // Warehouses
  get_warehouses:      { method: "GET", path: "/api/warehouses" },
  get_warehouse_stats: { method: "GET", path: "/api/warehouses/stats" },
  create_warehouse:    { method: "POST", path: "/api/warehouses", body: true },
  update_warehouse:    { method: "PUT", path: (a) => `/api/warehouses/${a.wh?.id || a.id}`, body: true },
  delete_warehouse:    { method: "DELETE", path: (a) => `/api/warehouses/${a.id}` },
  get_zones:           { method: "GET", path: "/api/warehouses/zones" },
  create_zone:         { method: "POST", path: "/api/warehouses/zones", body: true },
  update_zone:         { method: "PUT", path: "/api/warehouses/zones", body: true },
  delete_zone:         { method: "DELETE", path: (a) => `/api/warehouses/zones/${a.id}` },
  get_locations:       { method: "GET", path: "/api/warehouses/locations" },
  create_location:     { method: "POST", path: "/api/warehouses/locations", body: true },
  delete_location:     { method: "DELETE", path: (a) => `/api/warehouses/locations/${a.id}` },

  // Racks
  get_racks:           { method: "GET", path: "/api/racks" },
  create_rack:         { method: "POST", path: "/api/racks", body: true },
  update_rack:         { method: "PUT", path: (a) => `/api/racks/${a.rack?.id || a.id}`, body: true },
  delete_rack:         { method: "DELETE", path: (a) => `/api/racks/${a.id}` },
  get_rack_occupancy:  { method: "GET", path: "/api/racks/occupancy" },
  get_rack_occupancy_details: { method: "GET", path: "/api/racks/occupancy-details" },
  get_rack_utilization_history: { method: "GET", path: (a) => `/api/racks/${a.rackId}/utilization` },
  suggest_putaway:     { method: "GET", path: "/api/racks/putaway-suggestion" },

  // Transactions
  get_transactions:    { method: "GET", path: "/api/transactions" },
  get_transaction:     { method: "GET", path: (a) => `/api/transactions/${a.id}` },
  create_transaction:  { method: "POST", path: "/api/transactions", body: true },
  approve_transaction: { method: "POST", path: (a) => `/api/transactions/${a.id}/approve` },
  reject_transaction:  { method: "POST", path: (a) => `/api/transactions/${a.id}/reject` },
  reverse_transaction: { method: "POST", path: (a) => `/api/transactions/${a.id}/reverse` },
  reverse_transactions_bulk: { method: "POST", path: "/api/transactions/reverse-bulk", body: true },
  get_pending_transactions: { method: "GET", path: "/api/transactions/pending" },
  get_transaction_items: { method: "GET", path: (a) => `/api/transactions/${a.txId}/items` },
  generate_tx_number:  { method: "GET", path: "/api/transactions/generate-number" },
  get_transaction_attachments: { method: "GET", path: (a) => `/api/transactions/${a.txId}/attachments` },
  create_transaction_attachment: { method: "POST", path: "/api/transactions/attachments", body: true },
  delete_transaction_attachment: { method: "DELETE", path: (a) => `/api/transactions/attachments/${a.id}` },
  // Purchase Orders
  get_purchase_orders: { method: "GET", path: "/api/purchase-orders" },
  create_purchase_order: { method: "POST", path: "/api/purchase-orders", body: true },
  update_purchase_order_status: { method: "PUT", path: (a) => `/api/purchase-orders/${a.id}/status`, body: true },
  get_po_items:        { method: "GET", path: (a) => `/api/purchase-orders/${a.poId}/items` },
  // Sales Orders
  get_sales_orders:    { method: "GET", path: "/api/sales-orders" },
  create_sales_order:  { method: "POST", path: "/api/sales-orders", body: true },
  update_sales_order_status: { method: "PUT", path: (a) => `/api/sales-orders/${a.id}/status`, body: true },
  get_so_items:        { method: "GET", path: (a) => `/api/sales-orders/${a.soId}/items` },
  // Quality Inspections
  get_quality_inspections: { method: "GET", path: "/api/quality-inspections" },
  create_quality_inspection: { method: "POST", path: "/api/quality-inspections", body: true },
  // FIFO/FEFO
  get_fifo_fefo_suggestion: { method: "GET", path: "/api/fifo-fefo-suggestion" },

  // Stock Opname
  get_stock_opnames:       { method: "GET", path: "/api/stock-opnames" },
  create_stock_opname:     { method: "POST", path: "/api/stock-opnames", body: true },
  update_stock_opname_status: { method: "PUT", path: (a) => `/api/stock-opnames/${a.id}/status`, body: true },
  get_stock_opname_items:  { method: "GET", path: (a) => `/api/stock-opnames/${a.opnameId}/items` },
  save_stock_opname_item:  { method: "POST", path: "/api/stock-opnames/items", body: true },
  get_opname_config:       { method: "GET", path: "/api/stock-opname-config" },
  set_opname_config:       { method: "PUT", path: "/api/stock-opname-config", body: true },
  get_cycle_schedules:     { method: "GET", path: "/api/cycle-schedules" },
  create_cycle_schedule:   { method: "POST", path: "/api/cycle-schedules", body: true },
  delete_cycle_schedule:   { method: "DELETE", path: (a) => `/api/cycle-schedules/${a.id}` },
  auto_generate_cycle_opname: { method: "POST", path: "/api/cycle-opname/generate" },

  // Transfers
  transfer_material:       { method: "POST", path: "/api/transfers/material", body: true },
  transfer_materials_bulk: { method: "POST", path: "/api/transfers/bulk", body: true },
  batch_transfer_rack:     { method: "POST", path: "/api/transfers/rack", body: true },
  get_transfer_orders:     { method: "GET", path: "/api/transfer-orders" },
  create_transfer_order:   { method: "POST", path: "/api/transfer-orders", body: true },
  update_transfer_order_status: { method: "PUT", path: (a) => `/api/transfer-orders/${a.id}/status`, body: true },
  get_transfer_items:      { method: "GET", path: (a) => `/api/transfer-orders/${a.transferId}/items` },

  // Dashboard
  get_dashboard_kpi:       { method: "GET", path: "/api/dashboard/kpi" },
  get_demand_forecast:     { method: "GET", path: "/api/dashboard/demand-forecast" },
  get_reorder_suggestions: { method: "GET", path: "/api/dashboard/reorder-suggestions" },
  get_analysis_all:        { method: "GET", path: "/api/dashboard/analysis" },
  get_abc_analysis:        { method: "GET", path: "/api/dashboard/abc" },
  get_mom_kpis:            { method: "GET", path: "/api/reports/mom-kpis" },
  get_aging_report:        { method: "GET", path: "/api/reports/aging" },
  get_stock_movement:      { method: "GET", path: "/api/reports/stock-movement" },
  get_tx_type_summary:     { method: "GET", path: "/api/reports/tx-type-summary" },
  get_tx_by_user:          { method: "GET", path: "/api/reports/tx-by-user" },
  get_daily_trend:         { method: "GET", path: "/api/reports/daily-trend" },
  get_tx_date_comparison:  { method: "GET", path: "/api/reports/tx-date-comparison" },
  get_category_value_summary: { method: "GET", path: "/api/reports/category-value-summary" },
  get_stock_valuation:     { method: "GET", path: "/api/stock-valuation" },
  get_opname_variance:     { method: "GET", path: (a) => `/api/reports/opname-variance/${a.opnameId}` },

  // Throughput & Picker
  get_throughput_metrics:  { method: "GET", path: "/api/warehouse/throughput" },
  get_picker_activity:     { method: "GET", path: "/api/warehouse/picker-activity" },
  get_slotting_suggestions:{ method: "GET", path: "/api/warehouse/slotting-suggestions" },

  // Budgets
  get_budgets:             { method: "GET", path: "/api/budgets" },
  save_budget:             { method: "POST", path: "/api/budgets", body: true },
  delete_budget:           { method: "DELETE", path: (a) => `/api/budgets/${a.id}` },

  // ABC Weights
  get_abc_weights:         { method: "GET", path: "/api/abc-weights" },
  set_abc_weight:          { method: "POST", path: "/api/abc-weights", body: true },

  // Forecast Cache
  get_forecast_cache:      { method: "GET", path: "/api/forecast-cache" },
  set_forecast_cache:      { method: "POST", path: "/api/forecast-cache", body: true },
  delete_forecast_cache:   { method: "DELETE", path: "/api/forecast-cache" },

  // Login History
  get_login_history:       { method: "GET", path: "/api/login-history" },
  get_user_login_history:  { method: "GET", path: (a) => `/api/login-history/user/${a.userId}` },
  clear_login_history:     { method: "DELETE", path: "/api/login-history" },

  // QR ZIP
  generate_qr_zip:         { method: "POST", path: "/api/qr-zip-generate", body: true },

  // Label Templates
  get_label_templates:     { method: "GET", path: "/api/label-templates" },
  get_label_template:      { method: "GET", path: (a) => `/api/label-templates/${a.id}` },
  create_label_template:   { method: "POST", path: "/api/label-templates", body: true },
  update_label_template:   { method: "PUT", path: "/api/label-templates", body: true },
  save_label_template:     { method: "POST", path: "/api/label-templates", body: true },
  delete_label_template:   { method: "DELETE", path: (a) => `/api/label-templates/${a.id}` },

  // Company Profile
  get_company_profile:     { method: "GET", path: "/api/company-profile" },
  save_company_profile:    { method: "POST", path: "/api/company-profile", body: true },

  // Notification Config
  get_notification_config: { method: "GET", path: "/api/notification-config" },
  save_notification_config:{ method: "POST", path: "/api/notification-config", body: true },
  set_notification_config: { method: "POST", path: "/api/notification-config", body: true },

  // Roles
  get_roles:               { method: "GET", path: "/api/roles" },
  create_role:             { method: "POST", path: "/api/roles", body: true },
  update_role:             { method: "PUT", path: "/api/roles", body: true },
  delete_role:             { method: "DELETE", path: (a) => `/api/roles/${a.id}` },

  // App Config
  get_app_config:          { method: "GET", path: "/api/app-config" },
  set_app_config:          { method: "POST", path: "/api/app-config", body: true },

  // Inventory Settings
  get_inventory_settings:  { method: "GET", path: "/api/inventory-settings" },
  save_inventory_setting:  { method: "POST", path: "/api/inventory-settings", body: true },

  // Audit Logs
  get_audit_logs:          { method: "GET", path: "/api/audit-logs" },
  get_audit_logs_filtered: { method: "GET", path: "/api/audit-logs/filtered" },
  count_audit_logs_filtered: { method: "GET", path: "/api/audit-logs/filtered/count" },

  // System
  get_db_stats:            { method: "GET", path: "/api/db-stats" },

  // Reports
  export_report_csv:       { method: "GET", path: "/api/reports/csv" },
  export_report_pdf:       { method: "GET", path: "/api/reports/pdf" },
  generate_report_pdf:     { method: "GET", path: "/api/reports/pdf" },
  export_report_xlsx:      { method: "GET", path: "/api/reports/opname/export-xlsx" },
  export_opname_xlsx:      { method: "GET", path: "/api/reports/opname/export-xlsx" },
  approve_opname_report:   { method: "POST", path: "/api/reports/opname/approve", body: true },
  approve_opname_adjustment:{ method: "POST", path: "/api/reports/opname/approve", body: true },
  get_report_schedules:    { method: "GET", path: "/api/reports/schedules" },
  save_report_schedule:    { method: "POST", path: "/api/reports/schedules", body: true },
  delete_report_schedule:  { method: "DELETE", path: (a) => `/api/reports/schedules/${a.id}` },
  run_report_schedule:     { method: "POST", path: (a) => `/api/reports/schedules/${a.id}/run` },
  get_multi_warehouse_comparison: { method: "GET", path: "/api/reports/multi-warehouse" },
  multi_warehouse_report:  { method: "GET", path: "/api/reports/multi-warehouse" },
  get_pivot_report:        { method: "POST", path: "/api/reports/pivot", body: true },
  generate_receipt_pdf:    { method: "GET", path: "/api/reports/receipt-pdf" },
  generate_picking_list_pdf: { method: "GET", path: "/api/reports/picking-list-pdf" },
  generate_do_pdf:         { method: "GET", path: "/api/reports/do-pdf" },
  get_variance_root_cause: { method: "GET", path: (a) => `/api/reports/opname-variance/${a.opnameId}` },
};

async function httpCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const route = ROUTES[cmd];
  if (!route) {
    throw { type: "Unknown", message: `Command "${cmd}" not available in HTTP mode` };
  }

  const path = typeof route.path === "function" ? route.path(args) : route.path;
  // Auth is handled by httpOnly cookie set on login; no need to send Authorization header
  const headers: Record<string, string> = {};

  let url = `${getApiBase()}${path}`;
  let body: string | undefined;

  if (route.method === "GET") {
    const qp = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== null && !["id", "token"].includes(k)) {
        qp.set(k, String(v));
      }
    }
    const qs = qp.toString();
    if (qs) url += `?${qs}`;
  } else if (route.body) {
    headers["Content-Type"] = "application/json";
    const { token: _token, ...clean } = args;
    const keys = Object.keys(clean);
    if (keys.length === 1 && typeof clean[keys[0]] === "object" && clean[keys[0]] !== null && !Array.isArray(clean[keys[0]])) {
      body = JSON.stringify(clean[keys[0]]);
    } else {
      body = JSON.stringify(clean);
    }
  }

  const doFetch = await resolveFetch();
  let res: Response;
  try {
    res = await doFetch(url, { method: route.method, headers, body, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    console.error(`[httpCall] fetch error for ${cmd} ${route.method} ${url}:`, e);
    throw { type: "Network", message: `Failed to connect to ${url}. ${e instanceof DOMException && e.name === 'TimeoutError' ? 'Request timed out.' : 'Check that the server is running.'}` };
  }
  if (res.status === 401) {
    localStorage.removeItem("wms_token");
    localStorage.removeItem("wms_user");
    window.location.href = "/login";
    throw { type: "Auth", message: "Session expired or not logged in" };
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw { type: errBody?.type || "HttpError", message: errBody?.error || res.statusText };
  }
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as unknown as T);
}

export interface ServerStatus {
  status: "running" | "started" | "not_installed" | "start_failed" | "timeout" | "unreachable" | "unknown";
  message: string;
}

export async function ensureServer(): Promise<ServerStatus> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<ServerStatus>("ensure_server_running");
  }
  // HTTP mode: just check health directly
  const base = getApiBase();
  const doFetch = await resolveFetch();
  try {
    const res = await doFetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      return { status: "running", message: "Server is reachable." };
    }
    return { status: "unreachable", message: `Server returned ${res.status}` };
  } catch {
    return { status: "unreachable", message: `Cannot connect to ${base}. Ensure the server is running.` };
  }
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args);
  }
  return httpCall<T>(cmd, args || {});
}
