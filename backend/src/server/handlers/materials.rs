use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::Material;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
pub struct ListQuery { pub search: Option<String>, pub category_id: Option<String>, pub warehouse_id: Option<String> }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, \
         quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at \
         FROM materials WHERE 1=1 \
         AND ($1 IS NULL OR name ILIKE '%' || $1 || '%' OR sku ILIKE '%' || $1 || '%') \
         AND ($2 IS NULL OR category_id = $2) AND ($3 IS NULL OR warehouse_id = $3) ORDER BY name"
    ).bind(&q.search).bind(&q.category_id).bind(&q.warehouse_id)
     .fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let materials: Vec<serde_json::Value> = rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "sku": row.get::<String,_>("sku"), "name": row.get::<String,_>("name"),
            "description": row.get::<String,_>("description"), "category_id": row.get::<Option<String>,_>("category_id"),
            "unit_id": row.get::<Option<String>,_>("unit_id"), "supplier_id": row.get::<Option<String>,_>("supplier_id"),
            "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "rack_id": row.get::<Option<String>,_>("rack_id"),
            "quantity": row.get::<f64,_>("quantity"), "min_stock": row.get::<f64,_>("min_stock"),
            "max_stock": row.get::<f64,_>("max_stock"), "price": row.get::<f64,_>("price"),
            "image": row.get::<String,_>("image"), "expiry_date": row.get::<Option<String>,_>("expiry_date"),
            "is_active": row.get::<bool,_>("is_active"), "created_at": row.get::<String,_>("created_at"),
            "updated_at": row.get::<String,_>("updated_at")})
    }).collect();
    Ok(Json(json!(materials)))
}

pub async fn low_stock(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, sku, name, quantity, min_stock, warehouse_id FROM materials WHERE quantity <= min_stock AND min_stock > 0 AND is_active=true ORDER BY name")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|r| json!({"id": r.get::<String,_>("id"), "sku": r.get::<String,_>("sku"), "name": r.get::<String,_>("name"), "quantity": r.get::<f64,_>("quantity"), "min_stock": r.get::<f64,_>("min_stock"), "warehouse_id": r.get::<String,_>("warehouse_id")})).collect::<Vec<_>>())))
}

pub async fn expiring(
    State(pool): State<Arc<DbPool>>,
    Path(days): Path<i64>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, sku, name, quantity, expiry_date, warehouse_id FROM materials WHERE is_active=true AND expiry_date IS NOT NULL AND expiry_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval ORDER BY expiry_date")
        .bind(days).fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|r| json!({"id": r.get::<String,_>("id"), "sku": r.get::<String,_>("sku"), "name": r.get::<String,_>("name"), "quantity": r.get::<f64,_>("quantity"), "expiry_date": r.get::<String,_>("expiry_date"), "warehouse_id": r.get::<String,_>("warehouse_id")})).collect::<Vec<_>>())))
}

