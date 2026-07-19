use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferBody { pub material_id: String, pub from_warehouse_id: String, pub to_warehouse_id: String, pub rack_id: Option<String>, pub quantity: f64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkTransferBody { pub transfers: Vec<serde_json::Value>, pub user_id: Option<String> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOrderCreateBody { pub from_warehouse_id: String, pub to_warehouse_id: String, pub notes: String, pub items: Vec<serde_json::Value> }

#[derive(Deserialize)]
pub struct TransferOrderStatusBody { pub status: String }

#[derive(Deserialize)]
pub struct BatchRackBody { pub source_rack_id: String, pub dest_warehouse_id: String, pub dest_rack_id: Option<String> }

pub async fn transfer_material(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<TransferBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'")
        .fetch_one(&mut *db_tx).await.unwrap_or(1);
    let txn_number = format!("TRF-{:04}", count);
    sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number).bind(&body.material_id).bind(&body.from_warehouse_id).bind(-body.quantity)
        .bind(format!("Transfer to {}", body.to_warehouse_id)).bind(&user_id).bind(&now)
        .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    let count2: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'")
        .fetch_one(&mut *db_tx).await.unwrap_or(1);
    let txn_number2 = format!("TRF-{:04}", count2 + 1);
    sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8,$9)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number2).bind(&body.material_id).bind(&body.to_warehouse_id).bind(&body.rack_id)
        .bind(body.quantity).bind(format!("Transfer from {}", body.from_warehouse_id)).bind(&user_id).bind(&now)
        .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    sqlx::query("UPDATE materials SET warehouse_id=$1, rack_id=$2 WHERE id=$3")
        .bind(&body.to_warehouse_id).bind(&body.rack_id).bind(&body.material_id)
        .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn transfer_bulk(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<BulkTransferBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'").fetch_one(&mut *db_tx).await.unwrap_or(1);
    let mut tx_count = 0;
    let mut errors = Vec::new();
    for t in &body.transfers {
        let material_id = t.get("material_id").and_then(|v| v.as_str()).unwrap_or("");
        let from_wh = t.get("from_warehouse_id").and_then(|v| v.as_str()).unwrap_or("");
        let to_wh = t.get("to_warehouse_id").and_then(|v| v.as_str()).unwrap_or("");
        let rack_id = t.get("rack_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let quantity = t.get("quantity").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if material_id.is_empty() || from_wh.is_empty() || to_wh.is_empty() || quantity <= 0.0 {
            errors.push(format!("Invalid entry: material='{}', from='{}', to='{}', qty={}", material_id, from_wh, to_wh, quantity));
            continue;
        }
        let txn_number = format!("TRF-{:04}", count);
        sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number).bind(material_id).bind(from_wh).bind(-quantity)
            .bind(format!("Bulk transfer to {}", to_wh)).bind(&user_id).bind(&now)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        count += 1;
        let txn_number2 = format!("TRF-{:04}", count);
        sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8,$9)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number2).bind(material_id).bind(to_wh).bind(rack_id)
            .bind(quantity).bind(format!("Bulk transfer from {}", from_wh)).bind(&user_id).bind(&now)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        count += 1;
        sqlx::query("UPDATE materials SET warehouse_id=$1, rack_id=$2 WHERE id=$3")
            .bind(to_wh).bind(rack_id).bind(material_id)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        tx_count += 1;
    }
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    let msg = if errors.is_empty() { format!("{} material(s) transferred", tx_count) } else { format!("{} transferred, {} errors: {}", tx_count, errors.len(), errors.join("\n")) };
    Ok(Json(json!(msg)))
}

