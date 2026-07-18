use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use crate::models::{Transaction, TransactionItem, PurchaseOrder, PoItem, SalesOrder, SoItem, TxType, TxStatus};
use sqlx::Row;

fn gen_id() -> String { uuid::Uuid::new_v4().to_string() }

#[derive(Deserialize)]
pub struct ListParams { pub search: Option<String>, pub type_filter: Option<String>, pub material_id: Option<String>, pub warehouse_id: Option<String>, pub date_start: Option<String>, pub date_end: Option<String>, pub limit: Option<i64> }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Transaction>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let warehouse_ids = validate::get_user_warehouses(&pool.pool, &user_id).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let search_pat = params.search.as_ref().filter(|s| !s.is_empty()).map(|s| format!("%{}%", s));
    let de_val = params.date_end.as_ref().filter(|d| !d.is_empty()).map(|d| format!("{} 23:59:59", d));

    let mut builder = sqlx::QueryBuilder::new(
        "SELECT id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at FROM transactions WHERE 1=1"
    );

    if let Some(ref pat) = search_pat { builder.push(" AND (transaction_number LIKE ").push_bind(pat.clone()).push(" OR reference LIKE ").push_bind(pat.clone()).push(" OR po_number LIKE ").push_bind(pat.clone()).push(" OR invoice_no LIKE ").push_bind(pat.clone()).push(")"); }
    if let Some(ref t) = params.type_filter { if t != "all" { builder.push(" AND type = ").push_bind(t.clone()); } }
    if let Some(ref m) = params.material_id { if !m.is_empty() { builder.push(" AND material_id = ").push_bind(m.clone()); } }
    if let Some(ref w) = params.warehouse_id { if !w.is_empty() { builder.push(" AND warehouse_id = ").push_bind(w.clone()); } }
    if let Some(ref ds) = params.date_start { if !ds.is_empty() { builder.push(" AND created_at >= ").push_bind(ds.clone()); } }
    if let Some(ref dv) = de_val { builder.push(" AND created_at <= ").push_bind(dv.clone()); }
    if !warehouse_ids.is_empty() {
        builder.push(" AND warehouse_id = ANY(").push_bind(&warehouse_ids).push(")");
    }

    builder.push(" ORDER BY created_at DESC LIMIT ").push_bind(params.limit.unwrap_or(200));

    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let transactions = rows.iter().map(|row| { Transaction { id: row.get(0), transaction_number: row.get(1), tx_type: row.get(2), material_id: row.get(3), warehouse_id: row.get(4), rack_id: row.get(5), quantity: row.get(6), price: row.get(7), reference: row.get(8), notes: row.get(9), user_id: row.get(10), status: row.get(11), approved_by: row.get(12), po_number: row.get(13), invoice_no: row.get(14), destination: row.get(15), created_at: row.get(16), updated_at: row.get(17) } }).collect();
    Ok(Json(transactions))
}

pub async fn pending(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<Transaction>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at FROM transactions WHERE status='pending' ORDER BY created_at DESC LIMIT 100"
    )
    .fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?;
    let transactions = rows.iter().map(|row| { Transaction { id: row.get(0), transaction_number: row.get(1), tx_type: row.get(2), material_id: row.get(3), warehouse_id: row.get(4), rack_id: row.get(5), quantity: row.get(6), price: row.get(7), reference: row.get(8), notes: row.get(9), user_id: row.get(10), status: row.get(11), approved_by: row.get(12), po_number: row.get(13), invoice_no: row.get(14), destination: row.get(15), created_at: row.get(16), updated_at: row.get(17) } }).collect();
    Ok(Json(transactions))
}

#[derive(Deserialize)]
pub struct CreateBody { pub tx: Transaction, pub items: Option<Vec<TransactionItem>> }

