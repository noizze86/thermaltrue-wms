use tauri::State;
use serde::Serialize;
use crate::db_pool::DbPool;
use crate::models::*;
use crate::error::AppError;
use sqlx::Row;
use crate::validate;
use crate::commands::gen_id;

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
pub struct TransactionDetail {
    pub transaction: Transaction,
    pub items: Vec<TransactionItem>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PurchaseOrderWithCount {
    #[serde(flatten)]
    pub po: PurchaseOrder,
    pub item_count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct SalesOrderWithCount {
    #[serde(flatten)]
    pub so: SalesOrder,
    pub item_count: i64,
}

/// Delegates to the shared audit_log helper in mod.rs
async fn audit(
    pool: &sqlx::PgPool,
    user_id: &str,
    action: &str,
    entity: &str,
    entity_id: &str,
    details: &str,
) {
    crate::commands::audit_log(pool, user_id, action, entity, entity_id, details).await;
}

// ---------------------------------------------------------------------------
// EXISTING COMMANDS (enhanced)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_transactions(
    pool: State<'_, DbPool>,
    token: String,
    search: Option<String>,
    type_filter: Option<String>,
    material_id: Option<String>,
    warehouse_id: Option<String>,
    date_start: Option<String>,
    date_end: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Transaction>, AppError> {
    let user_id = pool.verify_token(&token)?;
    let warehouse_ids = validate::get_user_warehouses(&pool.pool, &user_id).await?;
    use sqlx::QueryBuilder;

    let search_pat = search.as_ref().filter(|s| !s.is_empty()).map(|s| format!("%{}%", s));
    let de_val = date_end.as_ref().filter(|d| !d.is_empty()).map(|d| format!("{} 23:59:59", d));

    let mut builder = QueryBuilder::new(
        "SELECT id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at FROM transactions WHERE 1=1"
    );

    if let Some(ref pat) = search_pat {
        builder.push(" AND (transaction_number LIKE ").push_bind(pat.clone());
        builder.push(" OR reference LIKE ").push_bind(pat.clone());
        builder.push(" OR po_number LIKE ").push_bind(pat.clone());
        builder.push(" OR invoice_no LIKE ").push_bind(pat.clone());
    }
    if let Some(ref t) = type_filter {
        if t != "all" {
            builder.push(" AND type = ").push_bind(t.clone());
        }
    }
    if let Some(ref m) = material_id {
        if !m.is_empty() {
            builder.push(" AND material_id = ").push_bind(m.clone());
        }
    }
    if let Some(ref w) = warehouse_id {
        if !w.is_empty() {
            builder.push(" AND warehouse_id = ").push_bind(w.clone());
        }
    }
    if let Some(ref ds) = date_start {
        if !ds.is_empty() {
            builder.push(" AND created_at >= ").push_bind(ds.clone());
        }
    }
    if let Some(ref dv) = de_val {
        builder.push(" AND created_at <= ").push_bind(dv.clone());
    }
    if !warehouse_ids.is_empty() {
        builder.push(" AND warehouse_id = ANY(").push_bind(&warehouse_ids).push(")");
    }
    builder.push(" ORDER BY created_at DESC");
    let limit_val = limit.unwrap_or(200);
    builder.push(" LIMIT ").push_bind(limit_val);

    let rows = builder.build().fetch_all(&pool.pool).await?;
    let mut transactions = Vec::new();
    for row in rows {
        transactions.push(Transaction {
            id: row.get(0),
            transaction_number: row.get(1),
            tx_type: row.get(2),
            material_id: row.get(3),
            warehouse_id: row.get(4),
            rack_id: row.get(5),
            quantity: row.get(6),
            price: row.get(7),
            reference: row.get(8),
            notes: row.get(9),
            user_id: row.get(10),
            status: row.get(11),
            approved_by: row.get(12),
            po_number: row.get(13),
            invoice_no: row.get(14),
            destination: row.get(15),
            created_at: row.get(16),
            updated_at: row.get(17),
        });
    }
    Ok(transactions)
}

#[tauri::command]
pub async fn create_transaction(
    pool: State<'_, DbPool>,
    token: String,
    tx: Transaction,
    items: Vec<TransactionItem>,
) -> Result<Transaction, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut db_tx = pool.pool.begin().await?;
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let prefix = match tx.tx_type.parse::<TxType>().unwrap_or(TxType::In) {
        TxType::In => "IN", TxType::Out => "OUT", TxType::Transfer => "TRF", TxType::Opname => "OPN",
    };
    let count: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)+1 FROM transactions WHERE type=$1"
    )
    .bind(&tx.tx_type)
    .fetch_one(&mut *db_tx)
    .await
    .unwrap_or(1);
    let txn_number = format!("{}-{:04}", prefix, count);
    let status = if tx.status.is_empty() { "pending".to_string() } else { tx.status.clone() };

    let (mat_id, qty, price) = if items.is_empty() {
        (tx.material_id.clone(), tx.quantity, tx.price)
    } else if items.len() == 1 {
        (items[0].material_id.clone(), items[0].quantity, items[0].price)
    } else {
        let total_qty: f64 = items.iter().map(|i| i.quantity).sum();
        (items[0].material_id.clone(), total_qty, 0.0)
    };

    sqlx::query(
        "INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
    )
    .bind(&id)
    .bind(&txn_number)
    .bind(&tx.tx_type)
    .bind(&mat_id)
    .bind(&tx.warehouse_id)
    .bind(&tx.rack_id)
    .bind(qty)
    .bind(price)
    .bind(&tx.reference)
    .bind(&tx.notes)
    .bind(&tx.user_id)
    .bind(&status)
    .bind(&tx.approved_by)
    .bind(&tx.po_number)
    .bind(&tx.invoice_no)
    .bind(&tx.destination)
    .bind(&now)
    .bind(&now)
    .execute(&mut *db_tx)
    .await?;

    for item in &items {
        let item_id = gen_id();
        sqlx::query(
            "INSERT INTO transaction_items (id, tx_id, material_id, batch_id, quantity, price, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&item_id)
        .bind(&id)
        .bind(&item.material_id)
        .bind(&item.batch_id)
        .bind(item.quantity)
        .bind(item.price)
        .bind(&now)
        .execute(&mut *db_tx)
        .await?;
    }

    if status.parse::<TxStatus>().ok() == Some(TxStatus::Approved) {
        if items.is_empty() {
            match tx.tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                TxType::In => {
                    sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                        .bind(tx.quantity)
                        .bind(&tx.material_id)
                        .execute(&mut *db_tx)
                        .await?;
                }
                TxType::Out => {
                    let result = sqlx::query("UPDATE materials SET quantity = quantity - $1 WHERE id=$2 AND quantity >= $1")
                        .bind(tx.quantity)
                        .bind(&tx.material_id)
                        .execute(&mut *db_tx)
                        .await?;
                    if result.rows_affected() == 0 {
                        let stock: f64 = sqlx::query_scalar("SELECT quantity FROM materials WHERE id=$1 FOR UPDATE")
                            .bind(&tx.material_id)
                            .fetch_optional(&mut *db_tx)
                            .await?
                            .ok_or_else(|| AppError::NotFound("Material not found".into()))?;
                        return Err(AppError::Validation(format!("Insufficient stock: available {:.2}, requested {:.2}", stock, tx.quantity)));
                    }
                }
                _ => {}
            }
        } else {
            for item in &items {
                match tx.tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                    TxType::In => {
                        sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                            .bind(item.quantity)
                            .bind(&item.material_id)
                            .execute(&mut *db_tx)
                            .await?;
                    }
                    TxType::Out => {
                        let result = sqlx::query("UPDATE materials SET quantity = quantity - $1 WHERE id=$2 AND quantity >= $1")
                            .bind(item.quantity)
                            .bind(&item.material_id)
                            .execute(&mut *db_tx)
                            .await?;
                        if result.rows_affected() == 0 {
                            let stock: f64 = sqlx::query_scalar("SELECT quantity FROM materials WHERE id=$1 FOR UPDATE")
                                .bind(&item.material_id)
                                .fetch_optional(&mut *db_tx)
                                .await?
                                .ok_or_else(|| AppError::NotFound("Material not found".into()))?;
                            return Err(AppError::Validation(format!("Insufficient stock: available {:.2}, requested {:.2}", stock, item.quantity)));
                        }
                    }
                    _ => {}
                }
            }
        }
        if tx.tx_type.parse::<TxType>().ok() == Some(TxType::In) && !tx.po_number.is_empty() {
            if items.is_empty() {
                if let Some(po_row) = sqlx::query("SELECT pi.received_qty, pi.quantity FROM po_items pi JOIN purchase_orders po ON pi.po_id=po.id WHERE po.po_number=$1 AND pi.material_id=$2")
                    .bind(&tx.po_number)
                    .bind(&tx.material_id)
                    .fetch_optional(&mut *db_tx)
                    .await?
                {
                    let received: f64 = po_row.get(0);
                    let total: f64 = po_row.get(1);
                    if received + tx.quantity > total {
                        return Err(AppError::Validation(format!("Over-receive: PO item max {:.2}, already received {:.2}, trying to add {:.2}", total, received, tx.quantity)));
                    }
                }
                let _ = sqlx::query(
                    "UPDATE po_items SET received_qty = received_qty + $1 WHERE po_id IN (SELECT id FROM purchase_orders WHERE po_number=$2) AND material_id=$3",
                )
                .bind(tx.quantity)
                .bind(&tx.po_number)
                .bind(&tx.material_id)
                .execute(&mut *db_tx).await;
            } else {
                for item in &items {
                    if let Some(po_row) = sqlx::query("SELECT pi.received_qty, pi.quantity FROM po_items pi JOIN purchase_orders po ON pi.po_id=po.id WHERE po.po_number=$1 AND pi.material_id=$2")
                        .bind(&tx.po_number)
                        .bind(&item.material_id)
                        .fetch_optional(&mut *db_tx)
                        .await?
                    {
                        let received: f64 = po_row.get(0);
                        let total: f64 = po_row.get(1);
                        if received + item.quantity > total {
                            return Err(AppError::Validation(format!("Over-receive: PO item max {:.2}, already received {:.2}, trying to add {:.2}", total, received, item.quantity)));
                        }
                    }
                    let _ = sqlx::query(
                        "UPDATE po_items SET received_qty = received_qty + $1 WHERE po_id IN (SELECT id FROM purchase_orders WHERE po_number=$2) AND material_id=$3",
                    )
                    .bind(item.quantity)
                    .bind(&tx.po_number)
                    .bind(&item.material_id)
                    .execute(&mut *db_tx).await;
                }
            }
        }
        if tx.tx_type.parse::<TxType>().ok() == Some(TxType::Out) && !tx.reference.is_empty() && tx.reference.starts_with("SO-") {
            if items.is_empty() {
                let _ = sqlx::query(
                    "UPDATE so_items SET fulfilled_qty = fulfilled_qty + $1 WHERE so_id IN (SELECT id FROM sales_orders WHERE so_number=$2) AND material_id=$3",
                )
                .bind(tx.quantity)
                .bind(&tx.reference)
                .bind(&tx.material_id)
                .execute(&mut *db_tx).await;
            } else {
                for item in &items {
                    let _ = sqlx::query(
                        "UPDATE so_items SET fulfilled_qty = fulfilled_qty + $1 WHERE so_id IN (SELECT id FROM sales_orders WHERE so_number=$2) AND material_id=$3",
                    )
                    .bind(item.quantity)
                    .bind(&tx.reference)
                    .bind(&item.material_id)
                    .execute(&mut *db_tx).await;
                }
            }
        }
    }

    db_tx.commit().await?;
    get_transaction_by_id_inner(&pool.pool, id).await
}

