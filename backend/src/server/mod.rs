use std::sync::Arc;
use std::path::Path;
use axum::{Router, routing::{get, post, put, delete}, middleware, Json, middleware::Next, extract::Request, response::{IntoResponse, Response}, body::Body, http::{Method, StatusCode, Uri, header::{AUTHORIZATION, COOKIE}}};

use tower_http::cors::CorsLayer;
use tokio::fs as async_fs;
use crate::db_pool::DbPool;

pub mod handlers;

pub fn create_router(pool: DbPool) -> Router {
    let state = Arc::new(pool);
    Router::new()
        // Health
        .route("/api/health", get(health))
        // Auth
        .route("/api/login", post(handlers::auth::login))
        .route("/api/logout", post(handlers::auth::logout))
        // Users
        .route("/api/users", get(handlers::users::list))
        .route("/api/users/me", get(handlers::users::get_me))
        .route("/api/users", post(handlers::users::create))
        .route("/api/users/:id", put(handlers::users::update))
        .route("/api/users/:id", delete(handlers::users::delete))
        .route("/api/users/:id/change-password", post(handlers::users::change_password))
        .route("/api/users/me/change-password", post(handlers::users::change_my_password))
        .route("/api/users/:id/photo", put(handlers::users::update_photo))
        .route("/api/users/:id/activity", get(handlers::users::get_activity))
        .route("/api/users/:id/log-activity", post(handlers::users::log_activity))
        // Stock Opname
        .route("/api/stock-opnames", get(handlers::stock_opname::list))
        .route("/api/stock-opnames", post(handlers::stock_opname::create))
        .route("/api/stock-opnames/:id/status", put(handlers::stock_opname::update_status))
        .route("/api/stock-opnames/:id/items", get(handlers::stock_opname::get_items))
        .route("/api/stock-opnames/items", post(handlers::stock_opname::save_item))
        .route("/api/stock-opname-config", get(handlers::stock_opname::get_config))
        .route("/api/stock-opname-config", put(handlers::stock_opname::set_config))
        .route("/api/cycle-schedules", get(handlers::stock_opname::get_cycle_schedules))
        .route("/api/cycle-schedules", post(handlers::stock_opname::create_cycle_schedule))
        .route("/api/cycle-schedules/:id", delete(handlers::stock_opname::delete_cycle_schedule))
        .route("/api/cycle-opname/generate", post(handlers::stock_opname::auto_generate))
        // Transfers
        .route("/api/transfers/material", post(handlers::transfers::transfer_material))
        .route("/api/transfers/bulk", post(handlers::transfers::transfer_bulk))
        .route("/api/transfers/rack", post(handlers::transfers::batch_transfer_rack))
        .route("/api/transfer-orders", get(handlers::transfers::get_transfer_orders))
        .route("/api/transfer-orders", post(handlers::transfers::create_transfer_order))
        .route("/api/transfer-orders/:id/status", put(handlers::transfers::update_transfer_order_status))
        .route("/api/transfer-orders/:id/items", get(handlers::transfers::get_transfer_items))
        // Dashboard & Metrics
        .route("/api/dashboard/kpi", get(handlers::dashboard::kpi))
        .route("/api/dashboard/analysis", get(handlers::dashboard::analysis_all))
        .route("/api/dashboard/abc", get(handlers::dashboard::abc_analysis))
        .route("/api/reports/mom-kpis", get(handlers::dashboard::mom_kpis))
        .route("/api/reports/aging", get(handlers::dashboard::aging_report))
        .route("/api/reports/stock-movement", get(handlers::dashboard::stock_movement))
        .route("/api/reports/tx-type-summary", get(handlers::dashboard::tx_type_summary))
        .route("/api/reports/tx-by-user", get(handlers::dashboard::tx_by_user))
        .route("/api/reports/daily-trend", get(handlers::dashboard::daily_trend))
        .route("/api/reports/tx-date-comparison", get(handlers::dashboard::tx_date_comparison))
        .route("/api/reports/category-value-summary", get(handlers::dashboard::category_value_summary))
        .route("/api/stock-valuation", get(handlers::dashboard::stock_valuation))
        .route("/api/reports/opname-variance/:id", get(handlers::dashboard::opname_variance))
        .route("/api/dashboard/demand-forecast", get(handlers::dashboard::demand_forecast))
        .route("/api/dashboard/reorder-suggestions", get(handlers::dashboard::reorder_suggestions))
        // Throughput & Picker
        .route("/api/warehouse/throughput", get(handlers::transfers::get_throughput_metrics))
        .route("/api/warehouse/picker-activity", get(handlers::transfers::get_picker_activity))
        .route("/api/warehouse/slotting-suggestions", get(handlers::transfers::get_slotting_suggestions))
        // Materials
        .route("/api/materials", get(handlers::materials::list))
        .route("/api/materials/low-stock", get(handlers::materials::low_stock))
        .route("/api/materials/expiring/:days", get(handlers::materials::expiring))
        .route("/api/materials/:id", get(handlers::materials::get_one))
        .route("/api/materials", post(handlers::materials::create))
        .route("/api/materials/:id", put(handlers::materials::update))
        .route("/api/materials/:id", delete(handlers::materials::delete))
        .route("/api/materials/bulk-delete", post(handlers::materials::bulk_delete))
        .route("/api/materials/bulk-update", put(handlers::materials::bulk_update))
        .route("/api/materials/import-csv", post(handlers::materials::import_csv))
        .route("/api/materials/import-xlsx", post(handlers::materials::import_xlsx))
        .route("/api/materials/preview-import-xlsx", post(handlers::materials::preview_import_xlsx))
        .route("/api/materials/export-stock-xlsx", get(handlers::materials::export_stock_xlsx))
        .route("/api/materials/generate-zpl", post(handlers::materials::generate_zpl))
        .route("/api/materials/stock-timeline/:material_id", get(handlers::materials::get_stock_timeline))
        .route("/api/materials/:material_id/batches", get(handlers::materials::get_material_batches))
        .route("/api/materials/batches/:id", delete(handlers::materials::delete_material_batch))
        .route("/api/materials/batches", post(handlers::materials::create_material_batch))
        .route("/api/materials/:material_id/images", get(handlers::materials::get_material_images))
        .route("/api/materials/images/reorder", put(handlers::materials::reorder_material_images))
        .route("/api/materials/images", post(handlers::materials::create_material_image))
        .route("/api/materials/images/:id", delete(handlers::materials::delete_material_image))
        // Categories
        .route("/api/categories", get(handlers::categories::list))
        .route("/api/categories/tree", get(handlers::categories::tree))
        .route("/api/categories", post(handlers::categories::create))
        .route("/api/categories", put(handlers::categories::update))
        .route("/api/categories/:id", delete(handlers::categories::delete))
        // Units
        .route("/api/units", get(handlers::units::list))
        .route("/api/units", post(handlers::units::create))
        .route("/api/units", put(handlers::units::update))
        .route("/api/units/:id", delete(handlers::units::delete))
        .route("/api/units/conversions", get(handlers::units::list_conversions))
        .route("/api/units/conversions", post(handlers::units::create_conversion))
        .route("/api/units/conversions/:id", delete(handlers::units::delete_unit_conversion))
        .route("/api/units/convert", get(handlers::units::convert_unit))
        // Suppliers
        .route("/api/suppliers", get(handlers::suppliers::list))
        .route("/api/suppliers", post(handlers::suppliers::create))
        .route("/api/suppliers", put(handlers::suppliers::update))
        .route("/api/suppliers/:id", delete(handlers::suppliers::delete))
        .route("/api/suppliers/:id/ratings", get(handlers::suppliers::list_ratings))
        .route("/api/suppliers/ratings", post(handlers::suppliers::create_rating))
        .route("/api/suppliers/:id/prices", get(handlers::suppliers::list_prices))
        .route("/api/suppliers/prices", post(handlers::suppliers::create_price))
        // Warehouses
        .route("/api/warehouses", get(handlers::warehouses::list))
        .route("/api/warehouses/stats", get(handlers::warehouses::stats))
        .route("/api/warehouses", post(handlers::warehouses::create))
        .route("/api/warehouses/:id", put(handlers::warehouses::update))
        .route("/api/warehouses/:id", delete(handlers::warehouses::delete))
        .route("/api/warehouses/zones", get(handlers::warehouses::list_zones))
        .route("/api/warehouses/zones", post(handlers::warehouses::create_zone))
        .route("/api/warehouses/zones", put(handlers::warehouses::update_zone))
        .route("/api/warehouses/zones/:id", delete(handlers::warehouses::delete_zone))
        .route("/api/warehouses/locations", get(handlers::warehouses::list_locations))
        .route("/api/warehouses/locations", post(handlers::warehouses::create_location))
        .route("/api/warehouses/locations/:id", delete(handlers::warehouses::delete_location))
        // Racks
        .route("/api/racks", get(handlers::racks::list))
        .route("/api/racks", post(handlers::racks::create))
        .route("/api/racks/:id", put(handlers::racks::update))
        .route("/api/racks/:id", delete(handlers::racks::delete))
        .route("/api/racks/occupancy", get(handlers::racks::occupancy))
        .route("/api/racks/occupancy-details", get(handlers::racks::occupancy_details))
        .route("/api/racks/putaway-suggestion", get(handlers::racks::putaway_suggestion))
        .route("/api/racks/:rackId/utilization", get(handlers::racks::utilization_history))
        // Transactions
        .route("/api/transactions", get(handlers::transactions::list))
        .route("/api/transactions/pending", get(handlers::transactions::pending))
        .route("/api/transactions/generate-number", get(handlers::transactions::generate_tx_number))
        .route("/api/transactions", post(handlers::transactions::create))
        .route("/api/transactions/:id", get(handlers::transactions::get_one))
        .route("/api/transactions/:id/approve", post(handlers::transactions::approve))
        .route("/api/transactions/:id/reject", post(handlers::transactions::reject))
        .route("/api/transactions/:id/reverse", post(handlers::transactions::reverse))
        .route("/api/transactions/reverse-bulk", post(handlers::transactions::reverse_bulk))
        .route("/api/transactions/:txId/items", get(handlers::transactions::get_items))
        .route("/api/transactions/:txId/attachments", get(handlers::transactions::get_transaction_attachments))
        .route("/api/transactions/attachments", post(handlers::transactions::create_transaction_attachment))
        .route("/api/transactions/attachments/:id", delete(handlers::transactions::delete_transaction_attachment))
        // Purchase Orders
        .route("/api/purchase-orders", get(handlers::transactions::get_purchase_orders))
        .route("/api/purchase-orders", post(handlers::transactions::create_purchase_order))
        .route("/api/purchase-orders/:id/status", put(handlers::transactions::update_purchase_order_status))
        .route("/api/purchase-orders/:poId/items", get(handlers::transactions::get_po_items))
        // Sales Orders
        .route("/api/sales-orders", get(handlers::transactions::get_sales_orders))
        .route("/api/sales-orders", post(handlers::transactions::create_sales_order))
        .route("/api/sales-orders/:id/status", put(handlers::transactions::update_sales_order_status))
        .route("/api/sales-orders/:soId/items", get(handlers::transactions::get_so_items))
        // Quality Inspections
        .route("/api/quality-inspections", get(handlers::transactions::get_quality_inspections))
        .route("/api/quality-inspections", post(handlers::transactions::create_quality_inspection))
        // FIFO/FEFO
        .route("/api/fifo-fefo-suggestion", get(handlers::transactions::fifo_fefo_suggestion))
        // Advanced
        .route("/api/budgets", get(handlers::advanced::get_budgets))
        .route("/api/budgets", post(handlers::advanced::save_budget))
        .route("/api/budgets/:id", delete(handlers::advanced::delete_budget))
        .route("/api/abc-weights", get(handlers::advanced::get_abc_weights))
        .route("/api/abc-weights", post(handlers::advanced::set_abc_weight))
        .route("/api/forecast-cache", get(handlers::advanced::get_forecast_cache))
        .route("/api/forecast-cache", post(handlers::advanced::set_forecast_cache))
        .route("/api/forecast-cache", delete(handlers::advanced::delete_forecast_cache))
        .route("/api/login-history", get(handlers::advanced::get_login_history))
        .route("/api/login-history", delete(handlers::advanced::clear_login_history))
        .route("/api/login-history/user/:userId", get(handlers::advanced::get_user_login_history))
        .route("/api/qr-zip-generate", post(handlers::advanced::generate_qr_zip))
        .route("/api/qr-generate", post(handlers::settings_handler::generate_qr_code))
        // Label Templates
        .route("/api/label-templates", get(handlers::label_templates::list))
        .route("/api/label-templates/:id", get(handlers::label_templates::get_one))
        .route("/api/label-templates", post(handlers::label_templates::create))
        .route("/api/label-templates", put(handlers::label_templates::update))
        .route("/api/label-templates/:id", delete(handlers::label_templates::delete))
        // Settings
        .route("/api/company-profile", get(handlers::settings_handler::get_company_profile))
        .route("/api/company-profile", post(handlers::settings_handler::save_company_profile))
        .route("/api/notification-config", get(handlers::settings_handler::get_notification_config))
        .route("/api/notification-config", post(handlers::settings_handler::save_notification_config))
        .route("/api/roles", get(handlers::settings_handler::list_roles))
        .route("/api/roles", post(handlers::settings_handler::create_role))
        .route("/api/roles", put(handlers::settings_handler::update_role))
        .route("/api/roles/:id", delete(handlers::settings_handler::delete_role))
        .route("/api/roles/clone", post(handlers::settings_handler::clone_role))
        .route("/api/check-permission", get(handlers::settings_handler::check_permission))
        .route("/api/app-config", get(handlers::settings_handler::get_app_config))
        .route("/api/app-config", post(handlers::settings_handler::set_app_config))
        .route("/api/app-config/all", get(handlers::settings_handler::get_all_app_config))
        .route("/api/app-config/:key", delete(handlers::settings_handler::delete_app_config))
        .route("/api/inventory-settings", get(handlers::settings_handler::get_inventory_settings))
        .route("/api/inventory-settings", post(handlers::settings_handler::save_inventory_setting))
        .route("/api/audit-logs", get(handlers::settings_handler::list_audit_logs))
        .route("/api/audit-logs", post(handlers::settings_handler::add_audit_log))
        .route("/api/audit-logs/filtered", get(handlers::settings_handler::filtered_audit_logs))
        .route("/api/audit-logs/filtered/count", get(handlers::settings_handler::count_filtered_audit_logs))
        .route("/api/audit-logs/purge", delete(handlers::settings_handler::purge_old_audit_logs))
        .route("/api/audit-logs/export-csv", get(handlers::settings_handler::export_audit_csv_filtered))
        .route("/api/db-stats", get(handlers::settings_handler::db_stats))
        .route("/api/db/backup", post(handlers::settings_handler::backup_database))
        .route("/api/db/restore", post(handlers::settings_handler::restore_database))
        // Reports
        .route("/api/reports/csv", get(handlers::reports::export_csv))
        .route("/api/reports/pdf", get(handlers::reports::export_pdf))
        .route("/api/reports/opname/approve", post(handlers::reports::approve_opname))
        .route("/api/reports/opname/export-xlsx", get(handlers::reports::export_opname_xlsx))
        .route("/api/reports/schedules", get(handlers::reports::get_schedules))
        .route("/api/reports/schedules", post(handlers::reports::save_schedule))
        .route("/api/reports/schedules/:id", delete(handlers::reports::delete_schedule))
        .route("/api/reports/schedules/:id/run", post(handlers::reports::run_schedule))
        .route("/api/reports/multi-warehouse", get(handlers::reports::multi_warehouse_comparison))
        .route("/api/reports/pivot", post(handlers::reports::pivot_report))
        .route("/api/reports/receipt-pdf", get(handlers::reports::generate_receipt_pdf))
        .route("/api/reports/picking-list-pdf", get(handlers::reports::generate_picking_list_pdf))
        .route("/api/reports/do-pdf", get(handlers::reports::generate_do_pdf))
        .route("/api/reports/count-sheet-pdf", get(handlers::reports::generate_count_sheet_pdf))
        // Security headers middleware (CSP, X-Frame-Options, etc.)
        .layer(middleware::from_fn(security_headers))
        // CORS — allow configured origin, or permissive for Tauri WebView
        .layer({
            let origin = std::env::var("CORS_ORIGIN").unwrap_or_default();
            if origin.is_empty() {
                CorsLayer::permissive()
            } else {
                match origin.as_str().parse::<axum::http::HeaderValue>() {
                    Ok(parsed_origin) => {
                        CorsLayer::new()
                            .allow_origin(parsed_origin)
                            .allow_methods([axum::http::Method::GET, axum::http::Method::POST,
                                axum::http::Method::PUT, axum::http::Method::DELETE, axum::http::Method::OPTIONS])
                            .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::COOKIE,
                                axum::http::header::AUTHORIZATION])
                    }
                    Err(e) => {
                        log::warn!("Invalid CORS_ORIGIN value '{}': {}. Falling back to permissive CORS.", origin, e);
                        CorsLayer::permissive()
                    }
                }
            }
        })
        // Middleware (skip auth for health, login & non-API paths)
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .with_state(state)
        // SPA fallback — serve frontend static files, fallback to index.html for React Router
        .fallback(spa_handler)
}