pub async fn create(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<CreateBody>,
) -> Result<Json<Transaction>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let prefix = match body.tx.tx_type.parse::<TxType>().unwrap_or(TxType::In) {
        TxType::In => "IN", TxType::Out => "OUT", TxType::Transfer => "TRF", TxType::Opname => "OPN",
    };
    let count: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*)+1 FROM transactions WHERE type=$1").bind(&body.tx.tx_type).fetch_one(&mut *db_tx).await.unwrap_or(1);
    let txn_number = format!("{}-{:04}", prefix, count);
    let status = if body.tx.status.is_empty() { "pending".to_string() } else { body.tx.status.clone() };
    let items = body.items.unwrap_or_default();

    let (mat_id, qty, price) = if items.is_empty() { (body.tx.material_id.clone(), body.tx.quantity, body.tx.price) }
        else if items.len() == 1 { (items[0].material_id.clone(), items[0].quantity, items[0].price) }
        else { let total_qty: f64 = items.iter().map(|i| i.quantity).sum(); (items[0].material_id.clone(), total_qty, 0.0) };

    sqlx::query(
        "INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
    )
    .bind(&id).bind(&txn_number).bind(&body.tx.tx_type).bind(&mat_id).bind(&body.tx.warehouse_id).bind(&body.tx.rack_id)
    .bind(qty).bind(price).bind(&body.tx.reference).bind(&body.tx.notes).bind(&body.tx.user_id).bind(&status)
    .bind(&body.tx.approved_by).bind(&body.tx.po_number).bind(&body.tx.invoice_no).bind(&body.tx.destination).bind(&now).bind(&now)
    .execute(&mut *db_tx).await
    .map_err(|e| crate::server::server_error(e))?;

    for item in &items {
        let item_id = gen_id();
        sqlx::query("INSERT INTO transaction_items (id, tx_id, material_id, batch_id, quantity, price, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&item_id).bind(&id).bind(&item.material_id).bind(&item.batch_id).bind(item.quantity).bind(item.price).bind(&now)
            .execute(&mut *db_tx).await
            .map_err(|e| crate::server::server_error(e))?;
    }

    match body.tx.tx_type.parse::<TxType>().unwrap_or(TxType::In) {
        TxType::In => { sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2").bind(qty).bind(&mat_id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?; }
        TxType::Out => { sqlx::query("UPDATE materials SET quantity = GREATEST(quantity - $1, 0) WHERE id=$2").bind(qty).bind(&mat_id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?; }
        _ => {}
    }

    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(Transaction { id, transaction_number: txn_number, tx_type: body.tx.tx_type, material_id: mat_id, warehouse_id: body.tx.warehouse_id, rack_id: body.tx.rack_id, quantity: qty, price, reference: body.tx.reference, notes: body.tx.notes, user_id: body.tx.user_id, status, approved_by: body.tx.approved_by, po_number: body.tx.po_number, invoice_no: body.tx.invoice_no, destination: body.tx.destination, created_at: now.clone(), updated_at: Some(now) }))
}

pub async fn approve(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE transactions SET status='approved' WHERE id=$1 AND status='pending'")
        .bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn reject(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE transactions SET status='rejected' WHERE id=$1 AND status='pending'")
        .bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn get_one(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let tx = sqlx::query(
        "SELECT id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at FROM transactions WHERE id=$1",
    )
    .bind(&id)
    .fetch_optional(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?
    .ok_or_else(|| (axum::http::StatusCode::NOT_FOUND, Json(json!({"error": "Transaction not found"}))))?;

    let items = sqlx::query(
        "SELECT ti.id, ti.tx_id, ti.material_id, ti.batch_id, ti.quantity, ti.price, COALESCE(m.name, ''), ti.created_at FROM transaction_items ti LEFT JOIN materials m ON m.id = ti.material_id WHERE ti.tx_id=$1",
    )
    .bind(&id)
    .fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?
    .iter().map(|row| json!({
        "id": row.get::<String,_>(0),
        "tx_id": row.get::<String,_>(1),
        "material_id": row.get::<String,_>(2),
        "batch_id": row.get::<Option<String>,_>(3),
        "quantity": row.get::<f64,_>(4),
        "price": row.get::<f64,_>(5),
        "material_name": row.get::<String,_>(6),
        "created_at": row.get::<String,_>(7),
    })).collect::<Vec<_>>();

    Ok(Json(json!({
        "transaction": {
            "id": tx.get::<String,_>(0),
            "transaction_number": tx.get::<String,_>(1),
            "tx_type": tx.get::<String,_>(2),
            "material_id": tx.get::<String,_>(3),
            "warehouse_id": tx.get::<String,_>(4),
            "rack_id": tx.get::<Option<String>,_>(5),
            "quantity": tx.get::<f64,_>(6),
            "price": tx.get::<f64,_>(7),
            "reference": tx.get::<Option<String>,_>(8),
            "notes": tx.get::<Option<String>,_>(9),
            "user_id": tx.get::<String,_>(10),
            "status": tx.get::<String,_>(11),
            "approved_by": tx.get::<Option<String>,_>(12),
            "po_number": tx.get::<Option<String>,_>(13),
            "invoice_no": tx.get::<Option<String>,_>(14),
            "destination": tx.get::<Option<String>,_>(15),
            "created_at": tx.get::<String,_>(16),
            "updated_at": tx.get::<Option<String>,_>(17),
        },
        "items": items,
    })))
}

pub async fn reverse(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Extension(user_id): Extension<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let (cur_status, tx_type): (String, String) = sqlx::query("SELECT status, type FROM transactions WHERE id=$1")
        .bind(&id).fetch_optional(&mut *db_tx).await
        .map_err(|e| crate::server::server_error(e))?
        .map(|row| (row.get(0), row.get(1)))
        .ok_or_else(|| (axum::http::StatusCode::NOT_FOUND, Json(json!({"error": "Transaction not found"}))))?;

    if cur_status.parse::<TxStatus>().ok() == Some(TxStatus::Reversed) {
        return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": "Transaction already reversed"}))));
    }

    let items: Vec<(String, f64)> = sqlx::query("SELECT material_id, quantity FROM transaction_items WHERE tx_id=$1")
        .bind(&id).fetch_all(&mut *db_tx).await
        .map_err(|e| crate::server::server_error(e))?
        .into_iter().map(|row| (row.get(0), row.get(1))).collect();

    if items.is_empty() {
        let row = sqlx::query("SELECT material_id, quantity FROM transactions WHERE id=$1")
            .bind(&id).fetch_one(&mut *db_tx).await
            .map_err(|e| crate::server::server_error(e))?;
        let (mid, qty): (String, f64) = (row.get(0), row.get(1));
        match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
            TxType::In => {
                sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2")
                    .bind(qty).bind(&mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
            }
            TxType::Out => {
                sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                    .bind(qty).bind(&mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
            }
            _ => {}
        }
    } else {
        for (mid, qty) in &items {
            match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                TxType::In => {
                    sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2")
                        .bind(qty).bind(mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
                }
                TxType::Out => {
                    sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                        .bind(qty).bind(mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
                }
                _ => {}
            }
        }
    }

    sqlx::query("UPDATE transactions SET status='reversed' WHERE id=$1")
        .bind(&id).execute(&mut *db_tx).await
        .map_err(|e| crate::server::server_error(e))?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let audit_id = gen_id();
    sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&audit_id).bind(&user_id).bind("reverse").bind("transaction").bind(&id).bind(&format!("Reversed {} transaction", tx_type)).bind(&now)
        .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;

    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"message": "Transaction reversed", "id": id})))
}

#[derive(Deserialize)]
pub struct ReverseBulkBody { pub ids: Vec<String> }

pub async fn reverse_bulk(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<ReverseBulkBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let mut reversed = 0i64;
    let mut errors = Vec::new();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    for id in &body.ids {
        let (cur_status, tx_type): (String, String) = match sqlx::query("SELECT status, type FROM transactions WHERE id=$1")
            .bind(id).fetch_optional(&mut *db_tx).await
        {
            Ok(Some(row)) => (row.get(0), row.get(1)),
            Ok(None) => { errors.push(format!("{}: not found", id)); continue; }
            Err(e) => { errors.push(format!("{}: {}", id, e)); continue; }
        };
        if cur_status.parse::<TxStatus>().ok() == Some(TxStatus::Reversed) { errors.push(format!("{}: already reversed", id)); continue; }
        let items: Vec<(String, f64)> = match sqlx::query("SELECT material_id, quantity FROM transaction_items WHERE tx_id=$1")
            .bind(id).fetch_all(&mut *db_tx).await
        {
            Ok(rows) => rows.into_iter().map(|r| (r.get(0), r.get(1))).collect(),
            Err(_) => Vec::new(),
        };
        if items.is_empty() {
            if let Ok(row) = sqlx::query("SELECT material_id, quantity FROM transactions WHERE id=$1")
                .bind(id).fetch_one(&mut *db_tx).await
            {
                let (mid, qty): (String, f64) = (row.get(0), row.get(1));
                match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                    TxType::In => { sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2").bind(qty).bind(&mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?; }
                    TxType::Out => { sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2").bind(qty).bind(&mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?; }
                    _ => {}
                }
            }
        } else {
            for (mid, qty) in &items {
                match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                    TxType::In => { sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2").bind(qty).bind(mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?; }
                    TxType::Out => { sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2").bind(qty).bind(mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?; }
                    _ => {}
                }
            }
        }
        if let Err(e) = sqlx::query("UPDATE transactions SET status='reversed' WHERE id=$1")
            .bind(id).execute(&mut *db_tx).await
        { errors.push(format!("{}: status update: {}", id, e)); }
        let audit_id = gen_id();
        sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&audit_id).bind(&user_id).bind("reverse").bind("transaction").bind(id).bind(&format!("Bulk reversed {} transaction", tx_type)).bind(&now)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        reversed += 1;
    }
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"reversed": reversed, "errors": errors})))
}

