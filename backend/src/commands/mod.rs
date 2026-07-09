pub mod auth;
pub mod materials;
pub mod transactions;
pub mod warehouse;
pub mod analysis;
pub mod reports;
pub mod settings;
pub mod advanced;
pub mod label_templates;

pub use auth::*;
pub use materials::*;
pub use transactions::*;
pub use warehouse::*;
pub use analysis::*;
pub use reports::*;
pub use settings::*;
pub use advanced::*;
pub use label_templates::*;

pub(crate) fn gen_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Shared audit helper – writes a row to the audit_log table.
/// Can be called from any command module.
pub async fn audit_log(
    pool: &sqlx::PgPool,
    user_id: &str,
    action: &str,
    entity: &str,
    entity_id: &str,
    details: &str,
) {
    sqlx::query(
        "INSERT INTO audit_log (id, user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(gen_id())
    .bind(user_id)
    .bind(action)
    .bind(entity)
    .bind(entity_id)
    .bind(details)
    .execute(pool)
    .await
    .ok();
}
