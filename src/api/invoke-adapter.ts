const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window && !import.meta.env.VITE_FORCE_HTTP;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface Route {
  method: HttpMethod;
  path: string | ((args: Record<string, unknown>) => string);
  body?: boolean;
}

const ROUTES: Record<string, Route> = {
  // Auth
  login:               { method: "POST", path: "/api/login", body: true },
  logout:              { method: "POST", path: "/api/logout", body: false },

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
  delete_zone:         { method: "DELETE", path: (a) => `/api/warehouses/zones/${a.id}` },

  // Racks
  get_racks:           { method: "GET", path: "/api/racks" },
  create_rack:         { method: "POST", path: "/api/racks", body: true },
  update_rack:         { method: "PUT", path: (a) => `/api/racks/${a.rack?.id || a.id}`, body: true },
  delete_rack:         { method: "DELETE", path: (a) => `/api/racks/${a.id}` },
  get_rack_occupancy:  { method: "GET", path: "/api/racks/occupancy" },
  get_rack_occupancy_details: { method: "GET", path: "/api/racks/occupancy-details" },

  // Transactions
  get_transactions:    { method: "GET", path: "/api/transactions" },
  create_transaction:  { method: "POST", path: "/api/transactions", body: true },
  approve_transaction: { method: "POST", path: (a) => `/api/transactions/${a.id}/approve` },
  reject_transaction:  { method: "POST", path: (a) => `/api/transactions/${a.id}/reject` },
  get_pending_transactions: { method: "GET", path: "/api/transactions/pending" },
};

async function httpCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const route = ROUTES[cmd];
  if (!route) {
    throw { type: "Unknown", message: `Command "${cmd}" not available in HTTP mode` };
  }

  const path = typeof route.path === "function" ? route.path(args) : route.path;
  const token = localStorage.getItem("wms_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let url = `${API_BASE}${path}`;
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
    body = JSON.stringify(args);
  }

  const res = await fetch(url, { method: route.method, headers, body });
  if (res.status === 401) {
    localStorage.removeItem("wms_token");
    localStorage.removeItem("wms_user");
    window.location.href = "/login";
    throw { type: "Auth", message: "Session expired" };
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw { type: errBody?.type || "HttpError", message: errBody?.error || res.statusText };
  }
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as unknown as T);
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args);
  }
  return httpCall<T>(cmd, args || {});
}