async fn get_transaction_by_id_inner(pool: &sqlx::PgPool, id: String) -> Result<Transaction, AppError> {
    sqlx::query(
        "SELECT id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at FROM transactions WHERE id=$1",
    )
    .bind(&id)
    .fetch_optional(pool)
    .await?
    .map(|row| Transaction {
        id: row.get(0),
        transaction_number: row.get(1),
        tx_type: row.get(2),
        material_id: row.get(3),
        warehouse_id: row.get(4),
        rack_id: row.get(5),
        quantity: row.get(6),
        price: row.get(7),
        reference: row.get(8),
        notes: row.get(9),
        user_id: row.get(10),
        status: row.get(11),
        approved_by: row.get(12),
        po_number: row.get(13),
        invoice_no: row.get(14),
        destination: row.get(15),
        created_at: row.get(16),
        updated_at: row.get(17),
    })
    .ok_or_else(|| AppError::NotFound(format!("Transaction not found: {}", id)))
}

#[tauri::command]
pub async fn approve_transaction(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut db_tx = pool.pool.begin().await?;

    let (tx_type, material_id): (String, String) = sqlx::query(
        "SELECT type, material_id FROM transactions WHERE id=$1",
    )
    .bind(&id)
    .fetch_optional(&mut *db_tx)
    .await?
    .map(|row| (row.get(0), row.get(1)))
    .ok_or_else(|| AppError::NotFound("Transaction not found".into()))?;

    sqlx::query("UPDATE transactions SET status='approved', approved_by=$1 WHERE id=$2")
        .bind(&user_id)
        .bind(&id)
        .execute(&mut *db_tx)
        .await?;

    let items: Vec<(String, f64)> = sqlx::query(
        "SELECT material_id, quantity FROM transaction_items WHERE tx_id=$1",
    )
    .bind(&id)
    .fetch_all(&mut *db_tx)
    .await?
    .into_iter()
    .map(|row| (row.get(0), row.get(1)))
    .collect();

    if items.is_empty() {
        let quantity: f64 = sqlx::query_scalar::<_, f64>(
            "SELECT quantity FROM transactions WHERE id=$1",
        )
        .bind(&id)
        .fetch_one(&mut *db_tx)
        .await?;
        match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
            TxType::In => {
                sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                    .bind(quantity)
                    .bind(&material_id)
                    .execute(&mut *db_tx)
                    .await?;
            }
            TxType::Out => {
                let result = sqlx::query("UPDATE materials SET quantity = quantity - $1 WHERE id=$2 AND quantity >= $1")
                    .bind(quantity)
                    .bind(&material_id)
                    .execute(&mut *db_tx)
                    .await?;
                if result.rows_affected() == 0 {
                    let cur_stock: f64 = sqlx::query_scalar("SELECT quantity FROM materials WHERE id=$1 FOR UPDATE")
                        .bind(&material_id)
                        .fetch_one(&mut *db_tx)
                        .await?;
                    return Err(AppError::Validation(format!("Insufficient stock: available {:.2}, requested {:.2}", cur_stock, quantity)));
                }
            }
            _ => {}
        }
    } else {
        for (mid, qty) in &items {
            match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                TxType::In => {
                    sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                        .bind(qty)
                        .bind(mid)
                        .execute(&mut *db_tx)
                        .await?;
                }
                TxType::Out => {
                    let result = sqlx::query("UPDATE materials SET quantity = quantity - $1 WHERE id=$2 AND quantity >= $1")
                        .bind(qty)
                        .bind(mid)
                        .execute(&mut *db_tx)
                        .await?;
                    if result.rows_affected() == 0 {
                        let cur_stock: f64 = sqlx::query_scalar("SELECT quantity FROM materials WHERE id=$1 FOR UPDATE")
                            .bind(mid)
                            .fetch_one(&mut *db_tx)
                            .await?;
                        return Err(AppError::Validation(format!("Insufficient stock: available {:.2}, requested {:.2}", cur_stock, qty)));
                    }
                }
                _ => {}
            }
        }
    }

    audit(&pool.pool, &user_id, "approve", "transaction", &id, &format!("Approved {} transaction", tx_type)).await;
    db_tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn reject_transaction(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE transactions SET status='rejected' WHERE id=$1")
        .bind(&id)
        .execute(&pool.pool)
        .await?;
    audit(&pool.pool, &user_id, "reject", "transaction", &id, "").await;
    Ok(())
}

