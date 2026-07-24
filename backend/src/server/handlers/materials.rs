use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::{CreateMaterialInput, UpdateMaterialInput, TxType};
use crate::validate;
use sqlx::Row;
use calamine::{Reader, DataType};

#[derive(Deserialize)]
pub struct ListQuery { pub search: Option<String>, pub category_id: Option<String>, pub warehouse_id: Option<String> }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let warehouse_ids = validate::get_user_warehouses(&pool.pool, &user_id).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    use sqlx::QueryBuilder;
    let mut builder = QueryBuilder::new(
        "SELECT m.id, m.sku, m.name, m.description, m.category_id, m.unit_id, m.supplier_id, m.warehouse_id, m.rack_id, \
         m.quantity, m.min_stock, m.max_stock, m.price, m.image, m.expiry_date, m.is_active, m.created_at, m.updated_at, \
         c.name as category_name, u.name as unit_name, w.name as warehouse_name \
         FROM materials m LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN units u ON m.unit_id=u.id \
         LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE 1=1"
    );
    if let Some(ref s) = q.search { if !s.is_empty() {
        let pat = format!("%{}%", s);
        builder.push(" AND (m.name ILIKE ").push_bind(pat.clone()).push(" OR m.sku ILIKE ").push_bind(pat).push(")");
    }}
    if let Some(ref c) = q.category_id { if !c.is_empty() {
        builder.push(" AND m.category_id = ").push_bind(c);
    }}
    if let Some(ref w) = q.warehouse_id { if !w.is_empty() {
        builder.push(" AND m.warehouse_id = ").push_bind(w);
    }}
    if !warehouse_ids.is_empty() {
        builder.push(" AND m.warehouse_id = ANY(").push_bind(&warehouse_ids).push(")");
    }
    builder.push(" ORDER BY m.name");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let materials: Vec<serde_json::Value> = rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "sku": row.get::<String,_>("sku"), "name": row.get::<String,_>("name"),
            "description": row.get::<String,_>("description"), "category_id": row.get::<Option<String>,_>("category_id"),
            "unit_id": row.get::<Option<String>,_>("unit_id"), "supplier_id": row.get::<Option<String>,_>("supplier_id"),
            "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "rack_id": row.get::<Option<String>,_>("rack_id"),
            "quantity": row.get::<f64,_>("quantity"), "min_stock": row.get::<f64,_>("min_stock"),
            "max_stock": row.get::<f64,_>("max_stock"), "price": row.get::<f64,_>("price"),
            "image": row.get::<String,_>("image"), "expiry_date": row.get::<Option<String>,_>("expiry_date"),
            "is_active": row.get::<bool,_>("is_active"), "created_at": row.get::<String,_>("created_at"),
            "updated_at": row.get::<String,_>("updated_at"),
            "category_name": row.get::<Option<String>,_>("category_name"), "unit_name": row.get::<Option<String>,_>("unit_name"),
            "warehouse_name": row.get::<Option<String>,_>("warehouse_name")})
    }).collect();
    Ok(Json(json!(materials)))
}

pub async fn low_stock(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT m.id, m.sku, m.name, m.quantity, m.min_stock, m.warehouse_id, c.name as category_name, u.name as unit_name, w.name as warehouse_name FROM materials m LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN units u ON m.unit_id=u.id LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.quantity <= m.min_stock AND m.min_stock > 0 AND m.is_active=true ORDER BY m.name")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|r| json!({"id": r.get::<String,_>("id"), "sku": r.get::<String,_>("sku"), "name": r.get::<String,_>("name"), "quantity": r.get::<f64,_>("quantity"), "min_stock": r.get::<f64,_>("min_stock"), "warehouse_id": r.get::<String,_>("warehouse_id"), "category_name": r.get::<Option<String>,_>("category_name"), "unit_name": r.get::<Option<String>,_>("unit_name"), "warehouse_name": r.get::<Option<String>,_>("warehouse_name")})).collect::<Vec<_>>())))
}

