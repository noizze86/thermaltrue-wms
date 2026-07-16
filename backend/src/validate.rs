use sqlx::PgPool;
use crate::error::AppError;

pub fn validate_string(value: &str, field: &str, max_len: usize) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Validation(format!("{} cannot be empty", field)));
    }
    if value.len() > max_len {
        return Err(AppError::Validation(format!("{} exceeds maximum length of {} characters", field, max_len)));
    }
    Ok(())
}

pub fn validate_sku(value: &str) -> Result<(), AppError> {
    validate_string(value, "SKU", 50)?;
    if !value.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::Validation("SKU can only contain letters, numbers, hyphens and underscores".into()));
    }
    Ok(())
}

pub fn validate_quantity(value: f64, field: &str) -> Result<(), AppError> {
    if value < 0.0 {
        return Err(AppError::Validation(format!("{} cannot be negative", field)));
    }
    if value > 999999999.0 {
        return Err(AppError::Validation(format!("{} exceeds maximum value", field)));
    }
    Ok(())
}

pub fn validate_password(value: &str) -> Result<(), AppError> {
    if value.len() < 8 {
        return Err(AppError::Validation("Password must be at least 8 characters".into()));
    }
    if value.len() > 128 {
        return Err(AppError::Validation("Password must not exceed 128 characters".into()));
    }
    if !value.chars().any(|c| c.is_uppercase()) {
        return Err(AppError::Validation("Password must contain at least one uppercase letter".into()));
    }
    if !value.chars().any(|c| c.is_lowercase()) {
        return Err(AppError::Validation("Password must contain at least one lowercase letter".into()));
    }
    if !value.chars().any(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation("Password must contain at least one digit".into()));
    }
    Ok(())
}

pub async fn check_user_permission(pool: &PgPool, user_id: &str, permission: &str) -> Result<bool, AppError> {
    let role_name: Option<String> = sqlx::query_scalar("SELECT role FROM users WHERE id=$1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    let role_name = role_name.ok_or_else(|| AppError::NotFound("User not found".into()))?;
    let perms_json: String = sqlx::query_scalar("SELECT permissions FROM roles WHERE name=$1")
        .bind(&role_name)
        .fetch_optional(pool)
        .await?
        .unwrap_or_else(|| "[]".into());
    let perms: Vec<String> = serde_json::from_str(&perms_json).unwrap_or_default();
    if perms.contains(&"*".to_string()) { return Ok(true); }
    Ok(perms.contains(&permission.to_string()))
}
