use std::sync::Arc;
use axum::{Json, extract::State, Extension};
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

async fn persist_cost_metrics(
    pool: &sqlx::PgPool, material_id: &str, warehouse_id: &str,
    period_type: &str, period_start: &str, period_end: &str,
    purchase_price: f64, storage_cost: f64, picking_cost: f64, waste_cost: f64,
    carrying_rate: f64, carrying_value: f64, carrying_pct: f64,
    total_cost: f64, total_units: f64, unit_cost: f64, cost_pct: f64,
    actual_hrs: Option<f64>, standard_hrs: Option<f64>, labor_rate: Option<f64>, penalty: Option<f64>, serve: Option<f64>,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO cost_metrics (id, material_id, warehouse_id, period_type, period_start, period_end, \
         purchase_price, storage_cost, picking_cost, waste_cost, \
         carrying_cost_rate, carrying_cost_value, carrying_cost_percent, \
         total_cost, total_units, true_unit_cost, cost_percentage_of_total, \
         actual_labor_hours, standard_labor_hours, hourly_labor_rate, \
         efficiency_penalty_cost, cost_to_serve_per_order, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) \
         ON CONFLICT (material_id, warehouse_id, period_type, period_start) DO UPDATE SET \
         period_end=EXCLUDED.period_end, purchase_price=EXCLUDED.purchase_price, \
         storage_cost=EXCLUDED.storage_cost, picking_cost=EXCLUDED.picking_cost, \
         waste_cost=EXCLUDED.waste_cost, carrying_cost_rate=EXCLUDED.carrying_cost_rate, \
         carrying_cost_value=EXCLUDED.carrying_cost_value, carrying_cost_percent=EXCLUDED.carrying_cost_percent, \
         total_cost=EXCLUDED.total_cost, total_units=EXCLUDED.total_units, \
         true_unit_cost=EXCLUDED.true_unit_cost, cost_percentage_of_total=EXCLUDED.cost_percentage_of_total, \
         actual_labor_hours=EXCLUDED.actual_labor_hours, standard_labor_hours=EXCLUDED.standard_labor_hours, \
         hourly_labor_rate=EXCLUDED.hourly_labor_rate, efficiency_penalty_cost=EXCLUDED.efficiency_penalty_cost, \
         cost_to_serve_per_order=EXCLUDED.cost_to_serve_per_order, updated_at=EXCLUDED.updated_at"
    )
    .bind(&id).bind(material_id).bind(warehouse_id).bind(period_type)
    .bind(period_start).bind(period_end)
    .bind(purchase_price).bind(storage_cost).bind(picking_cost).bind(waste_cost)
    .bind(carrying_rate).bind(carrying_value).bind(carrying_pct)
    .bind(total_cost).bind(total_units).bind(unit_cost).bind(cost_pct)
    .bind(actual_hrs).bind(standard_hrs).bind(labor_rate)
    .bind(penalty).bind(serve)
    .bind(&now).bind(&now)
    .execute(pool).await.ok();
}

pub async fn carrying_cost(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let carrying_rate: f64 = sqlx::query_scalar("SELECT COALESCE(carrying_cost_rate, 20.0) FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or(20.0) / 100.0;

    let rows = sqlx::query(
         r#"SELECT m.id, m.name, m.sku, m.quantity, m.price,
          COALESCE((SELECT SUM(ABS(soi.difference)) FROM stock_opname_items soi WHERE soi.material_id=m.id),0) as variance_qty,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t."type"='out' AND t.created_at::timestamp >= NOW() - INTERVAL '30 days'),0) as monthly_out
          FROM materials m WHERE m.is_active=true ORDER BY (m.quantity * m.price) DESC"#
    ).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    let mut results = Vec::new();
    let mut total_inv_value = 0.0_f64;
    for row in &rows {
        let qty: f64 = row.get("quantity");
        let price: f64 = row.get("price");
        total_inv_value += qty * price;
    }

    let storage_cost_monthly: f64 = sqlx::query_scalar("SELECT COALESCE(storage_cost_monthly, 500000) FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or(500000.0);

    for row in &rows {
        let id: String = row.get("id");
        let name: String = row.get("name");
        let sku: String = row.get("sku");
        let qty: f64 = row.get("quantity");
        let price: f64 = row.get("price");
        let variance_qty: f64 = row.get("variance_qty");
        let monthly_out: f64 = row.get("monthly_out");

        let inv_value = qty * price;
        let carrying = inv_value * carrying_rate;
        let shrinkage_loss = variance_qty * price;
        let storage_alloc = if total_inv_value > 0.0 { (inv_value / total_inv_value) * storage_cost_monthly } else { 0.0 };
        let total_carrying = carrying + shrinkage_loss + storage_alloc;
        let true_unit = if monthly_out > 0.0 { price + total_carrying / monthly_out.max(1.0) } else { price };

        let period = chrono::Local::now().format("%Y-%m").to_string();
        persist_cost_metrics(
            &pool.pool, &id, "", "monthly", &format!("{}-01", period), &period,
            price, storage_alloc, 0.0, shrinkage_loss,
            carrying_rate * 100.0, carrying, carrying / inv_value.max(1.0) * 100.0,
            price + total_carrying, qty, true_unit, inv_value / total_inv_value.max(1.0) * 100.0,
            None, None, None, None, None
        ).await;

        results.push(json!({
            "material_id": id, "material_name": name, "sku": sku,
            "quantity": qty, "price": price,
            "inventory_value": (inv_value * 100.0).round() / 100.0,
            "carrying_cost": (carrying * 100.0).round() / 100.0,
            "shrinkage_cost": (shrinkage_loss * 100.0).round() / 100.0,
            "storage_cost": (storage_alloc * 100.0).round() / 100.0,
            "total_carrying_cost": (total_carrying * 100.0).round() / 100.0,
            "carrying_cost_rate": (carrying_rate * 100.0 * 100.0).round() / 100.0,
            "true_unit_cost": (true_unit * 100.0).round() / 100.0,
        }));
    }
    Ok(Json(json!({"carrying_cost_rate": (carrying_rate * 100.0 * 100.0).round() / 100.0, "items": results})))
}

