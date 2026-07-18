use std::sync::Arc;
use axum::{Json, extract::{State, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::TxStatus;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
pub struct UpdateStatusBody { pub status: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveItemBody { pub opname_id: String, pub material_id: String, pub system_qty: f64, pub physical_qty: f64, pub difference: f64, pub notes: String }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at FROM stock_opname ORDER BY created_at DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "opname_number": row.get::<String,_>("opname_number"),
            "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "status": row.get::<String,_>("status"),
            "notes": row.get::<String,_>("notes"), "created_by": row.get::<Option<String>,_>("created_by"),
            "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at")})
    }).collect::<Vec<_>>())))
}

pub async fn create(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname")
        .fetch_one(&pool.pool).await.unwrap_or(1);
    let opname_number = format!("OPN-{:04}", count);
    let wh_id = body.get("warehouse_id").and_then(|v| v.as_str());
    let notes = body.get("notes").and_then(|v| v.as_str()).unwrap_or("");
    sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&id).bind(&opname_number).bind(wh_id).bind("draft").bind(notes).bind(&user_id).bind(&now).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"id": id, "opname_number": opname_number, "warehouse_id": wh_id, "status": "draft", "notes": notes, "created_by": user_id, "created_at": now, "updated_at": now})))
}

pub async fn update_status(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateStatusBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE stock_opname SET status=$1, updated_at=$2 WHERE id=$3")
        .bind(&body.status).bind(&now).bind(&id)
        .execute(&mut *db_tx).await
        .map_err(|e| crate::server::server_error(e))?;
    if body.status.parse::<TxStatus>().ok() == Some(TxStatus::Completed) {
        let threshold_str: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='auto_adjust_threshold'),'0')")
            .fetch_one(&mut *db_tx).await.unwrap_or("0".into());
        let threshold: f64 = threshold_str.parse().unwrap_or(0.0);
        let items: Vec<(String, f64, f64)> = sqlx::query("SELECT material_id, physical_qty, system_qty FROM stock_opname_items WHERE opname_id=$1")
            .bind(&id).fetch_all(&mut *db_tx).await
            .map_err(|e| crate::server::server_error(e))?
            .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1), row.get::<f64,_>(2))).collect();
        for (mid, phy_qty, sys_qty) in items {
            let diff = phy_qty - sys_qty;
            if threshold > 0.0 && diff.abs() < threshold { continue; }
            sqlx::query("UPDATE materials SET quantity=$1 WHERE id=$2")
                .bind(phy_qty).bind(&mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        }
    }
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn get_items(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, opname_id, material_id, system_qty, physical_qty, difference, notes FROM stock_opname_items WHERE opname_id=$1")
        .bind(&id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "opname_id": row.get::<String,_>("opname_id"),
            "material_id": row.get::<String,_>("material_id"), "system_qty": row.get::<f64,_>("system_qty"),
            "physical_qty": row.get::<f64,_>("physical_qty"), "difference": row.get::<f64,_>("difference"),
            "notes": row.get::<String,_>("notes")})
    }).collect::<Vec<_>>())))
}

pub async fn save_item(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SaveItemBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM stock_opname_items WHERE opname_id=$1 AND material_id=$2")
        .bind(&body.opname_id).bind(&body.material_id)
        .fetch_optional(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    if existing.is_some() {
        sqlx::query("UPDATE stock_opname_items SET physical_qty=$1, difference=$2, notes=$3 WHERE opname_id=$4 AND material_id=$5")
            .bind(body.physical_qty).bind(body.physical_qty - body.system_qty).bind(&body.notes)
            .bind(&body.opname_id).bind(&body.material_id)
            .execute(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?;
    } else {
        let item_id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&item_id).bind(&body.opname_id).bind(&body.material_id).bind(body.system_qty).bind(body.physical_qty)
            .bind(body.physical_qty - body.system_qty).bind(&body.notes)
            .execute(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?;
    }
    Ok(Json(()))
}

pub async fn get_config(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let blind: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='blind_count_mode'),'false')")
        .fetch_one(&pool.pool).await.unwrap_or("false".into());
    let threshold: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='auto_adjust_threshold'),'0')")
        .fetch_one(&pool.pool).await.unwrap_or("0".into());
    Ok(Json(json!({"blind_count_mode": blind == "true", "auto_adjust_threshold": threshold.parse::<f64>().unwrap_or(0.0)})))
}

#[derive(Deserialize)]
pub struct SetConfigBody { pub key: String, pub value: String }

pub async fn set_config(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SetConfigBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        .bind(&body.key).bind(&body.value)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn get_cycle_schedules(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, warehouse_id, class, frequency_days, next_date, last_date, created_at FROM cycle_schedules ORDER BY next_date")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "warehouse_id": row.get::<Option<String>,_>("warehouse_id"),
            "class": row.get::<String,_>("class"), "frequency_days": row.get::<i64,_>("frequency_days"),
            "next_date": row.get::<String,_>("next_date"), "last_date": row.get::<Option<String>,_>("last_date"),
            "created_at": row.get::<String,_>("created_at")})
    }).collect::<Vec<_>>())))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCycleBody { pub warehouse_id: Option<String>, pub class: String, pub frequency_days: i64 }

pub async fn create_cycle_schedule(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateCycleBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO cycle_schedules (id, warehouse_id, class, frequency_days, next_date, created_at) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5)")
        .bind(&id).bind(&body.warehouse_id).bind(&body.class).bind(body.frequency_days).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    Ok(Json(json!({"id": id, "warehouse_id": body.warehouse_id, "class": body.class, "frequency_days": body.frequency_days, "next_date": today, "last_date": null, "created_at": now})))
}

pub async fn delete_cycle_schedule(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM cycle_schedules WHERE id=$1").bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn auto_generate(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let schedules: Vec<(String, Option<String>, String, i64)> = sqlx::query("SELECT id, warehouse_id, class, frequency_days FROM cycle_schedules WHERE next_date <= $1")
        .bind(&today).fetch_all(&mut *db_tx).await
        .map_err(|e| crate::server::server_error(e))?
        .iter().map(|row| (row.get::<String,_>(0), row.get::<Option<String>,_>(1), row.get::<String,_>(2), row.get::<i64,_>(3))).collect();
    let mut created = 0;
    for (sid, wh_id, class, freq) in &schedules {
        let oid = uuid::Uuid::new_v4().to_string();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname").fetch_one(&mut *db_tx).await.unwrap_or(1);
        let opname_number = format!("OPN-{:04}", count);
        sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,'draft',$4,'auto',$5,$5)")
            .bind(&oid).bind(&opname_number).bind(wh_id).bind(format!("Auto-generated cycle count ({})", class)).bind(&now)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        let materials: Vec<(String, f64)> = {
            let mut mat_builder = sqlx::QueryBuilder::new("SELECT id, quantity FROM materials WHERE is_active=true");
            if let Some(ref w) = wh_id { mat_builder.push(" AND warehouse_id = "); mat_builder.push_bind(w); }
            mat_builder.build().fetch_all(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?
                .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1))).collect()
        };
        for (mid, qty) in &materials {
            let iid = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference) VALUES ($1,$2,$3,$4,$5,0)")
                .bind(&iid).bind(&oid).bind(mid).bind(qty).bind(qty).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        }
        sqlx::query("UPDATE cycle_schedules SET next_date=CURRENT_DATE + $1, last_date=$2 WHERE id=$3")
            .bind(freq).bind(&today).bind(sid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        created += 1;
    }
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"message": format!("Created {} opname(s) from cycle schedules", created)})))
}