#[tauri::command]
pub async fn get_pending_transactions(pool: State<'_, DbPool>, token: String) -> Result<Vec<Transaction>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at FROM transactions WHERE status='pending' ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(&pool.pool)
    .await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(Transaction {
            id: row.get(0),
            transaction_number: row.get(1),
            tx_type: row.get(2),
            material_id: row.get(3),
            warehouse_id: row.get(4),
            rack_id: row.get(5),
            quantity: row.get(6),
            price: row.get(7),
            reference: row.get(8),
            notes: row.get(9),
            user_id: row.get(10),
            status: row.get(11),
            approved_by: row.get(12),
            po_number: row.get(13),
            invoice_no: row.get(14),
            destination: row.get(15),
            created_at: row.get(16),
            updated_at: row.get(17),
        });
    }
    Ok(list)
}

#[tauri::command]
pub async fn get_transaction_by_id(pool: State<'_, DbPool>, token: String, id: String) -> Result<TransactionDetail, AppError> {
    pool.verify_token(&token)?;
    let tx = sqlx::query(
        "SELECT id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at FROM transactions WHERE id=$1",
    )
    .bind(&id)
    .fetch_optional(&pool.pool)
    .await?
    .map(|row| Transaction {
        id: row.get(0),
        transaction_number: row.get(1),
        tx_type: row.get(2),
        material_id: row.get(3),
        warehouse_id: row.get(4),
        rack_id: row.get(5),
        quantity: row.get(6),
        price: row.get(7),
        reference: row.get(8),
        notes: row.get(9),
        user_id: row.get(10),
        status: row.get(11),
        approved_by: row.get(12),
        po_number: row.get(13),
        invoice_no: row.get(14),
        destination: row.get(15),
        created_at: row.get(16),
        updated_at: row.get(17),
    })
    .ok_or_else(|| AppError::NotFound(format!("Transaction not found: {}", id)))?;

    let items: Vec<TransactionItem> = sqlx::query(
        "SELECT ti.id, ti.tx_id, ti.material_id, ti.batch_id, ti.quantity, ti.price, COALESCE(m.name, ''), ti.created_at FROM transaction_items ti LEFT JOIN materials m ON m.id = ti.material_id WHERE ti.tx_id=$1",
    )
    .bind(&id)
    .fetch_all(&pool.pool)
    .await?
    .into_iter()
    .map(|row| TransactionItem {
        id: row.get(0),
        tx_id: row.get(1),
        material_id: row.get(2),
        batch_id: row.get(3),
        quantity: row.get(4),
        price: row.get(5),
        material_name: row.get(6),
        created_at: row.get(7),
    })
    .collect();

    Ok(TransactionDetail { transaction: tx, items })
}

