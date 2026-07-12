use std::sync::Arc;
use axum::{Json, extract::State, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::server::create_jwt;
use sqlx::Row;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

pub async fn login(
    State(pool): State<Arc<DbPool>>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_row = sqlx::query(
        "SELECT id, username, password_hash, full_name, email, role, is_active, photo, \
         last_login_at, last_login_ip, password_changed_at, created_at, updated_at \
         FROM users WHERE username = $1 AND is_active = true"
    )
    .bind(&req.username)
    .fetch_optional(&pool.pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    let user = match user_row {
        Some(row) => row,
        None => return Err((axum::http::StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid username or password" })))),
    };

    let password_hash: String = user.get("password_hash");
    if !bcrypt::verify(&req.password, &password_hash).unwrap_or(false) {
        return Err((axum::http::StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid username or password" }))));
    }

    let user_id: String = user.get("id");
    let token = create_jwt(&user_id).map_err(|e| {
        (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))
    })?;

    let user_json = json!({
        "id": user.get::<String, _>("id"),
        "username": user.get::<String, _>("username"),
        "full_name": user.get::<String, _>("full_name"),
        "email": user.get::<String, _>("email"),
        "role": user.get::<String, _>("role"),
        "is_active": user.get::<bool, _>("is_active"),
        "photo": user.get::<String, _>("photo"),
        "last_login_at": user.get::<Option<String>, _>("last_login_at"),
        "last_login_ip": user.get::<String, _>("last_login_ip"),
        "password_changed_at": user.get::<Option<String>, _>("password_changed_at"),
        "created_at": user.get::<String, _>("created_at"),
        "updated_at": user.get::<String, _>("updated_at"),
    });

    Ok(Json(json!({
        "user": user_json,
        "token": token,
        "password_expired": false,
    })))
}

pub async fn logout(
    Extension(_user_id): Extension<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    Ok(Json(()))
}