pub async fn get_items(
    State(pool): State<Arc<DbPool>>,
    Path(tx_id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT ti.id, ti.tx_id, ti.material_id, ti.batch_id, ti.quantity, ti.price, COALESCE(m.name, ''), ti.created_at FROM transaction_items ti LEFT JOIN materials m ON m.id = ti.material_id WHERE ti.tx_id=$1",
    )
    .bind(&tx_id).fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?
    .iter().map(|row| json!({
        "id": row.get::<String,_>(0),
        "tx_id": row.get::<String,_>(1),
        "material_id": row.get::<String,_>(2),
        "batch_id": row.get::<Option<String>,_>(3),
        "quantity": row.get::<f64,_>(4),
        "price": row.get::<f64,_>(5),
        "material_name": row.get::<String,_>(6),
        "created_at": row.get::<String,_>(7),
    })).collect::<Vec<_>>();
    Ok(Json(json!(rows)))
}

#[derive(Deserialize)]
pub struct PoQuery { pub search: Option<String>, pub status_filter: Option<String> }

pub async fn get_purchase_orders(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<PoQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut sql = String::from(
        "SELECT po.id, po.po_number, po.supplier_id, po.supplier_name, po.status, po.notes, po.created_by, po.created_at, po.updated_at, (SELECT COUNT(*) FROM po_items WHERE po_id = po.id) FROM purchase_orders po WHERE 1=1"
    );
    let mut has_search = false;
    let mut search_val = String::new();
    let mut has_sf = false;
    let mut sf_val = String::new();
    let mut idx = 0u32;
    if let Some(s) = q.search { if !s.is_empty() { has_search = true; search_val = s; sql.push_str(&format!(" AND (po.po_number LIKE ${} OR po.supplier_name LIKE ${})", idx+1, idx+2)); idx += 2; } }
    if let Some(sf) = q.status_filter { if !sf.is_empty() && sf != "all" { has_sf = true; sf_val = sf; idx += 1; sql.push_str(&format!(" AND po.status = ${}", idx)); } }
    sql.push_str(" ORDER BY po.created_at DESC");
    let mut query = sqlx::query(&sql);
    let search_pat = if has_search { Some(format!("%{}%", search_val)) } else { None };
    if let Some(ref v) = search_pat { query = query.bind(v).bind(v); }
    if has_sf { query = query.bind(&sf_val); }
    let rows = query.fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| json!({
        "id": row.get::<String,_>(0),
        "po_number": row.get::<String,_>(1),
        "supplier_id": row.get::<Option<String>,_>(2),
        "supplier_name": row.get::<String,_>(3),
        "status": row.get::<String,_>(4),
        "notes": row.get::<String,_>(5),
        "created_by": row.get::<Option<String>,_>(6),
        "created_at": row.get::<String,_>(7),
        "updated_at": row.get::<String,_>(8),
        "item_count": row.get::<i64,_>(9),
    })).collect::<Vec<_>>();
    Ok(Json(json!(list)))
}

