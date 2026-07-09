use tauri::State;
use crate::db_pool::DbPool;
use crate::models::LabelTemplate;
use crate::error::AppError;
use sqlx::Row;

const COLS: &str = "id, name, layout_style, show_sku, show_name, show_company, show_qty, show_price, show_barcode, show_qr, show_category, show_supplier, show_location, show_expiry, show_batch, show_min_stock, show_logo, show_border, qr_size, border_style, font_scale, template_type, label_width_mm, label_height_mm, created_at, updated_at";

fn row_to_template(row: &sqlx::postgres::PgRow) -> LabelTemplate {
    LabelTemplate {
        id: row.get("id"),
        name: row.get("name"),
        layout_style: row.get("layout_style"),
        show_sku: row.get("show_sku"),
        show_name: row.get("show_name"),
        show_company: row.get("show_company"),
        show_qty: row.get("show_qty"),
        show_price: row.get("show_price"),
        show_barcode: row.get("show_barcode"),
        show_qr: row.get("show_qr"),
        show_category: row.get("show_category"),
        show_supplier: row.get("show_supplier"),
        show_location: row.get("show_location"),
        show_expiry: row.get("show_expiry"),
        show_batch: row.get("show_batch"),
        show_min_stock: row.get("show_min_stock"),
        show_logo: row.get("show_logo"),
        show_border: row.get("show_border"),
        qr_size: row.get("qr_size"),
        border_style: row.get("border_style"),
        font_scale: row.get("font_scale"),
        template_type: row.get("template_type"),
        label_width_mm: row.get("label_width_mm"),
        label_height_mm: row.get("label_height_mm"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

#[tauri::command]
pub async fn get_label_templates(pool: State<'_, DbPool>, token: String) -> Result<Vec<LabelTemplate>, AppError> {
    pool.verify_token(&token)?;
    let sql = format!("SELECT {} FROM label_templates ORDER BY name", COLS);
    let rows = sqlx::query(&sql).fetch_all(&pool.pool).await?;
    Ok(rows.iter().map(row_to_template).collect())
}

#[tauri::command]
pub async fn get_label_template(pool: State<'_, DbPool>, token: String, id: String) -> Result<LabelTemplate, AppError> {
    pool.verify_token(&token)?;
    let sql = format!("SELECT {} FROM label_templates WHERE id=$1", COLS);
    let row = sqlx::query(&sql).bind(&id).fetch_one(&pool.pool).await?;
    Ok(row_to_template(&row))
}

#[tauri::command]
pub async fn save_label_template(pool: State<'_, DbPool>, token: String, template: LabelTemplate) -> Result<LabelTemplate, AppError> {
    pool.verify_token(&token)?;
    let id = if template.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        template.id.clone()
    };
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        r#"INSERT INTO label_templates
           (id, name, layout_style, show_sku, show_name, show_company, show_qty, show_price, show_barcode, show_qr,
            show_category, show_supplier, show_location, show_expiry, show_batch, show_min_stock, show_logo, show_border,
            qr_size, border_style, font_scale, template_type, label_width_mm, label_height_mm, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25)
           ON CONFLICT (id) DO UPDATE SET
               name=EXCLUDED.name, layout_style=EXCLUDED.layout_style,
               show_sku=EXCLUDED.show_sku, show_name=EXCLUDED.show_name, show_company=EXCLUDED.show_company,
               show_qty=EXCLUDED.show_qty, show_price=EXCLUDED.show_price,
               show_barcode=EXCLUDED.show_barcode, show_qr=EXCLUDED.show_qr,
               show_category=EXCLUDED.show_category, show_supplier=EXCLUDED.show_supplier,
               show_location=EXCLUDED.show_location, show_expiry=EXCLUDED.show_expiry,
               show_batch=EXCLUDED.show_batch, show_min_stock=EXCLUDED.show_min_stock,
               show_logo=EXCLUDED.show_logo, show_border=EXCLUDED.show_border,
               qr_size=EXCLUDED.qr_size, border_style=EXCLUDED.border_style,
               font_scale=EXCLUDED.font_scale, template_type=EXCLUDED.template_type,
               label_width_mm=EXCLUDED.label_width_mm, label_height_mm=EXCLUDED.label_height_mm,
               updated_at=EXCLUDED.updated_at"#,
    )
    .bind(&id).bind(&template.name).bind(&template.layout_style)
    .bind(template.show_sku).bind(template.show_name).bind(template.show_company)
    .bind(template.show_qty).bind(template.show_price)
    .bind(template.show_barcode).bind(template.show_qr)
    .bind(template.show_category).bind(template.show_supplier).bind(template.show_location)
    .bind(template.show_expiry).bind(template.show_batch).bind(template.show_min_stock)
    .bind(template.show_logo).bind(template.show_border)
    .bind(&template.qr_size).bind(&template.border_style).bind(template.font_scale)
    .bind(&template.template_type).bind(template.label_width_mm).bind(template.label_height_mm)
    .bind(&now)
    .execute(&pool.pool).await?;
    let sql = format!("SELECT {} FROM label_templates WHERE id=$1", COLS);
    let row = sqlx::query(&sql).bind(&id).fetch_one(&pool.pool).await?;
    Ok(row_to_template(&row))
}

#[tauri::command]
pub async fn delete_label_template(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    pool.verify_token(&token)?;
    let protected = vec!["default", "company", "asset_standard", "branded", "rack_label", "full_card", "mini_thermal", "qr_only", "two_side"];
    if protected.contains(&id.as_str()) {
        return Err(AppError::Validation("Cannot delete system templates".into()));
    }
    sqlx::query("DELETE FROM label_templates WHERE id=$1")
        .bind(&id).execute(&pool.pool).await?;
    Ok(())
}
