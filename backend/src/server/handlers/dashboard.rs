use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisQuery { pub warehouse_id: Option<String> }

pub async fn kpi(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let total_materials: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials WHERE is_active=true").fetch_one(&pool.pool).await.unwrap_or(0);
    let total_transactions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions").fetch_one(&pool.pool).await.unwrap_or(0);
    let low_stock: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials WHERE quantity <= min_stock AND min_stock > 0 AND is_active=true").fetch_one(&pool.pool).await.unwrap_or(0);
    let total_warehouses: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM warehouses WHERE is_active=true").fetch_one(&pool.pool).await.unwrap_or(0);
    let stock_value: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity * price),0) FROM materials WHERE is_active=true").fetch_one(&pool.pool).await.unwrap_or(0.0);
    let recent_tx_rows = sqlx::query("SELECT id, transaction_number, type, material_id, warehouse_id, quantity, created_at FROM transactions ORDER BY created_at DESC LIMIT 10")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
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
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let wh_filter = q.warehouse_id.as_deref().unwrap_or("");
    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '90 days'),0) as consumption_3mo,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '180 days'),0) as consumption_6mo,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as consumption_12mo,
            COALESCE((SELECT t.quantity FROM transactions t WHERE t.material_id=m.id AND t.type='out' ORDER BY t.created_at DESC LIMIT 1),0) as turnover,
            (SELECT MAX(created_at) FROM transactions WHERE material_id=m.id) as last_transaction,
            (SELECT COUNT(DISTINCT DATE(created_at)) FROM transactions WHERE type='out' AND material_id=m.id) as lead_time_days
         FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY m.name"
    ).bind(wh_filter).fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        let last_tx: Option<String> = row.get::<Option<String>,_>("last_transaction");
        let days_since = last_tx.as_ref().and_then(|d| {
            chrono::NaiveDateTime::parse_from_str(d, "%Y-%m-%d %H:%M:%S").ok().map(|dt| {
                (chrono::Local::now().naive_local() - dt).num_days()
            })
        }).unwrap_or(999);
        json!({"material_id": row.get::<String,_>("id"), "material_name": row.get::<String,_>("name"),
            "sku": row.get::<String,_>("sku"), "quantity": row.get::<f64,_>("quantity"),
            "consumption_3mo": row.get::<f64,_>("consumption_3mo"),
            "consumption_6mo": row.get::<f64,_>("consumption_6mo"),
            "consumption_12mo": row.get::<f64,_>("consumption_12mo"),
            "turnover": row.get::<f64,_>("turnover"),
            "last_transaction": last_tx, "days_since_last": days_since,
            "lead_time_days": row.get::<i64,_>("lead_time_days"), "forecast_qty": 0.0, "abc_class": null})
    }).collect::<Vec<_>>())))
}

pub async fn abc_analysis(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let wh_filter = q.warehouse_id.as_deref().unwrap_or("");
    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as consumption_12mo,
            COALESCE((SELECT MAX(created_at) FROM transactions WHERE material_id=m.id),'') as last_transaction
         FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY consumption_12mo DESC"
    ).bind(wh_filter).fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
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
            "forecast_qty": 0.0, "abc_class": if cumulative <= 80.0 { Some("A") } else if cumulative <= 95.0 { Some("B") } else { Some("C") }});
        if cumulative <= 80.0 { class_a.push(item); }
        else if cumulative <= 95.0 { class_b.push(item); }
        else { class_c.push(item); }
    }
    Ok(Json(json!({"class_a": class_a, "class_b": class_b, "class_c": class_c})))
}

pub async fn mom_kpis(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let current = chrono::Local::now().format("%Y-%m").to_string();
    let prior = chrono::Local::now().checked_sub_months(chrono::Months::new(1)).map(|d| d.format("%Y-%m").to_string()).unwrap_or_default();
    async fn month_val(pool: &Arc<DbPool>, month: &str) -> f64 {
        sqlx::query_scalar("SELECT COALESCE(SUM(quantity),0) FROM transactions WHERE type='in' AND to_char(created_at,'YYYY-MM')=$1")
            .bind(month).fetch_one(&pool.pool).await.unwrap_or(0.0)
    }
    let cv = month_val(&pool, &current).await;
    let pv = month_val(&pool, &prior).await;
    let change = if pv > 0.0 { ((cv - pv) / pv * 100.0) as f64 } else { 0.0 };
    Ok(Json(json!({"inbound": json!({"current_value": cv, "prev_value": pv, "change_pct": change})})))
}

