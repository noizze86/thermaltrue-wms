use std::sync::Arc;
use axum::{Json, extract::{State, Query}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastQuery {
    pub warehouse_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastDetailsQuery {
    pub material_id: Option<String>,
    pub warehouse_id: Option<String>,
}

fn sma(data: &[f64], n: usize) -> f64 {
    if data.is_empty() { return 0.0 }
    let len = data.len().min(n);
    let slice = &data[data.len()-len..];
    slice.iter().sum::<f64>() / len as f64
}

fn ses(data: &[f64], alpha: f64) -> f64 {
    if data.is_empty() { return 0.0 }
    let mut s = data[0];
    for i in 1..data.len() { s = alpha * data[i] + (1.0 - alpha) * s }
    s
}

fn holt(data: &[f64], alpha: f64, beta: f64) -> f64 {
    if data.len() < 2 { return *data.last().unwrap_or(&0.0) }
    let mut level = data[0];
    let mut trend = data[1] - data[0];
    for i in 1..data.len() {
        let nl = alpha * data[i] + (1.0 - alpha) * (level + trend);
        let nt = beta * (nl - level) + (1.0 - beta) * trend;
        level = nl; trend = nt;
    }
    (level + trend).max(0.0)
}

fn best_forecast(data: &[f64]) -> f64 {
    if data.len() < 3 { return data.last().copied().unwrap_or(0.0) }
    let predictions: Vec<(f64, f64)> = (3..data.len()).map(|i| {
        let slice = &data[0..i];
        let f_sma3 = sma(slice, 3);
        let f_ses = ses(slice, 0.3);
        let f_holt = holt(slice, 0.3, 0.1);
        let actual = data[i];
        let err_sma3 = (actual - f_sma3).abs();
        let err_ses = (actual - f_ses).abs();
        let err_holt = (actual - f_holt).abs();
        (f_sma3, f_ses, f_holt, actual, err_sma3, err_ses, err_holt)
    }).collect();

    let total_sma3: f64 = predictions.iter().map(|x| x.4).sum();
    let total_ses: f64 = predictions.iter().map(|x| x.5).sum();
    let total_holt: f64 = predictions.iter().map(|x| x.6).sum();

    let cnt = predictions.len() as f64;
    let best = if total_sma3 <= total_ses && total_sma3 <= total_holt { "sma3" }
        else if total_ses <= total_holt { "ses" } else { "holt" };

    match best {
        "sma3" => sma(data, 3),
        "ses" => ses(data, 0.3),
        _ => holt(data, 0.3, 0.1),
    }
}

fn compute_mape(actual: &[f64], predicted: &[f64]) -> f64 {
    let mut sum = 0.0; let mut cnt = 0;
    for i in 0..actual.len().min(predicted.len()) {
        if actual[i] == 0.0 { continue }
        sum += (actual[i] - predicted[i]).abs() / actual[i] * 100.0;
        cnt += 1;
    }
    if cnt > 0 { sum / cnt as f64 } else { 0.0 }
}

fn compute_trend(data: &[f64]) -> &'static str {
    if data.len() < 3 { return "→" }
    let recent = &data[data.len()-3..];
    let avg = recent.iter().sum::<f64>() / 3.0;
    if avg > data[0] * 1.05 { "▲" } else if avg < data[0] * 0.95 { "▼" } else { "→" }
}

async fn persist_forecast(
    pool: &sqlx::PgPool,
    material_id: &str, warehouse_id: &str,
    period: &str, model: &str,
    f1: f64, f3: f64, f6: f64,
    cl1: f64, cu1: f64, cl3: f64, cu3: f64, cl6: f64, cu6: f64,
    mape: f64, mae: f64, rmse: f64,
    seasonal: &serde_json::Value,
    trend: &str, is_seasonal: bool,
    recommendations: &str,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO forecast_metrics (id, material_id, warehouse_id, period, forecast_model, \
         forecast_1mo, forecast_3mo, forecast_6mo, \
         confidence_lower_1mo, confidence_upper_1mo, \
         confidence_lower_3mo, confidence_upper_3mo, \
         confidence_lower_6mo, confidence_upper_6mo, \
         mape, mae, rmse, seasonal_index, trend, is_seasonal, recommendations, \
         created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) \
         ON CONFLICT (material_id, warehouse_id, period, forecast_model) DO UPDATE SET \
         forecast_1mo=EXCLUDED.forecast_1mo, forecast_3mo=EXCLUDED.forecast_3mo, forecast_6mo=EXCLUDED.forecast_6mo, \
         confidence_lower_1mo=EXCLUDED.confidence_lower_1mo, confidence_upper_1mo=EXCLUDED.confidence_upper_1mo, \
         confidence_lower_3mo=EXCLUDED.confidence_lower_3mo, confidence_upper_3mo=EXCLUDED.confidence_upper_3mo, \
         confidence_lower_6mo=EXCLUDED.confidence_lower_6mo, confidence_upper_6mo=EXCLUDED.confidence_upper_6mo, \
         mape=EXCLUDED.mape, mae=EXCLUDED.mae, rmse=EXCLUDED.rmse, \
         seasonal_index=EXCLUDED.seasonal_index, trend=EXCLUDED.trend, \
         is_seasonal=EXCLUDED.is_seasonal, recommendations=EXCLUDED.recommendations, \
         updated_at=EXCLUDED.updated_at"
    )
    .bind(&id).bind(material_id).bind(warehouse_id).bind(period).bind(model)
    .bind(f1).bind(f3).bind(f6)
    .bind(cl1).bind(cu1).bind(cl3).bind(cu3).bind(cl6).bind(cu6)
    .bind(mape).bind(mae).bind(rmse)
    .bind(seasonal).bind(trend).bind(is_seasonal).bind(recommendations)
    .bind(&now).bind(&now)
    .execute(pool).await.ok();
}