pub async fn cost_to_serve(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let rows = sqlx::query(
        r#"SELECT t.id, t.transaction_number, t."type", t.quantity, t.price,
         m.name as material_name, m.sku, m.id as material_id,
         (EXTRACT(EPOCH FROM (NULLIF(t.updated_at, '')::timestamp - t.created_at::timestamp)) / 60)::double precision as processing_minutes
         FROM transactions t JOIN materials m ON t.material_id=m.id
         WHERE t.status='approved' AND t.created_at::timestamp >= NOW() - INTERVAL '90 days'
         ORDER BY t.created_at DESC LIMIT 100"#
    ).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    let mut total_all_cost = 0.0_f64;
    let mut cost_items = Vec::new();
    for row in &rows {
        let tx_id: String = row.get("id");
        let tx_num: String = row.get("transaction_number");
        let tx_type: String = row.get("type");
        let qty: f64 = row.get("quantity");
        let price: f64 = row.get("price");
        let mat_name: String = row.get("material_name");
        let mat_sku: String = row.get("sku");
        let mat_id: String = row.get("material_id");
        let proc_mins: f64 = row.get::<Option<f64>,_>("processing_minutes").unwrap_or(1.0).max(1.0);

        let hourly_rate = sqlx::query_scalar("SELECT COALESCE(hourly_labor_rate, 5000) FROM company_profile LIMIT 1")
            .fetch_one(&pool.pool).await.unwrap_or(5000.0);
        let labor_rate_per_min = hourly_rate / 60.0;
        let picking_cost = proc_mins * labor_rate_per_min * qty.max(1.0);
        let packing_cost = picking_cost * 0.3;
        let admin_cost = 2000.0;
        let total_cost = picking_cost + packing_cost + admin_cost;
        let order_margin = (qty * price) - total_cost;
        let is_profitable = order_margin > 0.0;
        total_all_cost += total_cost;

        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let cpo_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO cost_per_order (id, transaction_id, material_id, \
             picking_cost, packing_cost, shipping_cost, admin_cost, \
             total_cost, order_margin, is_profitable, created_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) \
             ON CONFLICT(id) DO NOTHING"
        )
        .bind(&cpo_id).bind(&tx_id).bind(&mat_id)
        .bind(picking_cost).bind(packing_cost).bind(0.0).bind(admin_cost)
        .bind(total_cost).bind(order_margin).bind(is_profitable)
        .bind(&now)
        .execute(&pool.pool).await.ok();

        cost_items.push(json!({
            "transaction_id": tx_id, "transaction_number": tx_num, "type": tx_type,
            "material_name": mat_name, "sku": mat_sku,
            "picking_cost": (picking_cost * 100.0).round() / 100.0,
            "packing_cost": (packing_cost * 100.0).round() / 100.0,
            "admin_cost": admin_cost,
            "total_cost": (total_cost * 100.0).round() / 100.0,
            "order_margin": (order_margin * 100.0).round() / 100.0,
            "is_profitable": is_profitable,
        }));
    }
    let profitable_count = cost_items.iter().filter(|i| i["is_profitable"].as_bool().unwrap_or(false)).count();
    let total_items = cost_items.len();
    Ok(Json(json!({
        "total_orders_analyzed": total_items,
        "profitable_count": profitable_count,
        "unprofitable_count": total_items - profitable_count,
        "profitability_rate": if total_items > 0 { ((profitable_count as f64 / total_items as f64) * 100.0 * 100.0).round() / 100.0 } else { 0.0 },
        "total_cost_all": (total_all_cost * 100.0).round() / 100.0,
        "items": cost_items
    })))
}