pub async fn aging_report(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT CASE WHEN days >= 90 THEN '90+' WHEN days >= 60 THEN '60-90' WHEN days >= 30 THEN '30-60' ELSE '0-30' END as bucket, \
         COUNT(*) as cnt, COALESCE(SUM(quantity * price),0) as val FROM (SELECT m.id, m.quantity, m.price, \
         COALESCE((SELECT EXTRACT(DAY FROM NOW() - MAX(created_at::timestamp)) FROM transactions WHERE material_id=m.id),999) as days \
         FROM materials m WHERE m.is_active=true) sub GROUP BY bucket ORDER BY bucket"
    ).fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"bucket": row.get::<String,_>("bucket"), "count": row.get::<i64,_>("cnt"), "total_value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn stock_movement(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let start = q.get("periodStart").and_then(|v| v.as_str()).unwrap_or("");
    let end = q.get("periodEnd").and_then(|v| v.as_str()).unwrap_or("");
    let rows = sqlx::query(
        "SELECT m.name, COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id=m.id AND created_at < $1 AND type='in'),0) as opening, \
         COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id=m.id AND created_at >= $1 AND created_at < $2 AND type='in'),0) as qty_in, \
         COALESCE((SELECT SUM(quantity) FROM transactions WHERE material_id=m.id AND created_at >= $1 AND created_at < $2 AND type='out'),0) as qty_out \
         FROM materials m WHERE m.is_active=true ORDER BY m.name"
    ).bind(start).bind(end).fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        let o: f64 = row.get("opening"); let i: f64 = row.get("qty_in"); let oo: f64 = row.get("qty_out");
        json!({"material_name": row.get::<String,_>("name"), "opening": o, "qty_in": i, "qty_out": oo, "closing": o + i - oo})
    }).collect::<Vec<_>>())))
}

pub async fn tx_type_summary(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT type, COUNT(*) as cnt, COALESCE(SUM(quantity),0) as val FROM transactions GROUP BY type ORDER BY type")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"name": row.get::<String,_>("type"), "count": row.get::<i64,_>("cnt"), "value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn tx_by_user(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let ds = q.get("dateStart").and_then(|v| v.as_str()).unwrap_or("");
    let de = q.get("dateEnd").and_then(|v| v.as_str()).unwrap_or("");
    let rows = sqlx::query("SELECT t.user_id, u.full_name, COUNT(*) as cnt, COALESCE(SUM(t.quantity),0) as val FROM transactions t JOIN users u ON t.user_id=u.id WHERE ($1='' OR t.created_at>=$1) AND ($2='' OR t.created_at<$2) GROUP BY t.user_id, u.full_name ORDER BY cnt DESC")
        .bind(ds).bind(de).fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"user_id": row.get::<String,_>("user_id"), "user_name": row.get::<String,_>("full_name"),
            "total_count": row.get::<i64,_>("cnt"), "total_value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn daily_trend(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let ds = q.get("dateStart").and_then(|v| v.as_str()).unwrap_or("");
    let de = q.get("dateEnd").and_then(|v| v.as_str()).map(|s| if s.is_empty() { String::new() } else { format!("{} 23:59:59", s) }).unwrap_or_default();
    let rows = sqlx::query("SELECT DATE(created_at)::text as date, COUNT(*) as cnt, COALESCE(SUM(quantity),0) as val FROM transactions WHERE ($1='' OR created_at>=$1) AND ($2='' OR created_at<=$2) GROUP BY DATE(created_at) ORDER BY date")
        .bind(ds).bind(de).fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"date": row.get::<String,_>("date"), "count": row.get::<i64,_>("cnt"), "value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn tx_date_comparison(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let a_s = q.get("aStart").and_then(|v| v.as_str()).unwrap_or("");
    let a_e = q.get("aEnd").and_then(|v| v.as_str()).unwrap_or("");
    let b_s = q.get("bStart").and_then(|v| v.as_str()).unwrap_or("");
    let b_e = q.get("bEnd").and_then(|v| v.as_str()).unwrap_or("");
    let rows = sqlx::query(
        "SELECT DATE(created_at)::text as date, COUNT(*) as cnt, COALESCE(SUM(quantity),0) as val, \
         CASE WHEN created_at >= $1 AND created_at < $2 THEN 'A' WHEN created_at >= $3 AND created_at < $4 THEN 'B' END as series \
         FROM transactions WHERE (created_at >= $1 AND created_at < $2) OR (created_at >= $3 AND created_at < $4) \
         GROUP BY DATE(created_at), series ORDER BY date"
    ).bind(a_s).bind(a_e).bind(b_s).bind(b_e).fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        let series: Option<String> = row.get("series");
        let prefix = if series.as_deref() == Some("A") { "A_" } else { "B_" };
        json!({"date": row.get::<String,_>("date"), format!("{}count", prefix): row.get::<i64,_>("cnt"), format!("{}value", prefix): row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn category_value_summary(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT COALESCE(c.name,'Uncategorized') as name, COUNT(m.id) as cnt, COALESCE(SUM(m.quantity*m.price),0) as val FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true GROUP BY c.name ORDER BY val DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"name": row.get::<String,_>("name"), "count": row.get::<i64,_>("cnt"), "value": row.get::<f64,_>("val")})
    }).collect::<Vec<_>>())))
}