// ---------------------------------------------------------------------------
// NEW COMMANDS – Reverse
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn reverse_transaction(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut db_tx = pool.pool.begin().await?;

    let (cur_status, tx_type): (String, String) = sqlx::query(
        "SELECT status, type FROM transactions WHERE id=$1",
    )
    .bind(&id)
    .fetch_optional(&mut *db_tx)
    .await?
    .map(|row| (row.get(0), row.get(1)))
    .ok_or_else(|| AppError::NotFound("Transaction not found".into()))?;

    if cur_status.parse::<TxStatus>().ok() == Some(TxStatus::Reversed) {
        return Err(AppError::Validation("Transaction already reversed".into()));
    }

    let items: Vec<(String, f64)> = sqlx::query(
        "SELECT material_id, quantity FROM transaction_items WHERE tx_id=$1",
    )
    .bind(&id)
    .fetch_all(&mut *db_tx)
    .await?
    .into_iter()
    .map(|row| (row.get(0), row.get(1)))
    .collect();

    if items.is_empty() {
        let (mid, qty): (String, f64) = sqlx::query(
            "SELECT material_id, quantity FROM transactions WHERE id=$1",
        )
        .bind(&id)
        .fetch_one(&mut *db_tx)
        .await
        .map(|row| (row.get(0), row.get(1)))?;
        match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
            TxType::In => {
                sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2")
                    .bind(qty)
                    .bind(&mid)
                    .execute(&mut *db_tx).await?;
            }
            TxType::Out => {
                sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                    .bind(qty)
                    .bind(&mid)
                    .execute(&mut *db_tx).await?;
            }
            _ => {}
        }
    } else {
        for (mid, qty) in &items {
            match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                TxType::In => {
                    sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2")
                        .bind(qty)
                        .bind(mid)
                        .execute(&mut *db_tx).await?;
                }
                TxType::Out => {
                    sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                        .bind(qty)
                        .bind(mid)
                        .execute(&mut *db_tx).await?;
                }
                _ => {}
            }
        }
    }

    sqlx::query("UPDATE transactions SET status='reversed' WHERE id=$1")
        .bind(&id)
        .execute(&mut *db_tx)
        .await?;
    audit(&pool.pool, &user_id, "reverse", "transaction", &id, &format!("Reversed {} transaction", tx_type)).await;
    db_tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn reverse_transactions_bulk(pool: State<'_, DbPool>, token: String, ids: Vec<String>) -> Result<String, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut db_tx = pool.pool.begin().await?;
    let mut reversed = 0i64;
    let mut errors = Vec::new();
    for id in &ids {
        let (cur_status, tx_type): (String, String) = match sqlx::query(
            "SELECT status, type FROM transactions WHERE id=$1",
        )
        .bind(id)
        .fetch_optional(&mut *db_tx)
        .await
        {
            Ok(Some(row)) => (row.get(0), row.get(1)),
            Ok(None) => { errors.push(format!("{}: not found", id)); continue; }
            Err(e) => { errors.push(format!("{}: {}", id, e)); continue; }
        };
        if cur_status.parse::<TxStatus>().ok() == Some(TxStatus::Reversed) {
            errors.push(format!("{}: already reversed", id));
            continue;
        }
        let items: Vec<(String, f64)> = match sqlx::query(
            "SELECT material_id, quantity FROM transaction_items WHERE tx_id=$1",
        )
        .bind(id)
        .fetch_all(&mut *db_tx)
        .await
        {
            Ok(rows) => rows.into_iter().map(|r| (r.get(0), r.get(1))).collect(),
            Err(_) => Vec::new(),
        };
        if items.is_empty() {
            if let Ok(row) = sqlx::query(
                "SELECT material_id, quantity FROM transactions WHERE id=$1",
            )
            .bind(id)
            .fetch_one(&mut *db_tx)
            .await
            {
                let (mid, qty): (String, f64) = (row.get(0), row.get(1));
                match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                    TxType::In => {
                        if let Err(e) = sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2")
                            .bind(qty)
                            .bind(&mid)
                            .execute(&mut *db_tx).await
                        {
                            errors.push(format!("{}: material update: {}", id, e));
                        }
                    }
                    TxType::Out => {
                        if let Err(e) = sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                            .bind(qty)
                            .bind(&mid)
                            .execute(&mut *db_tx).await
                        {
                            errors.push(format!("{}: material update: {}", id, e));
                        }
                    }
                    _ => {}
                }
            }
        } else {
                for (mid, qty) in &items {
                    match tx_type.parse::<TxType>().unwrap_or(TxType::In) {
                        TxType::In => {
                            if let Err(e) = sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2")
                                .bind(qty)
                                .bind(mid)
                                .execute(&mut *db_tx).await
                            {
                                errors.push(format!("{}: material update: {}", id, e));
                            }
                        }
                        TxType::Out => {
                            if let Err(e) = sqlx::query("UPDATE materials SET quantity = quantity + $1 WHERE id=$2")
                                .bind(qty)
                                .bind(mid)
                                .execute(&mut *db_tx).await
                            {
                                errors.push(format!("{}: material update: {}", id, e));
                            }
                        }
                        _ => {}
                    }
                }
        }
        if let Err(e) = sqlx::query("UPDATE transactions SET status='reversed' WHERE id=$1")
            .bind(id)
            .execute(&mut *db_tx).await
        {
            errors.push(format!("{}: status update: {}", id, e));
        }
        audit(&pool.pool, &user_id, "reverse", "transaction", id, &format!("Bulk reversed {} transaction", tx_type)).await;
        reversed += 1;
    }
    db_tx.commit().await?;
    if errors.is_empty() {
        Ok(format!("Successfully reversed {} transactions", reversed))
    } else {
        Ok(format!("Reversed {} transactions with {} errors:\n{}", reversed, errors.len(), errors.join("\n")))
    }
}