#[derive(Deserialize)]
pub struct CreatePoBody { pub po: PurchaseOrder, pub items: Vec<PoItem> }

pub async fn create_purchase_order(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<CreatePoBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*)+1 FROM purchase_orders")
        .fetch_one(&pool.pool).await.unwrap_or(1);
    let po_number = if body.po.po_number.is_empty() { format!("PO-{:06}", count) } else { body.po.po_number.clone() };
    sqlx::query(
        "INSERT INTO purchase_orders (id, po_number, supplier_id, supplier_name, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(&id).bind(&po_number).bind(&body.po.supplier_id).bind(&body.po.supplier_name).bind(&body.po.status).bind(&body.po.notes).bind(&user_id).bind(&now).bind(&now)
    .execute(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?;
    for item in &body.items {
        let item_id = gen_id();
        sqlx::query("INSERT INTO po_items (id, po_id, material_id, quantity, price, received_qty, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&item_id).bind(&id).bind(&item.material_id).bind(item.quantity).bind(item.price).bind(0_f64).bind(&now)
            .execute(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?;
    }
    let audit_id = gen_id();
    sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&audit_id).bind(&user_id).bind("create").bind("purchase_order").bind(&id).bind(&format!("PO {}", po_number)).bind(&now)
        .execute(&pool.pool).await.ok();
    Ok(Json(json!({"id": id, "po_number": po_number, "status": body.po.status, "created_at": now})))
}

#[derive(Deserialize)]
pub struct UpdatePoStatusBody { pub status: String }

pub async fn update_purchase_order_status(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Extension(user_id): Extension<String>,
    Json(body): Json<UpdatePoStatusBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE purchase_orders SET status=$1, updated_at=$2 WHERE id=$3")
        .bind(&body.status).bind(&now).bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let audit_id = gen_id();
    sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&audit_id).bind(&user_id).bind("update_status").bind("purchase_order").bind(&id).bind(&format!("Status -> {}", body.status)).bind(&now)
        .execute(&pool.pool).await.ok();
    Ok(Json(json!({"message": "PO status updated"})))
}

pub async fn get_po_items(
    State(pool): State<Arc<DbPool>>,
    Path(po_id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT pi.id, pi.po_id, pi.material_id, pi.quantity, pi.price, pi.received_qty, COALESCE(m.name, ''), pi.created_at FROM po_items pi LEFT JOIN materials m ON m.id = pi.material_id WHERE pi.po_id=$1",
    )
    .bind(&po_id).fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?
    .iter().map(|row| json!({
        "id": row.get::<String,_>(0),
        "po_id": row.get::<String,_>(1),
        "material_id": row.get::<String,_>(2),
        "quantity": row.get::<f64,_>(3),
        "price": row.get::<f64,_>(4),
        "received_qty": row.get::<f64,_>(5),
        "material_name": row.get::<String,_>(6),
        "created_at": row.get::<String,_>(7),
    })).collect::<Vec<_>>();
    Ok(Json(json!(rows)))
}

#[derive(Deserialize)]
pub struct SoQuery { pub search: Option<String>, pub status_filter: Option<String> }

pub async fn get_sales_orders(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<SoQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut sql = String::from(
        "SELECT so.id, so.so_number, so.customer_name, so.customer_address, so.status, so.notes, so.created_by, so.created_at, so.updated_at, (SELECT COUNT(*) FROM so_items WHERE so_id = so.id) FROM sales_orders so WHERE 1=1"
    );
    let mut has_search = false;
    let mut search_val = String::new();
    let mut has_sf = false;
    let mut sf_val = String::new();
    let mut idx = 0u32;
    if let Some(s) = q.search { if !s.is_empty() { has_search = true; search_val = s; sql.push_str(&format!(" AND (so.so_number LIKE ${} OR so.customer_name LIKE ${})", idx+1, idx+2)); idx += 2; } }
    if let Some(sf) = q.status_filter { if !sf.is_empty() && sf != "all" { has_sf = true; sf_val = sf; idx += 1; sql.push_str(&format!(" AND so.status = ${}", idx)); } }
    sql.push_str(" ORDER BY so.created_at DESC");
    let mut query = sqlx::query(&sql);
    let search_pat = if has_search { Some(format!("%{}%", search_val)) } else { None };
    if let Some(ref v) = search_pat { query = query.bind(v).bind(v); }
    if has_sf { query = query.bind(&sf_val); }
    let rows = query.fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| json!({
        "id": row.get::<String,_>(0),
        "so_number": row.get::<String,_>(1),
        "customer_name": row.get::<String,_>(2),
        "customer_address": row.get::<String,_>(3),
        "status": row.get::<String,_>(4),
        "notes": row.get::<String,_>(5),
        "created_by": row.get::<Option<String>,_>(6),
        "created_at": row.get::<String,_>(7),
        "updated_at": row.get::<String,_>(8),
        "item_count": row.get::<i64,_>(9),
    })).collect::<Vec<_>>();
    Ok(Json(json!(list)))
}

