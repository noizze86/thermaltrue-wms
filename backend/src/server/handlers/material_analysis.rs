use std::sync::Arc;
use axum::{Json, extract::{State, Path}, Extension};
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

async fn persist_material_metrics(
    pool: &sqlx::PgPool,
    material_id: &str, warehouse_id: &str,
    current_qty: f64, min_stock: f64, max_stock: f64,
    stockout_risk: f64, days_cover: f64,
    is_dead: bool, is_slow: bool,
    turnover: f64, c3: f64, c6: f64, c12: f64,
    inbound: f64, outbound: f64,
    price: f64, value: f64,
    days_since: i32, last_tx: &str,
    abc_class: &str, abc_score: f64,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let period = chrono::Local::now().format("%Y-%m-%d").to_string();

    let yesterday = (chrono::Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
    let last_week = (chrono::Local::now() - chrono::Duration::days(7)).format("%Y-%m-%d").to_string();

    let yesterday_risk: f64 = sqlx::query_scalar(
        "SELECT COALESCE(stockout_risk,0) FROM material_metrics WHERE material_id=$1 AND period_start=$2 ORDER BY updated_at DESC LIMIT 1"
    ).bind(material_id).bind(&yesterday).fetch_one(pool).await.unwrap_or(0.0);
    let avg_7: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(stockout_risk),0) FROM material_metrics WHERE material_id=$1 AND period_start>=$2"
    ).bind(material_id).bind(&last_week).fetch_one(pool).await.unwrap_or(0.0);
    let trend = if (stockout_risk * 100.0).round() > (yesterday_risk * 100.0).round() { "▲" }
        else if (stockout_risk * 100.0).round() < (yesterday_risk * 100.0).round() { "▼" } else { "→" };

    sqlx::query(
        "INSERT INTO material_metrics (id, material_id, warehouse_id, period_type, period_start, period_end, \
         current_qty, min_stock, max_stock, stockout_risk, days_cover, is_dead_stock, is_slow_moving, \
         turnover_ratio, consumption_3mo, consumption_6mo, consumption_12mo, inbound_30d, outbound_30d, \
         unit_price, inventory_value, \
         yesterday_stockout_risk, avg_7days_stockout_risk, risk_trend, \
         abc_class, abc_score, days_since_last_tx, last_tx_date, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) \
         ON CONFLICT (material_id, warehouse_id, period_type, period_start) DO UPDATE SET \
         period_end=EXCLUDED.period_end, current_qty=EXCLUDED.current_qty, min_stock=EXCLUDED.min_stock, \
         max_stock=EXCLUDED.max_stock, stockout_risk=EXCLUDED.stockout_risk, days_cover=EXCLUDED.days_cover, \
         is_dead_stock=EXCLUDED.is_dead_stock, is_slow_moving=EXCLUDED.is_slow_moving, \
         turnover_ratio=EXCLUDED.turnover_ratio, consumption_3mo=EXCLUDED.consumption_3mo, \
         consumption_6mo=EXCLUDED.consumption_6mo, consumption_12mo=EXCLUDED.consumption_12mo, \
         inbound_30d=EXCLUDED.inbound_30d, outbound_30d=EXCLUDED.outbound_30d, \
         unit_price=EXCLUDED.unit_price, inventory_value=EXCLUDED.inventory_value, \
         yesterday_stockout_risk=EXCLUDED.yesterday_stockout_risk, avg_7days_stockout_risk=EXCLUDED.avg_7days_stockout_risk, \
         risk_trend=EXCLUDED.risk_trend, abc_class=EXCLUDED.abc_class, abc_score=EXCLUDED.abc_score, \
         days_since_last_tx=EXCLUDED.days_since_last_tx, last_tx_date=EXCLUDED.last_tx_date, updated_at=EXCLUDED.updated_at"
    )
    .bind(&id).bind(material_id).bind(warehouse_id).bind("daily").bind(&period).bind(&period)
    .bind(current_qty).bind(min_stock).bind(max_stock).bind(stockout_risk).bind(days_cover)
    .bind(is_dead).bind(is_slow)
    .bind(turnover).bind(c3).bind(c6).bind(c12).bind(inbound).bind(outbound)
    .bind(price).bind(value)
    .bind(yesterday_risk).bind(avg_7).bind(trend)
    .bind(abc_class).bind(abc_score).bind(days_since).bind(last_tx)
    .bind(&now).bind(&now)
    .execute(pool).await.ok();
}

