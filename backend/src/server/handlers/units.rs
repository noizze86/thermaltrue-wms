use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::{Unit, UnitConversion};
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
pub struct ListParams { pub search: Option<String> }

pub async fn list(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Unit>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let rows = sqlx::query("SELECT id, name, symbol, category, created_at FROM units WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%') ORDER BY name")
        .bind(&params.search)
        .fetch_all(&pool.pool)
        .await
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| { Unit { id: row.get(0), name: row.get(1), symbol: row.get(2), category: row.get(3), created_at: row.get(4) } }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
pub struct CreateBody { pub name: String, pub symbol: String, pub category: String }

pub async fn create(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_string(&body.name, "Unit name", 50).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO units (id, name, symbol, category) VALUES ($1,$2,$3,$4)")
        .bind(&id).bind(&body.name).bind(&body.symbol).bind(&body.category)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct UpdateBody { pub id: String, pub name: String, pub symbol: String, pub category: String }

pub async fn update(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<UpdateBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE units SET name=$1, symbol=$2, category=$3 WHERE id=$4")
        .bind(&body.name).bind(&body.symbol).bind(&body.category).bind(&body.id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn delete(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM unit_conversions WHERE from_unit_id=$1 OR to_unit_id=$1").bind(&id).execute(&pool.pool).await.ok();
    sqlx::query("DELETE FROM units WHERE id=$1").bind(&id).execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

// --- Unit Conversions ---
pub async fn list_conversions(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<UnitConversion>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let rows = sqlx::query(
        "SELECT uc.id, uc.from_unit_id, uc.to_unit_id, uc.factor, u1.name, u1.symbol, u2.name, u2.symbol, uc.created_at \
         FROM unit_conversions uc JOIN units u1 ON uc.from_unit_id=u1.id JOIN units u2 ON uc.to_unit_id=u2.id ORDER BY u1.name"
    )
    .fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| { UnitConversion { id: row.get(0), from_unit_id: row.get(1), to_unit_id: row.get(2), factor: row.get(3), from_unit_name: row.get(4), from_unit_symbol: row.get(5), to_unit_name: row.get(6), to_unit_symbol: row.get(7), created_at: row.get(8) } }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
pub struct CreateConversionBody { pub from_unit_id: String, pub to_unit_id: String, pub factor: f64 }

pub async fn create_conversion(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateConversionBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO unit_conversions (id, from_unit_id, to_unit_id, factor) VALUES ($1,$2,$3,$4)")
        .bind(&id).bind(&body.from_unit_id).bind(&body.to_unit_id).bind(body.factor)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

// ── Type B gaps ──

pub async fn delete_unit_conversion(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM unit_conversions WHERE id=$1")
        .bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct ConvertUnitQuery { pub from_unit_id: String, pub to_unit_id: String, pub quantity: f64 }

pub async fn convert_unit(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ConvertUnitQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let direct: Option<f64> = sqlx::query_scalar("SELECT factor FROM unit_conversions WHERE from_unit_id=$1 AND to_unit_id=$2")
        .bind(&params.from_unit_id).bind(&params.to_unit_id)
        .fetch_optional(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let factor = match direct {
        Some(f) => f,
        None => sqlx::query_scalar("SELECT 1.0/factor FROM unit_conversions WHERE from_unit_id=$1 AND to_unit_id=$2")
            .bind(&params.to_unit_id).bind(&params.from_unit_id)
            .fetch_optional(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?
            .unwrap_or(1.0),
    };
    Ok(Json(json!(params.quantity * factor)))
}
