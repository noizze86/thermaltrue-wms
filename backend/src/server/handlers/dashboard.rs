use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use chrono::Datelike;
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisQuery { pub warehouse_id: Option<String> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbcAnalysisQuery {
    pub warehouse_id: Option<String>,
    pub mode: Option<String>,
}

pub async fn kpi(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let total_materials: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials WHERE is_active=true").fetch_one(&pool.pool).await.unwrap_or(0);
    let total_transactions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions WHERE status NOT IN ('voided','reversed')").fetch_one(&pool.pool).await.unwrap_or(0);
    let low_stock: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials WHERE quantity <= min_stock AND min_stock > 0 AND is_active=true").fetch_one(&pool.pool).await.unwrap_or(0);
    let total_warehouses: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM warehouses WHERE is_active=true").fetch_one(&pool.pool).await.unwrap_or(0);
    let stock_value: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity * price),0) FROM materials WHERE is_active=true").fetch_one(&pool.pool).await.unwrap_or(0.0);
    let recent_tx_rows = sqlx::query("SELECT id, transaction_number, type, material_id, warehouse_id, quantity, created_at FROM transactions WHERE status NOT IN ('voided','reversed') ORDER BY created_at DESC LIMIT 10")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let recent = recent_tx_rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "transaction_number": row.get::<String,_>("transaction_number"),
            "type": row.get::<String,_>("type"), "material_id": row.get::<String,_>("material_id"),
            "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "quantity": row.get::<f64,_>("quantity"),
            "created_at": row.get::<String,_>("created_at")})
    }).collect::<Vec<_>>();
    Ok(Json(json!({"total_materials": total_materials, "total_transactions": total_transactions,
        "low_stock_items": low_stock, "total_warehouses": total_warehouses, "stock_value": stock_value,
        "recent_transactions": recent})))
}

pub async fn analysis_all(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh_filter = q.warehouse_id.as_deref().unwrap_or("");
let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, \
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '90 days'),0) as consumption_3mo, \
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '180 days'),0) as consumption_6mo, \
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as consumption_12mo, \
            COALESCE((SELECT t.quantity FROM transactions t WHERE t.material_id=m.id AND t.type='out' ORDER BY t.created_at DESC LIMIT 1),0) as turnover, \
            (SELECT MAX(created_at) FROM transactions WHERE material_id=m.id) as last_transaction, \
            (SELECT COUNT(DISTINCT DATE(created_at)) FROM transactions WHERE type='out' AND material_id=m.id) as lead_time_days, \
            COALESCE((SELECT forecast_1mo FROM forecast_metrics WHERE material_id=m.id AND period=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD') AND forecast_model='best' LIMIT 1), \
                (SELECT COALESCE(SUM(quantity)/3.0 * 1.1, 0) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '90 days')) as forecast_qty, \
            (SELECT abc_class FROM abc_classification WHERE material_id=m.id AND period=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD') ORDER BY updated_at DESC LIMIT 1) as abc_class \
         FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY m.name"
    ).bind(wh_filter).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        let last_tx: Option<String> = row.get::<Option<String>,_>("last_transaction");
        let days_since = last_tx.as_ref().and_then(|d| {
            chrono::NaiveDateTime::parse_from_str(d, "%Y-%m-%d %H:%M:%S").ok().map(|dt| {
                (chrono::Local::now().naive_local() - dt).num_days()
            })
        }).unwrap_or(999);
        let forecast_qty: f64 = row.get("forecast_qty");
        let abc_class: Option<String> = row.get("abc_class");
        json!({"material_id": row.get::<String,_>("id"), "material_name": row.get::<String,_>("name"),
            "sku": row.get::<String,_>("sku"), "quantity": row.get::<f64,_>("quantity"),
            "consumption_3mo": row.get::<f64,_>("consumption_3mo"),
            "consumption_6mo": row.get::<f64,_>("consumption_6mo"),
            "consumption_12mo": row.get::<f64,_>("consumption_12mo"),
            "turnover": row.get::<f64,_>("turnover"),
            "last_transaction": last_tx, "days_since_last": days_since,
            "lead_time_days": row.get::<i64,_>("lead_time_days"), "forecast_qty": (forecast_qty * 100.0).round() / 100.0, "abc_class": abc_class})
    }).collect::<Vec<_>>())))
}