#[derive(Deserialize)]
pub struct CreateSoBody { pub so: SalesOrder, pub items: Vec<SoItem> }

pub async fn create_sales_order(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<CreateSoBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*)+1 FROM sales_orders")
        .fetch_one(&pool.pool).await.unwrap_or(1);
    let so_number = if body.so.so_number.is_empty() { format!("SO-{:06}", count) } else { body.so.so_number.clone() };
    sqlx::query(
        "INSERT INTO sales_orders (id, so_number, customer_name, customer_address, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(&id).bind(&so_number).bind(&body.so.customer_name).bind(&body.so.customer_address).bind(&body.so.status).bind(&body.so.notes).bind(&user_id).bind(&now).bind(&now)
    .execute(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?;
    for item in &body.items {
        let item_id = gen_id();
        sqlx::query("INSERT INTO so_items (id, so_id, material_id, quantity, price, fulfilled_qty, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&item_id).bind(&id).bind(&item.material_id).bind(item.quantity).bind(item.price).bind(0_f64).bind(&now)
            .execute(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?;
    }
    let audit_id = gen_id();
    sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&audit_id).bind(&user_id).bind("create").bind("sales_order").bind(&id).bind(&format!("SO {}", so_number)).bind(&now)
        .execute(&pool.pool).await.ok();
    Ok(Json(json!({"id": id, "so_number": so_number, "status": body.so.status, "created_at": now})))
}

#[derive(Deserialize)]
pub struct UpdateSoStatusBody { pub status: String }

pub async fn update_sales_order_status(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Extension(user_id): Extension<String>,
    Json(body): Json<UpdateSoStatusBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE sales_orders SET status=$1, updated_at=$2 WHERE id=$3")
        .bind(&body.status).bind(&now).bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let audit_id = gen_id();
    sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&audit_id).bind(&user_id).bind("update_status").bind("sales_order").bind(&id).bind(&format!("Status -> {}", body.status)).bind(&now)
        .execute(&pool.pool).await.ok();
    Ok(Json(json!({"message": "SO status updated"})))
}

pub async fn get_so_items(
    State(pool): State<Arc<DbPool>>,
    Path(so_id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT si.id, si.so_id, si.material_id, si.quantity, si.price, si.fulfilled_qty, COALESCE(m.name, ''), si.created_at FROM so_items si LEFT JOIN materials m ON m.id = si.material_id WHERE si.so_id=$1",
    )
    .bind(&so_id).fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?
    .iter().map(|row| json!({
        "id": row.get::<String,_>(0),
        "so_id": row.get::<String,_>(1),
        "material_id": row.get::<String,_>(2),
        "quantity": row.get::<f64,_>(3),
        "price": row.get::<f64,_>(4),
        "fulfilled_qty": row.get::<f64,_>(5),
        "material_name": row.get::<String,_>(6),
        "created_at": row.get::<String,_>(7),
    })).collect::<Vec<_>>();
    Ok(Json(json!(rows)))
}

pub async fn get_transaction_attachments(
    State(pool): State<Arc<DbPool>>,
    Path(tx_id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT id, tx_id, filename, data_base64, created_at FROM transaction_attachments WHERE tx_id=$1",
    )
    .bind(&tx_id).fetch_all(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?
    .iter().map(|row| json!({
        "id": row.get::<String,_>(0),
        "tx_id": row.get::<String,_>(1),
        "filename": row.get::<String,_>(2),
        "data_base64": row.get::<String,_>(3),
        "created_at": row.get::<String,_>(4),
    })).collect::<Vec<_>>();
    Ok(Json(json!(rows)))
}

#[derive(Deserialize)]
pub struct CreateAttachmentBody { pub tx_id: String, pub filename: String, pub data_base64: String }

pub async fn create_transaction_attachment(
    State(pool): State<Arc<DbPool>>,
    Extension(_user_id): Extension<String>,
    Json(body): Json<CreateAttachmentBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO transaction_attachments (id, tx_id, filename, data_base64, created_at) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&id).bind(&body.tx_id).bind(&body.filename).bind(&body.data_base64).bind(&now)
    .execute(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"id": id, "tx_id": body.tx_id, "filename": body.filename, "created_at": now})))
}