pub async fn efficiency_penalty(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let rows = sqlx::query(
        r#"SELECT t."type", COUNT(*) as tx_count,
         COALESCE((AVG(EXTRACT(EPOCH FROM (NULLIF(t.updated_at, '')::timestamp - t.created_at::timestamp)) / 60))::double precision, 1) as avg_minutes
         FROM transactions t WHERE t.status='approved' AND t.created_at::timestamp >= NOW() - INTERVAL '30 days'
         GROUP BY t."type""#
    ).fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    let hourly_rate: f64 = sqlx::query_scalar("SELECT COALESCE(hourly_labor_rate, 5000) FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or(5000.0);

    let standard_times: std::collections::HashMap<&str, f64> = [
        ("in", 10.0), ("out", 15.0), ("transfer", 20.0), ("adjustment", 5.0),
    ].iter().cloned().collect();

    let mut results = Vec::new();
    let mut total_penalty = 0.0_f64;

    for row in &rows {
        let tx_type: String = row.get("type");
        let count: i64 = row.get("tx_count");
        let avg_min: f64 = row.get::<Option<f64>,_>("avg_minutes").unwrap_or(1.0);
        let standard = standard_times.get(tx_type.as_str()).copied().unwrap_or(10.0);
        let diff = avg_min - standard;
        let penalty_per_tx = if diff > 0.0 { diff * (hourly_rate / 60.0) } else { 0.0 };
        let total_penalty_type = penalty_per_tx * count as f64;
        total_penalty += total_penalty_type;

        results.push(json!({
            "transaction_type": tx_type, "count": count,
            "avg_actual_minutes": (avg_min * 100.0).round() / 100.0,
            "standard_minutes": standard,
            "variance_minutes": (diff * 100.0).round() / 100.0,
            "penalty_per_tx": (penalty_per_tx * 100.0).round() / 100.0,
            "total_penalty": (total_penalty_type * 100.0).round() / 100.0,
        }));
    }

    Ok(Json(json!({
        "hourly_labor_rate": hourly_rate,
        "total_efficiency_penalty": (total_penalty * 100.0).round() / 100.0,
        "details": results
    })))
}

pub async fn cost_summary(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let total_inv: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity*price),0) FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await.unwrap_or(0.0);
    let total_qty: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity),0) FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await.unwrap_or(0.0);
    let material_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await.unwrap_or(0);
    let tx_30d: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions WHERE status NOT IN ('voided','reversed') AND created_at::timestamp >= NOW() - INTERVAL '30 days'")
        .fetch_one(&pool.pool).await.unwrap_or(0);
    let carrying_rate: f64 = sqlx::query_scalar("SELECT COALESCE(carrying_cost_rate, 20.0) FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or(20.0);
    let estimated_carrying = total_inv * (carrying_rate / 100.0);

    let avg_purchase: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(price),0) FROM transactions WHERE type='in' AND status='approved' AND created_at::timestamp >= NOW() - INTERVAL '90 days'"
    ).fetch_one(&pool.pool).await.unwrap_or(0.0);

    let avg_value = if material_count > 0 { (total_inv / material_count as f64) * 100.0 / 100.0 } else { 0.0 };

    // Persist summary to cost_metrics with material_id="__summary__"
    let period = chrono::Local::now().format("%Y-%m").to_string();
    persist_cost_metrics(
        &pool.pool, "__summary__", "", "monthly", &format!("{}-01", period), &period,
        avg_purchase, 0.0, 0.0, 0.0,
        carrying_rate, estimated_carrying, carrying_rate,
        total_inv, total_qty, avg_value, 100.0,
        None, None, None, None, None
    ).await;

    // Trend tracking
    let yesterday = (chrono::Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
    let last_week = (chrono::Local::now() - chrono::Duration::days(7)).format("%Y-%m-%d").to_string();
    let yesterday_cost: f64 = sqlx::query_scalar(
        "SELECT COALESCE(total_cost,0) FROM cost_metrics WHERE material_id='__summary__' AND period_start=$1 ORDER BY updated_at DESC LIMIT 1"
    ).bind(&yesterday).fetch_one(&pool.pool).await.unwrap_or(0.0);
    let avg_7_cost: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(total_cost),0) FROM cost_metrics WHERE material_id='__summary__' AND period_start>=$1"
    ).bind(&last_week).fetch_one(&pool.pool).await.unwrap_or(0.0);
    let cost_trend = if (total_inv * 100.0).round() > (yesterday_cost * 100.0).round() { "▲" }
        else if (total_inv * 100.0).round() < (yesterday_cost * 100.0).round() { "▼" } else { "→" };

    Ok(Json(json!({
        "total_inventory_value": (total_inv * 100.0).round() / 100.0,
        "total_quantity": total_qty,
        "material_count": material_count,
        "transactions_30d": tx_30d,
        "carrying_cost_rate": carrying_rate,
        "estimated_annual_carrying_cost": (estimated_carrying * 100.0).round() / 100.0,
        "avg_purchase_price_90d": (avg_purchase * 100.0).round() / 100.0,
        "avg_value_per_material": (avg_value * 100.0).round() / 100.0,
        "cost_trend": cost_trend,
        "yesterday_total_cost": (yesterday_cost * 100.0).round() / 100.0,
        "avg_7days_total_cost": (avg_7_cost * 100.0).round() / 100.0,
    })))
}