async fn persist_dashboard_metrics(
    pool: &sqlx::PgPool, warehouse_id: &str,
    health: f64, accuracy: f64, productivity: f64, on_time: f64, space_util: f64, availability: f64,
    capacity_score: i32, predicted_full: &str,
    top_losses: &serde_json::Value,
    losses_items: &[String; 5],
    total_cap: f64, used: f64, available: f64, util_pct: f64,
    avg_in: f64, avg_out: f64, days_full: f64, cap_status: &str,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let hour = chrono::Local::now().format("%Y-%m-%d %H:00:00").to_string();
    let yesterday = (chrono::Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
    let last_week = (chrono::Local::now() - chrono::Duration::days(7)).format("%Y-%m-%d").to_string();

    let yesterday_hi: f64 = sqlx::query_scalar(
        "SELECT COALESCE(health_index,0) FROM dashboard_metrics WHERE warehouse_id=$1 AND metric_date=$2 ORDER BY metric_hour DESC LIMIT 1"
    ).bind(warehouse_id).bind(&yesterday).fetch_one(pool).await.unwrap_or(0.0);
    let avg_7: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(health_index),0) FROM dashboard_metrics WHERE warehouse_id=$1 AND metric_date>=$2"
    ).bind(warehouse_id).bind(&last_week).fetch_one(pool).await.unwrap_or(0.0);
    let trend = if (health * 100.0).round() > (yesterday_hi * 100.0).round() { "▲" } else if (health * 100.0).round() < (yesterday_hi * 100.0).round() { "▼" } else { "→" };

    sqlx::query(
        "INSERT INTO dashboard_metrics (id, warehouse_id, metric_date, metric_hour, \
         health_index, accuracy_rate, productivity_rate, on_time_shipping_rate, \
         utilization_rate, stock_availability_rate, \
         yesterday_health_index, avg_7days_health_index, trend_direction, \
         capacity_pressure_score, predicted_full_date, top_losses, \
         biggest_loss_item_1, biggest_loss_item_2, biggest_loss_item_3, \
         biggest_loss_item_4, biggest_loss_item_5, \
         total_capacity, used_capacity, available_capacity, utilization_pct, \
         avg_daily_inbound, avg_daily_outbound, days_to_full, capacity_status, \
         created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) \
         ON CONFLICT (warehouse_id, metric_date, metric_hour) DO UPDATE SET \
         health_index=EXCLUDED.health_index, accuracy_rate=EXCLUDED.accuracy_rate, \
         productivity_rate=EXCLUDED.productivity_rate, on_time_shipping_rate=EXCLUDED.on_time_shipping_rate, \
         utilization_rate=EXCLUDED.utilization_rate, stock_availability_rate=EXCLUDED.stock_availability_rate, \
         yesterday_health_index=EXCLUDED.yesterday_health_index, avg_7days_health_index=EXCLUDED.avg_7days_health_index, \
         trend_direction=EXCLUDED.trend_direction, capacity_pressure_score=EXCLUDED.capacity_pressure_score, \
         predicted_full_date=EXCLUDED.predicted_full_date, top_losses=EXCLUDED.top_losses, \
         biggest_loss_item_1=EXCLUDED.biggest_loss_item_1, biggest_loss_item_2=EXCLUDED.biggest_loss_item_2, \
         biggest_loss_item_3=EXCLUDED.biggest_loss_item_3, biggest_loss_item_4=EXCLUDED.biggest_loss_item_4, \
         biggest_loss_item_5=EXCLUDED.biggest_loss_item_5, \
         total_capacity=EXCLUDED.total_capacity, used_capacity=EXCLUDED.used_capacity, \
         available_capacity=EXCLUDED.available_capacity, utilization_pct=EXCLUDED.utilization_pct, \
         avg_daily_inbound=EXCLUDED.avg_daily_inbound, avg_daily_outbound=EXCLUDED.avg_daily_outbound, \
         days_to_full=EXCLUDED.days_to_full, capacity_status=EXCLUDED.capacity_status, \
         updated_at=EXCLUDED.updated_at"
    )
    .bind(&id).bind(warehouse_id).bind(&date).bind(&hour)
    .bind(health).bind(accuracy).bind(productivity).bind(on_time)
    .bind(space_util).bind(availability)
    .bind(yesterday_hi).bind(avg_7).bind(trend)
    .bind(capacity_score).bind(predicted_full)
    .bind(top_losses)
    .bind(&losses_items[0]).bind(&losses_items[1]).bind(&losses_items[2])
    .bind(&losses_items[3]).bind(&losses_items[4])
    .bind(total_cap).bind(used).bind(available).bind(util_pct)
    .bind(avg_in).bind(avg_out).bind(days_full).bind(cap_status)
    .bind(&now).bind(&now)
    .execute(pool).await.unwrap_or_else(|e| { log::warn!("persist_dashboard_metrics failed: {}", e); Default::default() });
}

