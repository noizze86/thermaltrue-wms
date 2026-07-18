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
    .map_err(|e| crate::server::server_error(e))?;
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
            .map_err(|e| crate::server::server_error(e))?;
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO company_profile (id, company_name, address, phone, email, logo, npwp, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&id).bind(&body.company_name).bind(&body.address).bind(&body.phone)
            .bind(&body.email).bind(&body.logo).bind(&body.npwp).bind(&now)
            .execute(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?;
    }
    Ok(Json(()))
}

// ── Notification Config ──

pub async fn get_notification_config(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<NotificationConfig>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, config_key, config_value FROM notification_config")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
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
            .map_err(|e| crate::server::server_error(e))?;
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO notification_config (id, config_key, config_value) VALUES ($1, $2, $3)")
            .bind(&id).bind(&body.config_key).bind(&body.config_value)
            .execute(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?;
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
        .map_err(|e| crate::server::server_error(e))?;
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
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_users").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO roles (id, name, description, permissions, is_system) VALUES ($1, $2, $3, $4, false)")
        .bind(&id).bind(&body.name).bind(&body.description).bind(&body.permissions)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(Role { id, name: body.name, description: body.description, permissions: body.permissions, is_system: false, created_at: now }))
}

pub async fn update_role(
    State(pool): State<Arc<DbPool>>,
    Extension(_user_id): Extension<String>,
    Json(body): Json<UpdateRoleBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_users").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    sqlx::query("UPDATE roles SET name=$1, description=$2, permissions=$3 WHERE id=$4 AND is_system=false")
        .bind(&body.name).bind(&body.description).bind(&body.permissions).bind(&body.id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn delete_role(
    State(pool): State<Arc<DbPool>>,
    Extension(_user_id): Extension<String>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &_user_id, "manage_users").await.map_err(|e| crate::server::server_error(e))? {
        return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error": "Permission denied"}))));
    }
    sqlx::query("DELETE FROM roles WHERE id=$1 AND is_system=false")
        .bind(&id).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
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
            .map_err(|e| crate::server::server_error(e))?;
        let v = val.unwrap_or_default();
        return Ok(Json(vec![AppConfig { key: key.clone(), value: v }]));
    } else {
        sqlx::query("SELECT key, value FROM app_config ORDER BY key")
            .fetch_all(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?
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
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

// ── Inventory Settings ──

pub async fn get_inventory_settings(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<AppConfig>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT key, value FROM app_config WHERE key LIKE 'inventory_%' ORDER BY key")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
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
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

// ── DB Stats ──

pub async fn db_stats(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let materials: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials")
        .fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let transactions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions")
        .fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let categories: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
        .fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"materials": materials, "transactions": transactions, "users": users, "categories": categories})))
}

// ── Audit Logs ──

#[derive(Deserialize)]
pub struct AuditLogQuery { pub limit: Option<i64>, pub offset: Option<i64>, pub user_id: Option<String>, pub entity: Option<String> }

#[derive(Deserialize)]
pub struct AuditLogFilteredQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub action: Option<String>,
    pub entity: Option<String>,
    pub user_id: Option<String>,
    pub date_start: Option<String>,
    pub date_end: Option<String>,
}

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
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| AuditLog {
        id: row.get(0), user_id: row.get::<Option<String>, _>(1), action: row.get(2),
        entity: row.get(3), entity_id: row.get::<Option<String>, _>(4),
        details: row.get(5), created_at: row.get(6),
    }).collect();
    Ok(Json(list))
}