pub async fn forecast_generate(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<ForecastQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let wh = q.warehouse_id.as_deref().unwrap_or("");
    let period = chrono::Local::now().format("%Y-%m-%d").to_string();

    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, m.min_stock, m.warehouse_id, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '90 days'),0) as c3, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '180 days'),0) as c6, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as c12 \
         FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY m.name"
    ).bind(wh).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    let mut generated: Vec<serde_json::Value> = Vec::new();
    for row in &rows {
        let id: String = row.get("id");
        let name: String = row.get("name");
        let sku: String = row.get("sku");
        let qty: f64 = row.get("quantity");
        let min_stock: f64 = row.get("min_stock");
        let wh_id: String = row.get("warehouse_id");
        let c3: f64 = row.get("c3");
        let c6: f64 = row.get("c6");
        let c12: f64 = row.get("c12");

        // Build monthly history from consumption data
        let mut monthly: Vec<f64> = Vec::new();
        let avg3 = if c3 > 0.0 { c3 / 3.0 } else { 0.0 };
        let avg6 = if c6 > 0.0 { c6 / 6.0 } else { 0.0 };
        let avg12 = if c12 > 0.0 { c12 / 12.0 } else { 0.0 };

        // Simulate 12 months from c12 minus c6, c6 minus c3, and c3
        if c12 > 0.0 {
            let early6 = (c12 - c6).max(0.0) / 6.0;
            let mid3 = (c6 - c3).max(0.0) / 3.0;
            let late3 = c3 / 3.0;
            for _ in 0..6 { monthly.push(early6.max(1.0)); }
            for _ in 0..3 { monthly.push(mid3.max(1.0)); }
            for _ in 0..3 { monthly.push(late3.max(1.0)); }
        } else if c6 > 0.0 {
            let early3 = (c6 - c3).max(0.0) / 3.0;
            let late3 = c3 / 3.0;
            for _ in 0..3 { monthly.push(early3.max(1.0)); }
            for _ in 0..3 { monthly.push(late3.max(1.0)); }
        } else if c3 > 0.0 {
            for _ in 0..3 { monthly.push((c3 / 3.0).max(1.0)); }
        } else {
            monthly.push(1.0);
        }

        // Fill to at least 6 data points for forecasting
        while monthly.len() < 6 {
            monthly.push(monthly.last().copied().unwrap_or(1.0));
        }
        let data = &monthly;

        let f1 = best_forecast(data);
        let f3 = f1 * 3.0;
        let f6 = f1 * 6.0;

        // Confidence intervals (± 30% for simplicity)
        let std_dev = if data.len() > 1 {
            let mean = data.iter().sum::<f64>() / data.len() as f64;
            (data.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (data.len() - 1) as f64).sqrt()
        } else { f1 * 0.3 };
        let ci = std_dev * 1.96;
        let cl1 = (f1 - ci).max(0.0);
        let cu1 = f1 + ci;
        let cl3 = (f3 - ci * 3.0_f64.sqrt()).max(0.0);
        let cu3 = f3 + ci * 3.0_f64.sqrt();
        let cl6 = (f6 - ci * 6.0_f64.sqrt()).max(0.0);
        let cu6 = f6 + ci * 6.0_f64.sqrt();

        // In-sample predictions for MAPE
        let preds: Vec<f64> = (1..data.len()).map(|i| best_forecast(&data[0..i])).collect();
        let actuals: Vec<f64> = data[1..].to_vec();
        let mape = compute_mape(&actuals, &preds);
        let mae = actuals.iter().zip(&preds).map(|(a, p)| (a - p).abs()).sum::<f64>() / actuals.len() as f64;
        let rmse = (actuals.iter().zip(&preds).map(|(a, p)| (a - p).powi(2)).sum::<f64>() / actuals.len() as f64).sqrt();

        // Seasonal index (simple: avg per quarter position)
        let si: Vec<f64> = if data.len() >= 4 {
            (0..4).map(|q| {
                let vals: Vec<f64> = data.iter().skip(q).step_by(4).copied().collect();
                if vals.is_empty() { 1.0 } else { vals.iter().sum::<f64>() / vals.len() as f64 }
            }).collect()
        } else { vec![1.0; 4] };
        let seasonal_avg = si.iter().sum::<f64>() / si.len() as f64;
        let seasonal_norm: Vec<f64> = if seasonal_avg > 0.0 {
            si.iter().map(|v| (v / seasonal_avg * 100.0).round() / 100.0).collect()
        } else { si };

        let trend_label = compute_trend(data);
        let is_seasonal = seasonal_norm.iter().any(|v| (*v - 1.0).abs() > 0.2);

        let need_reorder = f1 > qty;
        let recom = if need_reorder {
            format!("Reorder needed: current {:.0} < forecast {:.0}/mo. Safety stock {:.0}.",
                qty, f1, min_stock)
        } else {
            format!("Stock adequate: {:.0} covers {:.0}/mo forecast.", qty, f1)
        };

        persist_forecast(
            &pool.pool, &id, &wh_id, &period, "best",
            f1, f3, f6,
            cl1, cu1, cl3, cu3, cl6, cu6,
            mape, mae, rmse,
            &json!(seasonal_norm), trend_label, is_seasonal, &recom,
        ).await;

        generated.push(json!({
            "material_id": id, "material_name": name, "sku": sku,
            "current_qty": qty, "min_stock": min_stock,
            "forecast_1mo": (f1 * 100.0).round() / 100.0,
            "forecast_3mo": (f3 * 100.0).round() / 100.0,
            "forecast_6mo": (f6 * 100.0).round() / 100.0,
            "confidence_lower_1mo": (cl1 * 100.0).round() / 100.0,
            "confidence_upper_1mo": (cu1 * 100.0).round() / 100.0,
            "mape": (mape * 100.0).round() / 100.0,
            "mae": (mae * 100.0).round() / 100.0,
            "rmse": (rmse * 100.0).round() / 100.0,
            "trend": trend_label,
            "is_seasonal": is_seasonal,
            "recommendations": recom,
            "consumption_3mo": c3, "consumption_6mo": c6, "consumption_12mo": c12,
        }));
    }

    Ok(Json(json!({
        "generated": generated.len(),
        "period": period,
        "items": generated,
    })))
}

