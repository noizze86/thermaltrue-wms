use std::sync::Arc;
use axum::{Json, extract::{State, Query}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumptionQuery {
    pub warehouse_id: Option<String>,
}

async fn persist_consumption_metrics(
    pool: &sqlx::PgPool,
    material_id: &str, warehouse_id: &str,
    c1: f64, c3: f64, c6: f64, c12: f64,
    am1: f64, am3: f64, am6: f64, am12: f64,
    seasonal_index: f64, is_high: bool, is_low: bool,
    std_dev: f64, lead_time: f64, safety: f64, rop: f64,
    qty: f64,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let period = chrono::Local::now().format("%Y-%m").to_string();

    let yesterday = (chrono::Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
    let last_week = (chrono::Local::now() - chrono::Duration::days(7)).format("%Y-%m-%d").to_string();

    let yesterday_c3: f64 = sqlx::query_scalar(
        "SELECT COALESCE(consumption_3mo,0) FROM consumption_metrics WHERE material_id=$1 AND period_start=$2 ORDER BY updated_at DESC LIMIT 1"
    ).bind(material_id).bind(&yesterday).fetch_one(pool).await.unwrap_or(0.0);
    let avg_7_c3: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(consumption_3mo),0) FROM consumption_metrics WHERE material_id=$1 AND period_start>=$2"
    ).bind(material_id).bind(&last_week).fetch_one(pool).await.unwrap_or(0.0);
    let trend = if (c3 * 100.0).round() > (yesterday_c3 * 100.0).round() { "▲" }
        else if (c3 * 100.0).round() < (yesterday_c3 * 100.0).round() { "▼" } else { "→" };

    sqlx::query(
        "INSERT INTO consumption_metrics (id, material_id, warehouse_id, period_type, period_start, period_end, \
         consumption_1mo, consumption_3mo, consumption_6mo, consumption_12mo, \
         avg_monthly_1mo, avg_monthly_3mo, avg_monthly_6mo, avg_monthly_12mo, \
         seasonal_index, is_seasonal_high, is_seasonal_low, \
         std_dev_consumption, lead_time_days, safety_stock, reorder_point, \
         yesterday_consumption_3mo, avg_7days_consumption_3mo, consumption_trend, \
         current_qty, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) \
         ON CONFLICT (material_id, warehouse_id, period_type, period_start) DO UPDATE SET \
         period_end=EXCLUDED.period_end, \
         consumption_1mo=EXCLUDED.consumption_1mo, consumption_3mo=EXCLUDED.consumption_3mo, \
         consumption_6mo=EXCLUDED.consumption_6mo, consumption_12mo=EXCLUDED.consumption_12mo, \
         avg_monthly_1mo=EXCLUDED.avg_monthly_1mo, avg_monthly_3mo=EXCLUDED.avg_monthly_3mo, \
         avg_monthly_6mo=EXCLUDED.avg_monthly_6mo, avg_monthly_12mo=EXCLUDED.avg_monthly_12mo, \
         seasonal_index=EXCLUDED.seasonal_index, is_seasonal_high=EXCLUDED.is_seasonal_high, \
         is_seasonal_low=EXCLUDED.is_seasonal_low, \
         std_dev_consumption=EXCLUDED.std_dev_consumption, lead_time_days=EXCLUDED.lead_time_days, \
         safety_stock=EXCLUDED.safety_stock, reorder_point=EXCLUDED.reorder_point, \
         yesterday_consumption_3mo=EXCLUDED.yesterday_consumption_3mo, \
         avg_7days_consumption_3mo=EXCLUDED.avg_7days_consumption_3mo, \
         consumption_trend=EXCLUDED.consumption_trend, \
         current_qty=EXCLUDED.current_qty, updated_at=EXCLUDED.updated_at"
    )
    .bind(&id).bind(material_id).bind(warehouse_id).bind("monthly").bind(&period).bind(&period)
    .bind(c1).bind(c3).bind(c6).bind(c12)
    .bind(am1).bind(am3).bind(am6).bind(am12)
    .bind(seasonal_index).bind(is_high).bind(is_low)
    .bind(std_dev).bind(lead_time).bind(safety).bind(rop)
    .bind(yesterday_c3).bind(avg_7_c3).bind(trend)
    .bind(qty)
    .bind(&now).bind(&now)
    .execute(pool).await.ok();
}

