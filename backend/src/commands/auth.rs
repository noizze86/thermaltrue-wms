use tauri::State;
use std::time::{Duration, Instant};
use crate::db_pool::DbPool;
use crate::models::{User, LoginRequest, AuthResponse};
use crate::error::AppError;
use sqlx::Row;

const LOCAL_IP: &str = "127.0.0.1";

#[tauri::command]
pub async fn login(pool: State<'_, DbPool>, req: LoginRequest) -> Result<AuthResponse, AppError> {
    // Rate limit check
    {
        let mut attempts = pool.login_attempts.lock().map_err(|_| AppError::Lock("Login attempts mutex poisoned".into()))?;
        if let Some((count, first)) = attempts.get(&req.username) {
            if *count >= 5 && first.elapsed() < Duration::from_secs(900) {
                let remaining = 900 - first.elapsed().as_secs();
                return Err(AppError::Auth(format!("Too many login attempts. Try again in {} minutes.", remaining / 60 + 1)));
            }
            if first.elapsed() >= Duration::from_secs(900) {
                attempts.remove(&req.username);
            }
        }
    }

    // Global rate limit check
    {
        let global_failed: u32 = {
            let attempts = pool.login_attempts.lock().map_err(|_| AppError::Lock("Login attempts mutex poisoned".into()))?;
            attempts.values().filter(|(_, time)| time.elapsed() < Duration::from_secs(900)).map(|(count, _)| count).sum()
        };
        if global_failed > 50 {
            return Err(AppError::Auth("Too many failed login attempts globally. Please try again later.".into()));
        }
    }

    let user_row: Option<User> = sqlx::query(
        "SELECT id, username, password_hash, full_name, email, role, is_active, photo, last_login_at, last_login_ip, password_changed_at, created_at, updated_at FROM users WHERE username = $1 AND is_active = true"
    )
    .bind(&req.username)
    .fetch_optional(&pool.pool)
    .await?
    .map(|row| {
        Ok::<User, AppError>(User {
            id: row.get("id"),
            username: row.get("username"),
            password_hash: row.get("password_hash"),
            full_name: row.get("full_name"),
            email: row.get("email"),
            role: row.get("role"),
            is_active: row.get::<bool, _>("is_active"),
            photo: row.get("photo"),
            last_login_at: row.get("last_login_at"),
            last_login_ip: row.get("last_login_ip"),
            password_changed_at: row.get("password_changed_at"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }).transpose()?;

    let user = match user_row {
        Some(u) => u,
        None => {
            let ip = LOCAL_IP.to_string();
            {
                let mut attempts = pool.login_attempts.lock().map_err(|_| AppError::Lock("Login attempts mutex poisoned".into()))?;
                let entry = attempts.entry(req.username.clone()).or_insert((0, Instant::now()));
                entry.0 += 1;
            }
            let _ = sqlx::query("INSERT INTO login_history (id, user_id, username, ip_address, status) VALUES ($1, NULL, $2, $3, 'failed')")
                .bind(uuid::Uuid::new_v4().to_string()).bind(&req.username).bind(&ip)
                .execute(&pool.pool).await;
            return Err(AppError::Auth("Invalid username or password".into()));
        }
    };

    sqlx::query("UPDATE users SET last_login_at=NOW() WHERE id=$1")
        .bind(&user.id)
        .execute(&pool.pool).await.ok();

    if !bcrypt::verify(&req.password, &user.password_hash).map_err(|e| AppError::Internal(e.to_string()))? {
        let ip = LOCAL_IP.to_string();
        {
            let mut attempts = pool.login_attempts.lock().map_err(|_| AppError::Lock("Login attempts mutex poisoned".into()))?;
            let entry = attempts.entry(req.username.clone()).or_insert((0, Instant::now()));
            entry.0 += 1;
        }
        let _ = sqlx::query("INSERT INTO login_history (id, user_id, username, ip_address, status) VALUES ($1, NULL, $2, $3, 'failed')")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&req.username).bind(&ip)
            .execute(&pool.pool).await;
        return Err(AppError::Auth("Invalid username or password".to_string()));
    }

    // Clear attempts on success
    {
        let mut attempts = pool.login_attempts.lock().map_err(|_| AppError::Lock("Login attempts mutex poisoned".into()))?;
        attempts.remove(&req.username);
    }

    // Log login success
    let ip = LOCAL_IP.to_string();
    let _ = sqlx::query("INSERT INTO login_history (id, user_id, username, ip_address, status) VALUES ($1, $2, $3, $4, 'success')")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&user.id).bind(&user.username).bind(&ip)
        .execute(&pool.pool).await;
    crate::commands::audit_log(&pool.pool, &user.id, "login", "auth", &user.id, &format!("User {} logged in", user.username)).await;

    // Check password expiry
    let password_expiry_str: String = sqlx::query_scalar("SELECT COALESCE(value,'0') FROM app_config WHERE key='password_expiry_days'")
        .fetch_optional(&pool.pool).await?.unwrap_or_default();
    let password_expiry_days: i64 = password_expiry_str.parse().unwrap_or(0);
    let password_expired = if password_expiry_days > 0 {
        if let Some(ref changed) = user.password_changed_at {
            let changed_dt = chrono::NaiveDateTime::parse_from_str(changed, "%Y-%m-%d %H:%M:%S").ok();
            changed_dt.map(|d| {
                let now = chrono::Local::now().naive_local();
                (now - d).num_days() > password_expiry_days
            }).unwrap_or(true)
        } else {
            true
        }
    } else {
        false
    };

    let token = uuid::Uuid::new_v4().to_string();
    {
        let mut sessions = pool.sessions.lock().map_err(|_| AppError::Lock("Session mutex poisoned".into()))?;
        sessions.insert(token.clone(), (user.id.clone(), Instant::now()));
    }
    Ok(AuthResponse { user, token, password_expired })
}

#[tauri::command]
pub async fn logout(pool: State<'_, DbPool>, token: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    {
        let mut sessions = pool.sessions.lock().map_err(|_| AppError::Lock("Session mutex poisoned".into()))?;
        sessions.remove(&token);
    }
    crate::commands::audit_log(&pool.pool, &user_id, "logout", "auth", &user_id, "User logged out").await;
    Ok(())
}

#[tauri::command]
pub async fn get_current_user(pool: State<'_, DbPool>, token: String) -> Result<User, AppError> {
    let user_id = pool.verify_token(&token)?;
    sqlx::query(
        "SELECT id, username, password_hash, full_name, email, role, is_active, photo, last_login_at, last_login_ip, password_changed_at, created_at, updated_at FROM users WHERE id = $1"
    )
    .bind(&user_id)
    .fetch_optional(&pool.pool)
    .await?
    .map(|row| User {
        id: row.get("id"),
        username: row.get("username"),
        password_hash: row.get("password_hash"),
        full_name: row.get("full_name"),
        email: row.get("email"),
        role: row.get("role"),
        is_active: row.get::<bool, _>("is_active"),
        photo: row.get("photo"),
        last_login_at: row.get("last_login_at"),
        last_login_ip: row.get("last_login_ip"),
        password_changed_at: row.get("password_changed_at"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
    .ok_or_else(|| AppError::NotFound("User not found".into()))
}
