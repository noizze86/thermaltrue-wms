use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::Rack;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
pub struct ListParams { pub warehouse_id: Option<String>, pub search: Option<String> }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Rack>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut builder = sqlx::QueryBuilder::new("SELECT id, warehouse_id, area, rack_name, bin_location, max_capacity, location_id, created_at FROM racks WHERE 1=1");
    if let Some(ref w) = params.warehouse_id { if !w.is_empty() { builder.push(" AND warehouse_id = ").push_bind(w); } }
    if let Some(ref s) = params.search { if !s.is_empty() { builder.push(" AND (rack_name LIKE ").push_bind(format!("%{}%", s)).push(" OR area LIKE ").push_bind(format!("%{}%", s)).push(" OR bin_location LIKE ").push_bind(format!("%{}%", s)).push(")"); } }
    builder.push(" ORDER BY rack_name");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| { Rack { id: row.get(0), warehouse_id: row.get(1), area: row.get(2), rack_name: row.get(3), bin_location: row.get(4), max_capacity: row.get(5), location_id: row.get(6), created_at: row.get(7) } }).collect();
    Ok(Json(list))
}

pub async fn create(
    State(pool): State<Arc<DbPool>>,
    Json(rack): Json<Rack>,
) -> Result<Json<Rack>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    validate::validate_string(&rack.rack_name, "Rack name", 100).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO racks (id, warehouse_id, area, rack_name, bin_location, max_capacity, location_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&id).bind(&rack.warehouse_id).bind(&rack.area).bind(&rack.rack_name).bind(&rack.bin_location).bind(rack.max_capacity).bind(&rack.location_id).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(Rack { id, warehouse_id: rack.warehouse_id, area: rack.area, rack_name: rack.rack_name, bin_location: rack.bin_location, max_capacity: rack.max_capacity, location_id: rack.location_id, created_at: now }))
}

pub async fn update(
    State(pool): State<Arc<DbPool>>,
    Path(_id): Path<String>,
    Json(rack): Json<Rack>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("UPDATE racks SET warehouse_id=$1, area=$2, rack_name=$3, bin_location=$4, max_capacity=$5, location_id=$6 WHERE id=$7")
        .bind(&rack.warehouse_id).bind(&rack.area).bind(&rack.rack_name).bind(&rack.bin_location).bind(rack.max_capacity).bind(&rack.location_id).bind(&rack.id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn delete(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("DELETE FROM rack_utilization_log WHERE rack_id=$1").bind(&id).execute(&pool.pool).await.ok();
    sqlx::query("DELETE FROM racks WHERE id=$1").bind(&id).execute(&pool.pool).await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// --- Rack Occupancy ---
pub async fn occupancy(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<serde_json::Value>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT r.id, r.max_capacity, COUNT(m.id) as material_count, COALESCE(SUM(m.quantity), 0) as total_qty FROM racks r LEFT JOIN materials m ON m.rack_id = r.id AND m.is_active = true GROUP BY r.id")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| { json!({"rack_id": row.get::<String,_>(0), "max_capacity": row.get::<f64,_>(1), "material_count": row.get::<i64,_>(2), "total_quantity": row.get::<f64,_>(3)}) }).collect();
    Ok(Json(list))
}

pub async fn occupancy_details(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<serde_json::Value>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT r.id, r.warehouse_id, r.rack_name, r.area, r.max_capacity, \
         COUNT(m.id) as material_count, COALESCE(SUM(m.quantity), 0) as total_qty, \
         COALESCE((SELECT AVG(t.created_at)::text FROM transactions t WHERE t.material_id IN (SELECT id FROM materials WHERE rack_id=r.id) AND t.created_at > NOW() - INTERVAL '30 days'), '') as recent \
         FROM racks r LEFT JOIN materials m ON m.rack_id = r.id AND m.is_active = true GROUP BY r.id ORDER BY r.warehouse_id, r.rack_name"
    )
    .fetch_all(&pool.pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| { json!({"rack_id": row.get::<String,_>(0), "warehouse_id": row.get::<String,_>(1), "rack_name": row.get::<String,_>(2), "area": row.get::<String,_>(3), "max_capacity": row.get::<f64,_>(4), "material_count": row.get::<i64,_>(5), "total_quantity": row.get::<f64,_>(6), "recent_activity": row.get::<String,_>(7)}) }).collect();
    Ok(Json(list))
}

// --- Utilization History ---
pub async fn utilization_history(
    State(pool): State<Arc<DbPool>>,
    Path(rack_id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT id, rack_id, used_capacity, recorded_at FROM rack_utilization_log WHERE rack_id=$1 ORDER BY recorded_at DESC LIMIT 100"
    )
    .bind(&rack_id)
    .fetch_all(&pool.pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| {
        json!({"id": row.get::<String,_>(0), "rack_id": row.get::<String,_>(1), "used_capacity": row.get::<f64,_>(2), "recorded_at": row.get::<String,_>(3)})
    }).collect();
    Ok(Json(list))
}

// --- Putaway Suggestion ---
#[derive(Deserialize)]
pub struct PutawayParams { pub warehouse_id: Option<String>, pub material_id: Option<String> }

pub async fn putaway_suggestion(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<PutawayParams>,
) -> Result<Json<Vec<serde_json::Value>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT r.id, r.rack_name, r.area, r.max_capacity, \
         COALESCE(SUM(m.quantity), 0) as used_qty, r.max_capacity - COALESCE(SUM(m.quantity), 0) as free_space \
         FROM racks r LEFT JOIN materials m ON m.rack_id = r.id AND m.is_active = true WHERE 1=1"
    );
    if let Some(ref w) = params.warehouse_id { if !w.is_empty() { builder.push(" AND r.warehouse_id = ").push_bind(w); } }
    builder.push(" GROUP BY r.id ORDER BY free_space DESC LIMIT 20");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| {
        json!({"rack_id": row.get::<String,_>(0), "rack_name": row.get::<String,_>(1), "area": row.get::<String,_>(2), "max_capacity": row.get::<f64,_>(3), "used_quantity": row.get::<f64,_>(4), "free_space": row.get::<f64,_>(5)})
    }).collect();
    Ok(Json(list))
}
