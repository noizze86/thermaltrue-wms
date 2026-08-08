use std::sync::Arc;
use axum::{Json, extract::State, Extension};
use serde_json::json;
use sqlx::Row;
use crate::db_pool::DbPool;
use crate::validate;

pub async fn nightly_recalc(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !crate::validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await
        .map_err(|e| crate::server::server_error(e))?
    {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"}))));
    }
    let scope = validate::warehouse_scope(&pool.pool, &user_id).await.map_err(|e| crate::server::server_error(e))?;
    if !scope.is_all() {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Warehouse access denied"}))));
    }

    let rows = sqlx::query("SELECT out_material_id, out_warehouse_id, out_action, out_detail FROM batch_nightly_recalc()")
        .fetch_all(&pool.pool)
        .await
        .map_err(|e| crate::server::server_error(e))?;

    let mut results = Vec::new();
    for row in &rows {
        results.push(json!({
            "material_id": row.get::<String, _>("out_material_id"),
            "warehouse_id": row.get::<String, _>("out_warehouse_id"),
            "action": row.get::<String, _>("out_action"),
            "detail": row.get::<String, _>("out_detail"),
        }));
    }

    Ok(Json(json!({
        "success": true,
        "processed": results.len(),
        "results": results
    })))
}

pub async fn dashboard_refresh(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !crate::validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await
        .map_err(|e| crate::server::server_error(e))?
    {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"}))));
    }
    let scope = validate::warehouse_scope(&pool.pool, &user_id).await.map_err(|e| crate::server::server_error(e))?;
    if !scope.is_all() {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Warehouse access denied"}))));
    }

    let rows = sqlx::query("SELECT out_action, out_detail FROM batch_dashboard_refresh()")
        .fetch_all(&pool.pool)
        .await
        .map_err(|e| crate::server::server_error(e))?;

    let mut results = Vec::new();
    for row in &rows {
        results.push(json!({
            "action": row.get::<String, _>("out_action"),
            "detail": row.get::<String, _>("out_detail"),
        }));
    }

    Ok(Json(json!({
        "success": true,
        "processed": results.len(),
        "results": results
    })))
}
