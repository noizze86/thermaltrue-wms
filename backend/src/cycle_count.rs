use sqlx::Row;

pub async fn run_auto_generate(pool: &sqlx::PgPool, user_id: &str) -> Result<(i64, i64), sqlx::Error> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut db_tx = pool.begin().await?;

    // 1. Auto-expire open/in_progress tasks past deadline
    let expired_count = sqlx::query("UPDATE stock_opname SET status='expired', updated_at=$1 WHERE status IN ('open','in_progress') AND deadline <> '' AND deadline < $2")
        .bind(&now).bind(&today).execute(&mut *db_tx).await?
        .rows_affected();

    let mut created: i64 = 0;

    // 2. ABC/class schedules: scope = materials of matching abc class (fallback: all)
    let schedules: Vec<(String, Option<String>, String, i32)> = sqlx::query("SELECT id, warehouse_id, class, frequency_days FROM cycle_schedules WHERE next_date <= $1")
        .bind(&today).fetch_all(&mut *db_tx).await?
        .iter().map(|row| (row.get::<String,_>(0), row.get::<Option<String>,_>(1), row.get::<String,_>(2), row.get::<i32,_>(3))).collect();
    for (sid, wh_id, class, freq) in &schedules {
        let oid = uuid::Uuid::new_v4().to_string();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname").fetch_one(&mut *db_tx).await.unwrap_or(1);
        let opname_number = format!("OPN-{:04}", count);
        sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at, cycle_mode, task_type, tolerance_pct) VALUES ($1,$2,$3,'open',$4,$5,$6,$6,'abc','cycle',0)")
            .bind(&oid).bind(&opname_number).bind(wh_id).bind(format!("Auto cycle count class {}", class)).bind(user_id).bind(&now)
            .execute(&mut *db_tx).await?;
        let materials: Vec<(String, f64)> = {
            let mut mat_builder = sqlx::QueryBuilder::new(
                "SELECT m.id, m.quantity FROM materials m WHERE m.is_active=true");
            if let Some(ref w) = wh_id { mat_builder.push(" AND m.warehouse_id = "); mat_builder.push_bind(w); }
            if let Some(c) = class.chars().next() {
                mat_builder.push(" AND (EXISTS (SELECT 1 FROM abc_classification a WHERE a.material_id=m.id AND a.abc_class=");
                mat_builder.push_bind(c.to_string());
                mat_builder.push(") OR NOT EXISTS (SELECT 1 FROM abc_classification a2 WHERE a2.material_id=m.id))");
            }
            mat_builder.build().fetch_all(&mut *db_tx).await?
                .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1))).collect()
        };
        for (mid, qty) in &materials {
            let iid = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference, cycle_round) VALUES ($1,$2,$3,$4,$5,0,1)")
                .bind(&iid).bind(&oid).bind(mid).bind(qty).bind(qty).execute(&mut *db_tx).await?;
        }
        sqlx::query("UPDATE cycle_schedules SET next_date=CURRENT_DATE + $1, last_date=$2 WHERE id=$3")
            .bind(freq).bind(&today).bind(sid).execute(&mut *db_tx).await?;
        created += 1;
    }

    // 3. Zone rotation schedules
    let zones: Vec<(String, String, Option<String>, String, i32)> = sqlx::query("SELECT id, zone_id, warehouse_id, assign_mode, CASE WHEN assign_mode='daily' THEN 1 ELSE 7 END FROM cycle_count_zones WHERE next_date <= $1")
        .bind(&today).fetch_all(&mut *db_tx).await?
        .iter().map(|row| (row.get::<String,_>(0), row.get::<String,_>(1), row.get::<Option<String>,_>(2), row.get::<String,_>(3), row.get::<i32,_>(4))).collect();
    for (zid, zone_id, wh_id, _mode, freq) in &zones {
        let oid = uuid::Uuid::new_v4().to_string();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname").fetch_one(&mut *db_tx).await.unwrap_or(1);
        let opname_number = format!("OPN-{:04}", count);
        let zone_name: String = sqlx::query_scalar("SELECT COALESCE(name, code) FROM zones WHERE id=$1")
            .bind(zone_id).fetch_optional(&mut *db_tx).await?.unwrap_or_else(|| zone_id.clone());
        sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at, cycle_mode, task_type, zone_id, tolerance_pct) VALUES ($1,$2,$3,'open',$4,$5,$6,$6,'zone','cycle',$7,0)")
            .bind(&oid).bind(&opname_number).bind(wh_id).bind(format!("Auto zone rotation: {}", zone_name)).bind(user_id).bind(&now).bind(zone_id)
            .execute(&mut *db_tx).await?;
        let materials: Vec<(String, f64)> = {
            let mut mat_builder = sqlx::QueryBuilder::new("SELECT m.id, m.quantity FROM materials m WHERE m.is_active=true");
            if let Some(ref w) = wh_id { mat_builder.push(" AND m.warehouse_id = "); mat_builder.push_bind(w); }
            mat_builder.build().fetch_all(&mut *db_tx).await?
                .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1))).collect()
        };
        for (mid, qty) in &materials {
            let iid = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference, cycle_round) VALUES ($1,$2,$3,$4,$5,0,1)")
                .bind(&iid).bind(&oid).bind(mid).bind(qty).bind(qty).execute(&mut *db_tx).await?;
        }
        sqlx::query("UPDATE cycle_count_zones SET next_date=CURRENT_DATE + $1, last_date=$2 WHERE id=$3")
            .bind(freq).bind(&today).bind(zid).execute(&mut *db_tx).await?;
        created += 1;
    }

    // 4. Low-stock trigger (when enabled via app_config cycle_low_stock_trigger=true)
    let low_trigger: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='cycle_low_stock_trigger'),'false')")
        .fetch_one(&mut *db_tx).await.unwrap_or("false".into());
    if low_trigger == "true" {
        let low_mats: Vec<(String, f64, String)> = sqlx::query("SELECT m.id, m.quantity, m.warehouse_id FROM materials m WHERE m.is_active=true AND m.quantity < COALESCE(m.min_stock, 0) AND NOT EXISTS (SELECT 1 FROM stock_opname o WHERE o.status IN ('open','in_progress','pending_review') AND o.cycle_mode='low_stock' AND o.warehouse_id = m.warehouse_id)")
            .fetch_all(&mut *db_tx).await?
            .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1), row.get::<String,_>(2))).collect();
        if !low_mats.is_empty() {
            let wh_ids: Vec<String> = {
                let mut seen = std::collections::HashSet::new();
                low_mats.iter().map(|m| m.2.clone()).filter(|w| seen.insert(w.clone())).collect()
            };
            for wh in &wh_ids {
                let oid = uuid::Uuid::new_v4().to_string();
                let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname").fetch_one(&mut *db_tx).await.unwrap_or(1);
                let opname_number = format!("OPN-{:04}", count);
                sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at, cycle_mode, task_type, tolerance_pct) VALUES ($1,$2,$3,'open',$4,$5,$6,$6,'low_stock','cycle',0)")
                    .bind(&oid).bind(&opname_number).bind(wh).bind("Auto low-stock cycle count").bind(user_id).bind(&now)
                    .execute(&mut *db_tx).await?;
                for (lmid, lqty, _lwh) in low_mats.iter().filter(|m| m.2 == *wh) {
                    let iid = uuid::Uuid::new_v4().to_string();
                    sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference, cycle_round) VALUES ($1,$2,$3,$4,$5,0,1)")
                        .bind(&iid).bind(&oid).bind(lmid).bind(lqty).bind(lqty).execute(&mut *db_tx).await?;
                }
                created += 1;
            }
        }
    }

    db_tx.commit().await?;
    Ok((created, expired_count.try_into().unwrap_or(0)))
}
