use std::sync::Arc;
use axum::{Json, extract::{State, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody { pub username: String, pub password: String, pub full_name: String, pub role: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBody { pub full_name: String, pub email: String, pub role: String, pub is_active: bool }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordBody { pub new_password: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeMyPasswordBody { pub old_password: String, pub new_password: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogActivityBody { pub user_id: String, pub activity: String, pub details: String, pub ip_address: String }

pub async fn list(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query(
        "SELECT id, username, password_hash, full_name, email, role, is_active, photo, \
         last_login_at, last_login_ip, password_changed_at, created_at, updated_at \
         FROM users ORDER BY username"
    ).fetch_all(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "username": row.get::<String,_>("username"),
            "full_name": row.get::<String,_>("full_name"), "email": row.get::<String,_>("email"),
            "role": row.get::<String,_>("role"), "is_active": row.get::<bool,_>("is_active"),
            "photo": row.get::<String,_>("photo"), "last_login_at": row.get::<Option<String>,_>("last_login_at"),
            "last_login_ip": row.get::<String,_>("last_login_ip"),
            "password_changed_at": row.get::<Option<String>,_>("password_changed_at"),
            "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at")})
    }).collect::<Vec<_>>())))
}

pub async fn get_me(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query(
        "SELECT id, username, password_hash, full_name, email, role, is_active, photo, \
         last_login_at, last_login_ip, password_changed_at, created_at, updated_at \
         FROM users WHERE id=$1"
    ).bind(&user_id).fetch_optional(&pool.pool).await
     .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
     .ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"User not found"}))))?;
    Ok(Json(json!({"id": row.get::<String,_>("id"), "username": row.get::<String,_>("username"),
        "full_name": row.get::<String,_>("full_name"), "email": row.get::<String,_>("email"),
        "role": row.get::<String,_>("role"), "is_active": row.get::<bool,_>("is_active"),
        "photo": row.get::<String,_>("photo"), "last_login_at": row.get::<Option<String>,_>("last_login_at"),
        "last_login_ip": row.get::<String,_>("last_login_ip"),
        "password_changed_at": row.get::<Option<String>,_>("password_changed_at"),
        "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at")})))
}

pub async fn create(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_users").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_string(&body.username, "Username", 50).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_string(&body.password, "Password", 255).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    validate::validate_string(&body.full_name, "Full name", 255).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE username=$1")
        .bind(&body.username).fetch_one(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    if exists > 0 { return Err((axum::http::StatusCode::CONFLICT, Json(json!({"error":"Username already exists"})))); }
    let id = uuid::Uuid::new_v4().to_string();
    let hash = bcrypt::hash(&body.password, 12).map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    sqlx::query("INSERT INTO users (id, username, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id).bind(&body.username).bind(&hash).bind(&body.full_name).bind(&body.role)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn update(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_users").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE users SET full_name=$1, email=$2, role=$3, is_active=$4, updated_at=NOW() WHERE id=$5")
        .bind(&body.full_name).bind(&body.email).bind(&body.role).bind(body.is_active).bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn delete(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_users").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM users WHERE id=$1 AND username != 'admin'").bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn change_password(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Json(body): Json<ChangePasswordBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let hash = bcrypt::hash(&body.new_password, 12).map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    sqlx::query("UPDATE users SET password_hash=$1, password_changed_at=NOW() WHERE id=$2")
        .bind(&hash).bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn change_my_password(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<ChangeMyPasswordBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query("SELECT password_hash FROM users WHERE id=$1").bind(&user_id).fetch_optional(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"User not found"}))))?;
    let current_hash: String = row.get(0);
    if !bcrypt::verify(&body.old_password, &current_hash).map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))? {
        return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Old password is incorrect"}))));
    }
    let new_hash = bcrypt::hash(&body.new_password, 12).map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    sqlx::query("UPDATE users SET password_hash=$1, password_changed_at=NOW() WHERE id=$2")
        .bind(&new_hash).bind(&user_id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn update_photo(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let photo = body.get("photo").and_then(|v| v.as_str()).ok_or((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Missing photo"}))))?;
    sqlx::query("UPDATE users SET photo=$1 WHERE id=$2")
        .bind(photo).bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}

pub async fn get_activity(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, activity, details, ip_address, created_at FROM user_activity_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100")
        .bind(&id).fetch_all(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "activity": row.get::<String,_>("activity"),
            "details": row.get::<String,_>("details"), "ip_address": row.get::<String,_>("ip_address"),
            "created_at": row.get::<String,_>("created_at")})
    }).collect::<Vec<_>>())))
}

pub async fn log_activity(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<LogActivityBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO user_activity_log (id, user_id, activity, details, ip_address) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id).bind(&body.user_id).bind(&body.activity).bind(&body.details).bind(&body.ip_address)
        .execute(&pool.pool).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(()))
}