pub async fn delete_transaction_attachment(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Extension(_user_id): Extension<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM transaction_attachments WHERE id=$1")
        .bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"message": "Attachment deleted"})))
}

#[derive(Deserialize)]
pub struct QiQuery { pub tx_id: Option<String> }

pub async fn get_quality_inspections(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<QiQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut sql = String::from(
        "SELECT qi.id, qi.tx_id, qi.material_id, qi.status, qi.notes, qi.inspected_by, COALESCE(m.name, ''), qi.created_at FROM quality_inspections qi LEFT JOIN materials m ON m.id = qi.material_id WHERE 1=1"
    );
    if let Some(ref t) = q.tx_id { if !t.is_empty() { sql.push_str(" AND qi.tx_id = '"); sql.push_str(t); sql.push('\''); } }
    sql.push_str(" ORDER BY qi.created_at DESC");
    let rows = sqlx::query(&sql).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .iter().map(|row| json!({
            "id": row.get::<String,_>(0),
            "tx_id": row.get::<String,_>(1),
            "material_id": row.get::<String,_>(2),
            "status": row.get::<String,_>(3),
            "notes": row.get::<String,_>(4),
            "inspected_by": row.get::<Option<String>,_>(5),
            "material_name": row.get::<String,_>(6),
            "created_at": row.get::<String,_>(7),
        })).collect::<Vec<_>>();
    Ok(Json(json!(rows)))
}