pub async fn filtered_audit_logs(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<AuditLogFilteredQuery>,
) -> Result<Json<Vec<AuditLog>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let limit_val = params.limit.unwrap_or(200);
    let offset_val = params.offset.unwrap_or(0);
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT id, user_id, action, entity, entity_id, details, created_at FROM audit_log WHERE 1=1"
    );
    if let Some(ref a) = params.action { builder.push(" AND action = ").push_bind(a); }
    if let Some(ref e) = params.entity { builder.push(" AND entity = ").push_bind(e); }
    if let Some(ref u) = params.user_id { builder.push(" AND user_id = ").push_bind(u); }
    if let Some(ref d) = params.date_start { builder.push(" AND created_at >= ").push_bind(d); }
    if let Some(ref d) = params.date_end { builder.push(" AND created_at < (").push_bind(d); builder.push("::date + interval '1 day')"); }
    builder.push(" ORDER BY created_at DESC LIMIT ").push_bind(limit_val);
    builder.push(" OFFSET ").push_bind(offset_val);
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| AuditLog {
        id: row.get(0), user_id: row.get::<Option<String>, _>(1), action: row.get(2),
        entity: row.get(3), entity_id: row.get::<Option<String>, _>(4),
        details: row.get(5), created_at: row.get(6),
    }).collect();
    Ok(Json(list))
}

pub async fn count_filtered_audit_logs(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<AuditLogFilteredQuery>,
) -> Result<Json<i64>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT COUNT(*) FROM audit_log WHERE 1=1"
    );
    if let Some(ref a) = params.action { builder.push(" AND action = ").push_bind(a); }
    if let Some(ref e) = params.entity { builder.push(" AND entity = ").push_bind(e); }
    if let Some(ref u) = params.user_id { builder.push(" AND user_id = ").push_bind(u); }
    if let Some(ref d) = params.date_start { builder.push(" AND created_at >= ").push_bind(d); }
    if let Some(ref d) = params.date_end { builder.push(" AND created_at < (").push_bind(d); builder.push("::date + interval '1 day')"); }
    let count: i64 = builder.build().fetch_one(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .get(0);
    Ok(Json(count))
}

// ── Type B gaps ──

#[derive(Deserialize)]
pub struct AddAuditLogBody { pub user_id: Option<String>, pub action: String, pub entity: String, pub entity_id: Option<String>, pub details: String }

pub async fn add_audit_log(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<AddAuditLogBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&body.user_id).bind(&body.action).bind(&body.entity).bind(&body.entity_id).bind(&body.details)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct PurgeAuditLogsQuery { pub months: i64 }

pub async fn purge_old_audit_logs(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<PurgeAuditLogsQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let result = sqlx::query("DELETE FROM audit_log WHERE created_at < NOW() - ($1 * interval '1 month')")
        .bind(params.months)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"deleted": result.rows_affected() as i64})))
}

#[derive(Deserialize)]
pub struct ExportAuditCsvQuery { pub action: Option<String>, pub entity: Option<String>, pub user_id: Option<String>, pub date_start: Option<String>, pub date_end: Option<String>, pub limit: Option<i64> }

pub async fn export_audit_csv_filtered(
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ExportAuditCsvQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let limit_val = params.limit.unwrap_or(500);
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT a.id, a.user_id, COALESCE(u.username, 'System'), a.action, a.entity, a.entity_id, a.details, a.created_at FROM audit_log a LEFT JOIN users u ON a.user_id=u.id WHERE 1=1"
    );
    if let Some(ref a) = params.action { builder.push(" AND a.action = ").push_bind(a); }
    if let Some(ref e) = params.entity { builder.push(" AND a.entity = ").push_bind(e); }
    if let Some(ref u) = params.user_id { builder.push(" AND a.user_id = ").push_bind(u); }
    if let Some(ref d) = params.date_start { builder.push(" AND a.created_at >= ").push_bind(d); }
    if let Some(ref d) = params.date_end { builder.push(" AND a.created_at < (").push_bind(d); builder.push("::date + interval '1 day')"); }
    builder.push(" ORDER BY a.created_at DESC LIMIT ").push_bind(limit_val);
    let rows = builder.build().fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let mut csv = String::from("ID,User ID,Username,Action,Entity,Entity ID,Details,Created At\n");
    for row in rows {
        let id: String = row.get(0);
        let uid: Option<String> = row.get(1);
        let uname: String = row.get(2);
        let action: String = row.get(3);
        let entity: String = row.get(4);
        let eid: Option<String> = row.get(5);
        let details: String = row.get(6);
        let created: String = row.get(7);
        csv.push_str(&format!("{},{},{},{},{},{},{},{}\n", id, uid.unwrap_or_default(), uname, action, entity, eid.unwrap_or_default(), details.replace(',',";"), created));
    }
    Ok(Json(json!({"csv": csv})))
}