#[tauri::command]
pub async fn get_transaction_items(pool: State<'_, DbPool>, token: String, tx_id: String) -> Result<Vec<TransactionItem>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT ti.id, ti.tx_id, ti.material_id, ti.batch_id, ti.quantity, ti.price, COALESCE(m.name, ''), ti.created_at FROM transaction_items ti LEFT JOIN materials m ON m.id = ti.material_id WHERE ti.tx_id=$1",
    )
    .bind(&tx_id)
    .fetch_all(&pool.pool)
    .await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(TransactionItem {
            id: row.get(0),
            tx_id: row.get(1),
            material_id: row.get(2),
            batch_id: row.get(3),
            quantity: row.get(4),
            price: row.get(5),
            material_name: row.get(6),
            created_at: row.get(7),
        });
    }
    Ok(list)
}

// ---------------------------------------------------------------------------
// NEW COMMANDS – Purchase Orders
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_purchase_orders(
    pool: State<'_, DbPool>,
    token: String,
    search: Option<String>,
    status_filter: Option<String>,
) -> Result<Vec<PurchaseOrderWithCount>, AppError> {
    pool.verify_token(&token)?;
    let mut sql = String::from(
        "SELECT po.id, po.po_number, po.supplier_id, po.supplier_name, po.status, po.notes, po.created_by, po.created_at, po.updated_at, (SELECT COUNT(*) FROM po_items WHERE po_id = po.id) FROM purchase_orders po WHERE 1=1"
    );

    let mut has_search = false;
    let mut search_val = String::new();
    let mut has_sf = false;
    let mut sf_val = String::new();
    let mut idx = 0u32;

    if let Some(s) = search {
        if !s.is_empty() {
            has_search = true;
            search_val = s;
            sql.push_str(&format!(
                " AND (po.po_number LIKE ${} OR po.supplier_name LIKE ${})",
                idx + 1, idx + 2
            ));
            idx += 2;
        }
    }
    if let Some(sf) = status_filter {
        if !sf.is_empty() && sf != "all" {
            has_sf = true;
            sf_val = sf;
            idx += 1;
            sql.push_str(&format!(" AND po.status = ${}", idx));
        }
    }
    sql.push_str(" ORDER BY po.created_at DESC");

    let mut q = sqlx::query(&sql);
    let search_pat = if has_search { Some(format!("%{}%", search_val)) } else { None };
    if let Some(ref v) = search_pat {
        q = q.bind(v).bind(v);
    }
    if has_sf {
        q = q.bind(&sf_val);
    }

    let rows = q.fetch_all(&pool.pool).await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(PurchaseOrderWithCount {
            po: PurchaseOrder {
                id: row.get(0),
                po_number: row.get(1),
                supplier_id: row.get(2),
                supplier_name: row.get(3),
                status: row.get(4),
                notes: row.get(5),
                created_by: row.get(6),
                created_at: row.get(7),
                updated_at: row.get(8),
            },
            item_count: row.get(9),
        });
    }
    Ok(list)
}

