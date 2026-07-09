use tauri::State;
use crate::db_pool::DbPool;
use crate::models::{DashboardKpi, AnalysisItem, AbcAnalysis, Transaction};
use crate::error::AppError;
use sqlx::Row;

#[tauri::command]
pub async fn get_dashboard_kpi(pool: State<'_, DbPool>, token: String) -> Result<DashboardKpi, AppError> {
    pool.verify_token(&token)?;
    let total_materials: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await?;
    let total_transactions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions")
        .fetch_one(&pool.pool).await?;
    let low_stock_items: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials WHERE quantity <= min_stock AND min_stock > 0 AND is_active=true")
        .fetch_one(&pool.pool).await?;
    let total_warehouses: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM warehouses WHERE is_active=true")
        .fetch_one(&pool.pool).await?;
    let stock_value: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity * price), 0) FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await?;

    let rows = sqlx::query(
        "SELECT id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id, status, approved_by, po_number, invoice_no, destination, created_at, updated_at FROM transactions ORDER BY created_at DESC LIMIT 10"
    )
    .fetch_all(&pool.pool)
    .await?;
    let recent_transactions: Vec<Transaction> = rows.iter().map(|row| Transaction {
        id: row.get(0), transaction_number: row.get(1), tx_type: row.get(2), material_id: row.get(3),
        warehouse_id: row.get(4), rack_id: row.get(5), quantity: row.get(6), price: row.get(7),
        reference: row.get(8), notes: row.get(9), user_id: row.get(10), status: row.get(11),
        approved_by: row.get(12), po_number: row.get(13), invoice_no: row.get(14), destination: row.get(15),
        created_at: row.get(16), updated_at: row.get(17),
    }).collect();

    Ok(DashboardKpi { total_materials, total_transactions, low_stock_items, total_warehouses, recent_transactions, stock_value })
}

#[tauri::command]
pub async fn get_analysis_all(pool: State<'_, DbPool>, token: String, warehouse_id: Option<String>) -> Result<Vec<AnalysisItem>, AppError> {
    pool.verify_token(&token)?;
    get_analysis_all_inner(&pool, warehouse_id).await
}

#[tauri::command]
pub async fn get_abc_analysis(pool: State<'_, DbPool>, token: String, warehouse_id: Option<String>) -> Result<AbcAnalysis, AppError> {
    pool.verify_token(&token)?;
    let items = get_analysis_all_inner(&*pool, warehouse_id).await?;
    if items.is_empty() { return Ok(AbcAnalysis { class_a: vec![], class_b: vec![], class_c: vec![] }); }

    let total_value: f64 = items.iter().map(|i| i.quantity * i.turnover).sum();
    let mut sorted = items.clone();
    sorted.sort_by(|a, b| (b.quantity * b.turnover).partial_cmp(&(a.quantity * a.turnover)).unwrap_or(std::cmp::Ordering::Equal));

    let mut cumulative = 0.0;
    let mut class_a = Vec::new();
    let mut class_b = Vec::new();
    let mut class_c = Vec::new();

    for mut item in sorted {
        let val = item.quantity * item.turnover;
        cumulative += val;
        let pct = if total_value > 0.0 { cumulative / total_value } else { 0.0 };
        if pct <= 0.8 { item.abc_class = Some("A".into()); class_a.push(item); }
        else if pct <= 0.95 { item.abc_class = Some("B".into()); class_b.push(item); }
        else { item.abc_class = Some("C".into()); class_c.push(item); }
    }
    Ok(AbcAnalysis { class_a, class_b, class_c })
}

async fn get_analysis_all_inner(pool: &DbPool, warehouse_id: Option<String>) -> Result<Vec<AnalysisItem>, AppError> {
    let months_3 = chrono::Local::now().naive_local() - chrono::Duration::days(90);
    let months_6 = chrono::Local::now().naive_local() - chrono::Duration::days(180);
    let months_12 = chrono::Local::now().naive_local() - chrono::Duration::days(365);
    let fmt3 = months_3.format("%Y-%m-%d %H:%M:%S").to_string();
    let fmt6 = months_6.format("%Y-%m-%d %H:%M:%S").to_string();
    let fmt12 = months_12.format("%Y-%m-%d %H:%M:%S").to_string();

    let mut builder = sqlx::QueryBuilder::new(
        format!(
            "SELECT m.id, m.sku, m.name, m.quantity, \
             (SELECT created_at FROM transactions WHERE material_id=m.id AND type='out' ORDER BY created_at DESC LIMIT 1), \
             COALESCE((SELECT SUM(CASE WHEN type='out' THEN ABS(quantity) ELSE 0 END) FROM transactions WHERE material_id=m.id AND created_at>='{}'), 0), \
             COALESCE((SELECT SUM(CASE WHEN type='out' THEN ABS(quantity) ELSE 0 END) FROM transactions WHERE material_id=m.id AND created_at>='{}'), 0), \
             COALESCE((SELECT SUM(CASE WHEN type='out' THEN ABS(quantity) ELSE 0 END) FROM transactions WHERE material_id=m.id AND created_at>='{}'), 0) \
             FROM materials m WHERE m.is_active=true",
            fmt3, fmt6, fmt12
        )
    );
    if let Some(ref w) = warehouse_id {
        if !w.is_empty() {
            builder.push(" AND m.warehouse_id = ");
            builder.push_bind(w.as_str());
        }
    }

    let rows = builder.build().fetch_all(&pool.pool).await?;
    let mut items = Vec::new();
    for row in rows {
        let mid: String = row.get(0);
        let sku: String = row.get(1);
        let name: String = row.get(2);
        let qty: f64 = row.get(3);
        let last_tx: Option<String> = row.get(4);
        let cons3: f64 = row.get(5);
        let cons6: f64 = row.get(6);
        let cons12: f64 = row.get(7);

        let days_since = if let Some(ref d) = last_tx {
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(d, "%Y-%m-%d %H:%M:%S") {
                (chrono::Local::now().naive_local() - dt).num_days()
            } else { 999 }
        } else { 999 };

        let turnover = (if days_since > 0 { qty / days_since as f64 } else { qty }).max(0.0);
        let monthly_avg = cons12 / 12.0;
        let lead_time = if monthly_avg > 0.0 { qty / monthly_avg * 30.0 } else { 0.0 };
        let forecast = if cons12 > 0.0 { (cons12 / 12.0) * 3.0 } else { 0.0 };

        items.push(AnalysisItem {
            material_id: mid, material_name: name, sku, quantity: qty,
            turnover, last_transaction: last_tx, days_since_last: days_since,
            consumption_3mo: cons3, consumption_6mo: cons6, consumption_12mo: cons12,
            lead_time_days: lead_time, abc_class: None, forecast_qty: forecast,
        });
    }
    Ok(items)
}
