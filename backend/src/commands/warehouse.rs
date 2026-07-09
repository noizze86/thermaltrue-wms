use tauri::State;
use crate::db_pool::DbPool;
use crate::models::{Warehouse, WarehouseStats, Zone, Rack, StockOpname, StockOpnameItem, Location, ThroughputMetric, PickerActivity, SlottingSuggestion, TransferOrder, CycleSchedule};
use crate::error::AppError;
use crate::validate;
use sqlx::Row;
use sqlx::QueryBuilder;

// --- Warehouses ---
#[tauri::command]
pub async fn get_warehouses(pool: State<'_, DbPool>, token: String, search: Option<String>) -> Result<Vec<Warehouse>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, name, code, location, is_active, capacity, layout_image, created_at FROM warehouses WHERE ($1 IS NULL OR name LIKE '%' || $1 || '%' OR code LIKE '%' || $1 || '%') ORDER BY name"
    )
    .bind(&search)
    .fetch_all(&pool.pool)
    .await?;
    let list = rows.iter().map(|row| {
        Warehouse {
            id: row.get(0), name: row.get(1), code: row.get(2), location: row.get(3),
            is_active: row.get::<bool, _>(4), capacity: row.get(5), layout_image: row.get(6), created_at: row.get(7),
        }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn get_warehouse_stats(pool: State<'_, DbPool>, token: String) -> Result<Vec<WarehouseStats>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT w.id, w.name, w.code, w.location, w.is_active, w.capacity, w.layout_image, w.created_at,
            (SELECT COUNT(*) FROM racks WHERE warehouse_id=w.id) as rack_count,
            (SELECT COUNT(*) FROM materials WHERE warehouse_id=w.id AND is_active=true) as material_count,
            COALESCE((SELECT SUM(m.quantity) FROM materials m WHERE m.warehouse_id=w.id AND m.is_active=true), 0) as used_capacity
         FROM warehouses w ORDER BY w.name"
    )
    .fetch_all(&pool.pool)
    .await?;
    let list = rows.iter().map(|row| {
        WarehouseStats {
            id: row.get(0), name: row.get(1), code: row.get(2), location: row.get(3),
            is_active: row.get::<bool, _>(4), capacity: row.get(5), layout_image: row.get(6),
            created_at: row.get(7), rack_count: row.get::<i64, _>(8), material_count: row.get::<i64, _>(9), used_capacity: row.get::<f64, _>(10),
        }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_warehouse(pool: State<'_, DbPool>, token: String, wh: Warehouse) -> Result<Warehouse, AppError> {
    let user_id = pool.verify_token(&token)?;
    validate::validate_string(&wh.name, "Warehouse name", 255)?;
    validate::validate_string(&wh.code, "Warehouse code", 50)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO warehouses (id, name, code, location, is_active, capacity, layout_image, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&id).bind(&wh.name).bind(&wh.code).bind(&wh.location).bind(wh.is_active).bind(wh.capacity).bind(&wh.layout_image).bind(&now)
        .execute(&pool.pool).await?;
    Ok(Warehouse { id, name: wh.name, code: wh.code, location: wh.location, is_active: wh.is_active, capacity: wh.capacity, layout_image: wh.layout_image, created_at: now })
}

#[tauri::command]
pub async fn update_warehouse(pool: State<'_, DbPool>, token: String, wh: Warehouse) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE warehouses SET name=$1, code=$2, location=$3, is_active=$4, capacity=$5, layout_image=$6 WHERE id=$7")
        .bind(&wh.name).bind(&wh.code).bind(&wh.location).bind(wh.is_active).bind(wh.capacity).bind(&wh.layout_image).bind(&wh.id)
        .execute(&pool.pool).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_warehouse(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut tx = pool.pool.begin().await.map_err(|e| AppError::Db(format!("begin tx: {}", e)))?;
    sqlx::query("DELETE FROM zones WHERE warehouse_id=$1").bind(&id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM racks WHERE warehouse_id=$1").bind(&id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM warehouses WHERE id=$1").bind(&id).execute(&mut *tx).await?;
    tx.commit().await.map_err(|e| AppError::Db(format!("commit tx: {}", e)))?;
    Ok(())
}

// --- Zones ---
#[tauri::command]
pub async fn get_zones(pool: State<'_, DbPool>, token: String, warehouse_id: Option<String>) -> Result<Vec<Zone>, AppError> {
    pool.verify_token(&token)?;
    let mut builder = QueryBuilder::new("SELECT id, warehouse_id, name, code, capacity, created_at FROM zones WHERE 1=1");
    if let Some(ref w) = warehouse_id {
        if !w.is_empty() {
            builder.push(" AND warehouse_id = ");
            builder.push_bind(w);
        }
    }
    builder.push(" ORDER BY name");
    let rows = builder.build().fetch_all(&pool.pool).await?;
    let list = rows.iter().map(|row| {
        Zone { id: row.get(0), warehouse_id: row.get(1), name: row.get(2), code: row.get(3), capacity: row.get(4), created_at: row.get(5) }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_zone(pool: State<'_, DbPool>, token: String, warehouse_id: String, name: String, code: String, capacity: Option<f64>) -> Result<Zone, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    validate::validate_string(&name, "Zone name", 100)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let cap = capacity.unwrap_or(0.0);
    sqlx::query("INSERT INTO zones (id, warehouse_id, name, code, capacity, created_at) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&warehouse_id).bind(&name).bind(&code).bind(cap).bind(&now)
        .execute(&pool.pool).await?;
    Ok(Zone { id, warehouse_id, name, code, capacity: cap, created_at: now })
}

#[tauri::command]
pub async fn delete_zone(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM zones WHERE id=$1").bind(&id).execute(&pool.pool).await?;
    Ok(())
}

// --- Racks ---
#[tauri::command]
pub async fn get_racks(pool: State<'_, DbPool>, token: String, warehouse_id: Option<String>, search: Option<String>) -> Result<Vec<Rack>, AppError> {
    pool.verify_token(&token)?;
    let mut builder = QueryBuilder::new("SELECT id, warehouse_id, area, rack_name, bin_location, max_capacity, location_id, created_at FROM racks WHERE 1=1");
    if let Some(ref w) = warehouse_id {
        if !w.is_empty() {
            builder.push(" AND warehouse_id = ");
            builder.push_bind(w);
        }
    }
    if let Some(ref s) = search {
        if !s.is_empty() {
            builder.push(" AND (rack_name LIKE ");
            builder.push_bind(format!("%{}%", s));
            builder.push(" OR area LIKE ");
            builder.push_bind(format!("%{}%", s));
            builder.push(" OR bin_location LIKE ");
            builder.push_bind(format!("%{}%", s));
            builder.push(")");
        }
    }
    builder.push(" ORDER BY rack_name");
    let rows = builder.build().fetch_all(&pool.pool).await?;
    let list = rows.iter().map(|row| {
        Rack { id: row.get(0), warehouse_id: row.get(1), area: row.get(2), rack_name: row.get(3), bin_location: row.get(4), max_capacity: row.get(5), location_id: row.get(6), created_at: row.get(7) }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_rack(pool: State<'_, DbPool>, token: String, rack: Rack) -> Result<Rack, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    validate::validate_string(&rack.rack_name, "Rack name", 100)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO racks (id, warehouse_id, area, rack_name, bin_location, max_capacity, location_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&id).bind(&rack.warehouse_id).bind(&rack.area).bind(&rack.rack_name).bind(&rack.bin_location).bind(rack.max_capacity).bind(&rack.location_id).bind(&now)
        .execute(&pool.pool).await?;
    Ok(Rack { id, warehouse_id: rack.warehouse_id, area: rack.area, rack_name: rack.rack_name, bin_location: rack.bin_location, max_capacity: rack.max_capacity, location_id: rack.location_id, created_at: now })
}

#[tauri::command]
pub async fn update_rack(pool: State<'_, DbPool>, token: String, rack: Rack) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE racks SET warehouse_id=$1, area=$2, rack_name=$3, bin_location=$4, max_capacity=$5, location_id=$6 WHERE id=$7")
        .bind(&rack.warehouse_id).bind(&rack.area).bind(&rack.rack_name).bind(&rack.bin_location).bind(rack.max_capacity).bind(&rack.location_id).bind(&rack.id)
        .execute(&pool.pool).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_rack(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM rack_utilization_log WHERE rack_id=$1").bind(&id).execute(&pool.pool).await.ok();
    sqlx::query("DELETE FROM racks WHERE id=$1").bind(&id).execute(&pool.pool).await?;
    Ok(())
}

// --- Rack Utilization ---
#[tauri::command]
pub async fn get_rack_occupancy_details(pool: State<'_, DbPool>, token: String) -> Result<Vec<serde_json::Value>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT r.id, r.warehouse_id, r.rack_name, r.area, r.max_capacity,
            COUNT(m.id) as material_count,
            COALESCE(SUM(m.quantity), 0) as total_qty,
            COALESCE((SELECT AVG(t.created_at) FROM transactions t WHERE t.material_id IN (SELECT id FROM materials WHERE rack_id=r.id) AND t.created_at > NOW() - INTERVAL '30 days'), '') as recent_activity
         FROM racks r
         LEFT JOIN materials m ON m.rack_id = r.id AND m.is_active = true
         GROUP BY r.id ORDER BY r.warehouse_id, r.rack_name"
    )
    .fetch_all(&pool.pool)
    .await?;
    let list = rows.iter().map(|row| {
        serde_json::json!({
            "rack_id": row.get::<String, _>(0),
            "warehouse_id": row.get::<String, _>(1),
            "rack_name": row.get::<String, _>(2),
            "area": row.get::<String, _>(3),
            "max_capacity": row.get::<f64, _>(4),
            "material_count": row.get::<i64, _>(5),
            "total_quantity": row.get::<f64, _>(6),
            "recent_activity": row.get::<String, _>(7),
        })
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn get_rack_occupancy(pool: State<'_, DbPool>, token: String) -> Result<Vec<serde_json::Value>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT r.id, r.max_capacity, COUNT(m.id) as material_count, COALESCE(SUM(m.quantity), 0) as total_qty FROM racks r LEFT JOIN materials m ON m.rack_id = r.id AND m.is_active = true GROUP BY r.id")
        .fetch_all(&pool.pool)
        .await?;
    let list = rows.iter().map(|row| {
        serde_json::json!({
            "rack_id": row.get::<String, _>(0),
            "max_capacity": row.get::<f64, _>(1),
            "material_count": row.get::<i64, _>(2),
            "total_quantity": row.get::<f64, _>(3)
        })
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn get_rack_utilization_history(pool: State<'_, DbPool>, token: String, rack_id: String) -> Result<Vec<serde_json::Value>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT id, date, total_quantity, created_at FROM rack_utilization_log WHERE rack_id=$1 ORDER BY date ASC LIMIT 90"
    )
    .bind(&rack_id)
    .fetch_all(&pool.pool)
    .await?;
    let list = rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<String, _>(0),
            "date": row.get::<String, _>(1),
            "total_quantity": row.get::<f64, _>(2),
            "created_at": row.get::<String, _>(3),
        })
    }).collect();
    Ok(list)
}

// --- Put-away Suggestion ---
#[tauri::command]
pub async fn suggest_putaway(pool: State<'_, DbPool>, token: String, warehouse_id: String, material_id: String) -> Result<serde_json::Value, AppError> {
    pool.verify_token(&token)?;
    let category_id: Option<String> = sqlx::query_scalar("SELECT category_id FROM materials WHERE id=$1")
        .bind(&material_id)
        .fetch_optional(&pool.pool)
        .await?;

    let suggestion = if let Some(ref cat) = category_id {
        sqlx::query(
            "SELECT r.id, r.rack_name, r.max_capacity, COALESCE(SUM(m.quantity), 0) as used
             FROM racks r
             LEFT JOIN materials m ON m.rack_id = r.id AND m.is_active = true
             LEFT JOIN materials my ON my.category_id=$1 AND my.rack_id=r.id AND my.is_active=true
             WHERE r.warehouse_id=$2
             GROUP BY r.id
             ORDER BY COUNT(my.id) DESC, (r.max_capacity - COALESCE(SUM(m.quantity), 0)) DESC
             LIMIT 1"
        )
        .bind(cat).bind(&warehouse_id)
        .fetch_optional(&pool.pool)
        .await?
        .map(|row| {
            serde_json::json!({
                "rack_id": row.get::<String, _>(0),
                "rack_name": row.get::<String, _>(1),
                "max_capacity": row.get::<f64, _>(2),
                "used": row.get::<f64, _>(3),
                "available": row.get::<f64, _>(2) - row.get::<f64, _>(3),
            })
        })
    } else {
        None
    };

    let suggestion = if suggestion.is_some() {
        suggestion
    } else {
        sqlx::query(
            "SELECT r.id, r.rack_name, r.max_capacity, COALESCE(SUM(m.quantity), 0) as used
             FROM racks r
             LEFT JOIN materials m ON m.rack_id = r.id AND m.is_active = true
             WHERE r.warehouse_id=$1
             GROUP BY r.id
             ORDER BY (r.max_capacity - COALESCE(SUM(m.quantity), 0)) DESC
             LIMIT 1"
        )
        .bind(&warehouse_id)
        .fetch_optional(&pool.pool)
        .await?
        .map(|row| {
            serde_json::json!({
                "rack_id": row.get::<String, _>(0),
                "rack_name": row.get::<String, _>(1),
                "max_capacity": row.get::<f64, _>(2),
                "used": row.get::<f64, _>(3),
                "available": row.get::<f64, _>(2) - row.get::<f64, _>(3),
            })
        })
    };

    Ok(suggestion.unwrap_or(serde_json::json!({"rack_id": "", "rack_name": "No suitable rack found"})))
}

// --- Stock Opname ---
#[tauri::command]
pub async fn get_stock_opnames(pool: State<'_, DbPool>, token: String) -> Result<Vec<StockOpname>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at FROM stock_opname ORDER BY created_at DESC")
        .fetch_all(&pool.pool)
        .await?;
    let list = rows.iter().map(|row| {
        StockOpname { id: row.get(0), opname_number: row.get(1), warehouse_id: row.get::<Option<String>, _>(2), status: row.get(3), notes: row.get(4), created_by: row.get(5), created_at: row.get(6), updated_at: row.get(7) }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_stock_opname(pool: State<'_, DbPool>, token: String, so: StockOpname) -> Result<StockOpname, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname")
        .fetch_one(&pool.pool)
        .await
        .unwrap_or(1);
    let opname_number = format!("OPN-{:04}", count);
    sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&id).bind(&opname_number).bind(&so.warehouse_id).bind("draft").bind(&so.notes).bind(&so.created_by).bind(&now).bind(&now)
        .execute(&pool.pool).await?;
    Ok(StockOpname { id, opname_number, warehouse_id: so.warehouse_id, status: "draft".into(), notes: so.notes, created_by: so.created_by, created_at: now.clone(), updated_at: now })
}

#[tauri::command]
pub async fn update_stock_opname_status(pool: State<'_, DbPool>, token: String, id: String, status: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut tx = pool.pool.begin().await?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE stock_opname SET status=$1, updated_at=$2 WHERE id=$3")
        .bind(&status).bind(&now).bind(&id)
        .execute(&mut *tx).await?;
    if status == "completed" {
        let threshold_str: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='auto_adjust_threshold'),'0')")
            .fetch_one(&mut *tx).await
            .unwrap_or("0".into());
        let threshold: f64 = threshold_str.parse().unwrap_or(0.0);
        let items: Vec<(String, f64, f64)> = sqlx::query("SELECT material_id, physical_qty, system_qty FROM stock_opname_items WHERE opname_id=$1")
            .bind(&id)
            .fetch_all(&mut *tx)
            .await?
            .iter()
            .map(|row| (row.get::<String, _>(0), row.get::<f64, _>(1), row.get::<f64, _>(2)))
            .collect();
        for (mid, phy_qty, sys_qty) in items {
            let diff = phy_qty - sys_qty;
            if threshold > 0.0 && diff.abs() < threshold {
                continue;
            }
            sqlx::query("UPDATE materials SET quantity=$1 WHERE id=$2")
                .bind(phy_qty).bind(&mid)
                .execute(&mut *tx).await.ok();
        }
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn get_stock_opname_items(pool: State<'_, DbPool>, token: String, opname_id: String) -> Result<Vec<StockOpnameItem>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, opname_id, material_id, system_qty, physical_qty, difference, notes FROM stock_opname_items WHERE opname_id=$1")
        .bind(&opname_id)
        .fetch_all(&pool.pool)
        .await?;
    let list = rows.iter().map(|row| {
        StockOpnameItem { id: row.get(0), opname_id: row.get(1), material_id: row.get(2), system_qty: row.get(3), physical_qty: row.get(4), difference: row.get(5), notes: row.get(6) }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn save_stock_opname_item(pool: State<'_, DbPool>, token: String, item: StockOpnameItem) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM stock_opname_items WHERE opname_id=$1 AND material_id=$2")
        .bind(&item.opname_id)
        .bind(&item.material_id)
        .fetch_optional(&pool.pool)
        .await?;
    if existing.is_some() {
        sqlx::query("UPDATE stock_opname_items SET physical_qty=$1, difference=$2, notes=$3 WHERE opname_id=$4 AND material_id=$5")
            .bind(item.physical_qty).bind(item.physical_qty - item.system_qty).bind(&item.notes).bind(&item.opname_id).bind(&item.material_id)
            .execute(&pool.pool).await?;
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&id).bind(&item.opname_id).bind(&item.material_id).bind(item.system_qty).bind(item.physical_qty).bind(item.physical_qty - item.system_qty).bind(&item.notes)
            .execute(&pool.pool).await?;
    }
    Ok(())
}

// --- Transfer ---
#[tauri::command]
pub async fn transfer_material(pool: State<'_, DbPool>, token: String, material_id: String, from_warehouse_id: String, to_warehouse_id: String, rack_id: Option<String>, quantity: f64, _user_id: Option<String>) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut tx = pool.pool.begin().await?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'")
        .fetch_one(&mut *tx).await
        .unwrap_or(1);
    let txn_number = format!("TRF-{:04}", count);
    sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8)")
        .bind(&id).bind(&txn_number).bind(&material_id).bind(&from_warehouse_id).bind(-quantity).bind(format!("Transfer to {}", to_warehouse_id)).bind(&user_id).bind(&now)
        .execute(&mut *tx).await?;

    let id2 = uuid::Uuid::new_v4().to_string();
    let count2: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'")
        .fetch_one(&mut *tx).await
        .unwrap_or(1);
    let txn_number2 = format!("TRF-{:04}", count2 + 1);
    sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8,$9)")
        .bind(&id2).bind(&txn_number2).bind(&material_id).bind(&to_warehouse_id).bind(&rack_id).bind(quantity).bind(format!("Transfer from {}", from_warehouse_id)).bind(&user_id).bind(&now)
        .execute(&mut *tx).await?;

    sqlx::query("UPDATE materials SET warehouse_id=$1, rack_id=$2 WHERE id=$3")
        .bind(&to_warehouse_id).bind(&rack_id).bind(&material_id)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn transfer_materials_bulk(pool: State<'_, DbPool>, token: String, transfers: Vec<serde_json::Value>, _user_id: Option<String>) -> Result<String, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let mut tx = pool.pool.begin().await?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'")
        .fetch_one(&mut *tx).await
        .unwrap_or(1);
    let mut tx_count = 0;
    let mut errors = Vec::new();

    for t in &transfers {
        let material_id = t.get("material_id").and_then(|v| v.as_str()).unwrap_or("");
        let from_wh = t.get("from_warehouse_id").and_then(|v| v.as_str()).unwrap_or("");
        let to_wh = t.get("to_warehouse_id").and_then(|v| v.as_str()).unwrap_or("");
        let rack_id = t.get("rack_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let quantity = t.get("quantity").and_then(|v| v.as_f64()).unwrap_or(0.0);

        if material_id.is_empty() || from_wh.is_empty() || to_wh.is_empty() || quantity <= 0.0 {
            errors.push(format!("Invalid transfer entry: material_id='{}', from='{}', to='{}', qty={}", material_id, from_wh, to_wh, quantity));
            continue;
        }

        let txn_number = format!("TRF-{:04}", count);
        sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number).bind(material_id).bind(from_wh).bind(-quantity).bind(format!("Bulk transfer to {}", to_wh)).bind(&user_id).bind(&now)
            .execute(&mut *tx).await?;
        count += 1;

        let txn_number2 = format!("TRF-{:04}", count);
        sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8,$9)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number2).bind(material_id).bind(to_wh).bind(rack_id).bind(quantity).bind(format!("Bulk transfer from {}", from_wh)).bind(&user_id).bind(&now)
            .execute(&mut *tx).await?;
        count += 1;

        sqlx::query("UPDATE materials SET warehouse_id=$1, rack_id=$2 WHERE id=$3")
            .bind(to_wh).bind(rack_id).bind(material_id)
            .execute(&mut *tx).await?;
        tx_count += 1;
    }

    tx.commit().await?;
    if errors.is_empty() {
        Ok(format!("{} material(s) transferred successfully", tx_count))
    } else {
        Ok(format!("{} material(s) transferred, {} errors:\n{}", tx_count, errors.len(), errors.join("\n")))
    }
}

// --- Zone Update ---
#[tauri::command]
pub async fn update_zone(pool: State<'_, DbPool>, token: String, id: String, name: String, code: String, capacity: f64) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("UPDATE zones SET name=$1, code=$2, capacity=$3 WHERE id=$4")
        .bind(&name).bind(&code).bind(capacity).bind(&id)
        .execute(&pool.pool).await?;
    Ok(())
}

// --- Locations ---
#[tauri::command]
pub async fn get_locations(pool: State<'_, DbPool>, token: String, warehouse_id: Option<String>, parent_id: Option<String>) -> Result<Vec<Location>, AppError> {
    pool.verify_token(&token)?;
    let mut builder = QueryBuilder::new("SELECT id, parent_id, warehouse_id, type, code, created_at FROM locations WHERE 1=1");
    if let Some(ref w) = warehouse_id {
        if !w.is_empty() {
            builder.push(" AND warehouse_id = ");
            builder.push_bind(w);
        }
    }
    if let Some(ref p) = parent_id {
        if !p.is_empty() {
            builder.push(" AND parent_id = ");
            builder.push_bind(p);
        }
    } else if parent_id.is_some() {
        builder.push(" AND parent_id IS NULL");
    }
    builder.push(" ORDER BY code");
    let rows = builder.build().fetch_all(&pool.pool).await?;
    let list = rows.iter().map(|row| {
        Location { id: row.get(0), parent_id: row.get::<Option<String>, _>(1), warehouse_id: row.get(2), type_: row.get(3), code: row.get(4), created_at: row.get(5) }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_location(pool: State<'_, DbPool>, token: String, warehouse_id: String, parent_id: Option<String>, type_: String, code: String) -> Result<Location, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    validate::validate_string(&code, "Location code", 100)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO locations (id, parent_id, warehouse_id, type, code, created_at) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&parent_id).bind(&warehouse_id).bind(&type_).bind(&code).bind(&now)
        .execute(&pool.pool).await?;
    Ok(Location { id, parent_id, warehouse_id, type_, code, created_at: now })
}

#[tauri::command]
pub async fn delete_location(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM locations WHERE id=$1 OR parent_id=$1").bind(&id).execute(&pool.pool).await?;
    Ok(())
}

// ── Throughput Metrics ──
#[tauri::command]
pub async fn get_throughput_metrics(pool: State<'_, DbPool>, token: String) -> Result<Vec<ThroughputMetric>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT w.id, w.name,
                COALESCE(SUM(CASE WHEN t.type='in' AND t.created_at::date=CURRENT_DATE THEN t.quantity ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN t.type='out' AND t.created_at::date=CURRENT_DATE THEN t.quantity ELSE 0 END),0),
                COUNT(CASE WHEN t.created_at::date=CURRENT_DATE THEN 1 END)
         FROM warehouses w LEFT JOIN transactions t ON w.id=t.warehouse_id
         GROUP BY w.id ORDER BY w.name"
    )
    .fetch_all(&pool.pool)
    .await?;
    let list = rows.iter().map(|row| {
        ThroughputMetric {
            warehouse_id: row.get(0), warehouse_name: row.get(1),
            in_qty: row.get(2), out_qty: row.get(3), tx_count: row.get(4),
        }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn get_picker_activity(pool: State<'_, DbPool>, token: String) -> Result<Vec<PickerActivity>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT u.id, u.full_name, COUNT(*) FROM transactions t
         JOIN users u ON t.user_id=u.id
         WHERE t.type='out' AND t.created_at::date=CURRENT_DATE
         GROUP BY u.id ORDER BY COUNT(*) DESC LIMIT 20"
    )
    .fetch_all(&pool.pool)
    .await?;
    let list = rows.iter().map(|row| {
        PickerActivity { user_id: row.get(0), user_name: row.get(1), pick_count: row.get::<i64, _>(2) }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn get_slotting_suggestions(pool: State<'_, DbPool>, token: String) -> Result<Vec<SlottingSuggestion>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT m.id, m.sku, m.name,
                COALESCE(r.rack_name,'None'),
                'Recommended Zone',
                'High turnover - move closer to shipping'
         FROM materials m
         LEFT JOIN racks r ON m.rack_id=r.id
         WHERE m.id IN (
             SELECT material_id FROM transactions
              WHERE type='out' AND created_at >= TO_CHAR(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD HH24:MI:SS')
              GROUP BY material_id HAVING SUM(quantity) > 10
          )
          ORDER BY (SELECT SUM(quantity) FROM transactions WHERE type='out' AND material_id=m.id AND created_at>=TO_CHAR(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD HH24:MI:SS')) DESC
         LIMIT 10"
    )
    .fetch_all(&pool.pool)
    .await?;
    let list = rows.iter().map(|row| {
        SlottingSuggestion {
            material_id: row.get(0), sku: row.get(1), name: row.get(2),
            current_rack: row.get(3), suggested_rack: row.get(4), reason: row.get(5),
        }
    }).collect();
    Ok(list)
}

// ── Transfer Order Workflow ──
#[tauri::command]
pub async fn get_transfer_orders(pool: State<'_, DbPool>, token: String, status_filter: Option<String>) -> Result<Vec<TransferOrder>, AppError> {
    pool.verify_token(&token)?;
    let mut builder = QueryBuilder::new("SELECT id, transfer_number, from_warehouse_id, to_warehouse_id, status, notes, created_by, approved_by, created_at, updated_at FROM transfer_orders WHERE 1=1");
    if let Some(ref s) = status_filter {
        if !s.is_empty() { builder.push(" AND status = "); builder.push_bind(s); }
    }
    builder.push(" ORDER BY created_at DESC");
    let rows = builder.build().fetch_all(&pool.pool).await?;
    let list = rows.iter().map(|row| {
        TransferOrder {
            id: row.get(0), transfer_number: row.get(1), from_warehouse_id: row.get(2),
            to_warehouse_id: row.get(3), status: row.get(4), notes: row.get(5),
            created_by: row.get::<Option<String>, _>(6), approved_by: row.get::<Option<String>, _>(7), created_at: row.get(8), updated_at: row.get(9),
        }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_transfer_order(pool: State<'_, DbPool>, token: String, from_warehouse_id: String, to_warehouse_id: String, notes: String, items: Vec<serde_json::Value>) -> Result<TransferOrder, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transfer_orders")
        .fetch_one(&pool.pool).await
        .unwrap_or(1);
    let txn = format!("TO-{:04}", count);
    sqlx::query("INSERT INTO transfer_orders (id, transfer_number, from_warehouse_id, to_warehouse_id, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$7)")
        .bind(&id).bind(&txn).bind(&from_warehouse_id).bind(&to_warehouse_id).bind(&notes).bind(&user_id).bind(&now)
        .execute(&pool.pool).await?;
    for item in &items {
        let iid = uuid::Uuid::new_v4().to_string();
        let batch_id: Option<String> = item["batch_id"].as_str().map(|s| s.to_string());
        sqlx::query("INSERT INTO transfer_items (id, transfer_id, material_id, batch_id, quantity, created_at) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(&iid).bind(&id).bind(item["material_id"].as_str().unwrap_or("")).bind(&batch_id).bind(item["quantity"].as_f64().unwrap_or(0.0)).bind(&now)
            .execute(&pool.pool).await?;
    }
    Ok(TransferOrder { id, transfer_number: txn, from_warehouse_id, to_warehouse_id, status: "draft".into(), notes, created_by: Some(user_id), approved_by: None, created_at: now.clone(), updated_at: now })
}

#[tauri::command]
pub async fn update_transfer_order_status(pool: State<'_, DbPool>, token: String, id: String, status: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE transfer_orders SET status=$1, updated_at=$2 WHERE id=$3")
        .bind(&status).bind(&now).bind(&id)
        .execute(&pool.pool).await?;
    // If received, execute the actual material transfers
    if status == "received" {
        let items: Vec<(String, Option<String>, f64, String, String)> = sqlx::query("SELECT ti.material_id, ti.batch_id, ti.quantity, to2.from_warehouse_id, to2.to_warehouse_id FROM transfer_items ti JOIN transfer_orders to2 ON ti.transfer_id=to2.id WHERE ti.transfer_id=$1")
            .bind(&id)
            .fetch_all(&pool.pool)
            .await?
            .iter()
            .map(|row| {
                (row.get::<String, _>(0), row.get::<Option<String>, _>(1), row.get::<f64, _>(2), row.get::<String, _>(3), row.get::<String, _>(4))
            })
            .collect();
        let mut tx = pool.pool.begin().await.map_err(|e| AppError::Db(format!("begin tx: {}", e)))?;
        let txn_count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'")
            .fetch_one(&mut *tx).await
            .unwrap_or(1);
        let txn_num = format!("TRF-{:04}", txn_count);
        for (mat_id, _batch_id, qty, _from_wh, to_wh) in items {
            // Deduct from source
            sqlx::query("UPDATE materials SET quantity = CASE WHEN quantity - $1 < 0 THEN 0 ELSE quantity - $1 END WHERE id=$2")
                .bind(qty).bind(&mat_id).execute(&mut *tx).await.map_err(|e| AppError::Db(format!("deduct source: {}", e)))?;
            // Add to destination
            sqlx::query("UPDATE materials SET quantity = COALESCE(quantity,0) + $1, warehouse_id=$2 WHERE id=$3")
                .bind(qty).bind(&to_wh).bind(&mat_id).execute(&mut *tx).await.map_err(|e| AppError::Db(format!("add dest: {}", e)))?;
            // Create transaction record
            sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, quantity, price, reference, notes, user_id, status, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,0,$6,$7,$8,'approved',$9)")
                .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_num).bind(&mat_id).bind(&to_wh).bind(qty).bind(&id).bind(format!("Transfer Order: {}", id)).bind(&user_id).bind(&now)
                .execute(&mut *tx).await.map_err(|e| AppError::Db(format!("insert tx: {}", e)))?;
        }
        sqlx::query("UPDATE transfer_orders SET approved_by=$1 WHERE id=$2")
            .bind(&user_id).bind(&id).execute(&mut *tx).await.map_err(|e| AppError::Db(format!("update approved_by: {}", e)))?;
        tx.commit().await.map_err(|e| AppError::Db(format!("commit tx: {}", e)))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_transfer_items(pool: State<'_, DbPool>, token: String, transfer_id: String) -> Result<Vec<serde_json::Value>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT ti.id, ti.transfer_id, ti.material_id, ti.batch_id, ti.quantity, m.sku, m.name
         FROM transfer_items ti JOIN materials m ON ti.material_id=m.id WHERE ti.transfer_id=$1"
    )
    .bind(&transfer_id)
    .fetch_all(&pool.pool)
    .await?;
    let list = rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<String, _>(0), "transfer_id": row.get::<String, _>(1),
            "material_id": row.get::<String, _>(2), "batch_id": row.get::<Option<String>, _>(3),
            "quantity": row.get::<f64, _>(4), "sku": row.get::<String, _>(5), "material_name": row.get::<String, _>(6),
        })
    }).collect();
    Ok(list)
}

// ── Cycle Schedules ──
#[tauri::command]
pub async fn get_cycle_schedules(pool: State<'_, DbPool>, token: String) -> Result<Vec<CycleSchedule>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, warehouse_id, class, frequency_days, next_date, last_date, created_at FROM cycle_schedules ORDER BY next_date")
        .fetch_all(&pool.pool)
        .await?;
    let list = rows.iter().map(|row| {
        CycleSchedule { id: row.get(0), warehouse_id: row.get::<Option<String>, _>(1), class: row.get(2), frequency_days: row.get::<i64, _>(3), next_date: row.get(4), last_date: row.get::<Option<String>, _>(5), created_at: row.get(6) }
    }).collect();
    Ok(list)
}

#[tauri::command]
pub async fn create_cycle_schedule(pool: State<'_, DbPool>, token: String, warehouse_id: Option<String>, class: String, frequency_days: i64) -> Result<CycleSchedule, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO cycle_schedules (id, warehouse_id, class, frequency_days, next_date, created_at) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5)")
        .bind(&id).bind(&warehouse_id).bind(&class).bind(frequency_days).bind(&now)
        .execute(&pool.pool).await?;
    Ok(CycleSchedule { id, warehouse_id, class, frequency_days, next_date: chrono::Local::now().format("%Y-%m-%d").to_string(), last_date: None, created_at: now })
}

#[tauri::command]
pub async fn delete_cycle_schedule(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("DELETE FROM cycle_schedules WHERE id=$1").bind(&id).execute(&pool.pool).await?;
    Ok(())
}

// ── Opname Config (Blind count + Auto-adjust) ──
#[tauri::command]
pub async fn get_opname_config(pool: State<'_, DbPool>, token: String) -> Result<serde_json::Value, AppError> {
    pool.verify_token(&token)?;
    let blind: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='blind_count_mode'),'false')")
        .fetch_one(&pool.pool).await
        .unwrap_or("false".into());
    let threshold: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='auto_adjust_threshold'),'0')")
        .fetch_one(&pool.pool).await
        .unwrap_or("0".into());
    Ok(serde_json::json!({ "blind_count_mode": blind == "true", "auto_adjust_threshold": threshold.parse::<f64>().unwrap_or(0.0) }))
}

#[tauri::command]
pub async fn set_opname_config(pool: State<'_, DbPool>, token: String, key: String, value: String) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    sqlx::query("INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        .bind(&key).bind(&value)
        .execute(&pool.pool).await?;
    Ok(())
}

// ── Auto-generate cycle opname (Phase 11) ──
#[tauri::command]
pub async fn auto_generate_cycle_opname(pool: State<'_, DbPool>, token: String) -> Result<String, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut tx = pool.pool.begin().await.map_err(|e| AppError::Db(format!("begin tx: {}", e)))?;

    let schedules: Vec<(String, Option<String>, String, i64)> = sqlx::query("SELECT id, warehouse_id, class, frequency_days FROM cycle_schedules WHERE next_date <= $1")
        .bind(&today)
        .fetch_all(&mut *tx)
        .await?
        .iter()
        .map(|row| {
            (row.get::<String, _>(0), row.get::<Option<String>, _>(1), row.get::<String, _>(2), row.get::<i64, _>(3))
        })
        .collect();

    let mut created = 0;
    for (sid, wh_id, class, freq) in &schedules {
        let oid = uuid::Uuid::new_v4().to_string();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname")
            .fetch_one(&mut *tx).await
            .unwrap_or(1);
        let opname_number = format!("OPN-{:04}", count);
        sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at) VALUES ($1,$2,$3,'draft',$4,'auto',$5,$5)")
            .bind(&oid).bind(&opname_number).bind(wh_id).bind(format!("Auto-generated cycle count ({})", class)).bind(&now)
            .execute(&mut *tx).await?;

        let mut mat_builder = QueryBuilder::new("SELECT id, quantity FROM materials WHERE is_active=true");
        if let Some(ref w) = wh_id {
            mat_builder.push(" AND warehouse_id = ");
            mat_builder.push_bind(w);
        }
        let materials: Vec<(String, f64)> = mat_builder.build()
            .fetch_all(&mut *tx)
            .await?
            .iter()
            .map(|row| (row.get::<String, _>(0), row.get::<f64, _>(1)))
            .collect();

        for (mid, qty) in &materials {
            let iid = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference) VALUES ($1,$2,$3,$4,$5,0)")
                .bind(&iid).bind(&oid).bind(mid).bind(qty).bind(qty)
                .execute(&mut *tx).await.ok();
        }

        sqlx::query("UPDATE cycle_schedules SET next_date=CURRENT_DATE + $1, last_date=$2 WHERE id=$3")
            .bind(freq).bind(&today).bind(sid)
            .execute(&mut *tx).await?;
        created += 1;
    }

    tx.commit().await.map_err(|e| AppError::Db(format!("commit tx: {}", e)))?;
    Ok(format!("Created {} opname(s) from cycle schedules", created))
}

// ── Batch rack transfer (Phase 11) ──
#[tauri::command]
pub async fn batch_transfer_rack(pool: State<'_, DbPool>, token: String, source_rack_id: String, dest_warehouse_id: String, dest_rack_id: Option<String>, _user_id: Option<String>) -> Result<String, AppError> {
    let user_id = pool.verify_token(&token)?;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await? { return Err(AppError::Auth("Permission denied".into())); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut tx = pool.pool.begin().await.map_err(|e| AppError::Db(format!("begin tx: {}", e)))?;

    let materials: Vec<(String, String, f64)> = sqlx::query("SELECT id, name, quantity FROM materials WHERE rack_id=$1 AND is_active=true")
        .bind(&source_rack_id)
        .fetch_all(&mut *tx)
        .await?
        .iter()
        .map(|row| (row.get::<String, _>(0), row.get::<String, _>(1), row.get::<f64, _>(2)))
        .collect();

    if materials.is_empty() {
        return Err(AppError::NotFound("No active materials found in source rack".into()));
    }

    let mut count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM transactions WHERE type='transfer'")
        .fetch_one(&mut *tx).await
        .unwrap_or(1);
    let mut tx_count = 0;

    for (mid, _name, qty) in &materials {
        if *qty <= 0.0 { continue; }
        let txn_number = format!("TRF-{:04}", count);
        sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number).bind(mid).bind("").bind(-qty).bind(format!("Batch rack transfer to {}", dest_warehouse_id)).bind(&user_id).bind(&now)
            .execute(&mut *tx).await?;
        count += 1;

        let txn_number2 = format!("TRF-{:04}", count);
        sqlx::query("INSERT INTO transactions (id, transaction_number, type, material_id, warehouse_id, rack_id, quantity, notes, user_id, created_at) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8,$9)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&txn_number2).bind(mid).bind(&dest_warehouse_id).bind(&dest_rack_id).bind(qty).bind(format!("Batch rack transfer from rack {}", source_rack_id)).bind(&user_id).bind(&now)
            .execute(&mut *tx).await?;
        count += 1;

        sqlx::query("UPDATE materials SET warehouse_id=$1, rack_id=$2 WHERE id=$3")
            .bind(&dest_warehouse_id).bind(&dest_rack_id).bind(mid)
            .execute(&mut *tx).await?;
        tx_count += 1;
    }

    tx.commit().await.map_err(|e| AppError::Db(format!("commit tx: {}", e)))?;
    Ok(format!("Transferred {} material(s) from rack to destination warehouse", tx_count))
}
