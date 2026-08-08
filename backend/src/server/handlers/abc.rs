use std::sync::Arc;
use axum::{Json, extract::{State, Query}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbcQuery {
    pub mode: Option<String>,
    pub warehouse_id: Option<String>,
}

async fn persist_abc_classification(
    pool: &sqlx::PgPool,
    material_id: &str, warehouse_id: &str,
    mode: &str, abc: &str, xyz: &str,
    composite: f64, value_score: f64, freq_score: f64, crit_score: f64,
    value_pct: f64, consumption: f64, turnover: f64,
    qty: f64, price: f64, inv_value: f64,
    prev_class: &str,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let period = chrono::Local::now().format("%Y-%m-%d").to_string();

    let days_since: i32 = if prev_class.is_empty() || prev_class == abc { 0 } else {
        let last_change = sqlx::query_scalar::<_, Option<String>>(
            "SELECT MAX(period) FROM abc_classification WHERE material_id=$1 AND abc_class!=$2"
        ).bind(material_id).bind(abc).fetch_one(pool).await.unwrap_or(None);
        match last_change {
            Some(d) => {
                chrono::NaiveDate::parse_from_str(&period, "%Y-%m-%d").ok()
                    .zip(chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok())
                    .map(|(cur, prev)| (cur - prev).num_days() as i32)
                    .unwrap_or(0)
            }
            None => 0,
        }
    };

    sqlx::query(
        "INSERT INTO abc_classification (id, material_id, warehouse_id, period, analysis_mode, \
         abc_class, xyz_class, composite_score, value_score, frequency_score, criticality_score, \
         value_contribution_pct, consumption_12mo, turnover, current_qty, unit_price, inventory_value, \
         previous_class, days_since_class_change, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) \
         ON CONFLICT (material_id, warehouse_id, analysis_mode, period) DO UPDATE SET \
         abc_class=EXCLUDED.abc_class, xyz_class=EXCLUDED.xyz_class, \
         composite_score=EXCLUDED.composite_score, value_score=EXCLUDED.value_score, \
         frequency_score=EXCLUDED.frequency_score, criticality_score=EXCLUDED.criticality_score, \
         value_contribution_pct=EXCLUDED.value_contribution_pct, \
         consumption_12mo=EXCLUDED.consumption_12mo, turnover=EXCLUDED.turnover, \
         current_qty=EXCLUDED.current_qty, unit_price=EXCLUDED.unit_price, \
         inventory_value=EXCLUDED.inventory_value, previous_class=EXCLUDED.previous_class, \
         days_since_class_change=EXCLUDED.days_since_class_change, updated_at=EXCLUDED.updated_at"
    )
    .bind(&id).bind(material_id).bind(warehouse_id).bind(&period).bind(mode)
    .bind(abc).bind(xyz)
    .bind(composite).bind(value_score).bind(freq_score).bind(crit_score)
    .bind(value_pct).bind(consumption).bind(turnover)
    .bind(qty).bind(price).bind(inv_value)
    .bind(prev_class).bind(days_since)
    .bind(&now).bind(&now)
    .execute(pool).await.unwrap_or_else(|e| { log::warn!("persist_abc_classification failed: {}", e); Default::default() });
}

pub async fn abc_classify(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<AbcQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let mode = q.mode.as_deref().unwrap_or("single");
    let wh = q.warehouse_id.as_deref().unwrap_or("");
    let scope = validate::warehouse_scope(&pool.pool, &user_id).await.map_err(|e| crate::server::server_error(e))?;

    let mut b = sqlx::QueryBuilder::new(
        "SELECT m.id, m.name, m.sku, m.quantity, m.price, m.min_stock, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '90 days'),0) as consumption_3mo, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '180 days'),0) as consumption_6mo, \
         COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at::timestamp >= NOW() - INTERVAL '365 days'),0) as consumption_12mo, \
         COALESCE((SELECT t.quantity FROM transactions t WHERE t.material_id=m.id AND t.type='out' ORDER BY t.created_at DESC LIMIT 1),0) as turnover, \
         (SELECT MAX(created_at) FROM transactions WHERE material_id=m.id) as last_transaction \
         FROM materials m WHERE m.is_active=true"
    );
    scope.apply_builder(&mut b, "m.warehouse_id", q.warehouse_id.as_deref());
    b.push(" ORDER BY consumption_12mo DESC");
    let rows = b.build().fetch_all(&pool.pool).await
     .map_err(|e| crate::server::server_error(e))?;

    let weights = if mode == "multi" {
        let wrows = sqlx::query("SELECT key, value FROM abc_weights")
            .fetch_all(&pool.pool).await.unwrap_or_default();
        let mut wv = 0.4; let mut wf = 0.3; let mut wc = 0.3;
        for w in &wrows {
            match w.get::<String,_>("key").as_str() {
                "value_w" => wv = w.get("value"),
                "turnover_w" => wf = w.get("value"),
                "recency_w" => wc = w.get("value"),
                _ => {}
            }
        }
        (wv, wf, wc)
    } else { (1.0, 0.0, 0.0) };
    let sum_w = weights.0 + weights.1 + weights.2;
    let (wv, wf, wc) = if sum_w > 0.0 { (weights.0/sum_w, weights.1/sum_w, weights.2/sum_w) } else { weights };

    let total: f64 = rows.iter().map(|r| r.get::<f64,_>("consumption_12mo")).sum();
    let max_consumption = rows.iter().map(|r| r.get::<f64,_>("consumption_12mo")).fold(0.0_f64, f64::max).max(1.0);
    let max_turnover = rows.iter().map(|r| r.get::<f64,_>("turnover")).fold(0.0_f64, f64::max).max(1.0);

    let mut scored: Vec<(serde_json::Value, String)> = Vec::new();
    let mut cumulative = 0.0;

    for row in &rows {
        let id: String = row.get("id");
        let qty: f64 = row.get("quantity");
        let price: f64 = row.get("price");
        let consumption: f64 = row.get("consumption_12mo");
        let _c3: f64 = row.get("consumption_3mo");
        let _c6: f64 = row.get("consumption_6mo");
        let turnover: f64 = row.get("turnover");
        let last_tx: Option<String> = row.get("last_transaction");
        let days_since = last_tx.as_ref().and_then(|d| {
            chrono::NaiveDateTime::parse_from_str(d, "%Y-%m-%d %H:%M:%S").ok()
                .map(|dt| (chrono::Local::now().naive_local() - dt).num_days() as f64)
        }).unwrap_or(999.0);

        let inv_value = qty * price;
        let value_pct = if total > 0.0 { consumption / total * 100.0 } else { 0.0 };

        let consumption_norm = consumption / max_consumption;
        let turnover_norm = turnover / max_turnover;
        let recency_norm = 1.0 / (days_since + 1.0);

        let composite = consumption_norm * wv + turnover_norm * wf + recency_norm * wc;
        let abc = if mode == "single" {
            cumulative += value_pct;
            if cumulative <= 80.0 { "A" } else if cumulative <= 95.0 { "B" } else { "C" }
        } else {
            if composite >= 0.05 { "A" } else if composite >= 0.015 { "B" } else { "C" }
        };

        let monthly_rows = sqlx::query(
            "SELECT COALESCE(SUM(quantity),0) as cons FROM transactions \
             WHERE material_id=$1 AND type='out' AND status NOT IN ('voided','reversed') \
             AND created_at::timestamp >= NOW() - INTERVAL '12 months' \
             GROUP BY DATE_TRUNC('month', created_at::timestamp) ORDER BY DATE_TRUNC('month', created_at::timestamp)"
        ).bind(&id).fetch_all(&pool.pool).await.unwrap_or_default();
        let monthly_cons: Vec<f64> = monthly_rows.iter().map(|r| r.get("cons")).collect();
        let n = monthly_cons.len() as f64;
        let cv = if n > 1.0 {
            let sum: f64 = monthly_cons.iter().sum();
            let mean = sum / n;
            if mean > 0.0 {
                let variance = monthly_cons.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n;
                variance.sqrt() / mean
            } else { 999.0 }
        } else { 999.0 };
        let xyz = if cv < 0.5 { "X" } else if cv < 1.0 { "Y" } else { "Z" };

        let item_name: String = row.get("name");
        let item_sku: String = row.get("sku");

        scored.push((json!({
            "material_id": id, "material_name": item_name, "sku": item_sku,
            "current_qty": qty, "unit_price": price, "inventory_value": inv_value,
            "consumption_12mo": consumption, "turnover": turnover,
            "abc_class": abc, "xyz_class": xyz,
            "composite_score": (composite * 1000.0).round() / 1000.0,
            "value_contribution_pct": (value_pct * 100.0).round() / 100.0,
            "days_since_last_tx": days_since as i64,
        }), abc.to_string()));

        persist_abc_classification(
            &pool.pool, &id, wh, mode, abc, xyz,
            composite, consumption_norm, turnover_norm, recency_norm,
            value_pct, consumption, turnover, qty, price, inv_value, "",
        ).await;

        // Propagate abc_class and xyz_class to material_metrics
        sqlx::query(
            "UPDATE material_metrics SET abc_class=$1, abc_score=$2 WHERE material_id=$3 AND period_start=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')"
        ).bind(abc).bind(composite).bind(&id).execute(&pool.pool).await.unwrap_or_else(|e| { log::warn!("abc_classify update material_metrics failed: {}", e); Default::default() });
    }

    let mut class_a = Vec::new();
    let mut class_b = Vec::new();
    let mut class_c = Vec::new();
    for (item, cls) in scored {
        match cls.as_str() {
            "A" => class_a.push(item),
            "B" => class_b.push(item),
            _ => class_c.push(item),
        }
    }

    Ok(Json(json!({
        "class_a": class_a, "class_b": class_b, "class_c": class_c,
        "mode": mode, "total_materials": rows.len(),
        "weights": {"value_w": wv, "turnover_w": wf, "recency_w": wc},
    })))
}

pub async fn abc_summary(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "view_dashboard").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let period = chrono::Local::now().format("%Y-%m-%d").to_string();
    let scope = validate::warehouse_scope(&pool.pool, &user_id).await.map_err(|e| crate::server::server_error(e))?;
    let mut b = sqlx::QueryBuilder::new(
        "SELECT abc_class, COUNT(*) as cnt FROM abc_classification WHERE period=$1"
    );
    b.push_bind(&period);
    scope.apply_builder(&mut b, "abc_classification.warehouse_id", None);
    b.push(" GROUP BY abc_class");
    let counts = b.build().fetch_all(&pool.pool).await.unwrap_or_default();
    let mut a = 0i64; let mut b = 0i64; let mut c = 0i64;
    for row in &counts {
        match row.get::<String,_>("abc_class").as_str() {
            "A" => a = row.get("cnt"),
            "B" => b = row.get("cnt"),
            _ => c = row.get("cnt"),
        }
    }
    Ok(Json(json!({"class_a_count": a, "class_b_count": b, "class_c_count": c, "total_classified": a + b + c})))
}
