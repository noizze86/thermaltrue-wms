use tauri::State;
use calamine::{Reader, DataType};
use serde::{Serialize, Deserialize};
use crate::db_pool::DbPool;
use crate::models::{Material, MaterialBatch, MaterialImage, StockValuation};
use crate::error::AppError;
use crate::validate;
use sqlx::Row;
use sqlx::QueryBuilder;

#[tauri::command]
pub async fn get_materials(pool: State<'_, DbPool>, token: String, search: Option<String>, category_id: Option<String>, warehouse_id: Option<String>) -> Result<Vec<Material>, AppError> {
    pool.verify_token(&token)?;
    let mut builder = QueryBuilder::new("SELECT id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at FROM materials WHERE 1=1");
    if let Some(ref s) = search {
        if !s.is_empty() {
            let pattern = format!("%{}%", s);
            builder.push(" AND (name LIKE ").push_bind(pattern.clone()).push(" OR sku LIKE ").push_bind(pattern).push(")");
        }
    }
    if let Some(ref c) = category_id {
        if !c.is_empty() && c != "all" {
            builder.push(" AND category_id = ").push_bind(c);
        }
    }
    if let Some(ref w) = warehouse_id {
        if !w.is_empty() && w != "all" {
            builder.push(" AND warehouse_id = ").push_bind(w);
        }
    }
    builder.push(" ORDER BY name ASC");
    let rows = builder.build().fetch_all(&pool.pool).await?;
    let materials = rows.iter().map(|row| Material {
        id: row.get("id"), sku: row.get("sku"), name: row.get("name"),
        description: row.get("description"), category_id: row.get("category_id"),
        unit_id: row.get("unit_id"), supplier_id: row.get("supplier_id"),
        warehouse_id: row.get("warehouse_id"), rack_id: row.get("rack_id"),
        quantity: row.get("quantity"), min_stock: row.get("min_stock"),
        max_stock: row.get("max_stock"), price: row.get("price"),
        image: row.get("image"), expiry_date: row.get("expiry_date"),
        is_active: row.get::<bool, _>("is_active"),
        created_at: row.get("created_at"), updated_at: row.get("updated_at"),
    }).collect();
    Ok(materials)
}

#[tauri::command]
pub async fn get_material(pool: State<'_, DbPool>, token: String, id: String) -> Result<Material, AppError> {
    pool.verify_token(&token)?;
    sqlx::query("SELECT id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at FROM materials WHERE id = $1")
        .bind(&id)
        .fetch_optional(&pool.pool)
        .await?
        .map(|row| Material {
            id: row.get("id"), sku: row.get("sku"), name: row.get("name"),
            description: row.get("description"), category_id: row.get("category_id"),
            unit_id: row.get("unit_id"), supplier_id: row.get("supplier_id"),
            warehouse_id: row.get("warehouse_id"), rack_id: row.get("rack_id"),
            quantity: row.get("quantity"), min_stock: row.get("min_stock"),
            max_stock: row.get("max_stock"), price: row.get("price"),
            image: row.get("image"), expiry_date: row.get("expiry_date"),
            is_active: row.get::<bool, _>("is_active"),
            created_at: row.get("created_at"), updated_at: row.get("updated_at"),
        })
        .ok_or_else(|| AppError::NotFound("Material not found".into()))
}