async fn compute_and_persist_all(
    pool: &sqlx::PgPool, warehouse_id: &str,
) -> Result<(serde_json::Value, Vec<serde_json::Value>, serde_json::Value), String> {
    let wh = warehouse_id;
    let accuracy: f64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT COUNT(*)::float FROM stock_opname_items WHERE difference=0) / NULLIF((SELECT COUNT(*)::float FROM stock_opname_items),0) * 100, 100.0)"
    ).fetch_one(pool).await.unwrap_or(100.0);
    let tx_24h: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions WHERE created_at::timestamp >= NOW() - INTERVAL '24 hours' AND status NOT IN ('voided','reversed') AND ($1 = '' OR transactions.warehouse_id = $1)")
        .bind(wh).fetch_one(pool).await.unwrap_or(0);
    let active_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(pool).await.unwrap_or(1);
    let daily_target = (active_users as f64 * 5.0).max(10.0);
    let productivity = ((tx_24h as f64 / daily_target) * 100.0).min(100.0);
    let approved: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM transactions WHERE status='approved' AND created_at::timestamp >= NOW() - INTERVAL '30 days' AND ($1 = '' OR transactions.warehouse_id = $1)")
        .bind(wh).fetch_one(pool).await.unwrap_or(0.0);
    let total_30d: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM transactions WHERE status NOT IN ('voided','reversed') AND created_at::timestamp >= NOW() - INTERVAL '30 days' AND ($1 = '' OR transactions.warehouse_id = $1)")
        .bind(wh).fetch_one(pool).await.unwrap_or(1.0);
    let on_time = if total_30d > 0.0 { (approved / total_30d * 100.0).min(100.0) } else { 100.0 };

    let total_capacity: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(max_capacity),0)::float FROM racks")
        .fetch_one(pool).await.unwrap_or(0.0);
    let used_storage: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity),0)::float FROM materials WHERE is_active=true AND ($1 = '' OR materials.warehouse_id = $1)")
        .bind(wh).fetch_one(pool).await.unwrap_or(0.0);
    let space_util = if total_capacity > 0.0 { (used_storage / total_capacity * 100.0).min(100.0) } else { 50.0 };

    let total_active: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE is_active=true AND ($1 = '' OR materials.warehouse_id = $1)")
        .bind(wh).fetch_one(pool).await.unwrap_or(1.0);
    let above_min: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE quantity > min_stock AND is_active=true AND ($1 = '' OR materials.warehouse_id = $1)")
        .bind(wh).fetch_one(pool).await.unwrap_or(0.0);
    let availability = if total_active > 0.0 { (above_min / total_active * 100.0).min(100.0) } else { 100.0 };

    let health = ((accuracy * 0.25 + productivity * 0.20 + on_time * 0.20 + space_util * 0.15 + availability * 0.20) * 100.0).round() / 100.0;
    let status = if health >= 80.0 { "good" } else if health >= 50.0 { "warning" } else { "critical" };

    let now = chrono::Local::now();
    let yesterday = (now - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
    let last_week = (now - chrono::Duration::days(7)).format("%Y-%m-%d").to_string();
    let yesterday_hi: f64 = sqlx::query_scalar(
        "SELECT COALESCE(health_index,0) FROM dashboard_metrics WHERE warehouse_id=$1 AND metric_date=$2 ORDER BY metric_hour DESC LIMIT 1"
    ).bind(wh).bind(&yesterday).fetch_one(pool).await.unwrap_or(0.0);
    let avg_7: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(health_index),0) FROM dashboard_metrics WHERE warehouse_id=$1 AND metric_date>=$2"
    ).bind(wh).bind(&last_week).fetch_one(pool).await.unwrap_or(0.0);
    let trend = if (health * 100.0).round() > (yesterday_hi * 100.0).round() { "▲" } else if (health * 100.0).round() < (yesterday_hi * 100.0).round() { "▼" } else { "→" };

    let health_result = json!({"score": health, "status": status, "trend_direction": trend,
        "yesterday_score": (yesterday_hi * 100.0).round() / 100.0,
        "avg_7days_score": (avg_7 * 100.0).round() / 100.0,
        "components": {
            "inventory_accuracy": {"score": (accuracy * 100.0).round() / 100.0, "weight": 0.25},
            "productivity": {"score": (productivity * 100.0).round() / 100.0, "weight": 0.20},
            "on_time_rate": {"score": (on_time * 100.0).round() / 100.0, "weight": 0.20},
            "space_utilization": {"score": (space_util * 100.0).round() / 100.0, "weight": 0.15},
            "stock_availability": {"score": (availability * 100.0).round() / 100.0, "weight": 0.20}
        }});

    let loss_rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, m.price, m.min_stock, \
         COALESCE((SELECT SUM(ABS(soi.difference)) FROM stock_opname_items soi WHERE soi.material_id=m.id),0) as variance_qty, \
         CASE WHEN (SELECT COUNT(*) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '90 days') = 0 THEN 1 ELSE 0 END as is_dead \
         FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1)"
    ).bind(wh).fetch_all(pool).await.map_err(|e| e.to_string())?;
    let mut losses: Vec<serde_json::Value> = Vec::new();
    for row in &loss_rows {
        let qty: f64 = row.get("quantity");
        let price: f64 = row.get("price");
        let min_stock: f64 = row.get("min_stock");
        let variance: f64 = row.get("variance_qty");
        let is_dead: i32 = row.get("is_dead");
        let dead_loss = if is_dead == 1 && qty > 0.0 { qty * price * 0.2 } else { 0.0 };
        let stockout_loss = if qty < min_stock && min_stock > 0.0 { (min_stock - qty) * price * 0.3 } else { 0.0 };
        let variance_loss = variance * price;
        let total = dead_loss + stockout_loss + variance_loss;
        if total > 0.0 {
            losses.push(json!({"material_id": row.get::<String,_>("id"), "material_name": row.get::<String,_>("name"),
                "sku": row.get::<String,_>("sku"), "dead_stock_loss": (dead_loss * 100.0).round() / 100.0,
                "stockout_loss": (stockout_loss * 100.0).round() / 100.0,
                "variance_loss": (variance_loss * 100.0).round() / 100.0,
                "total_loss": (total * 100.0).round() / 100.0}));
        }
    }
    losses.sort_by(|a, b| b["total_loss"].as_f64().unwrap_or(0.0).partial_cmp(&a["total_loss"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
    losses.truncate(5);
    let top_losses_value = serde_json::Value::Array(losses.clone());
    let mut loss_items = [String::new(), String::new(), String::new(), String::new(), String::new()];
    for (i, l) in losses.iter().enumerate().take(5) {
        loss_items[i] = serde_json::to_string(l).unwrap_or_default();
    }

    let in_out = sqlx::query(
        "SELECT COALESCE(AVG(daily_in),0) as avg_in, COALESCE(AVG(daily_out),0) as avg_out \
         FROM (SELECT DATE(created_at) as d, \
             SUM(CASE WHEN type='in' THEN quantity ELSE 0 END) as daily_in, \
             SUM(CASE WHEN type='out' THEN quantity ELSE 0 END) as daily_out \
         FROM transactions WHERE created_at::timestamp >= NOW() - INTERVAL '30 days' AND status NOT IN ('voided','reversed') AND ($1 = '' OR transactions.warehouse_id = $1) \
         GROUP BY DATE(created_at)) sub"
    ).bind(wh).fetch_one(pool).await.map_err(|e| e.to_string())?;
    let avg_in: f64 = in_out.get("avg_in");
    let avg_out: f64 = in_out.get("avg_out");
    let net_flow = avg_in - avg_out;
    let available_capacity = (total_capacity - used_storage).max(0.0);
    let utilization_pct = if total_capacity > 0.0 { ((used_storage / total_capacity * 100.0) * 100.0).round() / 100.0 } else { 0.0 };
    let days_to_full = if net_flow > 0.0 { (available_capacity / net_flow * 100.0).round() / 100.0 } else { -1.0 };
    let cap_status = if days_to_full > 0.0 && days_to_full < 30.0 { "critical" } else if days_to_full > 0.0 && days_to_full < 90.0 { "warning" } else { "normal" };
    let capacity_score = if total_capacity == 0.0 { 50 }
        else if net_flow <= 0.0 { 0 }
        else if days_to_full <= 7.0 { 100 }
        else if days_to_full <= 30.0 { 80 }
        else if days_to_full <= 90.0 { 50 }
        else if days_to_full <= 180.0 { 30 }
        else { 10 };
    let predicted_full = if net_flow > 0.0 && days_to_full > 0.0 {
        (chrono::Local::now() + chrono::Duration::days(days_to_full as i64)).format("%Y-%m-%d").to_string()
    } else { String::new() };

    persist_dashboard_metrics(
        pool, wh, health, accuracy, productivity, on_time, space_util, availability,
        capacity_score, &predicted_full, &top_losses_value, &loss_items,
        total_capacity, used_storage, available_capacity, utilization_pct,
        avg_in, avg_out, days_to_full, cap_status
    ).await;

    let capacity_result = json!({"total_capacity": total_capacity, "used_capacity": used_storage,
        "available_capacity": available_capacity, "utilization_pct": utilization_pct,
        "avg_daily_inbound": (avg_in * 100.0).round() / 100.0,
        "avg_daily_outbound": (avg_out * 100.0).round() / 100.0,
        "days_to_full": days_to_full, "status": cap_status,
        "capacity_pressure_score": capacity_score,
        "predicted_full_date": predicted_full});

    Ok((health_result, losses, capacity_result))
}

pub async fn health_index(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh = q.warehouse_id.as_deref().unwrap_or("");
    let (health_result, _, _) = compute_and_persist_all(&pool.pool, wh).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(health_result))
}

pub async fn biggest_losses(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh = q.warehouse_id.as_deref().unwrap_or("");
    let (_, losses, _) = compute_and_persist_all(&pool.pool, wh).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(losses)))
}

