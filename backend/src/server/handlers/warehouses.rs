use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
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
    Extension(user_id): Extension<String>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Warehouse>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let warehouse_ids = validate::get_user_warehouses(&pool.pool, &user_id).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    use sqlx::QueryBuilder;
    let mut builder = QueryBuilder::new(
        "SELECT id, name, code, location, is_active, capacity, layout_image, created_at FROM warehouses WHERE 1=1"
    );
    if let Some(ref s) = params.search {
        if !s.is_empty() {
            let pat = format!("%{}%", s);
            builder.push(" AND (name LIKE ").push_bind(pat.clone()).push(" OR code LIKE ").push_bind(pat).push(")");
        }
    }
    if !warehouse_ids.is_empty() {
        builder.push(" AND id = ANY(").push_bind(&warehouse_ids).push(")");
    }
    builder.push(" ORDER BY name");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let list: Vec<Warehouse> = rows.iter().map(|row| { Warehouse { id: row.get(0), name: row.get(1), code: row.get(2), location: row.get(3), is_active: row.get(4), capacity: row.get(5), layout_image: row.get(6), created_at: row.get(7) } }).collect();
    Ok(Json(list))
}

pub async fn stats(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
) -> Result<Json<Vec<WarehouseStats>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let warehouse_ids = validate::get_user_warehouses(&pool.pool, &user_id).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    use sqlx::QueryBuilder;
    let mut builder = QueryBuilder::new(
        "SELECT w.id, w.name, w.code, w.location, w.is_active, w.capacity, w.layout_image, w.created_at, \
         (SELECT COUNT(*) FROM racks WHERE warehouse_id=w.id) as rack_count, \
         (SELECT COUNT(*) FROM materials WHERE warehouse_id=w.id AND is_active=true) as material_count, \
         COALESCE((SELECT SUM(m.quantity) FROM materials m WHERE m.warehouse_id=w.id AND m.is_active=true), 0) as used_capacity \
         FROM warehouses w WHERE 1=1"
    );
    if !warehouse_ids.is_empty() {
        builder.push(" AND w.id = ANY(").push_bind(&warehouse_ids).push(")");
    }
    builder.push(" ORDER BY w.name");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let list: Vec<WarehouseStats> = rows.iter().map(|row| { WarehouseStats { id: row.get(0), name: row.get(1), code: row.get(2), location: row.get(3), is_active: row.get(4), capacity: row.get(5), layout_image: row.get(6), created_at: row.get(7), rack_count: row.get(8), material_count: row.get(9), used_capacity: row.get(10) } }).collect();
    Ok(Json(list))
}

pub async fn create(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(wh): Json<Warehouse>,
) -> Result<Json<Warehouse>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_string(&wh.name, "Warehouse name", 255).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_string(&wh.code, "Warehouse code", 50).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO warehouses (id, name, code, location, is_active, capacity, layout_image, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&id).bind(&wh.name).bind(&wh.code).bind(&wh.location).bind(wh.is_active).bind(wh.capacity).bind(&wh.layout_image).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(Warehouse { id, name: wh.name, code: wh.code, location: wh.location, is_active: wh.is_active, capacity: wh.capacity, layout_image: wh.layout_image, created_at: now }))
}

pub async fn update(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Path(_id): Path<String>,
    Json(wh): Json<Warehouse>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE warehouses SET name=$1, code=$2, location=$3, is_active=$4, capacity=$5, layout_image=$6 WHERE id=$7")
        .bind(&wh.name).bind(&wh.code).bind(&wh.location).bind(wh.is_active).bind(wh.capacity).bind(&wh.layout_image).bind(&wh.id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn delete(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    sqlx::query("DELETE FROM zones WHERE warehouse_id=$1").bind(&id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    sqlx::query("DELETE FROM racks WHERE warehouse_id=$1").bind(&id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    sqlx::query("DELETE FROM warehouses WHERE id=$1").bind(&id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
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
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| { Zone { id: row.get(0), warehouse_id: row.get(1), name: row.get(2), code: row.get(3), capacity: row.get(4), created_at: row.get(5) } }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
pub struct CreateZoneBody { pub warehouse_id: String, pub name: String, pub code: String, pub capacity: Option<f64> }

pub async fn create_zone(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<CreateZoneBody>,
) -> Result<Json<Zone>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_string(&body.name, "Zone name", 100).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let cap = body.capacity.unwrap_or(0.0);
    sqlx::query("INSERT INTO zones (id, warehouse_id, name, code, capacity, created_at) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&body.warehouse_id).bind(&body.name).bind(&body.code).bind(cap).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(Zone { id, warehouse_id: body.warehouse_id, name: body.name, code: body.code, capacity: cap, created_at: now }))
}

pub async fn delete_zone(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM zones WHERE id=$1").bind(&id).execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

// --- Zone Update ---
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateZoneBody { pub id: String, pub name: String, pub code: String, pub capacity: Option<f64> }

pub async fn update_zone(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<UpdateZoneBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let cap = body.capacity.unwrap_or(0.0);
    sqlx::query("UPDATE zones SET name=$1, code=$2, capacity=$3 WHERE id=$4")
        .bind(&body.name).bind(&body.code).bind(cap).bind(&body.id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

// --- Locations ---
#[derive(Deserialize)]
pub struct ListLocationsParams { pub warehouse_id: Option<String>, pub parent_id: Option<String> }

pub async fn list_locations(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ListLocationsParams>,
) -> Result<Json<Vec<crate::models::Location>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut builder = sqlx::QueryBuilder::new("SELECT id, parent_id, warehouse_id, type_, code, created_at FROM locations WHERE 1=1");
    if let Some(ref w) = params.warehouse_id { if !w.is_empty() { builder.push(" AND warehouse_id = ").push_bind(w); } }
    if let Some(ref p) = params.parent_id { if !p.is_empty() { builder.push(" AND parent_id = ").push_bind(p); } }
    builder.push(" ORDER BY code");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| {
        crate::models::Location {
            id: row.get(0), parent_id: row.get(1), warehouse_id: row.get(2),
            type_: row.get(3), code: row.get(4), created_at: row.get(5),
        }
    }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLocationBody { pub warehouse_id: String, pub parent_id: Option<String>, pub r#type: String, pub code: String }

pub async fn create_location(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<CreateLocationBody>,
) -> Result<Json<crate::models::Location>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO locations (id, parent_id, warehouse_id, type_, code, created_at) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&body.parent_id).bind(&body.warehouse_id).bind(&body.r#type).bind(&body.code).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(crate::models::Location { id, parent_id: body.parent_id, warehouse_id: body.warehouse_id, type_: body.r#type, code: body.code, created_at: now }))
}

pub async fn delete_location(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM locations WHERE id=$1").bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}