#[tauri::command]
pub async fn create_purchase_order(
    pool: State<'_, DbPool>,
    token: String,
    po: PurchaseOrder,
    items: Vec<PoItem>,
) -> Result<PurchaseOrder, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)+1 FROM purchase_orders",
    )
    .fetch_one(&pool.pool)
    .await
    .unwrap_or(1);
    let po_number = if po.po_number.is_empty() {
        format!("PO-{:06}", count)
    } else {
        po.po_number.clone()
    };

    sqlx::query(
        "INSERT INTO purchase_orders (id, po_number, supplier_id, supplier_name, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(&id)
    .bind(&po_number)
    .bind(&po.supplier_id)
    .bind(&po.supplier_name)
    .bind(&po.status)
    .bind(&po.notes)
    .bind(&user_id)
    .bind(&now)
    .bind(&now)
    .execute(&pool.pool)
    .await?;

    for item in &items {
        let item_id = gen_id();
        sqlx::query(
            "INSERT INTO po_items (id, po_id, material_id, quantity, price, received_qty, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&item_id)
        .bind(&id)
        .bind(&item.material_id)
        .bind(item.quantity)
        .bind(item.price)
        .bind(0_f64)
        .bind(&now)
        .execute(&pool.pool)
        .await?;
    }

    audit(&pool.pool, &user_id, "create", "purchase_order", &id, &format!("PO {}", po_number)).await;
    Ok(PurchaseOrder {
        id, po_number, supplier_id: po.supplier_id,
        supplier_name: po.supplier_name, status: po.status,
        notes: po.notes, created_by: Some(user_id),
        created_at: now.clone(), updated_at: now,
    })
}

#[tauri::command]
pub async fn update_purchase_order_status(pool: State<'_, DbPool>, token: String, id: String, status: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "UPDATE purchase_orders SET status=$1, updated_at=$2 WHERE id=$3",
    )
    .bind(&status)
    .bind(&now)
    .bind(&id)
    .execute(&pool.pool)
    .await?;
    audit(&pool.pool, &user_id, "update_status", "purchase_order", &id, &format!("Status -> {}", status)).await;
    Ok(())
}

#[tauri::command]
pub async fn get_po_items(pool: State<'_, DbPool>, token: String, po_id: String) -> Result<Vec<PoItem>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT pi.id, pi.po_id, pi.material_id, pi.quantity, pi.price, pi.received_qty, COALESCE(m.name, ''), pi.created_at FROM po_items pi LEFT JOIN materials m ON m.id = pi.material_id WHERE pi.po_id=$1",
    )
    .bind(&po_id)
    .fetch_all(&pool.pool)
    .await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(PoItem {
            id: row.get(0),
            po_id: row.get(1),
            material_id: row.get(2),
            quantity: row.get(3),
            price: row.get(4),
            received_qty: row.get(5),
            material_name: row.get(6),
            created_at: row.get(7),
        });
    }
    Ok(list)
}

