use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::{Budget, AbcWeight, ForecastCache, LoginHistoryEntry};
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBudgetBody { pub id: String, pub category_id: String, pub period: String, pub amount: f64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAbcWeightBody { pub key: String, pub value: f64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastCacheQuery { pub material_id: Option<String>, pub model: Option<String>, pub horizon: Option<i64> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetForecastCacheBody { pub material_id: String, pub model: String, pub params: String, pub result: String, pub horizon: i64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteForecastCacheQuery { pub material_id: String, pub model: String }

#[derive(Deserialize)]
pub struct LoginHistoryQuery { pub limit: Option<i64> }

#[derive(Deserialize)]
pub struct GenerateQrZipBody { pub items: Vec<String> }

// ── Budgets ──

pub async fn get_budgets(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<Budget>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, category_id, period, amount, created_at, updated_at FROM budgets ORDER BY period DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| Budget {
        id: row.get(0), category_id: row.get(1), period: row.get(2),
        amount: row.get(3), created_at: row.get(4), updated_at: row.get(5),
    }).collect();
    Ok(Json(list))
}

pub async fn save_budget(
    State(pool): State<Arc<DbPool>>,
    Extension(_user_id): Extension<String>,
    Json(body): Json<SaveBudgetBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO budgets (id, category_id, period, amount, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT(id) DO UPDATE SET category_id=$2, period=$3, amount=$4, updated_at=$5"
    )
    .bind(&body.id).bind(&body.category_id).bind(&body.period).bind(body.amount).bind(&now)
    .execute(&pool.pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn delete_budget(
    State(pool): State<Arc<DbPool>>,
    Extension(_user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    sqlx::query("DELETE FROM budgets WHERE id=$1").bind(&id).execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// ── ABC Weights ──

pub async fn get_abc_weights(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<AbcWeight>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT key, value FROM abc_weights")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| AbcWeight { key: row.get(0), value: row.get(1) }).collect();
    Ok(Json(list))
}

pub async fn set_abc_weight(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SetAbcWeightBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("INSERT INTO abc_weights (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=$2")
        .bind(&body.key).bind(body.value)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// ── Forecast Cache ──

pub async fn get_forecast_cache(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ForecastCacheQuery>,
) -> Result<Json<Option<ForecastCache>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let material_id = params.material_id.unwrap_or_default();
    let model = params.model.unwrap_or_default();
    let horizon = params.horizon.unwrap_or(30);
    let row = sqlx::query(
        "SELECT id, material_id, model, params, result, horizon, created_at FROM forecast_cache WHERE material_id=$1 AND model=$2 AND horizon=$3 ORDER BY created_at DESC LIMIT 1"
    )
    .bind(&material_id).bind(&model).bind(horizon)
    .fetch_optional(&pool.pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    match row {
        Some(r) => Ok(Json(Some(ForecastCache {
            id: r.get(0), material_id: r.get(1), model: r.get(2),
            params: r.get(3), result: r.get(4), horizon: r.get(5), created_at: r.get(6),
        }))),
        None => Ok(Json(None)),
    }
}

pub async fn set_forecast_cache(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SetForecastCacheBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO forecast_cache (id, material_id, model, params, result, horizon, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(&id).bind(&body.material_id).bind(&body.model).bind(&body.params).bind(&body.result).bind(body.horizon).bind(&now)
    .execute(&pool.pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn delete_forecast_cache(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<DeleteForecastCacheQuery>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("DELETE FROM forecast_cache WHERE material_id=$1 AND model=$2")
        .bind(&params.material_id).bind(&params.model)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// ── Login History ──

pub async fn get_login_history(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<LoginHistoryQuery>,
) -> Result<Json<Vec<LoginHistoryEntry>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let limit = params.limit.unwrap_or(50);
    let rows = sqlx::query("SELECT id, user_id, username, ip_address, status, created_at FROM login_history ORDER BY created_at DESC LIMIT $1")
        .bind(limit)
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| LoginHistoryEntry {
        id: row.get(0), user_id: row.get(1), username: row.get(2),
        ip_address: row.get(3), status: row.get(4), created_at: row.get(5),
    }).collect();
    Ok(Json(list))
}

pub async fn get_user_login_history(
    State(pool): State<Arc<DbPool>>,
    Path(user_id): Path<String>,
    Query(params): Query<LoginHistoryQuery>,
) -> Result<Json<Vec<LoginHistoryEntry>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let limit = params.limit.unwrap_or(50);
    let rows = sqlx::query("SELECT id, user_id, username, ip_address, status, created_at FROM login_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2")
        .bind(&user_id).bind(limit)
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| LoginHistoryEntry {
        id: row.get(0), user_id: row.get(1), username: row.get(2),
        ip_address: row.get(3), status: row.get(4), created_at: row.get(5),
    }).collect();
    Ok(Json(list))
}

pub async fn clear_login_history(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("DELETE FROM login_history")
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// ── Batch QR ZIP ──

pub async fn generate_qr_zip(
    State(_pool): State<Arc<DbPool>>,
    Json(body): Json<GenerateQrZipBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let result = tokio::task::spawn_blocking(move || {
        use qrcode::QrCode;
        use image::Luma;
        use zip::write::SimpleFileOptions;
        use std::io::{Cursor, Write};

        let mut buf = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut zip = zip::ZipWriter::new(cursor);

            for (i, data) in body.items.iter().enumerate() {
                let code = QrCode::new(data.as_bytes()).map_err(|e| format!("QR gen: {}", e))?;
                let img = code.render::<Luma<u8>>().build();
                let mut png_buf = Cursor::new(Vec::new());
                img.write_to(&mut png_buf, image::ImageFormat::Png).map_err(|e| format!("PNG write: {}", e))?;
                let filename = format!("qr_{}.png", i + 1);
                zip.start_file(&filename, SimpleFileOptions::default()).map_err(|e| format!("zip start: {}", e))?;
                zip.write_all(png_buf.get_ref()).map_err(|e| format!("zip write: {}", e))?;
            }

            zip.finish().map_err(|e| format!("zip finish: {}", e))?;
        }

        Ok::<_, String>(buf)
    }).await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("spawn_blocking: {}", e)}))))?
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))))?;

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result);
    Ok(Json(json!({"zipBase64": format!("data:application/zip;base64,{}", b64)})))
}