pub async fn batch_transfer_rack(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<BatchRackBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let materials: Vec<(String, String, f64)> = sqlx::query("SELECT id, name, quantity FROM materials WHERE rack_id=$1 AND is_active=true")
        .bind(&body.source_rack_id).fetch_all(&mut *db_tx).await
        .map_err(|e| crate::server::server_error(e))?
        .iter().map(|row| (row.get::<String,_>(0), row.get::<String,_>(1), row.get::<f64,_>(2))).collect();
    if materials.is_empty() { return Err((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"No active materials in source rack"})))); }
    let mut count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'").fetch_one(&mut *db_tx).await.unwrap_or(1);
    let mut tx_count = 0;
    for (mid, _name, qty) in &materials {
        if *qty <= 0.0 { continue; }
        let txn_number = format!("TRF-{:04}", count);
        sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number).bind(mid).bind("").bind(-qty)
            .bind(format!("Batch rack transfer to {}", body.dest_warehouse_id)).bind(&user_id).bind(&now)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        count += 1;
        let txn_number2 = format!("TRF-{:04}", count);
        sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8,$9)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number2).bind(mid).bind(&body.dest_warehouse_id).bind(&body.dest_rack_id)
            .bind(qty).bind(format!("Batch rack transfer from rack {}", body.source_rack_id)).bind(&user_id).bind(&now)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        count += 1;
        sqlx::query("UPDATE materials SET warehouse_id=$1, rack_id=$2 WHERE id=$3")
            .bind(&body.dest_warehouse_id).bind(&body.dest_rack_id).bind(mid)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        tx_count += 1;
    }
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(format!("Transferred {} material(s)", tx_count))))
}

pub async fn get_transfer_orders(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let status_filter = q.get("statusFilter").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let mut builder = sqlx::QueryBuilder::new("SELECT id, transfer_number, from_warehouse_id, to_warehouse_id, status, notes, created_by, approved_by, created_at, updated_at FROM transfer_orders WHERE 1=1");
    if let Some(s) = status_filter { builder.push(" AND status = "); builder.push_bind(s); }
    builder.push(" ORDER BY created_at DESC");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "transfer_number": row.get::<String,_>("transfer_number"),
            "from_warehouse_id": row.get::<String,_>("from_warehouse_id"), "to_warehouse_id": row.get::<String,_>("to_warehouse_id"),
            "status": row.get::<String,_>("status"), "notes": row.get::<String,_>("notes"),
            "created_by": row.get::<Option<String>,_>("created_by"), "approved_by": row.get::<Option<String>,_>("approved_by"),
            "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at")})
    }).collect::<Vec<_>>())))
}

pub async fn create_transfer_order(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<TransferOrderCreateBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transfer_orders").fetch_one(&pool.pool).await.unwrap_or(1);
    let txn = format!("TO-{:04}", count);
    sqlx::query("INSERT INTO transfer_orders (id, transfer_number, from_warehouse_id, to_warehouse_id, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$7)")
        .bind(&id).bind(&txn).bind(&body.from_warehouse_id).bind(&body.to_warehouse_id).bind(&body.notes).bind(&user_id).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    for item in &body.items {
        let iid = uuid::Uuid::new_v4().to_string();
        let batch_id = item.get("batch_id").and_then(|v| v.as_str()).map(|s| s.to_string());
        sqlx::query("INSERT INTO transfer_items (id, transfer_id, material_id, batch_id, quantity, created_at) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(&iid).bind(&id).bind(item.get("material_id").and_then(|v| v.as_str()).unwrap_or("")).bind(&batch_id)
            .bind(item.get("quantity").and_then(|v| v.as_f64()).unwrap_or(0.0)).bind(&now)
            .execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    }
    Ok(Json(json!({"id": id, "transfer_number": txn, "from_warehouse_id": body.from_warehouse_id, "to_warehouse_id": body.to_warehouse_id, "status": "draft", "notes": body.notes, "created_by": user_id, "approved_by": null, "created_at": now, "updated_at": now})))
}

pub async fn update_transfer_order_status(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Json(body): Json<TransferOrderStatusBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE transfer_orders SET status=$1, updated_at=$2 WHERE id=$3")
        .bind(&body.status).bind(&now).bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    if body.status == "received" {
        let items: Vec<(String, f64, String)> = sqlx::query("SELECT ti.material_id, ti.quantity, to2.to_warehouse_id FROM transfer_items ti JOIN transfer_orders to2 ON ti.transfer_id=to2.id WHERE ti.transfer_id=$1")
            .bind(&id).fetch_all(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?
            .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1), row.get::<String,_>(2))).collect();
        let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
        let txn_count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'").fetch_one(&mut *db_tx).await.unwrap_or(1);
        let txn_num = format!("TRF-{:04}", txn_count);
        for (mat_id, qty, to_wh) in items {
            sqlx::query("UPDATE materials SET quantity = GREATEST(COALESCE(quantity,0) - $1, 0) WHERE id=$2")
                .bind(qty).bind(&mat_id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
            sqlx::query("UPDATE materials SET quantity = COALESCE(quantity,0) + $1, warehouse_id=$2 WHERE id=$3")
                .bind(qty).bind(&to_wh).bind(&mat_id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
            sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, quantity, price, reference, notes, user_id, status, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,0,$6,$7,$8,'approved',$9)")
                .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_num).bind(&mat_id).bind(&to_wh).bind(qty).bind(&id).bind(format!("Transfer Order: {}", id)).bind(&user_id).bind(&now)
                .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        }
        sqlx::query("UPDATE transfer_orders SET approved_by=$1 WHERE id=$2")
            .bind(&user_id).bind(&id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    }
    Ok(Json(()))
}