pub async fn capacity_pressure(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh = q.warehouse_id.as_deref().unwrap_or("");
    let (_, _, capacity_result) = compute_and_persist_all(&pool.pool, wh).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(capacity_result))
}

pub async fn compute_all(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh = q.warehouse_id.as_deref().unwrap_or("");
    let (health_result, losses, capacity_result) = compute_and_persist_all(&pool.pool, wh).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({
        "health_index": health_result,
        "biggest_losses": losses,
        "capacity_pressure": capacity_result,
    })))
}

pub async fn metrics_latest(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let row = sqlx::query(
        "SELECT health_index, accuracy_rate, productivity_rate, on_time_shipping_rate, \
         utilization_rate, stock_availability_rate, yesterday_health_index, avg_7days_health_index, \
         trend_direction, capacity_pressure_score, predicted_full_date, top_losses, \
         total_capacity, used_capacity, available_capacity, utilization_pct, \
         avg_daily_inbound, avg_daily_outbound, days_to_full, capacity_status, \
         metric_date, metric_hour, updated_at \
         FROM dashboard_metrics ORDER BY metric_hour DESC LIMIT 1"
    ).fetch_optional(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    match row {
        Some(r) => Ok(Json(json!({
            "health_index": r.get::<f64,_>("health_index"),
            "accuracy_rate": r.get::<f64,_>("accuracy_rate"),
            "productivity_rate": r.get::<f64,_>("productivity_rate"),
            "on_time_shipping_rate": r.get::<f64,_>("on_time_shipping_rate"),
            "utilization_rate": r.get::<f64,_>("utilization_rate"),
            "stock_availability_rate": r.get::<f64,_>("stock_availability_rate"),
            "yesterday_health_index": r.get::<f64,_>("yesterday_health_index"),
            "avg_7days_health_index": r.get::<f64,_>("avg_7days_health_index"),
            "trend_direction": r.get::<String,_>("trend_direction"),
            "capacity_pressure_score": r.get::<i32,_>("capacity_pressure_score"),
            "predicted_full_date": r.get::<String,_>("predicted_full_date"),
            "capacity_status": r.get::<String,_>("capacity_status"),
            "total_capacity": r.get::<f64,_>("total_capacity"),
            "used_capacity": r.get::<f64,_>("used_capacity"),
            "available_capacity": r.get::<f64,_>("available_capacity"),
            "utilization_pct": r.get::<f64,_>("utilization_pct"),
            "avg_daily_inbound": r.get::<f64,_>("avg_daily_inbound"),
            "avg_daily_outbound": r.get::<f64,_>("avg_daily_outbound"),
            "days_to_full": r.get::<f64,_>("days_to_full"),
            "metric_date": r.get::<String,_>("metric_date"),
            "metric_hour": r.get::<String,_>("metric_hour"),
            "updated_at": r.get::<String,_>("updated_at"),
        }))),
        None => Ok(Json(json!({"error": "No metrics computed yet. Call health-index first."}))),
    }
}

pub async fn abc_analysis(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AbcAnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let mode = q.mode.as_deref().unwrap_or("single");
    let wh_filter = q.warehouse_id.as_deref().unwrap_or("");

    if mode == "multi" {
        let rows = sqlx::query(
            "SELECT m.id, m.name, m.sku, m.quantity, m.min_stock, \
             COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as consumption_12mo, \
             COALESCE((SELECT MAX(created_at) FROM transactions WHERE material_id=m.id),'') as last_transaction, \
             COALESCE((SELECT COUNT(DISTINCT DATE(created_at)) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as pick_frequency, \
             COALESCE((SELECT COUNT(DISTINCT DATE(created_at)) FROM transactions WHERE type='out' AND material_id=m.id),0) as lead_time_days \
             FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY m.name"
        ).bind(wh_filter).fetch_all(&pool.pool).await
         .map_err(|e| crate::server::server_error(e))?;

        let weights = sqlx::query("SELECT key, value FROM abc_weights")
            .fetch_all(&pool.pool).await.unwrap_or_default();
        let mut w_value = 0.4; let mut w_freq = 0.3; let mut w_crit = 0.3;
        for w in &weights {
            let k: String = w.get("key"); let v: f64 = w.get("value");
            match k.as_str() { "value_w" => w_value = v, "turnover_w" => w_freq = v, "recency_w" => w_crit = v, _ => {} }
        }
        let sum_w = w_value + w_freq + w_crit;
        if sum_w > 0.0 { w_value /= sum_w; w_freq /= sum_w; w_crit /= sum_w; }

        let max_consumption = rows.iter().map(|r| r.get::<f64,_>("consumption_12mo")).fold(0.0_f64, f64::max).max(1.0);
        let max_frequency = rows.iter().map(|r| r.get::<i64,_>("pick_frequency")).max().unwrap_or(1).max(1) as f64;

        let mut scored: Vec<serde_json::Value> = rows.iter().map(|row| {
            let consumption: f64 = row.get("consumption_12mo");
            let frequency: i64 = row.get("pick_frequency");
            let qty: f64 = row.get("quantity");
            let _min_stock: f64 = row.get("min_stock");
            let lead_time: i64 = row.get("lead_time_days");
            let last_tx: Option<String> = row.get("last_transaction");
            let days_since = last_tx.as_ref().and_then(|d| {
                chrono::NaiveDateTime::parse_from_str(d, "%Y-%m-%d %H:%M:%S").ok()
                    .map(|dt| (chrono::Local::now().naive_local() - dt).num_days())
            }).unwrap_or(999);
            let consumption_norm = consumption / max_consumption;
            let freq_norm = frequency as f64 / max_frequency;
            let days_cover = if consumption > 0.0 { (qty / (consumption / 365.0)) as i64 } else { 999 };
            let criticality = if days_cover < lead_time.max(1) { 1.0 } else { 0.5 };

            let score = consumption_norm * w_value + freq_norm * w_freq + criticality * w_crit;
            json!({"material_id": row.get::<String,_>("id"), "material_name": row.get::<String,_>("name"),
                "sku": row.get::<String,_>("sku"), "quantity": qty, "consumption_12mo": consumption,
                "pick_frequency": frequency, "score": (score * 1000.0).round() / 1000.0,
                "criticality_score": criticality, "last_transaction": last_tx,
                "days_since_last": days_since, "lead_time_days": lead_time as f64,
                "consumption_3mo": 0.0, "consumption_6mo": 0.0, "turnover": 0.0, "forecast_qty": consumption / 12.0 * 3.0, "abc_class": null})
        }).collect();

        scored.sort_by(|a, b| b["score"].as_f64().unwrap_or(0.0).partial_cmp(&a["score"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
        let total_score: f64 = scored.iter().map(|s| s["score"].as_f64().unwrap_or(0.0)).sum();
        let mut cumulative = 0.0;
        let mut class_a = Vec::new(); let mut class_b = Vec::new(); let mut class_c = Vec::new();
        for mut item in scored {
            let s = item["score"].as_f64().unwrap_or(0.0);
            cumulative += s;
            let pct = if total_score > 0.0 { cumulative / total_score * 100.0 } else { 0.0 };
            if pct <= 20.0 { item["abc_class"] = json!("A"); class_a.push(item); }
            else if pct <= 50.0 { item["abc_class"] = json!("B"); class_b.push(item); }
            else { item["abc_class"] = json!("C"); class_c.push(item); }
        }
        Ok(Json(json!({"class_a": class_a, "class_b": class_b, "class_c": class_c, "mode": "multi", "weights": {"value_w": (w_value * 1000.0).round() / 1000.0, "frequency_w": (w_freq * 1000.0).round() / 1000.0, "criticality_w": (w_crit * 1000.0).round() / 1000.0}})))
    } else {
        let rows = sqlx::query(
            "SELECT m.id, m.name, m.sku, m.quantity, \
             COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as consumption_12mo, \
             COALESCE((SELECT MAX(created_at) FROM transactions WHERE material_id=m.id),'') as last_transaction \
             FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY consumption_12mo DESC"
        ).bind(wh_filter).fetch_all(&pool.pool).await
         .map_err(|e| crate::server::server_error(e))?;
        let total: f64 = rows.iter().map(|r| r.get::<f64,_>("consumption_12mo")).sum();
        let mut cumulative = 0.0;
        let mut class_a = Vec::new();
        let mut class_b = Vec::new();
        let mut class_c = Vec::new();
        for row in &rows {
            let val: f64 = row.get("consumption_12mo");
            let pct = if total > 0.0 { val / total * 100.0 } else { 0.0 };
            cumulative += pct;
            let item = json!({"material_id": row.get::<String,_>("id"), "material_name": row.get::<String,_>("name"),
                "sku": row.get::<String,_>("sku"), "quantity": row.get::<f64,_>("quantity"),
                "consumption_12mo": val, "turnover": val, "last_transaction": row.get::<Option<String>,_>("last_transaction"),
                "days_since_last": 0, "lead_time_days": 0, "consumption_3mo": 0.0, "consumption_6mo": 0.0,
                "forecast_qty": val / 12.0 * 3.0, "abc_class": if cumulative <= 80.0 { Some("A") } else if cumulative <= 95.0 { Some("B") } else { Some("C") }});
            if cumulative <= 80.0 { class_a.push(item); }
            else if cumulative <= 95.0 { class_b.push(item); }
            else { class_c.push(item); }
        }
        Ok(Json(json!({"class_a": class_a, "class_b": class_b, "class_c": class_c, "mode": "single"})))
    }
}

pub async fn mom_kpis(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let now = chrono::Local::now().naive_local();
    let cur_month_start = now.format("%Y-%m-01 00:00:00").to_string();
    let prev_month_start = (now - chrono::Duration::days(now.day() as i64)).format("%Y-%m-01 00:00:00").to_string();

    let cur_materials: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let cur_value: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity*price),0) FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let cur_low_stock: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE quantity<=min_stock AND min_stock>0 AND is_active=true")
        .fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let cur_transactions: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM transactions WHERE status NOT IN ('voided','reversed')")
        .fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let cur_tx_month: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM transactions WHERE status NOT IN ('voided','reversed') AND created_at>=$1")
        .bind(&cur_month_start).fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;

    let prev_materials: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE is_active=true AND created_at<$1")
        .bind(&cur_month_start).fetch_one(&pool.pool).await.unwrap_or(cur_materials);
    let prev_value: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity*price),0) FROM materials WHERE is_active=true AND created_at<$1")
        .bind(&cur_month_start).fetch_one(&pool.pool).await.unwrap_or(0.0);
    let prev_low_stock: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE quantity<=min_stock AND min_stock>0 AND is_active=true AND created_at<$1")
        .bind(&cur_month_start).fetch_one(&pool.pool).await.unwrap_or(0.0);
    let prev_transactions: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM transactions WHERE status NOT IN ('voided','reversed') AND created_at>=$1 AND created_at<$2")
        .bind(&prev_month_start).bind(&cur_month_start).fetch_one(&pool.pool).await.unwrap_or(0.0);

    let pct = |cur: f64, prev: f64| -> f64 { if prev == 0.0 { 0.0 } else { ((cur - prev) / prev * 100.0 * 100.0).round() / 100.0 } };

    let result = json!([
        {"current_value": cur_materials, "prev_value": prev_materials, "change_pct": pct(cur_materials, prev_materials)},
        {"current_value": cur_value, "prev_value": prev_value, "change_pct": pct(cur_value, prev_value)},
        {"current_value": cur_low_stock, "prev_value": prev_low_stock, "change_pct": pct(cur_low_stock, prev_low_stock)},
        {"current_value": cur_transactions, "prev_value": prev_transactions, "change_pct": pct(cur_transactions, prev_transactions)},
        {"current_value": cur_tx_month, "prev_value": prev_transactions, "change_pct": pct(cur_tx_month, prev_transactions)},
    ]);
    Ok(Json(result))
}

