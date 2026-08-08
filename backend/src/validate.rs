use sqlx::{PgPool, Postgres, QueryBuilder};
use crate::error::AppError;

/// Scope of warehouses a user is allowed to see/operate.
/// `All` = admin (no restriction). `Restricted(ids)` = non-admin bound list.
#[derive(Debug, Clone)]
pub enum WhScope {
    All,
    Restricted(Vec<String>),
}

impl WhScope {
    pub fn is_all(&self) -> bool {
        matches!(self, WhScope::All)
    }

    pub fn allowed_ids(&self) -> Option<&Vec<String>> {
        match self {
            WhScope::All => None,
            WhScope::Restricted(ids) => Some(ids),
        }
    }

    pub fn is_allowed(&self, wh: &str) -> bool {
        match self {
            WhScope::All => true,
            WhScope::Restricted(ids) => ids.iter().any(|x| x == wh),
        }
    }

    /// Effective concrete whitelist to enforce for a query given the requested
    /// warehouse param. `None` = no restriction (admin with no request).
    /// `Some(vec![..])` = bind to `col = ANY($n)`; empty vec forces no rows.
    pub fn filter_ids(&self, requested: Option<&str>) -> Option<Vec<String>> {
        let req = requested.filter(|s| !s.is_empty());
        match self {
            WhScope::All => req.map(|r| vec![r.to_string()]),
            WhScope::Restricted(ids) => Some(match req {
                Some(r) if ids.iter().any(|x| x == r) => vec![r.to_string()],
                Some(_) => Vec::new(),
                None => ids.clone(),
            }),
        }
    }

    /// Appends `AND col = ANY($n)` (or leaves the query untouched for `All` +
    /// no request) to a QueryBuilder-based query.
    pub fn apply_builder(
        &self,
        builder: &mut QueryBuilder<'_, Postgres>,
        col: &str,
        requested: Option<&str>,
    ) {
        if let Some(ids) = self.filter_ids(requested) {
            builder.push(" AND ").push(col).push(" = ANY(").push_bind(ids).push(")");
        }
    }
}

/// Warehouse scope for the requesting user (admin = All, others = user_warehouses).
pub async fn warehouse_scope(pool: &PgPool, user_id: &str) -> Result<WhScope, AppError> {
    let role: Option<String> = sqlx::query_scalar("SELECT role FROM users WHERE id=$1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    match role.as_deref() {
        Some("admin") => Ok(WhScope::All),
        None => Err(AppError::NotFound("User not found".into())),
        _ => {
            let rows: Vec<(String,)> =
                sqlx::query_as("SELECT warehouse_id FROM user_warehouses WHERE user_id=$1")
                    .bind(user_id)
                    .fetch_all(pool)
                    .await?;
            Ok(WhScope::Restricted(rows.into_iter().map(|r| r.0).collect()))
        }
    }
}

/// Gate helper for write/detail endpoints: true if the user may operate on the
/// given warehouse (admin always allowed, empty warehouse id = denied for non-admin).
pub async fn is_allowed_warehouse(pool: &PgPool, user_id: &str, wh: &str) -> Result<bool, AppError> {
    if wh.is_empty() {
        return Ok(false);
    }
    Ok(warehouse_scope(pool, user_id).await?.is_allowed(wh))
}

/// Multi-value gate (e.g. transfer from/to): every id must be allowed.
pub async fn ensure_warehouses_allowed(
    pool: &PgPool,
    user_id: &str,
    whs: &[&str],
) -> Result<bool, AppError> {
    let scope = warehouse_scope(pool, user_id).await?;
    Ok(whs.iter().all(|w| scope.is_allowed(w)))
}

/// Gate for material-scoped endpoints: material found + warehouse is within the user's scope.
pub async fn is_allowed_material(pool: &PgPool, user_id: &str, material_id: &str) -> Result<bool, AppError> {
    let wh: Option<String> = sqlx::query_scalar("SELECT warehouse_id FROM materials WHERE id=$1")
        .bind(material_id)
        .fetch_optional(pool)
        .await?;
    match wh {
        Some(w) => is_allowed_warehouse(pool, user_id, &w).await,
        None => Ok(false),
    }
}

/// Gate helper for create/update material: the target warehouse must be allowed,
/// or an empty/absent warehouse is permitted only for users with all-warehouse scope.
pub async fn is_allowed_material_wh(pool: &PgPool, user_id: &str, wh: &str) -> Result<bool, AppError> {
    if wh.is_empty() {
        return Ok(matches!(warehouse_scope(pool, user_id).await?, WhScope::All));
    }
    is_allowed_warehouse(pool, user_id, wh).await
}

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

pub async fn get_user_warehouses(pool: &PgPool, user_id: &str) -> Result<Vec<String>, AppError> {
    let role: Option<String> = sqlx::query_scalar("SELECT role FROM users WHERE id=$1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    if role.as_deref() == Some("admin") {
        return Ok(Vec::new()); // empty = all warehouses
    }
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT warehouse_id FROM user_warehouses WHERE user_id=$1"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
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
