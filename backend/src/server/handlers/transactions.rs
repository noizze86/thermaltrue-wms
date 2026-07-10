use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::{Transaction, TransactionItem};
use sqlx::Row;

fn gen_id() -> String { uuid::Uuid::new_v4().to_string() }

#[derive(Deserialize)]
pub struct ListParams { pub search: Option<String>, pub type_filter: Option<String>, pub material_id: Option<String>, pub warehouse_id: Option<String>, pub date_start: Option<String>, pub date_end: Option<String>, pub limit: Option<i64> }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Transaction>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
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

    builder.push(" ORDER BY created_at DESC LIMIT ").push_bind(params.limit.unwrap_or(200));

    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
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
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let transactions = rows.iter().map(|row| { Transaction { id: row.get(0), transaction_number: row.get(1), tx_type: row.get(2), material_id: row.get(3), warehouse_id: row.get(4), rack_id: row.get(5), quantity: row.get(6), price: row.get(7), reference: row.get(8), notes: row.get(9), user_id: row.get(10), status: row.get(11), approved_by: row.get(12), po_number: row.get(13), invoice_no: row.get(14), destination: row.get(15), created_at: row.get(16), updated_at: row.get(17) } }).collect();
    Ok(Json(transactions))
}

#[derive(Deserialize)]
pub struct CreateBody { pub tx: Transaction, pub items: Option<Vec<TransactionItem>> }

pub async fn create(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateBody>,
) -> Result<Json<Transaction>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut db_tx = pool.pool.begin().await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let prefix = match body.tx.tx_type.as_str() { "in" => "IN", "out" => "OUT", "transfer" => "TRF", "opname" => "OPN", _ => "TXN" };
    let count: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*)+1 FROM transactions WHERE type=$1").bind(&body.tx.tx_type).fetch_one(&mut *db_tx).await.unwrap_or(1);
    let txn_number = format!("{}-{:04}", prefix, count);
    let status = if body.tx.status.is_empty() { "approved".to_string() } else { body.tx.status.clone() };
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
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    for item in &items {
        let item_id = gen_id();
        sqlx::query("INSERT INTO transaction_items (id, tx_id, material_id, batch_id, quantity, price, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&item_id).bind(&id).bind(&item.material_id).bind(&item.batch_id).bind(item.quantity).bind(item.price).bind(&now)
            .execute(&mut *db_tx).await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    }

    match body.tx.tx_type.as_str() {
        "in" => { sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2").bind(qty).bind(&mat_id).execute(&mut *db_tx).await.ok(); }
        "out" => { sqlx::query("UPDATE materials SET quantity = GREATEST(quantity - $1, 0) WHERE id=$2").bind(qty).bind(&mat_id).execute(&mut *db_tx).await.ok(); }
        _ => {}
    }

    db_tx.commit().await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(Transaction { id, transaction_number: txn_number, tx_type: body.tx.tx_type, material_id: mat_id, warehouse_id: body.tx.warehouse_id, rack_id: body.tx.rack_id, quantity: qty, price, reference: body.tx.reference, notes: body.tx.notes, user_id: body.tx.user_id, status, approved_by: body.tx.approved_by, po_number: body.tx.po_number, invoice_no: body.tx.invoice_no, destination: body.tx.destination, created_at: now.clone(), updated_at: Some(now) }))
}

pub async fn approve(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("UPDATE transactions SET status='approved' WHERE id=$1 AND status='pending'")
        .bind(&id).execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn reject(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("UPDATE transactions SET status='rejected' WHERE id=$1 AND status='pending'")
        .bind(&id).execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}
