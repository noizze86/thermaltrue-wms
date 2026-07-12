use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::{CompanyProfile, NotificationConfig, Role, AppConfig, AuditLog};
use crate::validate;
use sqlx::Row;

// ── Company Profile ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCompanyProfileBody { pub company_name: String, pub address: String, pub phone: String, pub email: String, pub logo: String, pub npwp: String }

pub async fn get_company_profile(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Option<CompanyProfile>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query(
        "SELECT id, company_name, address, phone, email, logo, npwp, updated_at FROM company_profile LIMIT 1"
    )
    .fetch_optional(&pool.pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    match row {
        Some(r) => Ok(Json(Some(CompanyProfile {
            id: r.get(0), company_name: r.get(1), address: r.get(2),
            phone: r.get(3), email: r.get(4), logo: r.get(5),
            npwp: r.get(6), updated_at: r.get(7),
        }))),
        None => Ok(Json(None)),
    }
}

pub async fn save_company_profile(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SaveCompanyProfileBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let existing: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM company_profile")
        .fetch_one(&pool.pool).await.unwrap_or(false);
    if existing {
        sqlx::query("UPDATE company_profile SET company_name=$1, address=$2, phone=$3, email=$4, logo=$5, npwp=$6, updated_at=$7")
            .bind(&body.company_name).bind(&body.address).bind(&body.phone).bind(&body.email)
            .bind(&body.logo).bind(&body.npwp).bind(&now)
            .execute(&pool.pool).await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO company_profile (id, company_name, address, phone, email, logo, npwp, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&id).bind(&body.company_name).bind(&body.address).bind(&body.phone)
            .bind(&body.email).bind(&body.logo).bind(&body.npwp).bind(&now)
            .execute(&pool.pool).await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    }
    Ok(Json(()))
}

// ── Notification Config ──

pub async fn get_notification_config(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<NotificationConfig>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, config_key, config_value FROM notification_config")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| NotificationConfig {
        id: row.get(0), config_key: row.get(1), config_value: row.get(2),
    }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNotificationConfigBody { pub config_key: String, pub config_value: String }

pub async fn save_notification_config(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SaveNotificationConfigBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let existing: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM notification_config WHERE config_key=$1")
        .bind(&body.config_key).fetch_one(&pool.pool).await.unwrap_or(false);
    if existing {
        sqlx::query("UPDATE notification_config SET config_value=$1 WHERE config_key=$2")
            .bind(&body.config_value).bind(&body.config_key)
            .execute(&pool.pool).await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO notification_config (id, config_key, config_value) VALUES ($1, $2, $3)")
            .bind(&id).bind(&body.config_key).bind(&body.config_value)
            .execute(&pool.pool).await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    }
    Ok(Json(()))
}

// ── Roles ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoleBody { pub name: String, pub description: String, pub permissions: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoleBody { pub id: String, pub name: String, pub description: String, pub permissions: String }

pub async fn list_roles(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<Role>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, name, description, permissions, is_system, created_at FROM roles ORDER BY name")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| Role {
        id: row.get(0), name: row.get(1), description: row.get(2),
        permissions: row.get(3), is_system: row.get::<bool, _>(4), created_at: row.get(5),
    }).collect();
    Ok(Json(list))
}

pub async fn create_role(
    State(pool): State<Arc<DbPool>>,
    Extension(_user_id): Extension<String>,
    Json(body): Json<CreateRoleBody>,
) -> Result<Json<Role>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_users").await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO roles (id, name, description, permissions, is_system) VALUES ($1, $2, $3, $4, false)")
        .bind(&id).bind(&body.name).bind(&body.description).bind(&body.permissions)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(Role { id, name: body.name, description: body.description, permissions: body.permissions, is_system: false, created_at: now }))
}

pub async fn update_role(
    State(pool): State<Arc<DbPool>>,
    Extension(_user_id): Extension<String>,
    Json(body): Json<UpdateRoleBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_users").await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    sqlx::query("UPDATE roles SET name=$1, description=$2, permissions=$3 WHERE id=$4 AND is_system=false")
        .bind(&body.name).bind(&body.description).bind(&body.permissions).bind(&body.id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn delete_role(
    State(pool): State<Arc<DbPool>>,
    Extension(_user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_users").await.map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    sqlx::query("DELETE FROM roles WHERE id=$1 AND is_system=false")
        .bind(&id).execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// ── App Config ──

#[derive(Deserialize)]
pub struct AppConfigQuery { pub key: Option<String> }

pub async fn get_app_config(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<AppConfigQuery>,
) -> Result<Json<Vec<AppConfig>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = if let Some(ref key) = params.key {
        let val: Option<String> = sqlx::query_scalar("SELECT value FROM app_config WHERE key=$1")
            .bind(key).fetch_optional(&pool.pool).await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
        let v = val.unwrap_or_default();
        return Ok(Json(vec![AppConfig { key: key.clone(), value: v }]));
    } else {
        sqlx::query("SELECT key, value FROM app_config ORDER BY key")
            .fetch_all(&pool.pool).await
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    };
    let list = rows.iter().map(|row| AppConfig { key: row.get(0), value: row.get(1) }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAppConfigBody { pub key: String, pub value: String }

pub async fn set_app_config(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SetAppConfigBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        .bind(&body.key).bind(&body.value)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// ── Inventory Settings ──

pub async fn get_inventory_settings(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<AppConfig>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT key, value FROM app_config WHERE key LIKE 'inventory_%' ORDER BY key")
        .fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| AppConfig { key: row.get(0), value: row.get(1) }).collect();
    Ok(Json(list))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInventorySettingBody { pub key: String, pub value: String }

pub async fn save_inventory_setting(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SaveInventorySettingBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let key = format!("inventory_{}", body.key.trim_start_matches("inventory_"));
    sqlx::query("INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        .bind(&key).bind(&body.value)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

// ── Audit Logs ──

#[derive(Deserialize)]
pub struct AuditLogQuery { pub limit: Option<i64>, pub offset: Option<i64>, pub user_id: Option<String>, pub entity: Option<String> }

pub async fn list_audit_logs(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<AuditLogQuery>,
) -> Result<Json<Vec<AuditLog>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let limit_val = params.limit.unwrap_or(200);
    let offset_val = params.offset.unwrap_or(0);
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT id, user_id, action, entity, entity_id, details, created_at FROM audit_log WHERE 1=1"
    );
    if let Some(ref u) = params.user_id { builder.push(" AND user_id = ").push_bind(u); }
    if let Some(ref e) = params.entity { builder.push(" AND entity = ").push_bind(e); }
    builder.push(" ORDER BY created_at DESC LIMIT ").push_bind(limit_val);
    builder.push(" OFFSET ").push_bind(offset_val);
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    let list = rows.iter().map(|row| AuditLog {
        id: row.get(0), user_id: row.get::<Option<String>, _>(1), action: row.get(2),
        entity: row.get(3), entity_id: row.get::<Option<String>, _>(4),
        details: row.get(5), created_at: row.get(6),
    }).collect();
    Ok(Json(list))
}