pub async fn forecast_summary(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let period = chrono::Local::now().format("%Y-%m-%d").to_string();

    let row = sqlx::query(
        "SELECT COUNT(*) as total, \
         COUNT(*) FILTER (WHERE forecast_1mo > 0) as forecasted, \
         COUNT(*) FILTER (WHERE trend='▲') as trend_up, \
         COUNT(*) FILTER (WHERE trend='▼') as trend_down, \
         COUNT(*) FILTER (WHERE is_seasonal=TRUE) as seasonal_cnt, \
         COALESCE(AVG(mape),0) as avg_mape \
         FROM forecast_metrics WHERE period=$1 AND forecast_model='best'"
    ).bind(&period).fetch_one(&pool.pool).await.unwrap_or_else(|_| {
        // Return empty row if table doesn't exist yet
        sqlx::query(
            "SELECT 0::bigint as total, 0::bigint as forecasted, 0::bigint as trend_up, \
             0::bigint as trend_down, 0::bigint as seasonal_cnt, 0::double precision as avg_mape"
        ).fetch_one(&pool.pool).await.unwrap()
    });

    Ok(Json(json!({
        "total_materials": row.get::<i64,_>("total"),
        "forecasted": row.get::<i64,_>("forecasted"),
        "trend_up": row.get::<i64,_>("trend_up"),
        "trend_down": row.get::<i64,_>("trend_down"),
        "seasonal_count": row.get::<i64,_>("seasonal_cnt"),
        "avg_mape": (row.get::<f64,_>("avg_mape") * 100.0).round() / 100.0,
    })))
}

