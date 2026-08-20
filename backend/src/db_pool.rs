use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::sync::Mutex;
use std::collections::HashMap;
use std::time::Instant;
use crate::error::AppError;
use crate::jwt;

fn env_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

pub struct DbPool {
    pub pool: PgPool,
    pub login_attempts: Mutex<HashMap<String, (u32, Instant)>>,
}

impl DbPool {
    pub async fn new(database_url: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let max_retries = 2;
        let mut last_err = None;
        for attempt in 1..=max_retries {
            match Self::try_connect(database_url).await {
                Ok(pool) => return Ok(pool),
                Err(e) => {
                    last_err = Some(e);
                    if attempt < max_retries {
                        eprintln!("DB connection attempt {}/{} failed, retrying in 2s...", attempt, max_retries);
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    }
                }
            }
        }
        Err(last_err.unwrap_or_else(|| Box::new(std::io::Error::other("Failed to connect to database"))))
    }

    async fn try_connect(database_url: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let pool_size: u32 = std::env::var("DATABASE_POOL_SIZE")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(10);

        let pool = match PgPoolOptions::new()
            .max_connections(pool_size)
            .acquire_timeout(std::time::Duration::from_secs(3))
            .connect(database_url).await
        {
            Ok(p) => p,
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("does not exist") || msg.contains("database") && msg.contains("not exist") {
                    eprintln!("Database not found, attempting to create it...");
                    Self::create_database(database_url).await
                        .map_err(|ce| format!("Failed to create database: {} (original: {})", ce, msg))?;
                    // Retry after creating
                    PgPoolOptions::new()
                        .max_connections(pool_size)
                        .connect(database_url).await?
                } else {
                    return Err(e.into());
                }
            }
        };

        sqlx::migrate!("./migrations").run(&pool).await?;
        Self::seed_defaults(&pool).await?;
        if let Err(e) = sqlx::query("DELETE FROM audit_log WHERE created_at::timestamp < NOW() - interval '12 months'")
            .execute(&pool).await
        {
            log::warn!("audit_log auto-purge (12 months) failed: {}", e);
        }
        Ok(DbPool {
            pool,
            login_attempts: Mutex::new(HashMap::new()),
        })
    }

    async fn create_database(database_url: &str) -> Result<(), Box<dyn std::error::Error>> {
        let admin_url = database_url
            .replace("/thermaltrue?", "/postgres?")
            .replace("/thermaltrue", "/postgres");
        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&admin_url).await?;
        sqlx::query("CREATE DATABASE thermaltrue")
            .execute(&admin_pool).await?;
        admin_pool.close().await;
        eprintln!("Created database 'thermaltrue' successfully");
        Ok(())
    }

    async fn seed_defaults(pool: &PgPool) -> Result<(), Box<dyn std::error::Error>> {
        let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(pool).await?;
        if user_count == 0 {
            let default_pass = std::env::var("DEFAULT_ADMIN_PASSWORD").unwrap_or_else(|_| { let s = uuid::Uuid::new_v4().to_string(); format!("Admin{}", &s[..8]) });
            let hash = bcrypt::hash(&default_pass, 12)?;
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO users (id, username, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'admin')")
                .bind(&id).bind("admin").bind(&hash).bind("Administrator")
                .execute(pool).await?;
            log::info!("Seeded admin user 'admin' (set DEFAULT_ADMIN_PASSWORD for a fixed password; current: {})", default_pass);
            Self::write_admin_credentials("admin", &default_pass);
            let wh1 = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO warehouses (id, name, code, location) VALUES ($1, 'Main Warehouse', 'WH-001', 'Jakarta')")
                .bind(&wh1).execute(pool).await?;
            let wh2 = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO warehouses (id, name, code, location) VALUES ($1, 'Secondary Warehouse', 'WH-002', 'Bandung')")
                .bind(&wh2).execute(pool).await?;
        }
        Ok(())
    }

    fn write_admin_credentials(username: &str, password: &str) {
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let path = env_dir().join("admin-credentials.txt");
        let content = format!(
            "Thermaltrue WMS - Admin credentials (first-run seed)\n\
             Created: {}\n\
             Username: {}\n\
             Password: {}\n\n\
             IMPORTANT:\n\
             - Generated because DEFAULT_ADMIN_PASSWORD was not set in .env.\n\
             - Delete this file after first login.\n\
             - Reset anytime with: server.exe set-admin-password <new-password> (min 8 chars, one uppercase, one lowercase, one digit)\n",
            now, username, password
        );
        match std::fs::write(&path, content) {
            Ok(_) => log::info!("Admin credentials written to {:?}", path),
            Err(e) => log::warn!("Could not write admin-credentials.txt: {}", e),
        }
    }

    pub async fn reset_admin_password(pool: &PgPool, new_password: &str) -> Result<bool, Box<dyn std::error::Error>> {
        let hash = bcrypt::hash(new_password, 12)?;
        let result = sqlx::query("UPDATE users SET password_hash=$1, password_changed_at=NOW() WHERE username='admin' AND is_active=true")
            .bind(&hash).execute(pool).await?;
        if result.rows_affected() > 0 {
            return Ok(true);
        }
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO users (id, username, password_hash, full_name, role) VALUES ($1, 'admin', $2, 'Administrator', 'admin')")
            .bind(&id).bind(&hash).execute(pool).await?;
        Ok(false)
    }

    pub fn verify_token(&self, token: &str) -> Result<String, AppError> {
        jwt::verify_jwt(token)
            .map(|claims| claims.user_id)
            .map_err(|_| AppError::Auth("Invalid or expired token".into()))
    }

    pub fn cleanup_expired_sessions(&self) {
        let mut attempts = match self.login_attempts.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let cutoff = std::time::Instant::now() - std::time::Duration::from_secs(3600);
        attempts.retain(|_, (_, time)| *time > cutoff);
    }
}