#[tauri::command]
pub async fn create_material(pool: State<'_, DbPool>, token: String, material: Material) -> Result<Material, AppError> {
    let user_id = pool.verify_token(&token)?;
    validate::validate_sku(&material.sku)?;
    validate::validate_string(&material.name, "Material name", 255)?;
    validate::validate_quantity(material.quantity, "Quantity")?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = uuid::Uuid::new_v4().to_string();
    let mut tx = pool.pool.begin().await.map_err(|e| AppError::Db(format!("begin tx: {}", e)))?;
    sqlx::query("INSERT INTO materials (id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())")
        .bind(&id).bind(&material.sku).bind(&material.name).bind(&material.description)
        .bind(&material.category_id).bind(&material.unit_id).bind(&material.supplier_id)
        .bind(&material.warehouse_id).bind(&material.rack_id).bind(material.quantity)
        .bind(material.min_stock).bind(material.max_stock).bind(material.price)
        .bind(&material.image).bind(&material.expiry_date).bind(material.is_active)
        .execute(&mut *tx).await?;
    let row = sqlx::query("SELECT id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at FROM materials WHERE id = $1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await.map_err(|e| AppError::Db(format!("commit tx: {}", e)))?;
    crate::commands::audit_log(&pool.pool, &user_id, "create", "material", &id, &format!("SKU {} Name {}", material.sku, material.name)).await;
    Ok(Material {
        id: row.get("id"), sku: row.get("sku"), name: row.get("name"),
        description: row.get("description"), category_id: row.get("category_id"),
        unit_id: row.get("unit_id"), supplier_id: row.get("supplier_id"),
        warehouse_id: row.get("warehouse_id"), rack_id: row.get("rack_id"),
        quantity: row.get("quantity"), min_stock: row.get("min_stock"),
        max_stock: row.get("max_stock"), price: row.get("price"),
        image: row.get("image"), expiry_date: row.get("expiry_date"),
        is_active: row.get::<bool, _>("is_active"),
        created_at: row.get("created_at"), updated_at: row.get("updated_at"),
    })
}

#[tauri::command]
pub async fn update_material(pool: State<'_, DbPool>, token: String, material: Material) -> Result<Material, AppError> {
    let user_id = pool.verify_token(&token)?;
    validate::validate_sku(&material.sku)?;
    validate::validate_string(&material.name, "Material name", 255)?;
    validate::validate_quantity(material.quantity, "Quantity")?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE materials SET sku=$1, name=$2, description=$3, category_id=$4, unit_id=$5, supplier_id=$6, warehouse_id=$7, rack_id=$8, quantity=$9, min_stock=$10, max_stock=$11, price=$12, image=$13, expiry_date=$14, is_active=$15, updated_at=NOW() WHERE id=$16")
        .bind(&material.sku).bind(&material.name).bind(&material.description)
        .bind(&material.category_id).bind(&material.unit_id).bind(&material.supplier_id)
        .bind(&material.warehouse_id).bind(&material.rack_id).bind(material.quantity)
        .bind(material.min_stock).bind(material.max_stock).bind(material.price)
        .bind(&material.image).bind(&material.expiry_date).bind(material.is_active)
        .bind(&material.id)
        .execute(&pool.pool).await?;
    crate::commands::audit_log(&pool.pool, &user_id, "update", "material", &material.id, &format!("SKU {} Name {}", material.sku, material.name)).await;
    let id = material.id.clone();
    get_material(pool, token, id).await
}

#[tauri::command]
pub async fn delete_material(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE materials SET is_active=false WHERE id=$1").bind(&id).execute(&pool.pool).await?;
    crate::commands::audit_log(&pool.pool, &user_id, "delete", "material", &id, "Material soft-deleted (is_active=false)").await;
    Ok(())
}

#[tauri::command]
pub async fn get_materials_low_stock(pool: State<'_, DbPool>, token: String) -> Result<Vec<Material>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at FROM materials WHERE quantity <= min_stock AND min_stock > 0 ORDER BY (quantity / CASE WHEN min_stock=0 THEN 1 ELSE min_stock END) ASC")
        .fetch_all(&pool.pool).await?;
    let materials = rows.iter().map(|row| Material {
        id: row.get("id"), sku: row.get("sku"), name: row.get("name"),
        description: row.get("description"), category_id: row.get("category_id"),
        unit_id: row.get("unit_id"), supplier_id: row.get("supplier_id"),
        warehouse_id: row.get("warehouse_id"), rack_id: row.get("rack_id"),
        quantity: row.get("quantity"), min_stock: row.get("min_stock"),
        max_stock: row.get("max_stock"), price: row.get("price"),
        image: row.get("image"), expiry_date: row.get("expiry_date"),
        is_active: row.get::<bool, _>("is_active"),
        created_at: row.get("created_at"), updated_at: row.get("updated_at"),
    }).collect();
    Ok(materials)
}

#[tauri::command]
pub async fn import_materials_csv(pool: State<'_, DbPool>, token: String, csv_content: String) -> Result<String, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(csv_content.as_bytes());
    let rows: Vec<csv::StringRecord> = reader.records().filter_map(|r| r.ok()).collect();
    if rows.len() > 10000 {
        return Err(AppError::Validation(format!("Maximum 10,000 rows allowed, got {}", rows.len())));
    }
    let mut tx = pool.pool.begin().await?;
    let mut imported = 0;
    let mut errors = Vec::new();
    for (i, record) in rows.iter().enumerate() {
        if record.len() < 4 {
            errors.push(format!("Row {}: insufficient columns (need at least: SKU, Name, Quantity, Price)", i + 1));
            continue;
        }
        let sku = record.get(0).unwrap_or("").trim().to_string();
        let name = record.get(1).unwrap_or("").trim().to_string();
        let quantity: f64 = record.get(2).unwrap_or("0").trim().parse().unwrap_or(0.0);
        let price: f64 = record.get(3).unwrap_or("0").trim().parse().unwrap_or(0.0);
        let description = record.get(4).unwrap_or("").trim().to_string();
        let min_stock: f64 = record.get(5).unwrap_or("0").trim().parse().unwrap_or(0.0);
        let max_stock: f64 = record.get(6).unwrap_or("0").trim().parse().unwrap_or(0.0);
        let expiry_date = record.get(7).unwrap_or("").trim().to_string();
        if sku.is_empty() || name.is_empty() {
            errors.push(format!("Row {}: SKU and Name are required", i + 1));
            continue;
        }
        let id = uuid::Uuid::new_v4().to_string();
        let result = sqlx::query(
            "INSERT INTO materials (id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) ON CONFLICT (sku) DO UPDATE SET name=EXCLUDED.name, quantity=EXCLUDED.quantity, price=EXCLUDED.price, description=EXCLUDED.description, min_stock=EXCLUDED.min_stock, max_stock=EXCLUDED.max_stock"
        )
            .bind(&id).bind(&sku).bind(&name).bind(&description)
            .bind(Option::<String>::None).bind(Option::<String>::None).bind(Option::<String>::None)
            .bind(Option::<String>::None).bind(Option::<String>::None).bind(quantity)
            .bind(min_stock).bind(max_stock).bind(price).bind("")
            .bind(if expiry_date.is_empty() { Option::<String>::None } else { Some(expiry_date) })
            .bind(true)
            .execute(&mut *tx).await;
        match result {
            Ok(_) => imported += 1,
            Err(e) => errors.push(format!("Row {}: {}", i + 1, e)),
        }
    }
    tx.commit().await?;
    crate::commands::audit_log(&pool.pool, &user_id, "import", "material", "csv", &format!("Imported {} materials, {} errors", imported, errors.len())).await;
    Ok(serde_json::json!({"imported": imported, "errors": errors, "total": rows.len()}).to_string())
}

#[tauri::command]
pub async fn delete_materials_bulk(pool: State<'_, DbPool>, token: String, ids: Vec<String>) -> Result<String, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut tx = pool.pool.begin().await?;
    let mut deleted = 0u64;
    let mut errors = Vec::new();
    for id in &ids {
        match sqlx::query("DELETE FROM materials WHERE id=$1").bind(id).execute(&mut *tx).await {
            Ok(_) => {
                crate::commands::audit_log(&pool.pool, &user_id, "delete", "material", id, "Material hard-deleted").await;
                deleted += 1;
            }
            Err(e) => errors.push(format!("{}: {}", id, e)),
        }
    }
    tx.commit().await?;
    if errors.is_empty() {
        Ok(format!("Successfully deleted {} materials", deleted))
    } else {
        Ok(format!("Deleted {} materials with {} errors:\n{}", deleted, errors.len(), errors.join("\n")))
    }
}

#[tauri::command]
pub async fn update_materials_bulk(pool: State<'_, DbPool>, token: String, ids: Vec<String>, updates: serde_json::Value) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut tx = pool.pool.begin().await?;
    let category_id = updates.get("category_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let warehouse_id = updates.get("warehouse_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let supplier_id = updates.get("supplier_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let is_active = updates.get("is_active").and_then(|v| v.as_bool());
    let price = updates.get("price").and_then(|v| v.as_f64());
    let min_stock = updates.get("min_stock").and_then(|v| v.as_f64());
    let max_stock = updates.get("max_stock").and_then(|v| v.as_f64());

    for id in &ids {
        let mut builder = QueryBuilder::new("UPDATE materials SET updated_at=NOW()");
        if let Some(c) = category_id { builder.push(", category_id=").push_bind(c); }
        if let Some(w) = warehouse_id { builder.push(", warehouse_id=").push_bind(w); }
        if let Some(s) = supplier_id { builder.push(", supplier_id=").push_bind(s); }
        if let Some(a) = is_active { builder.push(", is_active=").push_bind(a); }
        if let Some(p) = price { builder.push(", price=").push_bind(p); }
        if let Some(m) = min_stock { builder.push(", min_stock=").push_bind(m); }
        if let Some(m) = max_stock { builder.push(", max_stock=").push_bind(m); }
        builder.push(" WHERE id=").push_bind(id);
        builder.build().execute(&mut *tx).await?;
    }
    tx.commit().await?;
    crate::commands::audit_log(&pool.pool, &user_id, "update", "material", "bulk", &format!("Bulk updated {} materials", ids.len())).await;
    Ok(())
}

#[tauri::command]
pub async fn get_expiring_materials(pool: State<'_, DbPool>, token: String, days: i32) -> Result<Vec<Material>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at FROM materials WHERE expiry_date IS NOT NULL AND expiry_date != '' AND expiry_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::integer AND is_active=true ORDER BY expiry_date ASC"
    )
    .bind(days)
    .fetch_all(&pool.pool).await?;
    let materials = rows.iter().map(|row| Material {
        id: row.get("id"), sku: row.get("sku"), name: row.get("name"),
        description: row.get("description"), category_id: row.get("category_id"),
        unit_id: row.get("unit_id"), supplier_id: row.get("supplier_id"),
        warehouse_id: row.get("warehouse_id"), rack_id: row.get("rack_id"),
        quantity: row.get("quantity"), min_stock: row.get("min_stock"),
        max_stock: row.get("max_stock"), price: row.get("price"),
        image: row.get("image"), expiry_date: row.get("expiry_date"),
        is_active: row.get::<bool, _>("is_active"),
        created_at: row.get("created_at"), updated_at: row.get("updated_at"),
    }).collect();
    Ok(materials)
}

// --- Material Batches ---
#[tauri::command]
pub async fn get_material_batches(pool: State<'_, DbPool>, token: String, material_id: String) -> Result<Vec<MaterialBatch>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, material_id, batch_no, qty, expiry_date, received_at, created_at FROM material_batches WHERE material_id=$1 ORDER BY received_at DESC")
        .bind(&material_id)
        .fetch_all(&pool.pool).await?;
    let list = rows.iter().map(|row| MaterialBatch {
        id: row.get("id"), material_id: row.get("material_id"), batch_no: row.get("batch_no"),
        qty: row.get("qty"), expiry_date: row.get("expiry_date"),
        received_at: row.get("received_at"), created_at: row.get("created_at"),
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_material_batch(pool: State<'_, DbPool>, token: String, material_id: String, batch_no: String, qty: f64, expiry_date: String, received_at: String) -> Result<MaterialBatch, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = uuid::Uuid::new_v4().to_string();
    let recv = if received_at.is_empty() { None } else { Some(received_at.clone()) };
    let exp = if expiry_date.is_empty() { Option::<String>::None } else { Some(expiry_date.clone()) };
    sqlx::query("INSERT INTO material_batches (id, material_id, batch_no, qty, expiry_date, received_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())")
        .bind(&id).bind(&material_id).bind(&batch_no).bind(qty).bind(&exp).bind(&recv)
        .execute(&pool.pool).await?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    Ok(MaterialBatch { id, material_id, batch_no, qty, expiry_date: exp, received_at: recv, created_at: now })
}

#[tauri::command]
pub async fn delete_material_batch(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM material_batches WHERE id=$1").bind(&id).execute(&pool.pool).await?;
    Ok(())
}

// --- Material Images ---
#[tauri::command]
pub async fn get_material_images(pool: State<'_, DbPool>, token: String, material_id: String) -> Result<Vec<MaterialImage>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, material_id, url, sort_order, created_at FROM material_images WHERE material_id=$1 ORDER BY sort_order ASC")
        .bind(&material_id).fetch_all(&pool.pool).await?;
    let list = rows.iter().map(|row| MaterialImage {
        id: row.get("id"), material_id: row.get("material_id"), url: row.get("url"),
        sort_order: row.get("sort_order"), created_at: row.get("created_at"),
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_material_image(pool: State<'_, DbPool>, token: String, material_id: String, url: String) -> Result<MaterialImage, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = uuid::Uuid::new_v4().to_string();
    let max_sort: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM material_images WHERE material_id=$1")
        .bind(&material_id).fetch_optional(&pool.pool).await?.unwrap_or(0);
    sqlx::query("INSERT INTO material_images (id, material_id, url, sort_order, created_at) VALUES ($1,$2,$3,$4,NOW())")
        .bind(&id).bind(&material_id).bind(&url).bind(max_sort)
        .execute(&pool.pool).await?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    Ok(MaterialImage { id, material_id, url, sort_order: max_sort, created_at: now })
}

#[tauri::command]
pub async fn delete_material_image(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM material_images WHERE id=$1").bind(&id).execute(&pool.pool).await?;
    Ok(())
}

#[tauri::command]
pub async fn reorder_material_images(pool: State<'_, DbPool>, token: String, ids: Vec<String>) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut tx = pool.pool.begin().await.map_err(|e| AppError::Db(format!("begin tx: {}", e)))?;
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE material_images SET sort_order=$1 WHERE id=$2")
            .bind(i as i32).bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await.map_err(|e| AppError::Db(format!("commit tx: {}", e)))?;
    Ok(())
}

// --- Stock Valuation ---
#[tauri::command]
pub async fn get_stock_valuation(pool: State<'_, DbPool>, token: String) -> Result<Vec<StockValuation>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT COALESCE(c.name, 'Uncategorized'), COUNT(m.id), COALESCE(SUM(m.quantity * m.price), 0) FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true GROUP BY m.category_id ORDER BY SUM(m.quantity * m.price) DESC")
        .fetch_all(&pool.pool).await?;
    let list = rows.iter().map(|row| StockValuation {
        category: row.get::<String, _>(0), count: row.get::<i64, _>(1), value: row.get::<f64, _>(2),
    }).collect();
    Ok(list)
}

// --- Preview XLSX ---
#[tauri::command]
pub async fn preview_import_xlsx(pool: State<'_, DbPool>, token: String, xlsx_base64: String) -> Result<String, AppError> {
    pool.verify_token(&token)?;
    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &xlsx_base64)
        .map_err(|e| AppError::Internal(format!("Base64 decode error: {}", e)))?;
    let mut workbook: calamine::Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(data))
        .map_err(|e| AppError::Internal(format!("XLSX parse error: {}", e)))?;
    let sheet_name = workbook.sheet_names().first().cloned().unwrap_or_else(|| "Sheet1".to_string());
    let range = workbook.worksheet_range(&sheet_name)
        .map_err(|e| AppError::Internal(format!("Sheet error: {}", e)))?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    for (i, row) in range.rows().enumerate() {
        if i > 10 { break; }
        rows.push(row.iter().map(|c| c.as_string().unwrap_or_default()).collect());
    }
    serde_json::to_string(&rows).map_err(|e| AppError::Internal(e.to_string()))
}

// --- Import XLSX ---
#[tauri::command]
pub async fn import_materials_xlsx(pool: State<'_, DbPool>, token: String, xlsx_base64: String) -> Result<String, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_materials").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut tx = pool.pool.begin().await?;
    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &xlsx_base64)
        .map_err(|e| AppError::Internal(format!("Base64 decode error: {}", e)))?;
    let mut workbook: calamine::Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(data))
        .map_err(|e| AppError::Internal(format!("XLSX parse error: {}", e)))?;
    let sheet_name = workbook.sheet_names().first().cloned().unwrap_or_else(|| "Sheet1".to_string());
    let range = workbook.worksheet_range(&sheet_name)
        .map_err(|e| AppError::Internal(format!("Sheet error: {}", e)))?;
    let mut imported = 0i64;
    let mut errors = Vec::new();
    for (i, row) in range.rows().enumerate() {
        if i == 0 { continue; }
        if row.len() < 4 {
            errors.push(format!("Row {}: insufficient columns", i + 1));
            continue;
        }
        let get_str = |idx: usize| -> String { row.get(idx).and_then(|c| c.as_string()).unwrap_or_default().trim().to_string() };
        let get_f64 = |idx: usize| -> f64 { get_str(idx).parse().unwrap_or(0.0) };
        let sku = get_str(0);
        let name = get_str(1);
        if sku.is_empty() || name.is_empty() {
            errors.push(format!("Row {}: SKU and Name required", i + 1));
            continue;
        }
        let qty = get_f64(2);
        let price = get_f64(3);
        let description = get_str(4);
        let min_stock = get_f64(5);
        let max_stock = get_f64(6);
        let id = uuid::Uuid::new_v4().to_string();
        if let Err(e) = sqlx::query(
            "INSERT INTO materials (id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, image, expiry_date, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) ON CONFLICT (sku) DO UPDATE SET name=EXCLUDED.name, quantity=EXCLUDED.quantity, price=EXCLUDED.price"
        )
            .bind(&id).bind(&sku).bind(&name).bind(&description)
            .bind(Option::<String>::None).bind(Option::<String>::None).bind(Option::<String>::None)
            .bind(Option::<String>::None).bind(Option::<String>::None).bind(qty)
            .bind(min_stock).bind(max_stock).bind(price).bind("")
            .bind(Option::<String>::None).bind(true)
            .execute(&mut *tx).await
        {
            errors.push(format!("Row {}: {}", i + 1, e));
        } else {
            imported += 1;
        }
    }
    tx.commit().await?;
    if errors.is_empty() {
        Ok(format!("Successfully imported {} materials", imported))
    } else {
        Ok(format!("Imported {} materials with {} errors:\n{}", imported, errors.len(), errors.join("\n")))
    }
}

// --- Export Stock XLSX ---
#[tauri::command]
pub async fn export_stock_xlsx(pool: State<'_, DbPool>, token: String) -> Result<Vec<u8>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT m.sku, m.name, m.quantity, m.price, COALESCE(c.name,''), COALESCE(w.name,''), m.min_stock, m.max_stock, COALESCE(m.expiry_date,'') FROM materials m LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.is_active=true ORDER BY m.name")
        .fetch_all(&pool.pool).await?;
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook.add_worksheet();
    let header = ["SKU", "Name", "Quantity", "Price", "Category", "Warehouse", "Min Stock", "Max Stock", "Expiry"];
    for (c, h) in header.iter().enumerate() {
        sheet.write_string(0, c as u16, *h)?;
    }
    for (row_idx, row) in rows.iter().enumerate() {
        let ri = (row_idx + 1) as u32;
        sheet.write_string(ri, 0, row.get::<String, _>(0))?;
        sheet.write_string(ri, 1, row.get::<String, _>(1))?;
        sheet.write_number(ri, 2, row.get::<f64, _>(2))?;
        sheet.write_number(ri, 3, row.get::<f64, _>(3))?;
        sheet.write_string(ri, 4, row.get::<String, _>(4))?;
        sheet.write_string(ri, 5, row.get::<String, _>(5))?;
        sheet.write_number(ri, 6, row.get::<f64, _>(6))?;
        sheet.write_number(ri, 7, row.get::<f64, _>(7))?;
        sheet.write_string(ri, 8, row.get::<String, _>(8))?;
    }
    let data = workbook.save_to_buffer().map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(data)
}

// --- Generate ZPL ---
#[tauri::command]
pub async fn generate_zpl(pool: State<'_, DbPool>, token: String, material_id: String, template_id: String) -> Result<String, AppError> {
    pool.verify_token(&token)?;
    let mat = sqlx::query("SELECT sku, name, quantity, price FROM materials WHERE id=$1")
        .bind(&material_id)
        .fetch_one(&pool.pool).await?;
    let sku: String = mat.get("sku");
    let name: String = mat.get("name");
    let qty: f64 = mat.get("quantity");
    let price: f64 = mat.get("price");

    let tmpl = sqlx::query(
        "SELECT layout_style, show_company, show_qty, show_price, show_barcode, show_sku, show_name, \
         show_category, show_location, show_expiry, show_batch, qr_size, font_scale, template_type \
         FROM label_templates WHERE id=$1"
    )
        .bind(&template_id)
        .fetch_one(&pool.pool).await?;
    let layout: String = tmpl.get("layout_style");
    let show_company: bool = tmpl.get("show_company");
    let show_qty: bool = tmpl.get("show_qty");
    let show_price: bool = tmpl.get("show_price");
    let show_barcode: bool = tmpl.get("show_barcode");
    let show_sku: bool = tmpl.get("show_sku");
    let show_name: bool = tmpl.get("show_name");
    let qr_size: String = tmpl.get("qr_size");
    let font_scale: f32 = tmpl.get("font_scale");
    let fs = (font_scale * 30.0) as u32;

    let company_name: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_else(|_| "Thermaltrue".into());

    let mut zpl = String::from("^XA");
    let mut y = 30u32;

    // QR code — size varies by qr_size
    let qr_mag = match qr_size.as_str() {
        "large" => 8,
        "small" => 4,
        _ => 6,
    };
    zpl.push_str(&format!("^FO30,{}^BQN,2,{}^FDQA,{}^FS", y, qr_mag, sku));
    y += match qr_size.as_str() {
        "large" => 130,
        "small" => 70,
        _ => 100,
    };

    match layout.as_str() {
        "rack" => {
            // Rack Label — big rack name, location info
            zpl.push_str(&format!("^FO30,{}^ADN,60,20^FD{}^FS", y, sku));
            y += 50;
            let (wh, _rack) = if name.len() > 20 {
                (&name[..20], "")
            } else {
                (name.as_str(), "")
            };
            zpl.push_str(&format!("^FO30,{}^ADN,20,10^FD{}^FS", y, wh));
            y += 30;
            zpl.push_str(&format!("^FO30,{}^ADN,20,10^FD{}^FS", y, company_name));
        }
        "mini" => {
            // Mini Thermal — compact
            if show_sku {
                zpl.push_str(&format!("^FO30,{}^ADN,{},10^FD{}^FS", y, fs.max(20), sku));
                y += fs.max(20) + 5;
            }
            if show_name {
                let short = if name.len() > 15 { &name[..15] } else { name.as_str() };
                zpl.push_str(&format!("^FO30,{}^ADN,18,8^FD{}^FS", y, short));
                y += 22;
            }
            zpl.push_str(&format!("^FO30,{}^ADN,15,8^FD{}^FS", y, company_name));
            if show_barcode {
                y += 20;
                zpl.push_str(&format!("^FO30,{}^BCN,40,Y,N,N^FD{}^FS", y, sku));
            }
        }
        "qr_only" => {
            // QR-Only Scan — large QR, sku bold, company
            if show_sku {
                y += 5;
                zpl.push_str(&format!("^FO30,{}^ADN,{},15^FD{}^FS", y, fs.max(35), sku));
            }
            zpl.push_str(&format!("^FO30,{}^ADN,20,10^FD{}^FS", y + 40, company_name));
        }
        "full_card" => {
            // Full Stock Card — all details stacked
            if show_sku {
                zpl.push_str(&format!("^FO30,{}^ADN,22,10^FD{}^FS", y, sku));
                y += 25;
            }
            if show_name {
                zpl.push_str(&format!("^FO30,{}^ADN,22,10^FD{}^FS", y, name));
                y += 25;
            }
            zpl.push_str(&format!("^FO30,{}^ADN,20,10^FD{}^FS", y, company_name));
            y += 22;
            if show_qty {
                zpl.push_str(&format!("^FO30,{}^ADN,20,10^FDQty: {:.*}^FS", y, 2, qty));
                y += 22;
            }
            if show_price {
                zpl.push_str(&format!("^FO30,{}^ADN,20,10^FDRp {:.*}^FS", y, 2, price));
                y += 22;
            }
            if show_barcode {
                zpl.push_str(&format!("^FO30,{}^BCN,50,Y,N,N^FD{}^FS", y, sku));
            }
        }
        "branded" => {
            // Branded Label — company top, then info
            zpl.push_str(&format!("^FO30,{}^ADN,35,15^FD{}^FS", y, company_name));
            y += 40;
            if show_sku {
                zpl.push_str(&format!("^FO30,{}^ADN,25,10^FD{}^FS", y, sku));
                y += 28;
            }
            if show_name {
                zpl.push_str(&format!("^FO30,{}^ADN,22,10^FD{}^FS", y, name));
                y += 25;
            }
            if show_qty {
                zpl.push_str(&format!("^FO30,{}^ADN,22,10^FDQty: {:.*}^FS", y, 2, qty));
            }
            if show_price {
                let px = if show_qty { 180u32 } else { 30u32 };
                zpl.push_str(&format!("^FO{},{}^ADN,22,10^FDRp {:.*}^FS", px, y, 2, price));
            }
        }
        "two_side" => {
            // Two-Side: QR on right, text info stacked on left
            let left_x = 30u32;
            let right_x = 350u32;

            zpl.push_str(&format!("^FO{},{}^BQN,2,8^FDQA,{}^FS", right_x, 30, sku));

            let mut ly = 30u32;
            if show_company {
                zpl.push_str(&format!("^FO{},{}^ADN,25,10^FD{}^FS", left_x, ly, company_name));
                ly += 28;
            }
            if show_sku {
                zpl.push_str(&format!("^FO{},{}^ADN,20,10^FDSKU: {}^FS", left_x, ly, sku));
                ly += 22;
            }
            if show_name {
                zpl.push_str(&format!("^FO{},{}^ADN,20,10^FDName: {}^FS", left_x, ly, name));
                ly += 22;
            }
            if show_qty {
                zpl.push_str(&format!("^FO{},{}^ADN,18,10^FDQty: {:.*}^FS", left_x, ly, 2, qty));
                ly += 20;
            }
            if show_price {
                zpl.push_str(&format!("^FO{},{}^ADN,18,10^FDRp {:.*}^FS", left_x, ly, 2, price));
            }

        }
        _ => {
            // Standard layout
            if show_sku {
                zpl.push_str(&format!("^FO30,{}^ADN,{},10^FD{}^FS", y, fs, sku));
                y += fs + 5;
            }
            if show_name {
                zpl.push_str(&format!("^FO30,{}^ADN,{},10^FD{}^FS", y, fs, name));
                y += fs + 5;
            }
            if show_company {
                zpl.push_str(&format!("^FO30,{}^ADN,{},10^FD{}^FS", y, fs, company_name));
                y += fs + 5;
            } else {
                if show_qty {
                    zpl.push_str(&format!("^FO30,{}^ADN,{},10^FDQty: {:.*}^FS", y, fs, 2, qty));
                }
                if show_price {
                    let px = if show_qty { 180u32 } else { 30u32 };
                    zpl.push_str(&format!("^FO{},{}^ADN,{},10^FDRp {:.*}^FS", px, y, fs, 2, price));
                }
                if show_qty || show_price {
                    y += fs + 5;
                }
            }
            if show_barcode {
                y = y.max(160);
                zpl.push_str(&format!("^FO30,{}^BCN,60,Y,N,N^FD{}^FS", y, sku));
            }
        }
    }

    zpl.push_str("^XZ");
    Ok(zpl)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StockTimelineEntry {
    pub id: String, pub transaction_number: String, pub type_: String,
    pub quantity: f64, pub qty_before: f64, pub qty_after: f64,
    pub reference: String, pub notes: String, pub user_name: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn get_stock_timeline(pool: State<'_, DbPool>, token: String, material_id: String) -> Result<Vec<StockTimelineEntry>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT t.id, t.transaction_number, t.type, t.quantity, COALESCE(t.reference,''), COALESCE(t.notes,''), COALESCE(u.full_name,''), t.created_at FROM transactions t LEFT JOIN users u ON t.user_id = u.id WHERE t.material_id = $1 AND t.type NOT IN ('opname') ORDER BY t.created_at ASC"
    )
    .bind(&material_id)
    .fetch_all(&pool.pool).await?;
    let raw: Vec<(String, String, String, f64, String, String, String, String)> = rows.iter().map(|row| (
        row.get::<String, _>(0), row.get::<String, _>(1), row.get::<String, _>(2),
        row.get::<f64, _>(3), row.get::<String, _>(4), row.get::<String, _>(5),
        row.get::<String, _>(6), row.get::<String, _>(7),
    )).collect();
    let mut running = 0.0;
    let mut entries = Vec::new();
    for (id, num, typ, qty, ref_, notes, user, ts) in raw {
        let qty_before = running;
        running += if typ == "in" { qty } else if typ == "out" { -qty } else { 0.0 };
        if running < 0.0 { running = 0.0; }
        entries.push(StockTimelineEntry {
            id, transaction_number: num, type_: typ, quantity: qty,
            qty_before, qty_after: running,
            reference: ref_, notes, user_name: user, created_at: ts,
        });
    }
    Ok(entries)
}