pub async fn aging_report(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let rows = sqlx::query(
        "SELECT CASE WHEN days >= 90 THEN '90+' WHEN days >= 60 THEN '60-90' WHEN days >= 30 THEN '30-60' ELSE '0-30' END as bucket, \
         COUNT(*) as cnt, COALESCE(SUM(quantity * price),0) as val FROM (SELECT m.id, m.quantity, m.price, \
         COALESCE((SELECT EXTRACT(DAY FROM NOW() - MAX(created_at::timestamp)) FROM transactions WHERE material_id=m.id),999) as days \
         FROM materials m WHERE m.is_active=true) sub GROUP BY bucket ORDER BY bucket"
    ).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"bucket": row.get::<String,_>("bucket"), "count": row.get::<i64,_>("cnt"), "total_value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn stock_movement(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let start = q.get("periodStart").and_then(|v| v.as_str()).unwrap_or("");
    let end = q.get("periodEnd").and_then(|v| v.as_str()).unwrap_or("");
    let rows = sqlx::query(
        "SELECT m.name, COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id=m.id AND created_at < $1 AND type='in'),0) as opening, \
         COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id=m.id AND created_at >= $1 AND created_at < $2 AND type='in'),0) as qty_in, \
         COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id=m.id AND created_at >= $1 AND created_at < $2 AND type='out'),0) as qty_out \
         FROM materials m WHERE m.is_active=true ORDER BY m.name"
    ).bind(start).bind(end).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        let o: f64 = row.get("opening"); let i: f64 = row.get("qty_in"); let oo: f64 = row.get("qty_out");
        json!({"material_name": row.get::<String,_>("name"), "opening": o, "qty_in": i, "qty_out": oo, "closing": o + i - oo})
    }).collect::<Vec<_>>())))
}