pub async fn material_summary(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await.unwrap_or(0);
    let dead: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM materials m WHERE m.is_active=true AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '90 days')"
    ).fetch_one(&pool.pool).await.unwrap_or(0);
    let slow: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM materials m WHERE m.is_active=true AND EXISTS (SELECT 1 FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '90 days' AND t.created_at::timestamp < NOW() - INTERVAL '30 days')"
    ).fetch_one(&pool.pool).await.unwrap_or(0);
    let avg_turnover: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(turnover),0) FROM material_metrics WHERE period_start=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')"
    ).fetch_one(&pool.pool).await.unwrap_or(0.0);
    let avg_risk: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(stockout_risk),0) FROM material_metrics WHERE period_start=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')"
    ).fetch_one(&pool.pool).await.unwrap_or(0.0);
    let high_risk: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM materials m WHERE m.is_active=true AND m.quantity <= m.min_stock AND m.min_stock > 0"
    ).fetch_one(&pool.pool).await.unwrap_or(0);

    Ok(Json(json!({
        "total_materials": total,
        "dead_stock_count": dead,
        "slow_moving_count": slow,
        "avg_turnover_ratio": (avg_turnover * 100.0).round() / 100.0,
        "avg_stockout_risk": (avg_risk * 100.0).round() / 100.0,
        "high_risk_count": high_risk,
    })))
}

pub async fn material_details(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }

    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, m.price, m.min_stock, m.max_stock, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '90 days'),0) as consumption_3mo, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '180 days'),0) as consumption_6mo, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as consumption_12mo, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='in' AND t.created_at::timestamp >= NOW() - INTERVAL '30 days'),0) as inbound_30d, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '30 days'),0) as outbound_30d, \
         COALESCE((SELECT t.quantity FROM transactions t WHERE t.material_id=m.id AND t.type='out' ORDER BY t.created_at DESC LIMIT 1),0) as turnover, \
         (SELECT MAX(created_at) FROM transactions WHERE material_id=m.id) as last_transaction, \
         (SELECT COUNT(DISTINCT DATE(created_at)) FROM transactions WHERE type='out' AND material_id=m.id) as lead_time_days \
         FROM materials m WHERE m.is_active=true ORDER BY m.name"
    ).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    let mut details = Vec::new();
    for row in &rows {
        let id: String = row.get("id");
        let qty: f64 = row.get("quantity");
        let price: f64 = row.get("price");
        let min_stock: f64 = row.get("min_stock");
        let max_stock: f64 = row.get("max_stock");
        let c3: f64 = row.get("consumption_3mo");
        let c6: f64 = row.get("consumption_6mo");
        let c12: f64 = row.get("consumption_12mo");
        let inbound: f64 = row.get("inbound_30d");
        let outbound: f64 = row.get("outbound_30d");
        let turnover: f64 = row.get("turnover");
        let last_tx: Option<String> = row.get("last_transaction");
        let lead_time: i64 = row.get("lead_time_days");
        let value = qty * price;

        let days_since = last_tx.as_ref().and_then(|d| {
            chrono::NaiveDateTime::parse_from_str(d, "%Y-%m-%d %H:%M:%S").ok()
                .map(|dt| (chrono::Local::now().naive_local() - dt).num_days() as i32)
        }).unwrap_or(999);

        let monthly_avg = if c12 > 0.0 { c12 / 12.0 } else { c3.max(1.0) / 3.0 };
        let days_cover = if monthly_avg > 0.0 { (qty / monthly_avg * 30.0).round() } else { 999.0 };
        let is_dead = days_since > 90;
        let is_slow = days_since > 30 && days_since <= 90;

        let stockout_risk = if min_stock <= 0.0 { 0.0 }
            else if qty <= 0.0 { 100.0 }
            else if qty <= min_stock { 80.0 }
            else if qty <= min_stock * 1.5 { 50.0 }
            else if is_dead { 30.0 }
            else { 10.0 };

        let itr = if qty > 0.0 { c12 / qty } else { 0.0 };

        let last_tx_str = last_tx.as_deref().unwrap_or("");

        persist_material_metrics(
            &pool.pool, &id, "",
            qty, min_stock, max_stock,
            stockout_risk, days_cover,
            is_dead, is_slow,
            itr, c3, c6, c12, inbound, outbound,
            price, value,
            days_since, last_tx_str,
            "", 0.0,
        ).await;

        details.push(json!({
            "material_id": id,
            "material_name": row.get::<String,_>("name"),
            "sku": row.get::<String,_>("sku"),
            "quantity": qty,
            "unit_price": price,
            "inventory_value": (value * 100.0).round() / 100.0,
            "min_stock": min_stock,
            "max_stock": max_stock,
            "consumption_3mo": c3,
            "consumption_6mo": c6,
            "consumption_12mo": c12,
            "inbound_30d": inbound,
            "outbound_30d": outbound,
            "turnover_ratio": (itr * 100.0).round() / 100.0,
            "days_cover": days_cover,
            "stockout_risk": stockout_risk,
            "is_dead_stock": is_dead,
            "is_slow_moving": is_slow,
            "days_since_last_tx": days_since,
            "last_tx_date": last_tx_str,
            "lead_time_days": lead_time,
        }));
    }
    Ok(Json(json!(details)))
}