pub async fn expiring(
    State(pool): State<Arc<DbPool>>,
    Path(days): Path<i64>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT m.id, m.sku, m.name, m.quantity, m.expiry_date, m.warehouse_id, c.name as category_name, u.name as unit_name, w.name as warehouse_name FROM materials m LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN units u ON m.unit_id=u.id LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.is_active=true AND m.expiry_date IS NOT NULL AND m.expiry_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval ORDER BY m.expiry_date")
        .bind(days).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|r| json!({"id": r.get::<String,_>("id"), "sku": r.get::<String,_>("sku"), "name": r.get::<String,_>("name"), "quantity": r.get::<f64,_>("quantity"), "expiry_date": r.get::<String,_>("expiry_date"), "warehouse_id": r.get::<String,_>("warehouse_id"), "category_name": r.get::<Option<String>,_>("category_name"), "unit_name": r.get::<Option<String>,_>("unit_name"), "warehouse_name": r.get::<Option<String>,_>("warehouse_name")})).collect::<Vec<_>>())))
}

pub async fn get_one(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query("SELECT m.id, m.sku, m.name, m.description, m.category_id, m.unit_id, m.supplier_id, m.warehouse_id, m.rack_id, m.quantity, m.min_stock, m.max_stock, m.price, m.image, m.expiry_date, m.is_active, m.created_at, m.updated_at, c.name as category_name, u.name as unit_name, w.name as warehouse_name FROM materials m LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN units u ON m.unit_id=u.id LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.id=$1")
        .bind(&id).fetch_optional(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Material not found"}))))?;
    Ok(Json(json!({"id": row.get::<String,_>("id"), "sku": row.get::<String,_>("sku"), "name": row.get::<String,_>("name"), "description": row.get::<String,_>("description"), "category_id": row.get::<Option<String>,_>("category_id"), "unit_id": row.get::<Option<String>,_>("unit_id"), "supplier_id": row.get::<Option<String>,_>("supplier_id"), "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "rack_id": row.get::<Option<String>,_>("rack_id"), "quantity": row.get::<f64,_>("quantity"), "min_stock": row.get::<f64,_>("min_stock"), "max_stock": row.get::<f64,_>("max_stock"), "price": row.get::<f64,_>("price"), "image": row.get::<String,_>("image"), "expiry_date": row.get::<Option<String>,_>("expiry_date"), "is_active": row.get::<bool,_>("is_active"), "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at"), "category_name": row.get::<Option<String>,_>("category_name"), "unit_name": row.get::<Option<String>,_>("unit_name"), "warehouse_name": row.get::<Option<String>,_>("warehouse_name")})))
}

pub async fn create(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(input): Json<CreateMaterialInput>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_sku(&input.sku).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_string(&input.name, "Material name", 255).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO materials (id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15,NOW(),NOW())")
        .bind(&id).bind(&input.sku).bind(&input.name).bind(&input.description)
        .bind(&input.category_id).bind(&input.unit_id).bind(&input.supplier_id)
        .bind(&input.warehouse_id).bind(&input.rack_id)
        .bind(input.min_stock).bind(input.max_stock).bind(input.price)
        .bind(&input.image).bind(&input.expiry_date).bind(input.is_active)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let row = sqlx::query("SELECT m.id, m.sku, m.name, m.description, m.category_id, m.unit_id, m.supplier_id, m.warehouse_id, m.rack_id, m.quantity, m.min_stock, m.max_stock, m.price, m.image, m.expiry_date, m.is_active, m.created_at, m.updated_at, c.name as category_name, u.name as unit_name, w.name as warehouse_name FROM materials m LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN units u ON m.unit_id=u.id LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.id=$1").bind(&id).fetch_one(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"id": row.get::<String,_>("id"), "sku": row.get::<String,_>("sku"), "name": row.get::<String,_>("name"), "description": row.get::<String,_>("description"), "category_id": row.get::<Option<String>,_>("category_id"), "unit_id": row.get::<Option<String>,_>("unit_id"), "supplier_id": row.get::<Option<String>,_>("supplier_id"), "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "rack_id": row.get::<Option<String>,_>("rack_id"), "quantity": row.get::<f64,_>("quantity"), "min_stock": row.get::<f64,_>("min_stock"), "max_stock": row.get::<f64,_>("max_stock"), "price": row.get::<f64,_>("price"), "image": row.get::<String,_>("image"), "expiry_date": row.get::<Option<String>,_>("expiry_date"), "is_active": row.get::<bool,_>("is_active"), "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at"), "category_name": row.get::<Option<String>,_>("category_name"), "unit_name": row.get::<Option<String>,_>("unit_name"), "warehouse_name": row.get::<Option<String>,_>("warehouse_name")})))
}

pub async fn update(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Json(input): Json<UpdateMaterialInput>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_sku(&input.sku).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_string(&input.name, "Name", 200).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_quantity(input.min_stock, "Min stock").map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_quantity(input.max_stock, "Max stock").map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    sqlx::query("UPDATE materials SET sku=$1, name=$2, description=$3, category_id=$4, unit_id=$5, supplier_id=$6, warehouse_id=$7, rack_id=$8, min_stock=$9, max_stock=$10, price=$11, image=$12, expiry_date=$13, is_active=$14, updated_at=NOW() WHERE id=$15")
        .bind(&input.sku).bind(&input.name).bind(&input.description).bind(&input.category_id)
        .bind(&input.unit_id).bind(&input.supplier_id).bind(&input.warehouse_id).bind(&input.rack_id)
        .bind(input.min_stock).bind(input.max_stock).bind(input.price)
        .bind(&input.image).bind(&input.expiry_date).bind(input.is_active).bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn delete(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM materials WHERE id=$1").bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
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
    Ok(Json(json!(format!("Deleted {} material(s)", ids.len()))))
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
        builder.build().execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
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

pub async fn import_xlsx(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let xlsx_base64 = body.get("xlsxBase64").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing xlsxBase64"}))))?;
    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, xlsx_base64)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": format!("Base64 decode error: {}", e)}))))?;
    let mut workbook: calamine::Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(data))
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": format!("XLSX parse error: {}", e)}))))?;
    let sheet_name = workbook.sheet_names().first().cloned().unwrap_or_else(|| "Sheet1".to_string());
    let range = workbook.worksheet_range(&sheet_name)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": format!("Sheet error: {}", e)}))))?;
    let mut imported = 0i64;
    let mut errors: Vec<String> = Vec::new();
    for (i, row) in range.rows().enumerate() {
        if i == 0 { continue; }
        if row.len() < 4 { errors.push(format!("Row {}: insufficient columns", i + 1)); continue; }
        let get_str = |idx: usize| -> String { row.get(idx).and_then(|c| c.as_string()).unwrap_or_default().trim().to_string() };
        let get_f64 = |idx: usize| -> f64 { get_str(idx).parse().unwrap_or(0.0) };
        let sku = get_str(0);
        let name = get_str(1);
        if sku.is_empty() || name.is_empty() { errors.push(format!("Row {}: SKU and Name required", i + 1)); continue; }
        let qty = get_f64(2);
        let price = get_f64(3);
        let id = uuid::Uuid::new_v4().to_string();
        match sqlx::query("INSERT INTO materials (id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) ON CONFLICT (sku) DO UPDATE SET name=EXCLUDED.name, quantity=EXCLUDED.quantity, price=EXCLUDED.price")
            .bind(&id).bind(&sku).bind(&name).bind(&get_str(4))
            .bind(Option::<String>::None).bind(Option::<String>::None).bind(Option::<String>::None)
            .bind(Option::<String>::None).bind(Option::<String>::None).bind(qty)
            .bind(get_f64(5)).bind(get_f64(6)).bind(price).bind("")
            .bind(Option::<String>::None).bind(true)
            .execute(&pool.pool).await {
            Ok(_) => imported += 1,
            Err(e) => errors.push(format!("Row {}: {}", i + 1, e)),
        }
    }
    Ok(Json(json!({"imported": imported, "errors": errors})))
}

pub async fn preview_import_xlsx(
    State(_pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let xlsx_base64 = body.get("xlsxBase64").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing xlsxBase64"}))))?;
    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, xlsx_base64)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": format!("Base64 decode error: {}", e)}))))?;
    let mut workbook: calamine::Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(data))
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": format!("XLSX parse error: {}", e)}))))?;
    let sheet_name = workbook.sheet_names().first().cloned().unwrap_or_else(|| "Sheet1".to_string());
    let range = workbook.worksheet_range(&sheet_name)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": format!("Sheet error: {}", e)}))))?;
    let mut preview: Vec<Vec<String>> = Vec::new();
    for (i, row) in range.rows().enumerate() {
        if i > 10 { break; }
        preview.push(row.iter().map(|c| c.as_string().unwrap_or_default()).collect());
    }
    Ok(Json(json!({"preview": preview})))
}

pub async fn export_stock_xlsx(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT m.sku, m.name, m.quantity, m.price, COALESCE(c.name,''), COALESCE(w.name,''), m.min_stock, m.max_stock, COALESCE(m.expiry_date,'') FROM materials m LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.is_active=true ORDER BY m.name")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook.add_worksheet();
    let header = ["SKU", "Name", "Quantity", "Price", "Category", "Warehouse", "Min Stock", "Max Stock", "Expiry"];
    for (c, h) in header.iter().enumerate() {
        sheet.write_string(0, c as u16, *h).map_err(|e| crate::server::server_error(e))?;
    }
    for (row_idx, row) in rows.iter().enumerate() {
        let ri = (row_idx + 1) as u32;
        sheet.write_string(ri, 0, row.get::<String, _>(0)).map_err(|e| crate::server::server_error(e))?;
        sheet.write_string(ri, 1, row.get::<String, _>(1)).map_err(|e| crate::server::server_error(e))?;
        sheet.write_number(ri, 2, row.get::<f64, _>(2)).map_err(|e| crate::server::server_error(e))?;
        sheet.write_number(ri, 3, row.get::<f64, _>(3)).map_err(|e| crate::server::server_error(e))?;
        sheet.write_string(ri, 4, row.get::<String, _>(4)).map_err(|e| crate::server::server_error(e))?;
        sheet.write_string(ri, 5, row.get::<String, _>(5)).map_err(|e| crate::server::server_error(e))?;
        sheet.write_number(ri, 6, row.get::<f64, _>(6)).map_err(|e| crate::server::server_error(e))?;
        sheet.write_number(ri, 7, row.get::<f64, _>(7)).map_err(|e| crate::server::server_error(e))?;
        sheet.write_string(ri, 8, row.get::<String, _>(8)).map_err(|e| crate::server::server_error(e))?;
    }
    let data = workbook.save_to_buffer().map_err(|e| crate::server::server_error(e))?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);
    Ok(Json(json!(b64)))
}

pub async fn generate_zpl(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let material_id = body.get("materialId").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing materialId"}))))?;
    let template_id = body.get("templateId").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing templateId"}))))?;
    let mat = sqlx::query("SELECT sku, name, quantity, price FROM materials WHERE id=$1")
        .bind(material_id).fetch_optional(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Material not found"}))))?;
    let sku: String = mat.get("sku");
    let name: String = mat.get("name");
    let qty: f64 = mat.get("quantity");
    let price: f64 = mat.get("price");
    let tmpl = sqlx::query("SELECT layout_style, show_company, show_qty, show_price, show_barcode, show_sku, show_name, show_category, show_location, show_expiry, show_batch, qr_size, font_scale, template_type FROM label_templates WHERE id=$1")
        .bind(template_id).fetch_optional(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Template not found"}))))?;
    let layout: String = tmpl.get("layout_style");
    let show_company: bool = tmpl.get("show_company");
    let show_qty: bool = tmpl.get("show_qty");
    let show_price: bool = tmpl.get("show_price");
    let show_barcode: bool = tmpl.get("show_barcode");
    let show_sku: bool = tmpl.get("show_sku");
    let show_name: bool = tmpl.get("show_name");
    let qr_size: String = tmpl.get("qr_size");
    let font_scale: f32 = tmpl.get("font_scale");
    let fs = (font_scale * 30.0) as u32;
    let company_name: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_else(|_| "Thermaltrue".into());
    let mut zpl = String::from("^XA");
    let mut y = 30u32;
    let qr_mag = match qr_size.as_str() { "large" => 8, "small" => 4, _ => 6 };
    zpl.push_str(&format!("^FO30,{}^BQN,2,{}^FDQA,{}^FS", y, qr_mag, sku));
    y += match qr_size.as_str() { "large" => 130, "small" => 70, _ => 100 };
    match layout.as_str() {
        "rack" => {
            zpl.push_str(&format!("^FO30,{}^ADN,60,20^FD{}^FS", y, sku));
            y += 50;
            let wh = if name.len() > 20 { &name[..20] } else { name.as_str() };
            zpl.push_str(&format!("^FO30,{}^ADN,20,10^FD{}^FS", y, wh));
            y += 30;
            zpl.push_str(&format!("^FO30,{}^ADN,20,10^FD{}^FS", y, company_name));
        }
        "mini" => {
            if show_sku { zpl.push_str(&format!("^FO30,{}^ADN,{},10^FD{}^FS", y, fs.max(20), sku)); y += fs.max(20) + 5; }
            if show_name { let short = if name.len() > 15 { &name[..15] } else { name.as_str() }; zpl.push_str(&format!("^FO30,{}^ADN,18,8^FD{}^FS", y, short)); y += 22; }
            zpl.push_str(&format!("^FO30,{}^ADN,15,8^FD{}^FS", y, company_name));
            if show_barcode { y += 20; zpl.push_str(&format!("^FO30,{}^BCN,40,Y,N,N^FD{}^FS", y, sku)); }
        }
        "qr_only" => {
            if show_sku { y += 5; zpl.push_str(&format!("^FO30,{}^ADN,{},15^FD{}^FS", y, fs.max(35), sku)); }
            zpl.push_str(&format!("^FO30,{}^ADN,20,10^FD{}^FS", y + 40, company_name));
        }
        "full_card" => {
            if show_sku { zpl.push_str(&format!("^FO30,{}^ADN,22,10^FD{}^FS", y, sku)); y += 25; }
            if show_name { zpl.push_str(&format!("^FO30,{}^ADN,22,10^FD{}^FS", y, name)); y += 25; }
            zpl.push_str(&format!("^FO30,{}^ADN,20,10^FD{}^FS", y, company_name)); y += 22;
            if show_qty { zpl.push_str(&format!("^FO30,{}^ADN,20,10^FDQty: {:.*}^FS", y, 2, qty)); y += 22; }
            if show_price { zpl.push_str(&format!("^FO30,{}^ADN,20,10^FDRp {:.*}^FS", y, 2, price)); y += 22; }
            if show_barcode { zpl.push_str(&format!("^FO30,{}^BCN,50,Y,N,N^FD{}^FS", y, sku)); }
        }
        "branded" => {
            zpl.push_str(&format!("^FO30,{}^ADN,35,15^FD{}^FS", y, company_name)); y += 40;
            if show_sku { zpl.push_str(&format!("^FO30,{}^ADN,25,10^FD{}^FS", y, sku)); y += 28; }
            if show_name { zpl.push_str(&format!("^FO30,{}^ADN,22,10^FD{}^FS", y, name)); y += 25; }
            if show_qty { zpl.push_str(&format!("^FO30,{}^ADN,22,10^FDQty: {:.*}^FS", y, 2, qty)); }
            if show_price { let px = if show_qty { 180u32 } else { 30u32 }; zpl.push_str(&format!("^FO{},{}^ADN,22,10^FDRp {:.*}^FS", px, y, 2, price)); }
        }
        "two_side" => {
            let left_x = 30u32; let right_x = 350u32;
            zpl.push_str(&format!("^FO{},{}^BQN,2,8^FDQA,{}^FS", right_x, 30, sku));
            let mut ly = 30u32;
            if show_company { zpl.push_str(&format!("^FO{},{}^ADN,25,10^FD{}^FS", left_x, ly, company_name)); ly += 28; }
            if show_sku { zpl.push_str(&format!("^FO{},{}^ADN,20,10^FDSKU: {}^FS", left_x, ly, sku)); ly += 22; }
            if show_name { zpl.push_str(&format!("^FO{},{}^ADN,20,10^FDName: {}^FS", left_x, ly, name)); ly += 22; }
            if show_qty { zpl.push_str(&format!("^FO{},{}^ADN,18,10^FDQty: {:.*}^FS", left_x, ly, 2, qty)); ly += 20; }
            if show_price { zpl.push_str(&format!("^FO{},{}^ADN,18,10^FDRp {:.*}^FS", left_x, ly, 2, price)); }
        }
        _ => {
            if show_sku { zpl.push_str(&format!("^FO30,{}^ADN,{},10^FD{}^FS", y, fs, sku)); y += fs + 5; }
            if show_name { zpl.push_str(&format!("^FO30,{}^ADN,{},10^FD{}^FS", y, fs, name)); y += fs + 5; }
            if show_company { zpl.push_str(&format!("^FO30,{}^ADN,{},10^FD{}^FS", y, fs, company_name)); y += fs + 5; }
            else {
                if show_qty { zpl.push_str(&format!("^FO30,{}^ADN,{},10^FDQty: {:.*}^FS", y, fs, 2, qty)); }
                if show_price { let px = if show_qty { 180u32 } else { 30u32 }; zpl.push_str(&format!("^FO{},{}^ADN,{},10^FDRp {:.*}^FS", px, y, fs, 2, price)); }
                if show_qty || show_price { y += fs + 5; }
            }
            if show_barcode { y = y.max(160); zpl.push_str(&format!("^FO30,{}^BCN,60,Y,N,N^FD{}^FS", y, sku)); }
        }
    }
    zpl.push_str("^XZ");
    Ok(Json(json!(zpl)))
}

pub async fn get_stock_timeline(
    State(pool): State<Arc<DbPool>>,
    Path(material_id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT t.id, t.transaction_number, t.type, t.quantity, COALESCE(t.reference,''), COALESCE(t.notes,''), COALESCE(u.full_name,''), t.created_at FROM transactions t LEFT JOIN users u ON t.user_id = u.id WHERE t.material_id = $1 AND t.type NOT IN ('opname') ORDER BY t.created_at ASC")
        .bind(&material_id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let mut running = 0.0f64;
    let mut entries = Vec::new();
    for row in &rows {
        let qty_before = running;
        let qty: f64 = row.get::<f64, _>(3);
        let typ: String = row.get::<String, _>(2);
        running += if typ.parse::<TxType>().ok() == Some(TxType::In) { qty } else if typ.parse::<TxType>().ok() == Some(TxType::Out) { -qty } else { 0.0 };
        if running < 0.0 { running = 0.0; }
        entries.push(json!({
            "id": row.get::<String,_>(0),
            "transactionNumber": row.get::<String,_>(1),
            "type": typ,
            "quantity": qty,
            "qtyBefore": qty_before,
            "qtyAfter": running,
            "reference": row.get::<String,_>(4),
            "notes": row.get::<String,_>(5),
            "userName": row.get::<String,_>(6),
            "createdAt": row.get::<String,_>(7),
        }));
    }
    Ok(Json(json!(entries)))
}

pub async fn get_material_batches(
    State(pool): State<Arc<DbPool>>,
    Path(material_id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, material_id, batch_no, qty, expiry_date, received_at, created_at FROM material_batches WHERE material_id=$1 ORDER BY received_at DESC")
        .bind(&material_id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|r| json!({
        "id": r.get::<String,_>("id"), "materialId": r.get::<String,_>("material_id"),
        "batchNo": r.get::<String,_>("batch_no"), "qty": r.get::<f64,_>("qty"),
        "expiryDate": r.get::<String,_>("expiry_date"), "receivedAt": r.get::<String,_>("received_at"),
        "createdAt": r.get::<String,_>("created_at")
    })).collect::<Vec<_>>())))
}

pub async fn create_material_batch(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let material_id = body.get("materialId").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing materialId"}))))?;
    let batch_no = body.get("batchNo").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing batchNo"}))))?;
    let qty = body.get("qty").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let expiry_date = body.get("expiryDate").and_then(|v| v.as_str()).unwrap_or("");
    let received_at = body.get("receivedAt").and_then(|v| v.as_str()).unwrap_or("");
    let id = uuid::Uuid::new_v4().to_string();
    let exp = if expiry_date.is_empty() { Option::<String>::None } else { Some(expiry_date.to_string()) };
    let recv = if received_at.is_empty() { Option::<String>::None } else { Some(received_at.to_string()) };
    sqlx::query("INSERT INTO material_batches (id, material_id, batch_no, qty, expiry_date, received_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())")
        .bind(&id).bind(material_id).bind(batch_no).bind(qty).bind(&exp).bind(&recv)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"id": id, "materialId": material_id, "batchNo": batch_no, "qty": qty, "expiryDate": exp, "receivedAt": recv})))
}

pub async fn delete_material_batch(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM material_batches WHERE id=$1").bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn get_material_images(
    State(pool): State<Arc<DbPool>>,
    Path(material_id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, material_id, url, sort_order, created_at FROM material_images WHERE material_id=$1 ORDER BY sort_order ASC")
        .bind(&material_id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|r| json!({
        "id": r.get::<String,_>("id"), "materialId": r.get::<String,_>("material_id"),
        "url": r.get::<String,_>("url"), "sortOrder": r.get::<i32,_>("sort_order"),
        "createdAt": r.get::<String,_>("created_at")
    })).collect::<Vec<_>>())))
}

pub async fn create_material_image(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let material_id = body.get("materialId").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing materialId"}))))?;
    let url = body.get("url").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing url"}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    let max_sort: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM material_images WHERE material_id=$1")
        .bind(material_id).fetch_optional(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .unwrap_or(0);
    sqlx::query("INSERT INTO material_images (id, material_id, url, sort_order, created_at) VALUES ($1,$2,$3,$4,NOW())")
        .bind(&id).bind(material_id).bind(url).bind(max_sort)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"id": id, "materialId": material_id, "url": url, "sortOrder": max_sort})))
}

pub async fn delete_material_image(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM material_images WHERE id=$1").bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn reorder_material_images(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let ids: Vec<String> = body.get("ids").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let mut tx = pool.pool.begin().await
        .map_err(|e| crate::server::server_error(e))?;
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE material_images SET sort_order=$1 WHERE id=$2")
            .bind(i as i32).bind(id).execute(&mut *tx).await
            .map_err(|e| crate::server::server_error(e))?;
    }
    tx.commit().await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}
