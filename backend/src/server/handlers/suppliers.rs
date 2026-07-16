use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::{Supplier, SupplierRating, SupplierPrice};
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
pub struct ListParams { pub search: Option<String> }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Supplier>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT id, name, contact, phone, email, address, contact_person, pic_phone, pic_email, created_at \
         FROM suppliers WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR contact ILIKE '%' || $1 || '%') ORDER BY name"
    )
    .bind(&params.search)
    .fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| { Supplier { id: row.get(0), name: row.get(1), contact: row.get(2), phone: row.get(3), email: row.get(4), address: row.get(5), contact_person: row.get(6), pic_phone: row.get(7), pic_email: row.get(8), created_at: row.get(9) } }).collect();
    Ok(Json(list))
}

pub async fn create(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(supplier): Json<Supplier>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_string(&supplier.name, "Supplier name", 255).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO suppliers (id, name, contact, phone, email, address, contact_person, pic_phone, pic_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(&id).bind(&supplier.name).bind(&supplier.contact).bind(&supplier.phone)
        .bind(&supplier.email).bind(&supplier.address).bind(&supplier.contact_person)
        .bind(&supplier.pic_phone).bind(&supplier.pic_email)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn update(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(supplier): Json<Supplier>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE suppliers SET name=$1, contact=$2, phone=$3, email=$4, address=$5, contact_person=$6, pic_phone=$7, pic_email=$8 WHERE id=$9")
        .bind(&supplier.name).bind(&supplier.contact).bind(&supplier.phone).bind(&supplier.email)
        .bind(&supplier.address).bind(&supplier.contact_person).bind(&supplier.pic_phone).bind(&supplier.pic_email).bind(&supplier.id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn delete(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM supplier_ratings WHERE supplier_id=$1").bind(&id).execute(&pool.pool).await.ok();
    sqlx::query("DELETE FROM supplier_prices WHERE supplier_id=$1").bind(&id).execute(&pool.pool).await.ok();
    sqlx::query("DELETE FROM suppliers WHERE id=$1").bind(&id).execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

// --- Supplier Ratings ---
pub async fn list_ratings(
    State(pool): State<Arc<DbPool>>,
    Path(supplier_id): Path<String>,
) -> Result<Json<Vec<SupplierRating>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, supplier_id, metric, score, period, notes, created_at FROM supplier_ratings WHERE supplier_id=$1 ORDER BY period DESC")
        .bind(&supplier_id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| { SupplierRating { id: row.get(0), supplier_id: row.get(1), metric: row.get(2), score: row.get(3), period: row.get(4), notes: row.get(5), created_at: row.get(6) } }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
pub struct CreateRatingBody { pub supplier_id: String, pub metric: String, pub score: f64, pub period: String, pub notes: String }

pub async fn create_rating(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<CreateRatingBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO supplier_ratings (id, supplier_id, metric, score, period, notes) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&body.supplier_id).bind(&body.metric).bind(body.score).bind(&body.period).bind(&body.notes)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

// --- Supplier Prices ---
pub async fn list_prices(
    State(pool): State<Arc<DbPool>>,
    Path(supplier_id): Path<String>,
) -> Result<Json<Vec<SupplierPrice>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT sp.id, sp.supplier_id, sp.material_id, COALESCE(m.name,''), sp.price, sp.date, sp.created_at \
         FROM supplier_prices sp LEFT JOIN materials m ON sp.material_id=m.id \
         WHERE sp.supplier_id=$1 ORDER BY sp.date DESC"
    )
    .bind(&supplier_id).fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| { SupplierPrice { id: row.get(0), supplier_id: row.get(1), material_id: row.get(2), material_name: row.get(3), price: row.get(4), date: row.get(5), created_at: row.get(6) } }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
pub struct CreatePriceBody { pub supplier_id: String, pub material_id: String, pub price: f64, pub date: String }

pub async fn create_price(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<CreatePriceBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO supplier_prices (id, supplier_id, material_id, price, date) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id).bind(&body.supplier_id).bind(&body.material_id).bind(body.price).bind(&body.date)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}
