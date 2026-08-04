use std::sync::Arc;
use axum::{Json, extract::{State, Query, Extension}};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use crate::db_pool::DbPool;

#[derive(Deserialize)]
pub struct RangeQuery {
    #[serde(default)]
    pub days: i64,
}

// Summary: task counts by status + total discrepancy + average accuracy
pub async fn cycle_summary(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let by_status: Vec<(String, i64)> = sqlx::query("SELECT status, COUNT(*) FROM stock_opname GROUP BY status")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .iter().map(|r| (r.get(0), r.get(1))).collect();
    let mut status_map = serde_json::Map::new();
    for (s, c) in by_status { status_map.insert(s, json!(c)); }
    let total_tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stock_opname").fetch_one(&pool.pool).await.unwrap_or(0);
    let open_tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stock_opname WHERE status IN ('open','in_progress','pending_review')").fetch_one(&pool.pool).await.unwrap_or(0);
    let total_diff: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(ABS(difference)),0) FROM stock_opname_items i JOIN stock_opname o ON o.id=i.opname_id WHERE o.status IN ('completed','pending_review')").fetch_one(&pool.pool).await.unwrap_or(0.0);
    let avg_acc: f64 = sqlx::query_scalar("SELECT COALESCE(AVG(accuracy_pct),0) FROM material_metrics WHERE accuracy_pct > 0").fetch_one(&pool.pool).await.unwrap_or(0.0);
    Ok(Json(json!({"totalTasks": total_tasks, "openTasks": open_tasks, "byStatus": status_map, "totalDiscrepancy": total_diff, "avgAccuracy": avg_acc})))
}

// Accuracy time-series: last N days from material_metrics updates (fallback cycle_count_history)
pub async fn cycle_accuracy(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<RangeQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let days = if q.days > 0 { q.days } else { 30 };
    let rows = sqlx::query("SELECT to_char(updated_at::timestamp::date, 'YYYY-MM-DD') AS day, ROUND(AVG(accuracy_pct)::numeric,1)::float8 AS acc, COUNT(*) AS n FROM material_metrics WHERE accuracy_pct > 0 AND updated_at::timestamp >= NOW() - ($1 || ' days')::interval GROUP BY day ORDER BY day")
        .bind(days.to_string())
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|r| {
        json!({"date": r.get::<String,_>("day"), "accuracy": r.get::<f64,_>("acc"), "count": r.get::<i64,_>("n")})
    }).collect::<Vec<_>>())))
}

// Discrepancy by staff (reviewer/changed_by of approvals)
pub async fn cycle_by_staff(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT h.changed_by, u.full_name, COUNT(*) AS actions, COALESCE(SUM(ABS(h.after_qty - h.before_qty)),0) AS total_diff FROM cycle_count_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.action='approve' GROUP BY h.changed_by, u.full_name ORDER BY total_diff DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|r| {
        json!({"user_id": r.get::<String,_>("changed_by"), "name": r.get::<Option<String>,_>("name"),
            "actions": r.get::<i64,_>("actions"), "total_diff": r.get::<f64,_>("total_diff")})
    }).collect::<Vec<_>>())))
}

// Discrepancy by location (rack of material)
pub async fn cycle_by_location(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT COALESCE(r.rack_name, 'No Rack') AS location, COUNT(*) AS items, COALESCE(SUM(ABS(i.difference)),0) AS total_diff FROM stock_opname_items i JOIN stock_opname o ON o.id=i.opname_id LEFT JOIN materials m ON m.id=i.material_id LEFT JOIN racks r ON r.id=m.rack_id WHERE o.status IN ('completed','pending_review') GROUP BY location ORDER BY total_diff DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|r| {
        json!({"location": r.get::<String,_>("location"), "items": r.get::<i64,_>("items"),
            "total_diff": r.get::<f64,_>("total_diff")})
    }).collect::<Vec<_>>())))
}

// XLSX export of all cycle count results
pub async fn export_cycle_xlsx(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !crate::validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let rows = sqlx::query("SELECT o.opname_number, o.status, o.cycle_mode, m.sku, m.name, COALESCE(r.rack_name,'') AS rack, i.system_qty, i.physical_qty, i.difference, i.approved_status, i.remark, o.created_at FROM stock_opname_items i JOIN stock_opname o ON o.id=i.opname_id LEFT JOIN materials m ON m.id=i.material_id LEFT JOIN racks r ON r.id=m.rack_id ORDER BY o.created_at DESC, m.sku")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let b64 = tokio::task::spawn_blocking(move || -> Result<String, String> {
        use rust_xlsxwriter::*;
        let mut wb = Workbook::new();
        let sh = wb.add_worksheet(); sh.set_name("Cycle Count").map_err(|e| e.to_string())?;
        let hdr = Format::new().set_bold().set_border(FormatBorder::Thin).set_background_color("CCCCCC");
        let cf = Format::new().set_border(FormatBorder::Thin);
        let headers = ["Opname", "Status", "Mode", "SKU", "Material", "Rack", "System", "Physical", "Diff", "Approved", "Remark", "Date"];
        for (ci, h) in headers.iter().enumerate() {
            sh.write_string_with_format(0, ci as u16, *h, &hdr).map_err(|e| e.to_string())?;
        }
        for (i, r) in rows.iter().enumerate() {
            let ri = (i + 1) as u32;
            sh.write_string_with_format(ri, 0, r.get::<String, _>(0), &cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri, 1, r.get::<String, _>(1), &cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri, 2, r.get::<String, _>(2), &cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri, 3, r.get::<String, _>(3), &cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri, 4, r.get::<String, _>(4), &cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri, 5, r.get::<String, _>(5), &cf).map_err(|e| e.to_string())?;
            sh.write_number_with_format(ri, 6, r.get::<f64, _>(6), &cf).map_err(|e| e.to_string())?;
            sh.write_number_with_format(ri, 7, r.get::<f64, _>(7), &cf).map_err(|e| e.to_string())?;
            sh.write_number_with_format(ri, 8, r.get::<f64, _>(8), &cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri, 9, r.get::<String, _>(9), &cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri, 10, r.get::<String, _>(10), &cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri, 11, r.get::<String, _>(11), &cf).map_err(|e| e.to_string())?;
        }
        for (ci, w) in [14u16, 10, 9, 14, 28, 12, 9, 10, 9, 10, 24, 19].iter().enumerate() {
            sh.set_column_width(ci as u16, *w).map_err(|e| e.to_string())?;
        }
        let bytes = wb.save_to_buffer().map_err(|e| e.to_string())?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes))
    }).await.map_err(|e| crate::server::server_error(e))?
    .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(b64)))
}
