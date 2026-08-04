pub mod auth;
pub mod users;
pub mod materials;
pub mod categories;
pub mod units;
pub mod suppliers;
pub mod warehouses;
pub mod racks;
pub mod transactions;
pub mod stock_opname;
pub mod transfers;
pub mod dashboard;
pub mod cost_analysis;
pub mod material_analysis;
pub mod consumption;
pub mod abc;
pub mod forecast;
pub mod advanced;
pub mod label_templates;
pub mod settings_handler;
pub mod reports;
pub mod batch;
pub mod cycle_reports;

/// Shared audit helper – writes a row to the audit_log table from HTTP handlers.
/// Logs a warning on failure without blocking the request.
pub async fn audit(
    pool: &sqlx::PgPool,
    user_id: &str,
    action: &str,
    entity: &str,
    entity_id: &str,
    details: &str,
) {
    if let Err(e) = sqlx::query(
        "INSERT INTO audit_log (id, user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(user_id)
    .bind(action)
    .bind(entity)
    .bind(entity_id)
    .bind(details)
    .execute(pool)
    .await
    {
        log::warn!("audit_log failed ({} {} {}): {}", action, entity, entity_id, e);
    }
}
