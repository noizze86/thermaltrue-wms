use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::{Warehouse, WarehouseStats, Zone};
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
pub struct ListParams { pub search: Option<String> }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Warehouse>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT id, name, code, location, is_active, capacity, layout_image, created_at FROM warehouses \
         WHERE ($1 IS NULL OR name LIKE '%' || $1 || '%' OR code LIKE '%' || $1 || '%') ORDER BY name"
    )
    .bind(&params.search)
    .fetch_all(&pool.pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| { Warehouse { id: row.get(0), name: row.get(1), code: row.get(2), location: row.get(3), is_active: row.get(4), capacity: row.get(5), layout_image: row.get(6), created_at: row.get(7) } }).collect();
    Ok(Json(list))
}

pub async fn stats(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<WarehouseStats>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT w.id, w.name, w.code, w.location, w.is_active, w.capacity, w.layout_image, w.created_at, \
         (SELECT COUNT(*) FROM racks WHERE warehouse_id=w.id) as rack_count, \
         (SELECT COUNT(*) FROM materials WHERE warehouse_id=w.id AND is_active=true) as material_count, \
         COALESCE((SELECT SUM(m.quantity) FROM materials m WHERE m.warehouse_id=w.id AND m.is_active=true), 0) as used_capacity \
         FROM warehouses w ORDER BY w.name"
    )
    .fetch_all(&pool.pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| { WarehouseStats { id: row.get(0), name: row.get(1), code: row.get(2), location: row.get(3), is_active: row.get(4), capacity: row.get(5), layout_image: row.get(6), created_at: row.get(7), rack_count: row.get(8), material_count: row.get(9), used_capacity: row.get(10) } }).collect();
    Ok(Json(list))
}

pub async fn create(
    State(pool): State<Arc<DbPool>>,
    Json(wh): Json<Warehouse>,
) -> Result<Json<Warehouse>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    validate::validate_string(&wh.name, "Warehouse name", 255).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_string(&wh.code, "Warehouse code", 50).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO warehouses (id, name, code, location, is_active, capacity, layout_image, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&id).bind(&wh.name).bind(&wh.code).bind(&wh.location).bind(wh.is_active).bind(wh.capacity).bind(&wh.layout_image).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(Warehouse { id, name: wh.name, code: wh.code, location: wh.location, is_active: wh.is_active, capacity: wh.capacity, layout_image: wh.layout_image, created_at: now }))
}

pub async fn update(
    State(pool): State<Arc<DbPool>>,
    Json(wh): Json<Warehouse>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("UPDATE warehouses SET name=$1, code=$2, location=$3, is_active=$4, capacity=$5, layout_image=$6 WHERE id=$7")
        .bind(&wh.name).bind(&wh.code).bind(&wh.location).bind(wh.is_active).bind(wh.capacity).bind(&wh.layout_image).bind(&wh.id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn delete(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut db_tx = pool.pool.begin().await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    sqlx::query("DELETE FROM zones WHERE warehouse_id=$1").bind(&id).execute(&mut *db_tx).await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    sqlx::query("DELETE FROM racks WHERE warehouse_id=$1").bind(&id).execute(&mut *db_tx).await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    sqlx::query("DELETE FROM warehouses WHERE id=$1").bind(&id).execute(&mut *db_tx).await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    db_tx.commit().await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// --- Zones ---
pub async fn list_zones(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Zone>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut builder = sqlx::QueryBuilder::new("SELECT id, warehouse_id, name, code, capacity, created_at FROM zones WHERE 1=1");
    if let Some(ref w) = params.search { if !w.is_empty() { builder.push(" AND warehouse_id = ").push_bind(w); } }
    builder.push(" ORDER BY name");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| { Zone { id: row.get(0), warehouse_id: row.get(1), name: row.get(2), code: row.get(3), capacity: row.get(4), created_at: row.get(5) } }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
pub struct CreateZoneBody { pub warehouse_id: String, pub name: String, pub code: String, pub capacity: Option<f64> }

pub async fn create_zone(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateZoneBody>,
) -> Result<Json<Zone>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    validate::validate_string(&body.name, "Zone name", 100).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let cap = body.capacity.unwrap_or(0.0);
    sqlx::query("INSERT INTO zones (id, warehouse_id, name, code, capacity, created_at) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&body.warehouse_id).bind(&body.name).bind(&body.code).bind(cap).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(Zone { id, warehouse_id: body.warehouse_id, name: body.name, code: body.code, capacity: cap, created_at: now }))
}

pub async fn delete_zone(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("DELETE FROM zones WHERE id=$1").bind(&id).execute(&pool.pool).await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}
