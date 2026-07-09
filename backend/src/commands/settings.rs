use tauri::State;
use crate::db_pool::DbPool;
use crate::models::{User, Category, CategoryTreeNode, Unit, UnitConversion, Supplier, SupplierRating, SupplierPrice, AuditLog, CompanyProfile, NotificationConfig, Role, AppConfig};
use crate::error::AppError;
use crate::validate;
use tauri::AppHandle;
use tauri::Manager;
use sqlx::Row;

// --- Users ---
#[tauri::command]
pub async fn get_users(db: State<'_, DbPool>, token: String) -> Result<Vec<User>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, username, password_hash, full_name, email, role, is_active, photo, last_login_at, last_login_ip, password_changed_at, created_at, updated_at FROM users ORDER BY username"
    )
    .fetch_all(&db.pool)
    .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(User {
            id: row.get(0), username: row.get(1), password_hash: row.get(2),
            full_name: row.get(3), email: row.get(4), role: row.get(5),
            is_active: row.get::<bool, _>(6), photo: row.get(7),
            last_login_at: row.get::<Option<String>, _>(8), last_login_ip: row.get(9),
            password_changed_at: row.get::<Option<String>, _>(10),
            created_at: row.get(11), updated_at: row.get(12),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn create_user(db: State<'_, DbPool>, token: String, username: String, password: String, full_name: String, role: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_users").await? { return Err(AppError::Auth("Permission denied".into())); }
    validate::validate_string(&username, "Username", 50)?;
    validate::validate_string(&password, "Password", 255)?;
    validate::validate_string(&full_name, "Full name", 255)?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE username=$1")
        .bind(&username).fetch_one(&db.pool).await?;
    if exists > 0 {
        return Err(AppError::Validation(format!("Username '{}' already exists", username)));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let hash = bcrypt::hash(&password, 12).map_err(|e| AppError::Internal(e.to_string()))?;
    sqlx::query("INSERT INTO users (id, username, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id).bind(&username).bind(&hash).bind(&full_name).bind(&role)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn update_user(db: State<'_, DbPool>, token: String, id: String, full_name: String, email: String, role: String, is_active: bool) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_users").await? { return Err(AppError::Auth("Permission denied".into())); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE users SET full_name=$1, email=$2, role=$3, is_active=$4, updated_at=$5 WHERE id=$6")
        .bind(&full_name).bind(&email).bind(&role).bind(is_active).bind(&now).bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn update_user_photo(db: State<'_, DbPool>, token: String, id: String, photo: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    sqlx::query("UPDATE users SET photo=$1 WHERE id=$2")
        .bind(&photo).bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn change_password(db: State<'_, DbPool>, token: String, id: String, new_password: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    let hash = bcrypt::hash(&new_password, 12).map_err(|e| AppError::Internal(e.to_string()))?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE users SET password_hash=$1, password_changed_at=$2 WHERE id=$3")
        .bind(&hash).bind(&now).bind(&id)
        .execute(&db.pool)
        .await?;
    let mut sessions = db.sessions.lock().map_err(|_| AppError::Lock("Session mutex poisoned".into()))?;
    sessions.retain(|_, v| v.0 != id);
    Ok(())
}

#[tauri::command]
pub async fn delete_user(db: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_users").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM users WHERE id=$1 AND username != 'admin'")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_user_activity(db: State<'_, DbPool>, token: String, user_id: String) -> Result<Vec<serde_json::Value>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, activity, details, ip_address, created_at FROM user_activity_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100")
        .bind(&user_id)
        .fetch_all(&db.pool)
        .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(serde_json::json!({
            "id": row.get::<String, _>(0),
            "activity": row.get::<String, _>(1),
            "details": row.get::<String, _>(2),
            "ip_address": row.get::<String, _>(3),
            "created_at": row.get::<String, _>(4),
        }))
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn log_user_activity(db: State<'_, DbPool>, token: String, user_id: String, activity: String, details: String, ip_address: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO user_activity_log (id, user_id, activity, details, ip_address) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id).bind(&user_id).bind(&activity).bind(&details).bind(&ip_address)
        .execute(&db.pool)
        .await?;
    Ok(())
}

// --- Categories ---
#[tauri::command]
pub async fn get_categories(db: State<'_, DbPool>, token: String, search: Option<String>) -> Result<Vec<Category>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, name, description, parent_id, icon, color, created_at FROM categories WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%') ORDER BY name"
    )
    .bind(&search)
    .fetch_all(&db.pool)
    .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(Category {
            id: row.get(0), name: row.get(1), description: row.get(2),
            parent_id: row.get::<Option<String>, _>(3), icon: row.get(4), color: row.get(5), created_at: row.get(6),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn get_category_tree(db: State<'_, DbPool>, token: String) -> Result<Vec<CategoryTreeNode>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, name, description, parent_id, icon, color, created_at FROM categories ORDER BY name")
        .fetch_all(&db.pool)
        .await?;
    let all: Vec<Category> = rows.iter().map(|row| {
        Category {
            id: row.get(0), name: row.get(1), description: row.get(2),
            parent_id: row.get::<Option<String>, _>(3), icon: row.get(4), color: row.get(5), created_at: row.get(6),
        }
    }).collect();

    fn build_tree(parent_id: Option<String>, all: &[Category]) -> Vec<CategoryTreeNode> {
        all.iter().filter(|c| c.parent_id == parent_id).map(|c| {
            let children = build_tree(Some(c.id.clone()), all);
            CategoryTreeNode {
                id: c.id.clone(), name: c.name.clone(), description: c.description.clone(),
                parent_id: c.parent_id.clone(), icon: c.icon.clone(), color: c.color.clone(),
                created_at: c.created_at.clone(), children,
            }
        }).collect()
    }

    Ok(build_tree(None, &all))
}

#[tauri::command]
pub async fn create_category(db: State<'_, DbPool>, token: String, name: String, description: String, parent_id: Option<String>, icon: String, color: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    validate::validate_string(&name, "Category name", 100)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO categories (id, name, description, parent_id, icon, color) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&name).bind(&description).bind(&parent_id).bind(&icon).bind(&color)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn update_category(db: State<'_, DbPool>, token: String, id: String, name: String, description: String, parent_id: Option<String>, icon: String, color: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE categories SET name=$1, description=$2, parent_id=$3, icon=$4, color=$5 WHERE id=$6")
        .bind(&name).bind(&description).bind(&parent_id).bind(&icon).bind(&color).bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_category(db: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE categories SET parent_id=NULL WHERE parent_id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    sqlx::query("DELETE FROM categories WHERE id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

// --- Units ---
#[tauri::command]
pub async fn get_units(db: State<'_, DbPool>, token: String, search: Option<String>) -> Result<Vec<Unit>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, name, symbol, category, created_at FROM units WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%') ORDER BY name"
    )
    .bind(&search)
    .fetch_all(&db.pool)
    .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(Unit { id: row.get(0), name: row.get(1), symbol: row.get(2), category: row.get(3), created_at: row.get(4) })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn create_unit(db: State<'_, DbPool>, token: String, name: String, symbol: String, category: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    validate::validate_string(&name, "Unit name", 50)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO units (id, name, symbol, category) VALUES ($1,$2,$3,$4)")
        .bind(&id).bind(&name).bind(&symbol).bind(&category)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn update_unit(db: State<'_, DbPool>, token: String, id: String, name: String, symbol: String, category: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE units SET name=$1, symbol=$2, category=$3 WHERE id=$4")
        .bind(&name).bind(&symbol).bind(&category).bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_unit(db: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM unit_conversions WHERE from_unit_id=$1 OR to_unit_id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    sqlx::query("DELETE FROM units WHERE id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

// --- Unit Conversions ---
#[tauri::command]
pub async fn get_unit_conversions(db: State<'_, DbPool>, token: String) -> Result<Vec<UnitConversion>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT uc.id, uc.from_unit_id, uc.to_unit_id, uc.factor, u1.name, u1.symbol, u2.name, u2.symbol, uc.created_at
         FROM unit_conversions uc
         JOIN units u1 ON uc.from_unit_id=u1.id
         JOIN units u2 ON uc.to_unit_id=u2.id
         ORDER BY u1.name"
    )
    .fetch_all(&db.pool)
    .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(UnitConversion {
            id: row.get(0), from_unit_id: row.get(1), to_unit_id: row.get(2),
            factor: row.get(3),
            from_unit_name: row.get(4), from_unit_symbol: row.get(5),
            to_unit_name: row.get(6), to_unit_symbol: row.get(7), created_at: row.get(8),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn create_unit_conversion(db: State<'_, DbPool>, token: String, from_unit_id: String, to_unit_id: String, factor: f64) -> Result<(), AppError> {
    db.verify_token(&token)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO unit_conversions (id, from_unit_id, to_unit_id, factor) VALUES ($1,$2,$3,$4)")
        .bind(&id).bind(&from_unit_id).bind(&to_unit_id).bind(factor)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_unit_conversion(db: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    sqlx::query("DELETE FROM unit_conversions WHERE id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn convert_unit(db: State<'_, DbPool>, token: String, from_unit_id: String, to_unit_id: String, quantity: f64) -> Result<f64, AppError> {
    db.verify_token(&token)?;
    let direct: Option<f64> = sqlx::query_scalar(
        "SELECT factor FROM unit_conversions WHERE from_unit_id=$1 AND to_unit_id=$2"
    )
    .bind(&from_unit_id).bind(&to_unit_id)
    .fetch_optional(&db.pool)
    .await?;
    let factor = match direct {
        Some(f) => f,
        None => {
            sqlx::query_scalar(
                "SELECT 1.0/factor FROM unit_conversions WHERE from_unit_id=$1 AND to_unit_id=$2"
            )
            .bind(&to_unit_id).bind(&from_unit_id)
            .fetch_optional(&db.pool)
            .await?
            .unwrap_or(1.0)
        }
    };
    Ok(quantity * factor)
}

// --- Suppliers ---
#[tauri::command]
pub async fn get_suppliers(db: State<'_, DbPool>, token: String, search: Option<String>) -> Result<Vec<Supplier>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, name, contact, phone, email, address, contact_person, pic_phone, pic_email, created_at FROM suppliers WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR contact ILIKE '%' || $1 || '%') ORDER BY name"
    )
    .bind(&search)
    .fetch_all(&db.pool)
    .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(Supplier {
            id: row.get(0), name: row.get(1), contact: row.get(2), phone: row.get(3),
            email: row.get(4), address: row.get(5), contact_person: row.get(6),
            pic_phone: row.get(7), pic_email: row.get(8), created_at: row.get(9),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn create_supplier(db: State<'_, DbPool>, token: String, supplier: Supplier) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    validate::validate_string(&supplier.name, "Supplier name", 255)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO suppliers (id, name, contact, phone, email, address, contact_person, pic_phone, pic_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)"
    )
    .bind(&id).bind(&supplier.name).bind(&supplier.contact).bind(&supplier.phone)
    .bind(&supplier.email).bind(&supplier.address).bind(&supplier.contact_person)
    .bind(&supplier.pic_phone).bind(&supplier.pic_email)
    .execute(&db.pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn update_supplier(db: State<'_, DbPool>, token: String, supplier: Supplier) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query(
        "UPDATE suppliers SET name=$1, contact=$2, phone=$3, email=$4, address=$5, contact_person=$6, pic_phone=$7, pic_email=$8 WHERE id=$9"
    )
    .bind(&supplier.name).bind(&supplier.contact).bind(&supplier.phone)
    .bind(&supplier.email).bind(&supplier.address).bind(&supplier.contact_person)
    .bind(&supplier.pic_phone).bind(&supplier.pic_email).bind(&supplier.id)
    .execute(&db.pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_supplier(db: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_settings").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM supplier_ratings WHERE supplier_id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    sqlx::query("DELETE FROM supplier_prices WHERE supplier_id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    sqlx::query("DELETE FROM suppliers WHERE id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

// --- Supplier Ratings ---
#[tauri::command]
pub async fn get_supplier_ratings(db: State<'_, DbPool>, token: String, supplier_id: String) -> Result<Vec<SupplierRating>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, supplier_id, metric, score, period, notes, created_at FROM supplier_ratings WHERE supplier_id=$1 ORDER BY period DESC")
        .bind(&supplier_id)
        .fetch_all(&db.pool)
        .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(SupplierRating {
            id: row.get(0), supplier_id: row.get(1), metric: row.get(2),
            score: row.get(3), period: row.get(4), notes: row.get(5), created_at: row.get(6),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn create_supplier_rating(db: State<'_, DbPool>, token: String, supplier_id: String, metric: String, score: f64, period: String, notes: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO supplier_ratings (id, supplier_id, metric, score, period, notes) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&supplier_id).bind(&metric).bind(score).bind(&period).bind(&notes)
        .execute(&db.pool)
        .await?;
    Ok(())
}

// --- Supplier Prices ---
#[tauri::command]
pub async fn get_supplier_prices(db: State<'_, DbPool>, token: String, supplier_id: String) -> Result<Vec<SupplierPrice>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT sp.id, sp.supplier_id, sp.material_id, COALESCE(m.name,''), sp.price, sp.date, sp.created_at
         FROM supplier_prices sp
         LEFT JOIN materials m ON sp.material_id=m.id
         WHERE sp.supplier_id=$1 ORDER BY sp.date DESC"
    )
    .bind(&supplier_id)
    .fetch_all(&db.pool)
    .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(SupplierPrice {
            id: row.get(0), supplier_id: row.get(1), material_id: row.get(2),
            material_name: row.get(3), price: row.get(4), date: row.get(5), created_at: row.get(6),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn create_supplier_price(db: State<'_, DbPool>, token: String, supplier_id: String, material_id: String, price: f64, date: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO supplier_prices (id, supplier_id, material_id, price, date) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id).bind(&supplier_id).bind(&material_id).bind(price).bind(&date)
        .execute(&db.pool)
        .await?;
    Ok(())
}

// --- Audit Log ---
#[tauri::command]
pub async fn get_audit_logs(db: State<'_, DbPool>, token: String) -> Result<Vec<AuditLog>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, user_id, action, entity, entity_id, details, created_at FROM audit_log ORDER BY created_at DESC LIMIT 200")
        .fetch_all(&db.pool)
        .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(AuditLog {
            id: row.get(0), user_id: row.get::<Option<String>, _>(1), action: row.get(2),
            entity: row.get(3), entity_id: row.get::<Option<String>, _>(4),
            details: row.get(5), created_at: row.get(6),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn get_audit_logs_filtered(
    db: State<'_, DbPool>, token: String,
    action: Option<String>, entity: Option<String>, user_id: Option<String>,
    date_start: Option<String>, date_end: Option<String>, limit: Option<i64>,
) -> Result<Vec<AuditLog>, AppError> {
    db.verify_token(&token)?;
    let limit_val = limit.unwrap_or(200);
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT id, user_id, action, entity, entity_id, details, created_at FROM audit_log WHERE 1=1"
    );
    if let Some(ref a) = action {
        builder.push(" AND action = ");
        builder.push_bind(a.as_str());
    }
    if let Some(ref e) = entity {
        builder.push(" AND entity = ");
        builder.push_bind(e.as_str());
    }
    if let Some(ref u) = user_id {
        builder.push(" AND user_id = ");
        builder.push_bind(u.as_str());
    }
    if let Some(ref d) = date_start {
        builder.push(" AND created_at >= ");
        builder.push_bind(d.as_str());
    }
    if let Some(ref d) = date_end {
        builder.push(" AND created_at < (");
        builder.push_bind(d.as_str());
        builder.push("::date + interval '1 day')");
    }
    builder.push(" ORDER BY created_at DESC LIMIT ");
    builder.push_bind(limit_val);

    let rows = builder.build().fetch_all(&db.pool).await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(AuditLog {
            id: row.get(0), user_id: row.get::<Option<String>, _>(1), action: row.get(2),
            entity: row.get(3), entity_id: row.get::<Option<String>, _>(4),
            details: row.get(5), created_at: row.get(6),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn count_audit_logs_filtered(
    db: State<'_, DbPool>, token: String,
    action: Option<String>, entity: Option<String>, user_id: Option<String>,
    date_start: Option<String>, date_end: Option<String>,
) -> Result<i64, AppError> {
    db.verify_token(&token)?;
    let mut builder = sqlx::QueryBuilder::new("SELECT COUNT(*) FROM audit_log WHERE 1=1");
    if let Some(ref a) = action { builder.push(" AND action = ").push_bind(a.as_str()); }
    if let Some(ref e) = entity { builder.push(" AND entity = ").push_bind(e.as_str()); }
    if let Some(ref u) = user_id { builder.push(" AND user_id = ").push_bind(u.as_str()); }
    if let Some(ref d) = date_start { builder.push(" AND created_at >= ").push_bind(d.as_str()); }
    if let Some(ref d) = date_end { builder.push(" AND created_at < (").push_bind(d.as_str()); builder.push("::date + interval '1 day')"); }
    let count: i64 = builder.build().fetch_one(&db.pool).await?.get(0);
    Ok(count)
}

#[tauri::command]
pub async fn add_audit_log(db: State<'_, DbPool>, token: String, user_id: Option<String>, action: String, entity: String, entity_id: Option<String>, details: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO audit_log (id, user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&user_id).bind(&action).bind(&entity).bind(&entity_id).bind(&details)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn purge_old_audit_logs(db: State<'_, DbPool>, token: String, months: i64) -> Result<i64, AppError> {
    db.verify_token(&token)?;
    let result = sqlx::query("DELETE FROM audit_log WHERE created_at < NOW() - ($1 * interval '1 month')")
        .bind(months)
        .execute(&db.pool)
        .await?;
    Ok(result.rows_affected() as i64)
}

#[tauri::command]
pub async fn export_audit_csv_filtered(
    db: State<'_, DbPool>, token: String,
    action: Option<String>, entity: Option<String>, user_id: Option<String>,
    date_start: Option<String>, date_end: Option<String>, limit: Option<i64>,
) -> Result<String, AppError> {
    db.verify_token(&token)?;
    let limit_val = limit.unwrap_or(500);
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT a.id, a.user_id, COALESCE(u.username, 'System'), a.action, a.entity, a.entity_id, a.details, a.created_at FROM audit_log a LEFT JOIN users u ON a.user_id=u.id WHERE 1=1"
    );
    if let Some(ref a) = action {
        builder.push(" AND a.action = ");
        builder.push_bind(a.as_str());
    }
    if let Some(ref e) = entity {
        builder.push(" AND a.entity = ");
        builder.push_bind(e.as_str());
    }
    if let Some(ref u) = user_id {
        builder.push(" AND a.user_id = ");
        builder.push_bind(u.as_str());
    }
    if let Some(ref d) = date_start {
        builder.push(" AND a.created_at >= ");
        builder.push_bind(d.as_str());
    }
    if let Some(ref d) = date_end {
        builder.push(" AND a.created_at < (");
        builder.push_bind(d.as_str());
        builder.push("::date + interval '1 day')");
    }
    builder.push(" ORDER BY a.created_at DESC LIMIT ");
    builder.push_bind(limit_val);

    let rows = builder.build().fetch_all(&db.pool).await?;
    let mut csv = String::from("ID,User ID,Username,Action,Entity,Entity ID,Details,Created At\n");
    for row in rows {
        let id: String = row.get(0);
        let uid: Option<String> = row.get(1);
        let uname: String = row.get(2);
        let action: String = row.get(3);
        let entity: String = row.get(4);
        let eid: Option<String> = row.get(5);
        let details: String = row.get(6);
        let created: String = row.get(7);
        csv.push_str(&format!("{},{},{},{},{},{},{},{}\n",
            id, uid.unwrap_or_default(), uname, action, entity, eid.unwrap_or_default(),
            details.replace(',', ";").replace('\n', " "), created));
    }
    Ok(csv)
}

// --- Company Profile ---
#[tauri::command]
pub async fn get_company_profile(db: State<'_, DbPool>, token: String) -> Result<Option<CompanyProfile>, AppError> {
    db.verify_token(&token)?;
    let row = sqlx::query(
        "SELECT id, company_name, address, phone, email, logo, npwp, updated_at FROM company_profile LIMIT 1"
    )
    .fetch_optional(&db.pool)
    .await?;

    match row {
        Some(r) => Ok(Some(CompanyProfile {
            id: r.get(0), company_name: r.get(1), address: r.get(2),
            phone: r.get(3), email: r.get(4), logo: r.get(5),
            npwp: r.get(6), updated_at: r.get(7),
        })),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn save_company_profile(db: State<'_, DbPool>, token: String, company_name: String, address: String, phone: String, email: String, logo: String, npwp: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let existing: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM company_profile")
        .fetch_one(&db.pool)
        .await
        .unwrap_or(false);
    if existing {
        sqlx::query("UPDATE company_profile SET company_name=$1, address=$2, phone=$3, email=$4, logo=$5, npwp=$6, updated_at=$7")
            .bind(&company_name).bind(&address).bind(&phone).bind(&email).bind(&logo).bind(&npwp).bind(&now)
            .execute(&db.pool)
            .await?;
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO company_profile (id, company_name, address, phone, email, logo, npwp, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&id).bind(&company_name).bind(&address).bind(&phone).bind(&email).bind(&logo).bind(&npwp).bind(&now)
            .execute(&db.pool)
            .await?;
    }
    Ok(())
}

// --- App Config ---
#[tauri::command]
pub async fn get_app_config(db: State<'_, DbPool>, token: String, key: String) -> Result<String, AppError> {
    db.verify_token(&token)?;
    let val: Option<String> = sqlx::query_scalar("SELECT value FROM app_config WHERE key=$1")
        .bind(&key)
        .fetch_optional(&db.pool)
        .await?;
    Ok(val.unwrap_or_default())
}

#[tauri::command]
pub async fn set_app_config(db: State<'_, DbPool>, token: String, key: String, value: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    sqlx::query("INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        .bind(&key).bind(&value)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_all_app_config(db: State<'_, DbPool>, token: String) -> Result<Vec<AppConfig>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query("SELECT key, value FROM app_config ORDER BY key")
        .fetch_all(&db.pool)
        .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(AppConfig { key: row.get(0), value: row.get(1) })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn delete_app_config(db: State<'_, DbPool>, token: String, key: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    sqlx::query("DELETE FROM app_config WHERE key=$1")
        .bind(&key)
        .execute(&db.pool)
        .await?;
    Ok(())
}

// --- Notification Config ---
#[tauri::command]
pub async fn get_notification_config(db: State<'_, DbPool>, token: String) -> Result<Vec<NotificationConfig>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, config_key, config_value FROM notification_config")
        .fetch_all(&db.pool)
        .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(NotificationConfig { id: row.get(0), config_key: row.get(1), config_value: row.get(2) })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn set_notification_config(db: State<'_, DbPool>, token: String, config_key: String, config_value: String) -> Result<(), AppError> {
    db.verify_token(&token)?;
    let existing: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM notification_config WHERE config_key=$1")
        .bind(&config_key)
        .fetch_one(&db.pool)
        .await
        .unwrap_or(false);
    if existing {
        sqlx::query("UPDATE notification_config SET config_value=$1 WHERE config_key=$2")
            .bind(&config_value).bind(&config_key)
            .execute(&db.pool)
            .await?;
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO notification_config (id, config_key, config_value) VALUES ($1, $2, $3)")
            .bind(&id).bind(&config_key).bind(&config_value)
            .execute(&db.pool)
            .await?;
    }
    Ok(())
}

// --- Backup & Restore ---
#[tauri::command]
pub async fn backup_database(db: State<'_, DbPool>, token: String, app_handle: AppHandle) -> Result<String, AppError> {
    db.verify_token(&token)?;
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| AppError::Internal("DATABASE_URL environment variable not set".into()))?;
    let app_dir = app_handle.path().app_data_dir().map_err(|e| AppError::Internal(e.to_string()))?;
    let backup_path = app_dir.join(format!("thermaltrue_backup_{}.sql", chrono::Local::now().format("%Y%m%d_%H%M%S")));
    let backup_dir = backup_path.parent().unwrap();
    tokio::fs::create_dir_all(backup_dir).await.map_err(|e| AppError::Db(format!("create backup dir: {}", e)))?;
    let output = tokio::process::Command::new("pg_dump")
        .arg("-d").arg(&database_url)
        .arg("-f").arg(&backup_path)
        .arg("--no-owner")
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to run pg_dump: {}", e)))?;
    if !output.status.success() {
        return Err(AppError::Internal(format!("pg_dump failed: {}", String::from_utf8_lossy(&output.stderr))));
    }
    Ok(backup_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn restore_database(db: State<'_, DbPool>, token: String, backup_path: String, _app_handle: AppHandle) -> Result<String, AppError> {
    db.verify_token(&token)?;
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| AppError::Internal("DATABASE_URL environment variable not set".into()))?;
    let output = tokio::process::Command::new("psql")
        .arg("-d").arg(&database_url)
        .arg("-f").arg(&backup_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to run psql: {}", e)))?;
    if !output.status.success() {
        return Err(AppError::Internal(format!("psql restore failed: {}", String::from_utf8_lossy(&output.stderr))));
    }
    Ok("Database restored successfully".into())
}

#[tauri::command]
pub async fn get_db_stats(db: State<'_, DbPool>, token: String) -> Result<serde_json::Value, AppError> {
    db.verify_token(&token)?;
    let materials: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM materials")
        .fetch_one(&db.pool).await?;
    let transactions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions")
        .fetch_one(&db.pool).await?;
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&db.pool).await?;
    let categories: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
        .fetch_one(&db.pool).await?;
    Ok(serde_json::json!({
        "materials": materials, "transactions": transactions,
        "users": users, "categories": categories
    }))
}

// --- QR Code ---
#[tauri::command]
pub fn generate_qr_code(db: State<'_, DbPool>, token: String, data: String) -> Result<String, AppError> {
    db.verify_token(&token)?;
    use qrcode::QrCode;
    use image::Luma;
    let code = QrCode::new(data.as_bytes()).map_err(|e| AppError::Internal(e.to_string()))?;
    let img = code.render::<Luma<u8>>().build();
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).map_err(|e| AppError::Internal(e.to_string()))?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, buf.get_ref());
    Ok(format!("data:image/png;base64,{}", b64))
}

// --- Roles ---
#[tauri::command]
pub async fn get_roles(db: State<'_, DbPool>, token: String) -> Result<Vec<Role>, AppError> {
    db.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, name, description, permissions, is_system, created_at FROM roles ORDER BY name")
        .fetch_all(&db.pool)
        .await?;
    let list = rows.iter().map(|row| {
        Ok::<_, AppError>(Role {
            id: row.get(0), name: row.get(1), description: row.get(2),
            permissions: row.get(3), is_system: row.get::<bool, _>(4),
            created_at: row.get(5),
        })
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(list)
}

#[tauri::command]
pub async fn clone_role(db: State<'_, DbPool>, token: String, source_role_id: String, new_name: String, new_description: String) -> Result<Role, AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_users").await? {
        return Err(AppError::Auth("Permission denied: manage_users required".into()));
    }
    let row = sqlx::query("SELECT id, name, description, permissions, is_system, created_at FROM roles WHERE id=$1")
        .bind(&source_role_id)
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Role not found".into()))?;
    let source = Role {
        id: row.get(0), name: row.get(1), description: row.get(2),
        permissions: row.get(3), is_system: row.get::<bool, _>(4),
        created_at: row.get(5),
    };
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO roles (id, name, description, permissions, is_system) VALUES ($1, $2, $3, $4, false)")
        .bind(&id).bind(&new_name).bind(&new_description).bind(&source.permissions)
        .execute(&db.pool)
        .await?;
    Ok(Role { id, name: new_name, description: new_description, permissions: source.permissions, is_system: false, created_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string() })
}

#[tauri::command]
pub async fn check_permission(db: State<'_, DbPool>, token: String, permission: String) -> Result<bool, AppError> {
    let user_id = db.verify_token(&token)?;
    validate::check_user_permission(&db.pool, &user_id, &permission).await
}

#[tauri::command]
pub async fn update_role(db: State<'_, DbPool>, token: String, id: String, name: String, description: String, permissions: String) -> Result<(), AppError> {
    let user_id = db.verify_token(&token)?;
    if !validate::check_user_permission(&db.pool, &user_id, "manage_users").await? {
        return Err(AppError::Auth("Permission denied: manage_users required".into()));
    }
    sqlx::query("UPDATE roles SET name=$1, description=$2, permissions=$3 WHERE id=$4 AND is_system=false")
        .bind(&name).bind(&description).bind(&permissions).bind(&id)
        .execute(&db.pool)
        .await?;
    Ok(())
}
