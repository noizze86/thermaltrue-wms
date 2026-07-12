use std::sync::Arc;
use axum::{Router, routing::{get, post, put, delete}, middleware, Json, middleware::Next, extract::Request, response::{IntoResponse, Response}, http::{StatusCode, header::AUTHORIZATION}};
use serde::{Deserialize, Serialize};
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
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
        .route("/api/users/{id}", put(handlers::users::update))
        .route("/api/users/{id}", delete(handlers::users::delete))
        .route("/api/users/{id}/change-password", post(handlers::users::change_password))
        .route("/api/users/me/change-password", post(handlers::users::change_my_password))
        .route("/api/users/{id}/photo", put(handlers::users::update_photo))
        .route("/api/users/{id}/activity", get(handlers::users::get_activity))
        .route("/api/users/{id}/log-activity", post(handlers::users::log_activity))
        // Stock Opname
        .route("/api/stock-opnames", get(handlers::stock_opname::list))
        .route("/api/stock-opnames", post(handlers::stock_opname::create))
        .route("/api/stock-opnames/{id}/status", put(handlers::stock_opname::update_status))
        .route("/api/stock-opnames/{id}/items", get(handlers::stock_opname::get_items))
        .route("/api/stock-opnames/items", post(handlers::stock_opname::save_item))
        .route("/api/stock-opname-config", get(handlers::stock_opname::get_config))
        .route("/api/stock-opname-config", put(handlers::stock_opname::set_config))
        .route("/api/cycle-schedules", get(handlers::stock_opname::get_cycle_schedules))
        .route("/api/cycle-schedules", post(handlers::stock_opname::create_cycle_schedule))
        .route("/api/cycle-schedules/{id}", delete(handlers::stock_opname::delete_cycle_schedule))
        .route("/api/cycle-opname/generate", post(handlers::stock_opname::auto_generate))
        // Transfers
        .route("/api/transfers/material", post(handlers::transfers::transfer_material))
        .route("/api/transfers/bulk", post(handlers::transfers::transfer_bulk))
        .route("/api/transfers/rack", post(handlers::transfers::batch_transfer_rack))
        .route("/api/transfer-orders", get(handlers::transfers::get_transfer_orders))
        .route("/api/transfer-orders", post(handlers::transfers::create_transfer_order))
        .route("/api/transfer-orders/{id}/status", put(handlers::transfers::update_transfer_order_status))
        .route("/api/transfer-orders/{id}/items", get(handlers::transfers::get_transfer_items))
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
        .route("/api/reports/opname-variance/{id}", get(handlers::dashboard::opname_variance))
        .route("/api/dashboard/demand-forecast", get(handlers::dashboard::demand_forecast))
        .route("/api/dashboard/reorder-suggestions", get(handlers::dashboard::reorder_suggestions))
        // Throughput & Picker
        .route("/api/warehouse/throughput", get(handlers::transfers::get_throughput_metrics))
        .route("/api/warehouse/picker-activity", get(handlers::transfers::get_picker_activity))
        .route("/api/warehouse/slotting-suggestions", get(handlers::transfers::get_slotting_suggestions))
        // Materials
        .route("/api/materials", get(handlers::materials::list))
        .route("/api/materials/low-stock", get(handlers::materials::low_stock))
        .route("/api/materials/expiring/{days}", get(handlers::materials::expiring))
        .route("/api/materials/{id}", get(handlers::materials::get_one))
        .route("/api/materials", post(handlers::materials::create))
        .route("/api/materials/{id}", put(handlers::materials::update))
        .route("/api/materials/{id}", delete(handlers::materials::delete))
        .route("/api/materials/bulk-delete", post(handlers::materials::bulk_delete))
        .route("/api/materials/bulk-update", put(handlers::materials::bulk_update))
        .route("/api/materials/import-csv", post(handlers::materials::import_csv))
        .route("/api/materials/import-xlsx", post(handlers::materials::import_xlsx))
        .route("/api/materials/preview-import-xlsx", post(handlers::materials::preview_import_xlsx))
        .route("/api/materials/export-stock-xlsx", get(handlers::materials::export_stock_xlsx))
        .route("/api/materials/generate-zpl", post(handlers::materials::generate_zpl))
        .route("/api/materials/stock-timeline/{material_id}", get(handlers::materials::get_stock_timeline))
        .route("/api/materials/{material_id}/batches", get(handlers::materials::get_material_batches))
        .route("/api/materials/batches/{id}", delete(handlers::materials::delete_material_batch))
        .route("/api/materials/batches", post(handlers::materials::create_material_batch))
        .route("/api/materials/{material_id}/images", get(handlers::materials::get_material_images))
        .route("/api/materials/images/reorder", put(handlers::materials::reorder_material_images))
        .route("/api/materials/images", post(handlers::materials::create_material_image))
        .route("/api/materials/images/{id}", delete(handlers::materials::delete_material_image))
        // Categories
        .route("/api/categories", get(handlers::categories::list))
        .route("/api/categories/tree", get(handlers::categories::tree))
        .route("/api/categories", post(handlers::categories::create))
        .route("/api/categories", put(handlers::categories::update))
        .route("/api/categories/{id}", delete(handlers::categories::delete))
        // Units
        .route("/api/units", get(handlers::units::list))
        .route("/api/units", post(handlers::units::create))
        .route("/api/units", put(handlers::units::update))
        .route("/api/units/{id}", delete(handlers::units::delete))
        .route("/api/units/conversions", get(handlers::units::list_conversions))
        .route("/api/units/conversions", post(handlers::units::create_conversion))
        // Suppliers
        .route("/api/suppliers", get(handlers::suppliers::list))
        .route("/api/suppliers", post(handlers::suppliers::create))
        .route("/api/suppliers", put(handlers::suppliers::update))
        .route("/api/suppliers/{id}", delete(handlers::suppliers::delete))
        .route("/api/suppliers/{id}/ratings", get(handlers::suppliers::list_ratings))
        .route("/api/suppliers/ratings", post(handlers::suppliers::create_rating))
        .route("/api/suppliers/{id}/prices", get(handlers::suppliers::list_prices))
        .route("/api/suppliers/prices", post(handlers::suppliers::create_price))
        // Warehouses
        .route("/api/warehouses", get(handlers::warehouses::list))
        .route("/api/warehouses/stats", get(handlers::warehouses::stats))
        .route("/api/warehouses", post(handlers::warehouses::create))
        .route("/api/warehouses/{id}", put(handlers::warehouses::update))
        .route("/api/warehouses/{id}", delete(handlers::warehouses::delete))
        .route("/api/warehouses/zones", get(handlers::warehouses::list_zones))
        .route("/api/warehouses/zones", post(handlers::warehouses::create_zone))
        .route("/api/warehouses/zones", put(handlers::warehouses::update_zone))
        .route("/api/warehouses/zones/{id}", delete(handlers::warehouses::delete_zone))
        .route("/api/warehouses/locations", get(handlers::warehouses::list_locations))
        .route("/api/warehouses/locations", post(handlers::warehouses::create_location))
        .route("/api/warehouses/locations/{id}", delete(handlers::warehouses::delete_location))
        // Racks
        .route("/api/racks", get(handlers::racks::list))
        .route("/api/racks", post(handlers::racks::create))
        .route("/api/racks/{id}", put(handlers::racks::update))
        .route("/api/racks/{id}", delete(handlers::racks::delete))
        .route("/api/racks/occupancy", get(handlers::racks::occupancy))
        .route("/api/racks/occupancy-details", get(handlers::racks::occupancy_details))
        .route("/api/racks/putaway-suggestion", get(handlers::racks::putaway_suggestion))
        .route("/api/racks/{rackId}/utilization", get(handlers::racks::utilization_history))
        // Transactions
        .route("/api/transactions", get(handlers::transactions::list))
        .route("/api/transactions/pending", get(handlers::transactions::pending))
        .route("/api/transactions/generate-number", get(handlers::transactions::generate_tx_number))
        .route("/api/transactions", post(handlers::transactions::create))
        .route("/api/transactions/{id}", get(handlers::transactions::get_one))
        .route("/api/transactions/{id}/approve", post(handlers::transactions::approve))
        .route("/api/transactions/{id}/reject", post(handlers::transactions::reject))
        .route("/api/transactions/{id}/reverse", post(handlers::transactions::reverse))
        .route("/api/transactions/reverse-bulk", post(handlers::transactions::reverse_bulk))
        .route("/api/transactions/{txId}/items", get(handlers::transactions::get_items))
        .route("/api/transactions/{txId}/attachments", get(handlers::transactions::get_transaction_attachments))
        .route("/api/transactions/attachments", post(handlers::transactions::create_transaction_attachment))
        .route("/api/transactions/attachments/{id}", delete(handlers::transactions::delete_transaction_attachment))
        // Purchase Orders
        .route("/api/purchase-orders", get(handlers::transactions::get_purchase_orders))
        .route("/api/purchase-orders", post(handlers::transactions::create_purchase_order))
        .route("/api/purchase-orders/{id}/status", put(handlers::transactions::update_purchase_order_status))
        .route("/api/purchase-orders/{poId}/items", get(handlers::transactions::get_po_items))
        // Sales Orders
        .route("/api/sales-orders", get(handlers::transactions::get_sales_orders))
        .route("/api/sales-orders", post(handlers::transactions::create_sales_order))
        .route("/api/sales-orders/{id}/status", put(handlers::transactions::update_sales_order_status))
        .route("/api/sales-orders/{soId}/items", get(handlers::transactions::get_so_items))
        // Quality Inspections
        .route("/api/quality-inspections", get(handlers::transactions::get_quality_inspections))
        .route("/api/quality-inspections", post(handlers::transactions::create_quality_inspection))
        // FIFO/FEFO
        .route("/api/fifo-fefo-suggestion", get(handlers::transactions::fifo_fefo_suggestion))
        // Advanced
        .route("/api/budgets", get(handlers::advanced::get_budgets))
        .route("/api/budgets", post(handlers::advanced::save_budget))
        .route("/api/budgets/{id}", delete(handlers::advanced::delete_budget))
        .route("/api/abc-weights", get(handlers::advanced::get_abc_weights))
        .route("/api/abc-weights", post(handlers::advanced::set_abc_weight))
        .route("/api/forecast-cache", get(handlers::advanced::get_forecast_cache))
        .route("/api/forecast-cache", post(handlers::advanced::set_forecast_cache))
        .route("/api/forecast-cache", delete(handlers::advanced::delete_forecast_cache))
        .route("/api/login-history", get(handlers::advanced::get_login_history))
        .route("/api/login-history", delete(handlers::advanced::clear_login_history))
        .route("/api/login-history/user/{userId}", get(handlers::advanced::get_user_login_history))
        .route("/api/qr-zip-generate", post(handlers::advanced::generate_qr_zip))
        // Label Templates
        .route("/api/label-templates", get(handlers::label_templates::list))
        .route("/api/label-templates/{id}", get(handlers::label_templates::get_one))
        .route("/api/label-templates", post(handlers::label_templates::create))
        .route("/api/label-templates", put(handlers::label_templates::update))
        .route("/api/label-templates/{id}", delete(handlers::label_templates::delete))
        // Settings
        .route("/api/company-profile", get(handlers::settings_handler::get_company_profile))
        .route("/api/company-profile", post(handlers::settings_handler::save_company_profile))
        .route("/api/notification-config", get(handlers::settings_handler::get_notification_config))
        .route("/api/notification-config", post(handlers::settings_handler::save_notification_config))
        .route("/api/roles", get(handlers::settings_handler::list_roles))
        .route("/api/roles", post(handlers::settings_handler::create_role))
        .route("/api/roles", put(handlers::settings_handler::update_role))
        .route("/api/roles/{id}", delete(handlers::settings_handler::delete_role))
        .route("/api/app-config", get(handlers::settings_handler::get_app_config))
        .route("/api/app-config", post(handlers::settings_handler::set_app_config))
        .route("/api/inventory-settings", get(handlers::settings_handler::get_inventory_settings))
        .route("/api/inventory-settings", post(handlers::settings_handler::save_inventory_setting))
        .route("/api/audit-logs", get(handlers::settings_handler::list_audit_logs))
        // Reports
        .route("/api/reports/csv", get(handlers::reports::export_csv))
        .route("/api/reports/pdf", get(handlers::reports::export_pdf))
        .route("/api/reports/opname/approve", post(handlers::reports::approve_opname))
        .route("/api/reports/opname/export-xlsx", get(handlers::reports::export_opname_xlsx))
        .route("/api/reports/schedules", get(handlers::reports::get_schedules))
        .route("/api/reports/schedules", post(handlers::reports::save_schedule))
        .route("/api/reports/schedules/{id}", delete(handlers::reports::delete_schedule))
        .route("/api/reports/schedules/{id}/run", post(handlers::reports::run_schedule))
        .route("/api/reports/multi-warehouse", get(handlers::reports::multi_warehouse_comparison))
        .route("/api/reports/pivot", post(handlers::reports::pivot_report))
        .route("/api/reports/receipt-pdf", get(handlers::reports::generate_receipt_pdf))
        .route("/api/reports/picking-list-pdf", get(handlers::reports::generate_picking_list_pdf))
        .route("/api/reports/do-pdf", get(handlers::reports::generate_do_pdf))
        // Middleware (skip auth for health & login)
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn auth_middleware(
    mut req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if path == "/api/health" || path == "/api/login" {
        return next.run(req).await;
    }

    let auth_header = req.headers().get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    match auth_header {
        Some(token) => {
            match verify_jwt(&token) {
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
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Missing authorization header" }))).into_response()
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: String,
    pub exp: usize,
}

fn jwt_secret() -> String {
    std::env::var("JWT_SECRET").unwrap_or_else(|_| "thermaltrue-dev-secret-key-2026".into())
}

pub fn create_jwt(user_id: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .unwrap()
        .timestamp() as usize;
    let claims = Claims { user_id: user_id.to_string(), exp };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(jwt_secret().as_bytes()))
}

pub fn verify_jwt(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let data = decode::<Claims>(token, &DecodingKey::from_secret(jwt_secret().as_bytes()), &Validation::default())?;
    Ok(data.claims)
}