// ---------------------------------------------------------------------------
// NEW COMMANDS – Sales Orders
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_sales_orders(
    pool: State<'_, DbPool>,
    token: String,
    search: Option<String>,
    status_filter: Option<String>,
) -> Result<Vec<SalesOrderWithCount>, AppError> {
    pool.verify_token(&token)?;
    let mut sql = String::from(
        "SELECT so.id, so.so_number, so.customer_name, so.customer_address, so.status, so.notes, so.created_by, so.created_at, so.updated_at, (SELECT COUNT(*) FROM so_items WHERE so_id = so.id) FROM sales_orders so WHERE 1=1"
    );

    let mut has_search = false;
    let mut search_val = String::new();
    let mut has_sf = false;
    let mut sf_val = String::new();
    let mut idx = 0u32;

    if let Some(s) = search {
        if !s.is_empty() {
            has_search = true;
            search_val = s;
            sql.push_str(&format!(
                " AND (so.so_number LIKE ${} OR so.customer_name LIKE ${})",
                idx + 1, idx + 2
            ));
            idx += 2;
        }
    }
    if let Some(sf) = status_filter {
        if !sf.is_empty() && sf != "all" {
            has_sf = true;
            sf_val = sf;
            idx += 1;
            sql.push_str(&format!(" AND so.status = ${}", idx));
        }
    }
    sql.push_str(" ORDER BY so.created_at DESC");

    let mut q = sqlx::query(&sql);
    let search_pat = if has_search { Some(format!("%{}%", search_val)) } else { None };
    if let Some(ref v) = search_pat {
        q = q.bind(v).bind(v);
    }
    if has_sf {
        q = q.bind(&sf_val);
    }

    let rows = q.fetch_all(&pool.pool).await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(SalesOrderWithCount {
            so: SalesOrder {
                id: row.get(0),
                so_number: row.get(1),
                customer_name: row.get(2),
                customer_address: row.get(3),
                status: row.get(4),
                notes: row.get(5),
                created_by: row.get(6),
                created_at: row.get(7),
                updated_at: row.get(8),
            },
            item_count: row.get(9),
        });
    }
    Ok(list)
}

#[tauri::command]
pub async fn create_sales_order(
    pool: State<'_, DbPool>,
    token: String,
    so: SalesOrder,
    items: Vec<SoItem>,
) -> Result<SalesOrder, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)+1 FROM sales_orders",
    )
    .fetch_one(&pool.pool)
    .await
    .unwrap_or(1);
    let so_number = if so.so_number.is_empty() {
        format!("SO-{:06}", count)
    } else {
        so.so_number.clone()
    };

    sqlx::query(
        "INSERT INTO sales_orders (id, so_number, customer_name, customer_address, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(&id)
    .bind(&so_number)
    .bind(&so.customer_name)
    .bind(&so.customer_address)
    .bind(&so.status)
    .bind(&so.notes)
    .bind(&user_id)
    .bind(&now)
    .bind(&now)
    .execute(&pool.pool)
    .await?;

    for item in &items {
        let item_id = gen_id();
        sqlx::query(
            "INSERT INTO so_items (id, so_id, material_id, quantity, price, fulfilled_qty, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&item_id)
        .bind(&id)
        .bind(&item.material_id)
        .bind(item.quantity)
        .bind(item.price)
        .bind(0_f64)
        .bind(&now)
        .execute(&pool.pool)
        .await?;
    }

    audit(&pool.pool, &user_id, "create", "sales_order", &id, &format!("SO {}", so_number)).await;
    Ok(SalesOrder {
        id, so_number, customer_name: so.customer_name,
        customer_address: so.customer_address, status: so.status,
        notes: so.notes, created_by: Some(user_id),
        created_at: now.clone(), updated_at: now,
    })
}

#[tauri::command]
pub async fn update_sales_order_status(pool: State<'_, DbPool>, token: String, id: String, status: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "UPDATE sales_orders SET status=$1, updated_at=$2 WHERE id=$3",
    )
    .bind(&status)
    .bind(&now)
    .bind(&id)
    .execute(&pool.pool)
    .await?;
    audit(&pool.pool, &user_id, "update_status", "sales_order", &id, &format!("Status -> {}", status)).await;
    Ok(())
}

#[tauri::command]
pub async fn get_so_items(pool: State<'_, DbPool>, token: String, so_id: String) -> Result<Vec<SoItem>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT si.id, si.so_id, si.material_id, si.quantity, si.price, si.fulfilled_qty, COALESCE(m.name, ''), si.created_at FROM so_items si LEFT JOIN materials m ON m.id = si.material_id WHERE si.so_id=$1",
    )
    .bind(&so_id)
    .fetch_all(&pool.pool)
    .await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(SoItem {
            id: row.get(0),
            so_id: row.get(1),
            material_id: row.get(2),
            quantity: row.get(3),
            price: row.get(4),
            fulfilled_qty: row.get(5),
            material_name: row.get(6),
            created_at: row.get(7),
        });
    }
    Ok(list)
}

