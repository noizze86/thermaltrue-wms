use tauri::State;
use crate::db_pool::DbPool;
use crate::models::{Budget, AbcWeight, ForecastCache, LoginHistoryEntry};
use crate::error::AppError;
use crate::validate;
use sqlx::Row;

// ── Budgets ──

#[tauri::command]
pub async fn get_budgets(pool: State<'_, DbPool>, token: String) -> Result<Vec<Budget>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, category_id, period, amount, created_at, updated_at FROM budgets ORDER BY period DESC")
        .fetch_all(&pool.pool)
        .await?;
    let items = rows.iter().map(|row| Budget {
        id: row.get(0),
        category_id: row.get(1),
        period: row.get(2),
        amount: row.get(3),
        created_at: row.get(4),
        updated_at: row.get(5),
    }).collect();
    Ok(items)
}

#[tauri::command]
pub async fn save_budget(pool: State<'_, DbPool>, token: String, id: String, category_id: String, period: String, amount: f64) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO budgets (id, category_id, period, amount, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT(id) DO UPDATE SET category_id=$2, period=$3, amount=$4, updated_at=$5"
    )
    .bind(&id).bind(&category_id).bind(&period).bind(amount).bind(&now)
    .execute(&pool.pool).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_budget(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM budgets WHERE id=$1")
        .bind(&id)
        .execute(&pool.pool).await?;
    Ok(())
}

// ── ABC Weights ──

#[tauri::command]
pub async fn get_abc_weights(pool: State<'_, DbPool>, token: String) -> Result<Vec<AbcWeight>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT key, value FROM abc_weights")
        .fetch_all(&pool.pool).await?;
    let items = rows.iter().map(|row| AbcWeight {
        key: row.get(0),
        value: row.get(1),
    }).collect();
    Ok(items)
}

#[tauri::command]
pub async fn set_abc_weight(pool: State<'_, DbPool>, token: String, key: String, value: f64) -> Result<(), AppError> {
    pool.verify_token(&token)?;
    sqlx::query("INSERT INTO abc_weights (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=$2")
        .bind(&key).bind(value)
        .execute(&pool.pool).await?;
    Ok(())
}

// ── Forecast Cache ──

#[tauri::command]
pub async fn get_forecast_cache(pool: State<'_, DbPool>, token: String, material_id: String, model: String, horizon: i64) -> Result<Option<ForecastCache>, AppError> {
    pool.verify_token(&token)?;
    let row = sqlx::query(
        "SELECT id, material_id, model, params, result, horizon, created_at FROM forecast_cache WHERE material_id=$1 AND model=$2 AND horizon=$3 ORDER BY created_at DESC LIMIT 1"
    )
    .bind(&material_id).bind(&model).bind(horizon)
    .fetch_optional(&pool.pool)
    .await?;
    match row {
        Some(r) => Ok(Some(ForecastCache {
            id: r.get(0),
            material_id: r.get(1),
            model: r.get(2),
            params: r.get(3),
            result: r.get(4),
            horizon: r.get(5),
            created_at: r.get(6),
        })),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn set_forecast_cache(pool: State<'_, DbPool>, token: String, material_id: String, model: String, params: String, result: String, horizon: i64) -> Result<(), AppError> {
    pool.verify_token(&token)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO forecast_cache (id, material_id, model, params, result, horizon, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(&id).bind(&material_id).bind(&model).bind(&params).bind(&result).bind(horizon).bind(&now)
    .execute(&pool.pool).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_forecast_cache(pool: State<'_, DbPool>, token: String, material_id: String, model: String) -> Result<(), AppError> {
    pool.verify_token(&token)?;
    sqlx::query("DELETE FROM forecast_cache WHERE material_id=$1 AND model=$2")
        .bind(&material_id).bind(&model)
        .execute(&pool.pool).await?;
    Ok(())
}

// ── Login History ──

#[tauri::command]
pub async fn get_login_history(pool: State<'_, DbPool>, token: String, limit: i64) -> Result<Vec<LoginHistoryEntry>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, user_id, username, ip_address, status, created_at FROM login_history ORDER BY created_at DESC LIMIT $1")
        .bind(limit)
        .fetch_all(&pool.pool).await?;
    let items = rows.iter().map(|row| LoginHistoryEntry {
        id: row.get(0),
        user_id: row.get(1),
        username: row.get(2),
        ip_address: row.get(3),
        status: row.get(4),
        created_at: row.get(5),
    }).collect();
    Ok(items)
}

#[tauri::command]
pub async fn get_user_login_history(pool: State<'_, DbPool>, token: String, user_id: String, limit: i64) -> Result<Vec<LoginHistoryEntry>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, user_id, username, ip_address, status, created_at FROM login_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2")
        .bind(&user_id).bind(limit)
        .fetch_all(&pool.pool).await?;
    let items = rows.iter().map(|row| LoginHistoryEntry {
        id: row.get(0),
        user_id: row.get(1),
        username: row.get(2),
        ip_address: row.get(3),
        status: row.get(4),
        created_at: row.get(5),
    }).collect();
    Ok(items)
}

#[tauri::command]
pub async fn clear_login_history(pool: State<'_, DbPool>, token: String) -> Result<(), AppError> {
    pool.verify_token(&token)?;
    sqlx::query("DELETE FROM login_history")
        .execute(&pool.pool).await?;
    Ok(())
}

// ── Batch QR ZIP ──

#[tauri::command]
pub async fn generate_qr_zip(pool: State<'_, DbPool>, token: String, items: Vec<String>) -> Result<String, AppError> {
    pool.verify_token(&token)?;
    let result = tokio::task::spawn_blocking(move || {
        use qrcode::QrCode;
        use image::Luma;
        use zip::write::SimpleFileOptions;
        use std::io::{Cursor, Write};

        let mut buf = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut zip = zip::ZipWriter::new(cursor);

            for (i, data) in items.iter().enumerate() {
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
    }).await.map_err(|e| AppError::Internal(format!("spawn_blocking: {}", e)))?
        .map_err(|e| AppError::Internal(e))?;

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result);
    Ok(format!("data:application/zip;base64,{}", b64))
}