/// Security headers middleware: adds CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("X-Content-Type-Options", "nosniff".parse().expect("hardcoded 'nosniff' is valid"));
    headers.insert("X-Frame-Options", "DENY".parse().expect("hardcoded 'DENY' is valid"));
    headers.insert("Referrer-Policy", "strict-origin-when-cross-origin".parse().expect("hardcoded referrer-policy is valid"));
    headers.insert("X-XSS-Protection", "0".parse().expect("hardcoded '0' is valid"));
    let csp = if cfg!(debug_assertions) {
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://localhost:*;"
    } else {
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';"
    };
    headers.insert("Content-Security-Policy", csp.parse().expect("hardcoded CSP is valid"));
    response
}

async fn spa_handler(uri: Uri) -> Response<Body> {
    let dist = frontend_dist_dir();
    let path = uri.path().trim_start_matches('/');
    let file_path = Path::new(&dist).join(path);

    // Serve actual file if it exists (JS, CSS, images, etc.)
    if !path.is_empty() && file_path.is_file() {
        match async_fs::read(&file_path).await {
            Ok(content) => {
                return match Response::builder()
                    .header("Content-Type", mime_type(&file_path))
                    .body(Body::from(content))
                {
                    Ok(res) => res,
                    Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Response build error: {}", e)).into_response(),
                };
            }
            Err(_) => { /* fall through to index.html */ }
        }
    }

    // SPA fallback — serve index.html for all other routes
    let index_path = Path::new(&dist).join("index.html");
    match async_fs::read(&index_path).await {
        Ok(content) => {
            match Response::builder()
                .header("Content-Type", "text/html")
                .body(Body::from(content))
            {
                Ok(res) => res,
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Response build error: {}", e)).into_response(),
            }
        }
        Err(_e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "Frontend not found. Ensure dist/ exists.").into_response()
        }
    }
}