// ---------------------------------------------------------------------------
// NEW COMMANDS – Transaction Attachments
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_transaction_attachments(pool: State<'_, DbPool>, token: String, tx_id: String) -> Result<Vec<TransactionAttachment>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, tx_id, filename, data_base64, created_at FROM transaction_attachments WHERE tx_id=$1",
    )
    .bind(&tx_id)
    .fetch_all(&pool.pool)
    .await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(TransactionAttachment {
            id: row.get(0),
            tx_id: row.get(1),
            filename: row.get(2),
            data_base64: row.get(3),
            created_at: row.get(4),
        });
    }
    Ok(list)
}

#[tauri::command]
pub async fn create_transaction_attachment(
    pool: State<'_, DbPool>,
    token: String,
    tx_id: String,
    filename: String,
    data_base64: String,
) -> Result<TransactionAttachment, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO transaction_attachments (id, tx_id, filename, data_base64, created_at) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&id)
    .bind(&tx_id)
    .bind(&filename)
    .bind(&data_base64)
    .bind(&now)
    .execute(&pool.pool)
    .await?;
    Ok(TransactionAttachment { id, tx_id, filename, data_base64, created_at: now })
}

#[tauri::command]
pub async fn delete_transaction_attachment(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM transaction_attachments WHERE id=$1")
        .bind(&id)
        .execute(&pool.pool)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// NEW COMMANDS – Quality Inspections
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_quality_inspections(pool: State<'_, DbPool>, token: String, tx_id: String) -> Result<Vec<QualityInspection>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT qi.id, qi.tx_id, qi.material_id, qi.status, qi.notes, qi.inspected_by, COALESCE(m.name, ''), qi.created_at FROM quality_inspections qi LEFT JOIN materials m ON m.id = qi.material_id WHERE qi.tx_id=$1",
    )
    .bind(&tx_id)
    .fetch_all(&pool.pool)
    .await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(QualityInspection {
            id: row.get(0),
            tx_id: row.get(1),
            material_id: row.get(2),
            status: row.get(3),
            notes: row.get(4),
            inspected_by: row.get(5),
            material_name: row.get(6),
            created_at: row.get(7),
        });
    }
    Ok(list)
}

#[tauri::command]
pub async fn create_quality_inspection(
    pool: State<'_, DbPool>,
    token: String,
    tx_id: String,
    material_id: String,
    status: String,
    notes: String,
) -> Result<QualityInspection, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_transactions").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = gen_id();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO quality_inspections (id, tx_id, material_id, status, notes, inspected_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(&id)
    .bind(&tx_id)
    .bind(&material_id)
    .bind(&status)
    .bind(&notes)
    .bind(&user_id)
    .bind(&now)
    .execute(&pool.pool)
    .await?;
    audit(&pool.pool, &user_id, "create", "quality_inspection", &id, &format!("Material {} -> {}", material_id, status)).await;
    Ok(QualityInspection {
        id, tx_id, material_id, status, notes,
        inspected_by: Some(user_id), material_name: String::new(), created_at: now,
    })
}

// ---------------------------------------------------------------------------
// NEW COMMANDS – FIFO / FEFO Suggestion
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_fifo_fefo_suggestion(
    pool: State<'_, DbPool>,
    token: String,
    material_id: String,
    type_: String,
) -> Result<Vec<MaterialBatch>, AppError> {
    pool.verify_token(&token)?;
    let order_clause = if type_ == "fefo" {
        "ORDER BY CASE WHEN expiry_date = '' OR expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC"
    } else {
        "ORDER BY received_at ASC"
    };
    let sql = format!(
        "SELECT id, material_id, batch_no, qty, expiry_date, received_at, created_at FROM material_batches WHERE material_id=$1 AND qty > 0 {}",
        order_clause
    );
    let rows = sqlx::query(&sql)
        .bind(&material_id)
        .fetch_all(&pool.pool)
        .await?;
    let mut list = Vec::new();
    for row in rows {
        list.push(MaterialBatch {
            id: row.get(0),
            material_id: row.get(1),
            batch_no: row.get(2),
            qty: row.get(3),
            expiry_date: row.get(4),
            received_at: row.get(5),
            created_at: row.get(6),
        });
    }
    Ok(list)
}

// ---------------------------------------------------------------------------
// NEW COMMANDS – Generate Transaction Number
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn generate_tx_number(pool: State<'_, DbPool>, token: String, type_: String) -> Result<String, AppError> {
    pool.verify_token(&token)?;
    let prefix = match type_.parse::<TxType>().unwrap_or(TxType::In) {
        TxType::In => "GR",
        TxType::Out => "DO",
        TxType::Transfer => "TRF",
        TxType::Opname => "OPN",
    };
    let now = chrono::Local::now();
    let yyyymm = now.format("%Y%m").to_string();
    let pattern = format!("{}-{}%", prefix, yyyymm);
    let count: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)+1 FROM transactions WHERE transaction_number LIKE $1",
    )
    .bind(&pattern)
    .fetch_one(&pool.pool)
    .await
    .unwrap_or(1);
    Ok(format!("{}-{}-{:06}", prefix, yyyymm, count))
}