pub async fn consumption_summary(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let total_c3: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(consumption_3mo),0) FROM materials m WHERE m.is_active=true").fetch_one(&pool.pool).await.unwrap_or(0.0);
    let total_c6: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(consumption_6mo),0) FROM materials m WHERE m.is_active=true").fetch_one(&pool.pool).await.unwrap_or(0.0);
    let total_c12: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(consumption_12mo),0) FROM materials m WHERE m.is_active=true").fetch_one(&pool.pool).await.unwrap_or(0.0);
    let avg_lt: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(COALESCE((SELECT COUNT(DISTINCT DATE(created_at)) FROM transactions WHERE type='out' AND material_id=m.id),0)),0) FROM materials m WHERE m.is_active=true"
    ).fetch_one(&pool.pool).await.unwrap_or(0.0);
    Ok(Json(json!({
        "total_consumption_3mo": (total_c3 * 100.0).round() / 100.0,
        "total_consumption_6mo": (total_c6 * 100.0).round() / 100.0,
        "total_consumption_12mo": (total_c12 * 100.0).round() / 100.0,
        "avg_lead_time_days": (avg_lt * 100.0).round() / 100.0,
    })))
}

pub async fn consumption_details(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<ConsumptionQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh = q.warehouse_id.as_deref().unwrap_or("");

    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '30 days'),0) as consumption_1mo, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '90 days'),0) as consumption_3mo, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '180 days'),0) as consumption_6mo, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as consumption_12mo, \
         (SELECT COUNT(DISTINCT DATE(created_at)) FROM transactions WHERE type='out' AND material_id=m.id) as lead_time_days \
         FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY m.name"
    ).bind(wh).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    let mut details = Vec::new();
    for row in &rows {
        let id: String = row.get("id");
        let qty: f64 = row.get("quantity");
        let c1: f64 = row.get("consumption_1mo");
        let c3: f64 = row.get("consumption_3mo");
        let c6: f64 = row.get("consumption_6mo");
        let c12: f64 = row.get("consumption_12mo");
        let lead_time: f64 = row.get::<i64,_>("lead_time_days") as f64;

        let am3 = c3 / 3.0;
        let am6 = c6 / 6.0;
        let am12 = c12 / 12.0;
        let am1 = if c1 > 0.0 { c1 } else { am3.max(1.0) };

        let monthly_vals = [am1, am3, am6];
        let mu = monthly_vals.iter().sum::<f64>() / 3.0;
        let variance = monthly_vals.iter().map(|v| (v - mu).powi(2)).sum::<f64>() / 3.0;
        let std_dev = variance.sqrt();

        let seasonal_index = if mu > 0.0 { am1 / mu } else { 1.0 };
        let is_high = seasonal_index > 1.1;
        let is_low = seasonal_index < 0.9;

        let z: f64 = 1.65;
        let safety = z * std_dev * lead_time.max(1.0).sqrt();
        let avg_daily = c12 / 365.0;
        let rop = avg_daily * lead_time.max(1.0) + safety;

        persist_consumption_metrics(
            &pool.pool, &id, wh,
            c1, c3, c6, c12,
            am1, am3, am6, am12,
            seasonal_index, is_high, is_low,
            std_dev, lead_time, safety, rop,
            qty,
        ).await;

        details.push(json!({
            "material_id": id,
            "material_name": row.get::<String,_>("name"),
            "sku": row.get::<String,_>("sku"),
            "current_qty": qty,
            "consumption_1mo": c1,
            "consumption_3mo": c3,
            "consumption_6mo": c6,
            "consumption_12mo": c12,
            "avg_monthly_1mo": (am1 * 100.0).round() / 100.0,
            "avg_monthly_3mo": (am3 * 100.0).round() / 100.0,
            "avg_monthly_6mo": (am6 * 100.0).round() / 100.0,
            "avg_monthly_12mo": (am12 * 100.0).round() / 100.0,
            "seasonal_index": (seasonal_index * 100.0).round() / 100.0,
            "is_seasonal_high": is_high,
            "is_seasonal_low": is_low,
            "std_dev": (std_dev * 100.0).round() / 100.0,
            "lead_time_days": lead_time,
            "safety_stock": (safety * 100.0).round() / 100.0,
            "reorder_point": (rop * 100.0).round() / 100.0,
        }));
    }
    Ok(Json(json!(details)))
}

pub async fn consumption_seasonal(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let month_labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let now = chrono::Local::now();
    let cur_month = now.month() as usize;
    let mut seasonal = Vec::new();
    for i in 0..12 {
        let idx = (cur_month + i) % 12;
        let label = month_labels[idx];
        seasonal.push(json!({"name": label, "avg": 0, "index": 1.0, "season": "Normal"}));
    }
    let row = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(AVG(seasonal_index),1.0) FROM consumption_metrics WHERE period_start=TO_CHAR(NOW(),'YYYY-MM')"
    ).fetch_one(&pool.pool).await.unwrap_or(1.0);
    for m in &mut seasonal {
        let idx = m["index"].as_f64().unwrap_or(1.0) * row;
        let season_label = if idx > 1.1 { "High" } else if idx < 0.9 { "Low" } else { "Normal" };
        m["index"] = json!((idx * 100.0).round() / 100.0);
        m["season"] = json!(season_label);
        m["avg"] = json!(0);
    }
    Ok(Json(json!(seasonal)))
}