pub async fn forecast_details(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<ForecastDetailsQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let period = chrono::Local::now().format("%Y-%m-%d").to_string();
    let wh = q.warehouse_id.as_deref().unwrap_or("");
    let mid = q.material_id.as_deref().unwrap_or("");

    let rows = sqlx::query(
        "SELECT fm.*, m.name as material_name, m.sku \
         FROM forecast_metrics fm \
         JOIN materials m ON m.id = fm.material_id \
         WHERE fm.period=$1 AND fm.forecast_model='best' \
         AND ($2 = '' OR fm.warehouse_id = $2) \
         AND ($3 = '' OR fm.material_id = $3) \
         ORDER BY m.name"
    ).bind(&period).bind(wh).bind(mid)
     .fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    let items: Vec<serde_json::Value> = rows.iter().map(|row| {
        json!({
            "material_id": row.get::<String,_>("material_id"),
            "material_name": row.get::<String,_>("material_name"),
            "sku": row.get::<String,_>("sku"),
            "forecast_1mo": row.get::<f64,_>("forecast_1mo"),
            "forecast_3mo": row.get::<f64,_>("forecast_3mo"),
            "forecast_6mo": row.get::<f64,_>("forecast_6mo"),
            "confidence_lower_1mo": row.get::<f64,_>("confidence_lower_1mo"),
            "confidence_upper_1mo": row.get::<f64,_>("confidence_upper_1mo"),
            "confidence_lower_3mo": row.get::<f64,_>("confidence_lower_3mo"),
            "confidence_upper_3mo": row.get::<f64,_>("confidence_upper_3mo"),
            "confidence_lower_6mo": row.get::<f64,_>("confidence_lower_6mo"),
            "confidence_upper_6mo": row.get::<f64,_>("confidence_upper_6mo"),
            "mape": row.get::<f64,_>("mape"),
            "mae": row.get::<f64,_>("mae"),
            "rmse": row.get::<f64,_>("rmse"),
            "trend": row.get::<String,_>("trend"),
            "is_seasonal": row.get::<bool,_>("is_seasonal"),
            "recommendations": row.get::<String,_>("recommendations"),
        })
    }).collect();

    Ok(Json(json!({"items": items, "total": items.len(), "period": period})))
}