pub async fn get_all_app_config(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<AppConfig>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT key, value FROM app_config ORDER BY key")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| AppConfig { key: row.get(0), value: row.get(1) }).collect();
    Ok(Json(list))
}

pub async fn delete_app_config(
    State(pool): State<Arc<DbPool>>,
    Path(key): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("DELETE FROM app_config WHERE key=$1")
        .bind(&key).execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn backup_database(
    State(_pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let database_url = std::env::var("DATABASE_URL").map_err(|_| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error":"DATABASE_URL not set"}))))?;
    let backup_dir = std::env::var("BACKUP_DIR").unwrap_or_else(|_| "backups".into());
    tokio::fs::create_dir_all(&backup_dir).await.map_err(|e| crate::server::server_error(e))?;
    let backup_path = format!("{}/thermaltrue_backup_{}.sql", backup_dir, chrono::Local::now().format("%Y%m%d_%H%M%S"));
    let output = tokio::process::Command::new("pg_dump")
        .arg("-d").arg(&database_url).arg("-f").arg(&backup_path).arg("--no-owner")
        .output().await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("pg_dump failed: {}", e)}))))?;
    if !output.status.success() {
        return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("pg_dump: {}", String::from_utf8_lossy(&output.stderr))}))));
    }
    Ok(Json(json!({"path": backup_path})))
}

#[derive(Deserialize)]
pub struct RestoreDatabaseBody { pub backup_path: String }

pub async fn restore_database(
    State(_pool): State<Arc<DbPool>>,
    Json(body): Json<RestoreDatabaseBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let database_url = std::env::var("DATABASE_URL").map_err(|_| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error":"DATABASE_URL not set"}))))?;
    let output = tokio::process::Command::new("psql")
        .arg("-d").arg(&database_url).arg("-f").arg(&body.backup_path)
        .output().await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("psql failed: {}", e)}))))?;
    if !output.status.success() {
        return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("psql restore: {}", String::from_utf8_lossy(&output.stderr))}))));
    }
    Ok(Json(json!({"message": "Database restored successfully"})))
}

#[derive(Deserialize)]
pub struct GenerateQrCodeBody { pub data: String }

pub async fn generate_qr_code(
    Json(body): Json<GenerateQrCodeBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    use qrcode::QrCode;
    use image::Luma;
    let code = QrCode::new(body.data.as_bytes()).map_err(|e| crate::server::server_error(e))?;
    let img = code.render::<Luma<u8>>().build();
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).map_err(|e| crate::server::server_error(e))?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, buf.get_ref());
    Ok(Json(json!({"qr": format!("data:image/png;base64,{}", b64)})))
}

#[derive(Deserialize)]
pub struct CloneRoleBody { pub source_role_id: String, pub new_name: String, pub new_description: String }

pub async fn clone_role(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CloneRoleBody>,
) -> Result<Json<Role>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_users").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let row = sqlx::query("SELECT id, name, description, permissions, is_system, created_at FROM roles WHERE id=$1")
        .bind(&body.source_role_id).fetch_optional(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Role not found"}))))?;
    let source_permissions: String = row.get(3);
    let new_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO roles (id, name, description, permissions, is_system) VALUES ($1, $2, $3, $4, false)")
        .bind(&new_id).bind(&body.new_name).bind(&body.new_description).bind(&source_permissions)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(Role { id: new_id, name: body.new_name, description: body.new_description, permissions: source_permissions, is_system: false, created_at: now }))
}

#[derive(Deserialize)]
pub struct CheckPermissionQuery { pub permission: String }

pub async fn check_permission(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<CheckPermissionQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let ok = validate::check_user_permission(&pool.pool, &user_id, &params.permission).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"allowed": ok})))
}