pub async fn stock_valuation(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT COALESCE(c.name,'Uncategorized') as category, SUM(m.quantity*m.price) as value, COUNT(m.id) as count FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true GROUP BY c.name ORDER BY value DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"category": row.get::<String,_>("category"), "value": row.get::<f64,_>("value"), "count": row.get::<i64,_>("count")})
    }).collect::<Vec<_>>())))
}

pub async fn demand_forecast(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let wh_filter = q.warehouse_id.as_deref().unwrap_or("");
    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, m.min_stock, m.max_stock,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '90 days'),0) as consumption_3mo,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '30 days'),0) as consumption_1mo
         FROM materials m WHERE m.is_active=true AND ($1 = '' OR m.warehouse_id = $1) ORDER BY m.name"
    ).bind(wh_filter).fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        let c3: f64 = row.get("consumption_3mo");
        let c1: f64 = row.get("consumption_1mo");
        let monthly_avg = if c3 > 0.0 { c3 / 3.0 } else { c1.max(1.0) };
        let seasonal_factor = if c1 > 0.0 && monthly_avg > 0.0 { c1 / monthly_avg } else { 1.0 };
        let forecast_next = (monthly_avg * seasonal_factor * 1.1).round();
        json!({"material_id": row.get::<String,_>("id"), "material_name": row.get::<String,_>("name"),
            "sku": row.get::<String,_>("sku"), "current_qty": row.get::<f64,_>("quantity"),
            "min_stock": row.get::<f64,_>("min_stock"), "max_stock": row.get::<f64,_>("max_stock"),
            "consumption_3mo": c3, "consumption_1mo": c1,
            "monthly_avg_demand": (monthly_avg * 100.0).round() / 100.0,
            "forecast_next_month": forecast_next as i64})
    }).collect::<Vec<_>>())))
}

pub async fn reorder_suggestions(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AnalysisQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let wh_filter = q.warehouse_id.as_deref().unwrap_or("");
    let rows = sqlx::query(
        "SELECT m.id, m.name, m.sku, m.quantity, m.min_stock, m.max_stock, m.price,
            COALESCE(s.name,'') as supplier,
            COALESCE((SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at::timestamp >= NOW() - INTERVAL '30 days'),0) as monthly_usage
         FROM materials m LEFT JOIN suppliers s ON m.supplier_id=s.id
         WHERE m.is_active=true AND m.quantity <= m.max_stock AND ($1 = '' OR m.warehouse_id = $1) ORDER BY (m.quantity - m.min_stock) ASC"
    ).bind(wh_filter).fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
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
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT COALESCE(c.name,'Uncategorized') as category, COALESCE(SUM(soi.difference),0) as total_diff FROM stock_opname_items soi LEFT JOIN materials m ON soi.material_id=m.id LEFT JOIN categories c ON m.category_id=c.id WHERE soi.opname_id=$1 GROUP BY c.name ORDER BY total_diff DESC")
        .bind(&id).fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"category": row.get::<String,_>("category"), "total_diff": row.get::<f64,_>("total_diff")})
    }).collect::<Vec<_>>())))
}