pub async fn get_transfer_items(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT ti.id, ti.transfer_id, ti.material_id, ti.batch_id, ti.quantity, m.sku, m.name FROM transfer_items ti JOIN materials m ON ti.material_id=m.id WHERE ti.transfer_id=$1")
        .bind(&id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "transfer_id": row.get::<String,_>("transfer_id"),
            "material_id": row.get::<String,_>("material_id"), "batch_id": row.get::<Option<String>,_>("batch_id"),
            "quantity": row.get::<f64,_>("quantity"), "sku": row.get::<String,_>("sku"),
            "material_name": row.get::<String,_>("name")})
    }).collect::<Vec<_>>())))
}

pub async fn get_throughput_metrics(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT w.id, w.name, COALESCE(SUM(CASE WHEN t.type='in' AND t.created_at::date=CURRENT_DATE THEN t.quantity ELSE 0 END),0), COALESCE(SUM(CASE WHEN t.type='out' AND t.created_at::date=CURRENT_DATE THEN t.quantity ELSE 0 END),0), COUNT(CASE WHEN t.created_at::date=CURRENT_DATE THEN 1 END) FROM warehouses w LEFT JOIN transactions t ON w.id=t.warehouse_id GROUP BY w.id ORDER BY w.name")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"warehouse_id": row.get::<String,_>("id"), "warehouse_name": row.get::<String,_>("name"),
            "in_qty": row.get::<f64,_>(2), "out_qty": row.get::<f64,_>(3), "tx_count": row.get::<i64,_>(4)})
    }).collect::<Vec<_>>())))
}

pub async fn get_picker_activity(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT u.id, u.full_name, COUNT(*) FROM transactions t JOIN users u ON t.user_id=u.id WHERE t.type='out' AND t.created_at::date=CURRENT_DATE GROUP BY u.id ORDER BY COUNT(*) DESC LIMIT 20")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"user_id": row.get::<String,_>("id"), "user_name": row.get::<String,_>("full_name"), "pick_count": row.get::<i64,_>(2)})
    }).collect::<Vec<_>>())))
}

pub async fn get_slotting_suggestions(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT m.id, m.sku, m.name, COALESCE(r.rack_name,'None'), 'Recommended Zone', 'High turnover - move closer to shipping' FROM materials m \
         LEFT JOIN racks r ON m.rack_id=r.id \
         WHERE m.id IN (SELECT material_id FROM transactions WHERE type='out' AND created_at >= TO_CHAR(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD HH24:MI:SS') GROUP BY material_id HAVING SUM(quantity) > 10) \
         ORDER BY (SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at>=TO_CHAR(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD HH24:MI:SS')) DESC LIMIT 10"
    ).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"material_id": row.get::<String,_>("id"), "sku": row.get::<String,_>("sku"), "name": row.get::<String,_>("name"),
            "current_rack": row.get::<String,_>(3), "suggested_rack": row.get::<String,_>(4), "reason": row.get::<String,_>(5)})
    }).collect::<Vec<_>>())))
}