pub async fn tx_type_summary(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let rows = sqlx::query("SELECT type, COUNT(*) as cnt, COALESCE(SUM(quantity),0) as val FROM transactions WHERE status NOT IN ('voided','reversed') GROUP BY type ORDER BY type")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"name": row.get::<String,_>("type"), "count": row.get::<i64,_>("cnt"), "value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn tx_by_user(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let ds = q.get("dateStart").and_then(|v| v.as_str()).unwrap_or("");
    let de = q.get("dateEnd").and_then(|v| v.as_str()).unwrap_or("");
    let rows = sqlx::query("SELECT t.user_id, u.full_name, COUNT(*) as cnt, COALESCE(SUM(t.quantity),0) as val FROM transactions t JOIN users u ON t.user_id=u.id WHERE ($1='' OR t.created_at>=$1) AND ($2='' OR t.created_at<$2) AND t.status NOT IN ('voided','reversed') GROUP BY t.user_id, u.full_name ORDER BY cnt DESC")
        .bind(ds).bind(de).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"user_id": row.get::<String,_>("user_id"), "user_name": row.get::<String,_>("full_name"),
            "total_count": row.get::<i64,_>("cnt"), "total_value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn daily_trend(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let ds = q.get("dateStart").and_then(|v| v.as_str()).unwrap_or("");
    let de = q.get("dateEnd").and_then(|v| v.as_str()).map(|s| if s.is_empty() { String::new() } else { format!("{} 23:59:59", s) }).unwrap_or_default();
    let rows = sqlx::query("SELECT DATE(created_at)::text as date, COUNT(*) as cnt, COALESCE(SUM(quantity),0) as val FROM transactions WHERE ($1='' OR created_at>=$1) AND ($2='' OR created_at<=$2) AND status NOT IN ('voided','reversed') GROUP BY DATE(created_at) ORDER BY date")
        .bind(ds).bind(de).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"date": row.get::<String,_>("date"), "count": row.get::<i64,_>("cnt"), "value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn tx_date_comparison(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let a_s = q.get("aStart").and_then(|v| v.as_str()).unwrap_or("");
    let a_e = q.get("aEnd").and_then(|v| v.as_str()).unwrap_or("");
    let b_s = q.get("bStart").and_then(|v| v.as_str()).unwrap_or("");
    let b_e = q.get("bEnd").and_then(|v| v.as_str()).unwrap_or("");
    let rows = sqlx::query(
        "SELECT DATE(created_at)::text as date, COUNT(*) as cnt, COALESCE(SUM(quantity),0) as val, \
         CASE WHEN created_at >= $1 AND created_at < $2 THEN 'A' WHEN created_at >= $3 AND created_at < $4 THEN 'B' END as series \
         FROM transactions WHERE ((created_at >= $1 AND created_at < $2) OR (created_at >= $3 AND created_at < $4)) AND status NOT IN ('voided','reversed') \
         GROUP BY DATE(created_at), series ORDER BY date"
    ).bind(a_s).bind(a_e).bind(b_s).bind(b_e).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        let series: Option<String> = row.get("series");
        let prefix = if series.as_deref() == Some("A") { "A_" } else { "B_" };
        json!({"date": row.get::<String,_>("date"), format!("{}count", prefix): row.get::<i64,_>("cnt"), format!("{}value", prefix): row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn category_value_summary(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let rows = sqlx::query("SELECT COALESCE(c.name,'Uncategorized') as name, COUNT(m.id) as cnt, COALESCE(SUM(m.quantity*m.price),0) as val FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true GROUP BY c.name ORDER BY val DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"name": row.get::<String,_>("name"), "count": row.get::<i64,_>("cnt"), "value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn stock_valuation(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let rows = sqlx::query("SELECT COALESCE(c.name,'Uncategorized') as category, SUM(m.quantity*m.price) as value, COUNT(m.id) as count FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true GROUP BY c.name ORDER BY value DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"category": row.get::<String,_>("category"), "value": row.get::<f64,_>("value"), "count": row.get::<i64,_>("count")})
    }).collect::<Vec<_>>())))
}

pub async fn demand_forecast(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh_filter = q.warehouse_id.as_deref().unwrap_or("");
    let period = chrono::Local::now().format("%Y-%m-%d").to_string();
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, m.min_stock, m.max_stock,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '90 days'),0) as consumption_3mo,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '30 days'),0) as consumption_1mo
         FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY m.name"
    ).bind(wh_filter).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;
    let mut items: Vec<serde_json::Value> = Vec::new();
    for row in &rows {
        let id: String = row.get("id");
        let c3: f64 = row.get("consumption_3mo");
        let c1: f64 = row.get("consumption_1mo");
        let monthly_avg = if c3 > 0.0 { c3 / 3.0 } else { c1.max(1.0) };
        let seasonal_factor = if c1 > 0.0 && monthly_avg > 0.0 { c1 / monthly_avg } else { 1.0 };
        let forecast_next = (monthly_avg * seasonal_factor * 1.1).round();

        // Persist to forecast_metrics
        let fid = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO forecast_metrics (id, material_id, warehouse_id, period, forecast_model, \
             forecast_1mo, forecast_3mo, forecast_6mo, created_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) \
             ON CONFLICT (material_id, warehouse_id, period, forecast_model) DO UPDATE SET \
             forecast_1mo=EXCLUDED.forecast_1mo, forecast_3mo=EXCLUDED.forecast_3mo, \
             forecast_6mo=EXCLUDED.forecast_6mo, updated_at=EXCLUDED.updated_at"
        )
        .bind(&fid).bind(&id).bind(wh_filter).bind(&period).bind("demand")
        .bind(forecast_next).bind(forecast_next * 3.0).bind(forecast_next * 6.0)
        .bind(&now_str).bind(&now_str)
        .execute(&pool.pool).await.unwrap_or_else(|e| { log::warn!("dashboard forecast insert failed: {}", e); Default::default() });

        items.push(json!({"material_id": id, "material_name": row.get::<String,_>("name"),
            "sku": row.get::<String,_>("sku"), "current_qty": row.get::<f64,_>("quantity"),
            "min_stock": row.get::<f64,_>("min_stock"), "max_stock": row.get::<f64,_>("max_stock"),
            "consumption_3mo": c3, "consumption_1mo": c1,
            "monthly_avg_demand": (monthly_avg * 100.0).round() / 100.0,
            "forecast_next_month": forecast_next as i64}));
    }
    Ok(Json(json!(items)))
}