fn mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("js") => "application/javascript",
        Some("css") => "text/css",
        Some("html") => "text/html",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("json") => "application/json",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        _ => "application/octet-stream",
    }
}

fn frontend_dist_dir() -> String {
    if let Ok(dir) = std::env::var("FRONTEND_DIST") {
        return dir;
    }
    // Resolve relative to CARGO_MANIFEST_DIR (server crate root)
    let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_dist = manifest.join("../dist");
    if dev_dist.exists() {
        return dev_dist.to_string_lossy().to_string();
    }
    // Production: resolve relative to executable path
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("dist");
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }
    // Last resort
    "dist".into()
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn auth_middleware(
    mut req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path();
    // Skip auth for: CORS preflight, health, login, and all non-API paths (static files, SPA)
    if req.method() == Method::OPTIONS
        || path == "/api/health"
        || path == "/api/login"
        || !path.starts_with("/api/")
    {
        return next.run(req).await;
    }

    // Check httpOnly cookie first, then fall back to Authorization header (Tauri IPC compat)
    let token = req.headers().get(COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookie_str| {
            cookie_str.split(';').find_map(|pair| {
                let pair = pair.trim();
                pair.strip_prefix("token=").map(|s| s.to_string())
            })
        })
        .or_else(|| {
            req.headers().get(AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|s| s.to_string())
        });

    match token {
        Some(t) => {
            match verify_jwt(&t) {
                Ok(claims) => {
                    req.extensions_mut().insert(claims.user_id);
                    next.run(req).await
                }
                Err(_) => {
                    (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid token" }))).into_response()
                }
            }
        }
        None => {
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))).into_response()
        }
    }
}

// Re-export shared JWT functions from the jwt module
pub use crate::jwt::{Claims, create_jwt, verify_jwt};

pub fn server_error(e: impl std::fmt::Display) -> (StatusCode, Json<serde_json::Value>) {
    log::error!("Internal server error: {}", e);
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Internal server error"})))
}
