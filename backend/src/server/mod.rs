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
        // Materials
        .route("/api/materials", get(handlers::materials::list))
        .route("/api/materials/low-stock", get(handlers::materials::low_stock))
        .route("/api/materials/expiring/{days}", get(handlers::materials::expiring))
        .route("/api/materials/{id}", get(handlers::materials::get_one))
        .route("/api/materials", post(handlers::materials::create))
        .route("/api/materials", put(handlers::materials::update))
        .route("/api/materials/{id}", delete(handlers::materials::delete))
        .route("/api/materials/bulk-delete", post(handlers::materials::bulk_delete))
        .route("/api/materials/bulk-update", put(handlers::materials::bulk_update))
        .route("/api/materials/import-csv", post(handlers::materials::import_csv))
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
        .route("/api/warehouses", put(handlers::warehouses::update))
        .route("/api/warehouses/{id}", delete(handlers::warehouses::delete))
        .route("/api/warehouses/zones", get(handlers::warehouses::list_zones))
        .route("/api/warehouses/zones", post(handlers::warehouses::create_zone))
        .route("/api/warehouses/zones/{id}", delete(handlers::warehouses::delete_zone))
        // Racks
        .route("/api/racks", get(handlers::racks::list))
        .route("/api/racks", post(handlers::racks::create))
        .route("/api/racks", put(handlers::racks::update))
        .route("/api/racks/{id}", delete(handlers::racks::delete))
        .route("/api/racks/occupancy", get(handlers::racks::occupancy))
        .route("/api/racks/occupancy-details", get(handlers::racks::occupancy_details))
        // Transactions
        .route("/api/transactions", get(handlers::transactions::list))
        .route("/api/transactions/pending", get(handlers::transactions::pending))
        .route("/api/transactions", post(handlers::transactions::create))
        .route("/api/transactions/{id}/approve", post(handlers::transactions::approve))
        .route("/api/transactions/{id}/reject", post(handlers::transactions::reject))
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