pub async fn reorder_suggestions(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh_filter = q.warehouse_id.as_deref().unwrap_or("");
    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, m.min_stock, m.max_stock, m.price,
            COALESCE(s.name,'') as supplier,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '30 days'),0) as monthly_usage
         FROM materials m LEFT JOIN suppliers s ON m.supplier_id=s.id
         WHERE m.is_active=true AND m.quantity <= m.max_stock AND ($1 = '' OR m.warehouse_id = $1) ORDER BY (m.quantity - m.min_stock) ASC"
    ).bind(wh_filter).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        let qty: f64 = row.get("quantity");
        let min: f64 = row.get("min_stock");
        let max: f64 = row.get("max_stock");
        let monthly: f64 = row.get("monthly_usage");
        let reorder_point = min + (monthly * 0.5);
        let suggested_order = if qty <= reorder_point { (max - qty).max(min - qty + monthly) } else { 0.0 };
        json!({"material_id": row.get::<String,_>("id"), "material_name": row.get::<String,_>("name"),
            "sku": row.get::<String,_>("sku"), "current_qty": qty, "min_stock": min,
            "max_stock": max, "reorder_point": (reorder_point * 100.0).round() / 100.0,
            "suggested_order_qty": suggested_order as i64,
            "monthly_usage": monthly, "price": row.get::<f64,_>("price"),
            "supplier": row.get::<String,_>("supplier"),
            "priority": if qty <= min { "high" } else if qty <= reorder_point { "medium" } else { "low" }})
    }).collect::<Vec<_>>())))
}

pub async fn opname_variance(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let rows = sqlx::query("SELECT COALESCE(c.name,'Uncategorized') as category, COALESCE(SUM(soi.difference),0) as total_diff FROM stock_opname_items soi LEFT JOIN materials m ON soi.material_id=m.id LEFT JOIN categories c ON m.category_id=c.id WHERE soi.opname_id=$1 GROUP BY c.name ORDER BY total_diff DESC")
        .bind(&id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"category": row.get::<String,_>("category"), "total_diff": row.get::<f64,_>("total_diff")})
    }).collect::<Vec<_>>())))
}