pub async fn get_one(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query("SELECT id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at FROM materials WHERE id=$1")
        .bind(&id).fetch_optional(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Material not found"}))))?;
    Ok(Json(json!({"id": row.get::<String,_>("id"), "sku": row.get::<String,_>("sku"), "name": row.get::<String,_>("name"), "description": row.get::<String,_>("description"), "category_id": row.get::<Option<String>,_>("category_id"), "unit_id": row.get::<Option<String>,_>("unit_id"), "supplier_id": row.get::<Option<String>,_>("supplier_id"), "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "rack_id": row.get::<Option<String>,_>("rack_id"), "quantity": row.get::<f64,_>("quantity"), "min_stock": row.get::<f64,_>("min_stock"), "max_stock": row.get::<f64,_>("max_stock"), "price": row.get::<f64,_>("price"), "image": row.get::<String,_>("image"), "expiry_date": row.get::<Option<String>,_>("expiry_date"), "is_active": row.get::<bool,_>("is_active"), "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at")})))
}

pub async fn create(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(material): Json<Material>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_sku(&material.sku).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_string(&material.name, "Material name", 255).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO materials (id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())")
        .bind(&id).bind(&material.sku).bind(&material.name).bind(&material.description)
        .bind(&material.category_id).bind(&material.unit_id).bind(&material.supplier_id)
        .bind(&material.warehouse_id).bind(&material.rack_id).bind(material.quantity)
        .bind(material.min_stock).bind(material.max_stock).bind(material.price)
        .bind(&material.image).bind(&material.expiry_date).bind(material.is_active)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let row = sqlx::query("SELECT * FROM materials WHERE id=$1").bind(&id).fetch_one(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!({"id": row.get::<String,_>("id"), "sku": row.get::<String,_>("sku"), "name": row.get::<String,_>("name"), "description": row.get::<String,_>("description"), "category_id": row.get::<Option<String>,_>("category_id"), "unit_id": row.get::<Option<String>,_>("unit_id"), "supplier_id": row.get::<Option<String>,_>("supplier_id"), "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "rack_id": row.get::<Option<String>,_>("rack_id"), "quantity": row.get::<f64,_>("quantity"), "min_stock": row.get::<f64,_>("min_stock"), "max_stock": row.get::<f64,_>("max_stock"), "price": row.get::<f64,_>("price"), "image": row.get::<String,_>("image"), "expiry_date": row.get::<Option<String>,_>("expiry_date"), "is_active": row.get::<bool,_>("is_active"), "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at")})))
}

pub async fn update(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(material): Json<Material>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE materials SET sku=$1, name=$2, description=$3, category_id=$4, unit_id=$5, supplier_id=$6, warehouse_id=$7, rack_id=$8, quantity=$9, min_stock=$10, max_stock=$11, price=$12, image=$13, expiry_date=$14, is_active=$15, updated_at=NOW() WHERE id=$16")
        .bind(&material.sku).bind(&material.name).bind(&material.description).bind(&material.category_id)
        .bind(&material.unit_id).bind(&material.supplier_id).bind(&material.warehouse_id).bind(&material.rack_id)
        .bind(material.quantity).bind(material.min_stock).bind(material.max_stock).bind(material.price)
        .bind(&material.image).bind(&material.expiry_date).bind(material.is_active).bind(&material.id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn delete(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM materials WHERE id=$1").bind(&id).execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn bulk_delete(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let ids: Vec<String> = body.get("ids").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    for id in &ids { sqlx::query("DELETE FROM materials WHERE id=$1").bind(id).execute(&pool.pool).await.ok(); }
    Ok(Json(json!({"deleted": ids.len()})))
}

pub async fn bulk_update(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let ids: Vec<String> = body.get("ids").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let updates = &body["updates"];
    for id in &ids {
        let mut builder = sqlx::QueryBuilder::new("UPDATE materials SET updated_at=NOW()");
        if let Some(c) = updates.get("category_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) { builder.push(", category_id=").push_bind(c); }
        if let Some(w) = updates.get("warehouse_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) { builder.push(", warehouse_id=").push_bind(w); }
        if let Some(p) = updates.get("price").and_then(|v| v.as_f64()) { builder.push(", price=").push_bind(p); }
        if let Some(mn) = updates.get("min_stock").and_then(|v| v.as_f64()) { builder.push(", min_stock=").push_bind(mn); }
        if let Some(mx) = updates.get("max_stock").and_then(|v| v.as_f64()) { builder.push(", max_stock=").push_bind(mx); }
        builder.push(" WHERE id=").push_bind(id);
        builder.build().execute(&pool.pool).await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    }
    Ok(Json(()))
}

pub async fn import_csv(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let csv_content = body.get("csvContent").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing csvContent"}))))?;
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(csv_content.as_bytes());
    let records: Vec<csv::StringRecord> = reader.records().filter_map(|r| r.ok()).collect();
    if records.len() > 10000 { return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Max 10,000 rows"})))); }
    let mut imported = 0u64;
    let mut errors = Vec::new();
    for (i, record) in records.iter().enumerate() {
        let sku = record.get(0).unwrap_or("").trim();
        let name = record.get(1).unwrap_or("").trim();
        if sku.is_empty() || name.is_empty() { errors.push(format!("Row {}: SKU and Name required", i+1)); continue; }
        let id = uuid::Uuid::new_v4().to_string();
        let qty: f64 = record.get(2).unwrap_or("0").trim().parse().unwrap_or(0.0);
        let price: f64 = record.get(3).unwrap_or("0").trim().parse().unwrap_or(0.0);
        match sqlx::query("INSERT INTO materials (id, sku, name, quantity, price, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,true,NOW(),NOW()) ON CONFLICT (sku) DO UPDATE SET name=EXCLUDED.name, quantity=EXCLUDED.quantity, price=EXCLUDED.price")
            .bind(&id).bind(sku).bind(name).bind(qty).bind(price).execute(&pool.pool).await {
            Ok(_) => imported += 1,
            Err(e) => errors.push(format!("Row {}: {}", i+1, e)),
        }
    }
    Ok(Json(json!({"imported": imported, "errors": errors, "total": records.len()})))
}
