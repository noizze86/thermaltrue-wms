use serde::{Deserialize, Serialize};
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use std::path::PathBuf;
use std::io::{BufRead, Write, BufReader};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: String,
    pub exp: usize,
}

fn env_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn jwt_secret() -> String {
    if let Ok(secret) = std::env::var("JWT_SECRET") {
        return secret;
    }
    let secret = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    std::env::set_var("JWT_SECRET", &secret);
    let env_path = env_dir().join(".env");
    let mut lines: Vec<String> = vec![];
    let mut found = false;
    if let Ok(f) = std::fs::File::open(&env_path) {
        for line in BufReader::new(f).lines().flatten() {
            if line.starts_with("JWT_SECRET=") {
                lines.push(format!("JWT_SECRET={}", secret));
                found = true;
            } else {
                lines.push(line);
            }
        }
    }
    if !found {
        lines.push(format!("JWT_SECRET={}", secret));
    }
    if let Ok(mut f) = std::fs::File::create(env_path) {
        for line in &lines {
            writeln!(f, "{}", line).ok();
        }
    }
    secret
}

pub fn create_jwt(user_id: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let ttl_hours: i64 = std::env::var("SESSION_TTL_HOURS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(24);
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(ttl_hours))
        .map(|t| t.timestamp() as usize)
        .unwrap_or(0);
    let claims = Claims { user_id: user_id.to_string(), exp };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(jwt_secret().as_bytes()))
}

pub fn verify_jwt(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let data = decode::<Claims>(token, &DecodingKey::from_secret(jwt_secret().as_bytes()), &Validation::default())?;
    Ok(data.claims)
}