#[derive(Deserialize)]
pub struct CreateQiBody { pub tx_id: String, pub material_id: String, pub status: String, pub notes: String }

pub async fn create_quality_inspection(
    State(pool): State<Arc<DbPool>>,
    Extension(user_id): Extension<String>,
    Json(body): Json<CreateQiBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO quality_inspections (id, tx_id, material_id, status, notes, inspected_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(&id).bind(&body.tx_id).bind(&body.material_id).bind(&body.status).bind(&body.notes).bind(&user_id).bind(&now)
    .execute(&pool.pool).await
    .map_err(|e| crate::server::server_error(e))?;
    let audit_id = gen_id();
    sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&audit_id).bind(&user_id).bind("create").bind("quality_inspection").bind(&id).bind(&format!("Material {} -> {}", body.material_id, body.status)).bind(&now)
        .execute(&pool.pool).await.ok();
    Ok(Json(json!({"id": id, "tx_id": body.tx_id, "material_id": body.material_id, "status": body.status, "notes": body.notes, "created_at": now})))
}

#[derive(Deserialize)]
pub struct FifoQuery { pub material_id: Option<String>, pub type_: Option<String> }

pub async fn fifo_fefo_suggestion(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<FifoQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let order_clause = if q.type_.as_deref() == Some("fefo") {
        "ORDER BY CASE WHEN expiry_date = '' OR expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC"
    } else {
        "ORDER BY received_at ASC"
    };
    let sql = format!(
        "SELECT id, material_id, batch_no, qty, expiry_date, received_at, created_at FROM material_batches WHERE material_id=$1 AND qty > 0 {}",
        order_clause
    );
    let mid = q.material_id.unwrap_or_default();
    let rows = sqlx::query(&sql).bind(&mid).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .iter().map(|row| json!({
            "id": row.get::<String,_>(0),
            "material_id": row.get::<String,_>(1),
            "batch_no": row.get::<String,_>(2),
            "qty": row.get::<f64,_>(3),
            "expiry_date": row.get::<Option<String>,_>(4),
            "received_at": row.get::<Option<String>,_>(5),
            "created_at": row.get::<String,_>(6),
        })).collect::<Vec<_>>();
    Ok(Json(json!(rows)))
}

#[derive(Deserialize)]
pub struct TxNumberQuery { pub type_: Option<String> }

pub async fn generate_tx_number(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<TxNumberQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let prefix = match q.type_.as_deref().and_then(|s| s.parse::<TxType>().ok()).unwrap_or(TxType::In) {
        TxType::In => "GR",
        TxType::Out => "DO",
        TxType::Transfer => "TRF",
        TxType::Opname => "OPN",
    };
    let now = chrono::Local::now();
    let yyyymm = now.format("%Y%m").to_string();
    let pattern = format!("{}-{}%", prefix, yyyymm);
    let count: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*)+1 FROM transactions WHERE transaction_number LIKE $1")
        .bind(&pattern).fetch_one(&pool.pool).await.unwrap_or(1);
    Ok(Json(json!({"number": format!("{}-{}-{:06}", prefix, yyyymm, count)})))
}
