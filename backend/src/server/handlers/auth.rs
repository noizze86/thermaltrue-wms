use std::sync::Arc;
use std::time::Instant;
use axum::{Json, extract::State, Extension, response::IntoResponse, http::header::SET_COOKIE};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::server::create_jwt;
use sqlx::Row;

const MAX_LOGIN_ATTEMPTS: u32 = 5;
const LOGIN_WINDOW_SECS: u64 = 900; // 15 minutes

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

fn check_rate_limit(pool: &DbPool, username: &str) -> Result<(), (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut attempts = match pool.login_attempts.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::error!("Mutex poisoned (login_attempts), recovering: {}", poisoned);
            poisoned.into_inner()
        }
    };
    let now = Instant::now();

    // Global rate limit
    let global: u32 = attempts.values()
        .filter(|(_, t)| now.duration_since(*t).as_secs() < LOGIN_WINDOW_SECS)
        .map(|(c, _)| c)
        .sum();
    if global >= MAX_LOGIN_ATTEMPTS * 10 {
        return Err((axum::http::StatusCode::TOO_MANY_REQUESTS, Json(json!({"error":"Too many login attempts. Try again later."}))));
    }

    // Per-user rate limit
    let entry = attempts.entry(username.to_string()).or_insert((0, now));
    if entry.0 >= MAX_LOGIN_ATTEMPTS && now.duration_since(entry.1).as_secs() < LOGIN_WINDOW_SECS {
        return Err((axum::http::StatusCode::TOO_MANY_REQUESTS, Json(json!({"error":"Too many login attempts. Try again later."}))));
    }
    if now.duration_since(entry.1).as_secs() >= LOGIN_WINDOW_SECS {
        *entry = (0, now);
    }
    entry.0 += 1;
    entry.1 = now;
    Ok(())
}

pub async fn login(
    State(pool): State<Arc<DbPool>>,
    Json(req): Json<LoginRequest>,
) -> Result<impl IntoResponse, (axum::http::StatusCode, Json<serde_json::Value>)> {
    check_rate_limit(&pool, &req.username)?;

    let user_row = sqlx::query(
        "SELECT id, username, password_hash, full_name, email, role, is_active, photo, \
         last_login_at, last_login_ip, password_changed_at, created_at, updated_at \
         FROM users WHERE username = $1 AND is_active = true"
    )
    .bind(&req.username)
    .fetch_optional(&pool.pool)
    .await
    .map_err(|e| crate::server::server_error(e))?;

    let user = match user_row {
        Some(row) => row,
        None => return Err((axum::http::StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid username or password" })))),
    };

    let password_hash: String = user.get("password_hash");
    if !bcrypt::verify(&req.password, &password_hash).unwrap_or(false) {
        return Err((axum::http::StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid username or password" }))));
    }

    // Reset login attempts on success
    {
        let mut attempts = pool.login_attempts.lock().unwrap();
        attempts.remove(&req.username);
    }

    let user_id: String = user.get("id");
    let token = create_jwt(&user_id).map_err(|e| crate::server::server_error(e))?;

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

    let secure = if cfg!(not(debug_assertions)) { "; Secure" } else { "" };
    let cookie = format!(
        "token={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400{}",
        token, secure
    );

    Ok(([(SET_COOKIE, cookie)], Json(json!({
        "user": user_json,
        "token": token,
        "password_expired": false,
    }))))
}

pub async fn logout(
    Extension(_user_id): Extension<String>,
) -> Result<impl IntoResponse, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let clear = "token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    Ok(([(SET_COOKIE, clear)], Json(json!({}))))
}
