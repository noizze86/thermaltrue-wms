use tauri::State;
use chrono::Datelike;
use crate::db_pool::DbPool;
use crate::error::AppError;
use crate::models::*;
use sqlx::Row;

// ── Existing CSV & PDF ──

#[tauri::command]
pub async fn export_report_csv(pool: State<'_, DbPool>, token: String, report_type: String) -> Result<String, AppError> {
    pool.verify_token(&token)?;
    let mut wtr = csv::Writer::from_writer(Vec::new());
    match report_type.as_str() {
        "materials" => {
            wtr.write_record(["SKU", "Name", "Category", "Quantity", "Price", "Min Stock", "Expiry Date"]).map_err(|e| AppError::Internal(e.to_string()))?;
            let rows = sqlx::query("SELECT m.sku, m.name, COALESCE(c.name,''), m.quantity, m.price, m.min_stock, COALESCE(m.expiry_date,'') FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true ORDER BY m.name")
                .fetch_all(&pool.pool).await?;
            for row in &rows { wtr.write_record([row.get::<String,_>(0), row.get::<String,_>(1), row.get::<String,_>(2), row.get::<f64,_>(3).to_string(), row.get::<f64,_>(4).to_string(), row.get::<f64,_>(5).to_string(), row.get::<String,_>(6)]).map_err(|e| AppError::Internal(e.to_string()))?; }
        }
        "transactions" => {
            wtr.write_record(["Number", "Type", "Material", "Quantity", "Date"]).map_err(|e| AppError::Internal(e.to_string()))?;
            let rows = sqlx::query("SELECT t.transaction_number, t.type, COALESCE(m.name,''), t.quantity, t.created_at FROM transactions t LEFT JOIN materials m ON t.material_id=m.id ORDER BY t.created_at DESC")
                .fetch_all(&pool.pool).await?;
            for row in &rows { wtr.write_record([row.get::<String,_>(0), row.get::<String,_>(1), row.get::<String,_>(2), row.get::<f64,_>(3).to_string(), row.get::<String,_>(4)]).map_err(|e| AppError::Internal(e.to_string()))?; }
        }
        "categories" => {
            wtr.write_record(["Name", "Description"]).map_err(|e| AppError::Internal(e.to_string()))?;
            let rows = sqlx::query("SELECT name, COALESCE(description,'') FROM categories ORDER BY name")
                .fetch_all(&pool.pool).await?;
            for row in &rows { wtr.write_record([row.get::<String,_>(0), row.get::<String,_>(1)]).map_err(|e| AppError::Internal(e.to_string()))?; }
        }
        "units" => {
            wtr.write_record(["Name", "Symbol"]).map_err(|e| AppError::Internal(e.to_string()))?;
            let rows = sqlx::query("SELECT name, COALESCE(symbol,'') FROM units ORDER BY name")
                .fetch_all(&pool.pool).await?;
            for row in &rows { wtr.write_record([row.get::<String,_>(0), row.get::<String,_>(1)]).map_err(|e| AppError::Internal(e.to_string()))?; }
        }
        "suppliers" => {
            wtr.write_record(["Name", "Contact", "Phone", "Email", "Address"]).map_err(|e| AppError::Internal(e.to_string()))?;
            let rows = sqlx::query("SELECT name, COALESCE(contact,''), COALESCE(phone,''), COALESCE(email,''), COALESCE(address,'') FROM suppliers ORDER BY name")
                .fetch_all(&pool.pool).await?;
            for row in &rows { wtr.write_record([row.get::<String,_>(0), row.get::<String,_>(1), row.get::<String,_>(2), row.get::<String,_>(3), row.get::<String,_>(4)]).map_err(|e| AppError::Internal(e.to_string()))?; }
        }
        "transaction_details" => {
            wtr.write_record(["Number","Type","Material","Warehouse","Qty","Price","Status","User","Reference","PO","Invoice","Date"]).map_err(|e| AppError::Internal(e.to_string()))?;
            let rows = sqlx::query("SELECT t.transaction_number,t.type,COALESCE(m.name,''),COALESCE(w.name,''),t.quantity,t.price,t.status,COALESCE(u.full_name,''),t.reference,t.po_number,t.invoice_no,t.created_at FROM transactions t LEFT JOIN materials m ON t.material_id=m.id LEFT JOIN warehouses w ON t.warehouse_id=w.id LEFT JOIN users u ON t.user_id=u.id ORDER BY t.created_at DESC")
                .fetch_all(&pool.pool).await?;
            for row in &rows { wtr.write_record([row.get::<String,_>(0),row.get::<String,_>(1),row.get::<String,_>(2),row.get::<String,_>(3),row.get::<f64,_>(4).to_string(),row.get::<f64,_>(5).to_string(),row.get::<String,_>(6),row.get::<String,_>(7),row.get::<String,_>(8),row.get::<String,_>(9),row.get::<String,_>(10),row.get::<String,_>(11)]).map_err(|e| AppError::Internal(e.to_string()))?; }
        }
        _ => return Err(AppError::Validation("Unknown report type".into())),
    }
    let data = wtr.into_inner().map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(String::from_utf8(data).map_err(|e| AppError::Internal(e.to_string()))?)
}

#[tauri::command]
pub async fn generate_report_pdf(pool: State<'_, DbPool>, token: String, report_type: String, opname_id: Option<String>,
    date_start: Option<String>, date_end: Option<String>, type_filter: Option<String>, status_filter: Option<String>) -> Result<Vec<u8>, AppError> {
    pool.verify_token(&token)?;

    let company_name: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());
    let company_addr: String = sqlx::query_scalar("SELECT COALESCE(address,'') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_default();

    let materials_data: Vec<(String, String, String, f64, f64, f64)>;
    let stock_data: Vec<(String, String, String, f64, f64)>;
    let opname_data: Vec<(String, f64, f64, f64, String)>;
    let tx_data: Vec<(String, String, String, f64, String, String, String)>;

    match report_type.as_str() {
        "materials" => {
            let rows = sqlx::query("SELECT m.sku, m.name, COALESCE(c.name,''), m.quantity, m.price, m.min_stock FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true ORDER BY m.name")
                .fetch_all(&pool.pool).await?;
            materials_data = rows.iter().map(|r| (r.get(0), r.get(1), r.get(2), r.get(3), r.get(4), r.get(5))).collect();
            stock_data = Vec::new(); opname_data = Vec::new(); tx_data = Vec::new();
        }
        "stock" => {
            let rows = sqlx::query("SELECT m.sku, m.name, COALESCE(w.name,''), m.quantity, m.min_stock FROM materials m LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.is_active=true ORDER BY w.name, m.name")
                .fetch_all(&pool.pool).await?;
            materials_data = Vec::new();
            stock_data = rows.iter().map(|r| (r.get(0), r.get(1), r.get(2), r.get(3), r.get(4))).collect();
            opname_data = Vec::new(); tx_data = Vec::new();
        }
        "opname" => {
            let oid: String = if let Some(id) = opname_id { id } else {
                sqlx::query_scalar("SELECT id FROM stock_opname WHERE status='completed' ORDER BY created_at DESC LIMIT 1")
                    .fetch_one(&pool.pool).await.unwrap_or_default()
            };
            let rows = sqlx::query("SELECT m.name, soi.system_qty, soi.physical_qty, soi.difference, soi.notes FROM stock_opname_items soi LEFT JOIN materials m ON soi.material_id=m.id WHERE soi.opname_id=$1 ORDER BY m.name")
                .bind(&oid).fetch_all(&pool.pool).await?;
            materials_data = Vec::new(); stock_data = Vec::new();
            opname_data = rows.iter().map(|r| (r.get(0), r.get(1), r.get(2), r.get(3), r.get(4))).collect();
            tx_data = Vec::new();
        }
        "transactions" => {
            let mut sql = String::from("SELECT t.transaction_number, t.type, COALESCE(m.name,''), t.quantity, t.reference, t.status, t.created_at FROM transactions t LEFT JOIN materials m ON t.material_id=m.id WHERE 1=1");
            let mut param_idx = 1;
            if let Some(ref ds) = date_start { if !ds.is_empty() { sql.push_str(&format!(" AND t.created_at >= ${}", param_idx)); param_idx += 1; } }
            if let Some(ref de) = date_end { if !de.is_empty() { sql.push_str(&format!(" AND t.created_at <= ${}", param_idx)); param_idx += 1; } }
            if let Some(ref tf) = type_filter { if !tf.is_empty() && tf != "all" { sql.push_str(&format!(" AND t.type = ${}", param_idx)); param_idx += 1; } }
            if let Some(ref sf) = status_filter { if !sf.is_empty() && sf != "all" { sql.push_str(&format!(" AND t.status = ${}", param_idx)); } }
            sql.push_str(" ORDER BY t.created_at DESC LIMIT 500");
            let mut q = sqlx::query(&sql);
            if let Some(ref ds) = date_start { if !ds.is_empty() { q = q.bind(ds); } }
            if let Some(ref de) = date_end { if !de.is_empty() { q = q.bind(format!("{} 23:59:59", de)); } }
            if let Some(ref tf) = type_filter { if !tf.is_empty() && tf != "all" { q = q.bind(tf); } }
            if let Some(ref sf) = status_filter { if !sf.is_empty() && sf != "all" { q = q.bind(sf); } }
            let rows = q.fetch_all(&pool.pool).await?;
            materials_data = Vec::new(); stock_data = Vec::new(); opname_data = Vec::new();
            tx_data = rows.iter().map(|r| (r.get(0), r.get(1), r.get(2), r.get(3), r.get(4), r.get(5), r.get(6))).collect();
        }
        _ => {
            materials_data = Vec::new(); stock_data = Vec::new(); opname_data = Vec::new(); tx_data = Vec::new();
        }
    }

    let bytes = tokio::task::spawn_blocking(move || {
        use printpdf::*;
        let (doc, page1, layer1) = PdfDocument::new(&format!("{} Report", company_name), Mm(210.0), Mm(297.0), "Report");
        let current_layer = doc.get_page(page1).get_layer(layer1);
        let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| AppError::Internal(e.to_string()))?;
        let font_reg = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| AppError::Internal(e.to_string()))?;

        current_layer.use_text(&company_name, 18.0, Mm(20.0), Mm(275.0), &font_bold);
        if !company_addr.is_empty() {
            current_layer.use_text(&company_addr, 9.0, Mm(20.0), Mm(268.0), &font_reg);
        }
        current_layer.use_text(&format!("{} Report - Generated {}", report_type, chrono::Local::now().format("%Y-%m-%d %H:%M")), 11.0, Mm(20.0), Mm(260.0), &font_bold);

        match report_type.as_str() {
            "materials" => {
                let mut y = 245.0;
                current_layer.use_text("SKU | Name | Category | Qty | Price | Min", 9.0, Mm(20.0), Mm(y), &font_bold);
                y -= 6.0;
                for (sku, name, cat, qty, price, min) in &materials_data {
                    if y < 20.0 { current_layer.use_text("...continued on next page", 8.0, Mm(20.0), Mm(15.0), &font_reg); break; }
                    current_layer.use_text(&format!("{} | {} | {} | {} | {} | {}", sku, name, cat, qty, price, min), 8.0, Mm(20.0), Mm(y), &font_reg);
                    y -= 5.0;
                }
                current_layer.use_text(&format!("Page 1 | {} - {} Report", company_name, report_type), 7.0, Mm(20.0), Mm(10.0), &font_reg);
            }
            "stock" => {
                let mut y = 245.0;
                current_layer.use_text("SKU | Name | Warehouse | Qty | Min Stock", 9.0, Mm(20.0), Mm(y), &font_bold);
                y -= 6.0;
                for (sku, name, wh, qty, min) in &stock_data {
                    if y < 20.0 { break; }
                    current_layer.use_text(&format!("{} | {} | {} | {} | {}", sku, name, wh, qty, min), 8.0, Mm(20.0), Mm(y), &font_reg);
                    y -= 5.0;
                }
                current_layer.use_text(&format!("Page 1 | {} - {} Report", company_name, report_type), 7.0, Mm(20.0), Mm(10.0), &font_reg);
            }
            "opname" => {
                let mut y = 245.0;
                current_layer.use_text("Material | System | Physical | Diff | Notes", 9.0, Mm(20.0), Mm(y), &font_bold);
                y -= 6.0;
                for (mat, sys, phy, diff, notes) in &opname_data {
                    if y < 20.0 { break; }
                    current_layer.use_text(&format!("{} | {} | {} | {} | {}", mat, sys, phy, diff, notes), 8.0, Mm(20.0), Mm(y), &font_reg);
                    y -= 5.0;
                }
                y = 40.0;
                current_layer.use_text("Supervisor: _______________", 10.0, Mm(20.0), Mm(y), &font_reg);
                current_layer.use_text("Mengetahui: _______________", 10.0, Mm(120.0), Mm(y), &font_reg);
                current_layer.use_text(&format!("Page 1 | {} - Opname Report", company_name), 7.0, Mm(20.0), Mm(10.0), &font_reg);
            }
            "transactions" => {
                let mut y = 245.0;
                current_layer.use_text("Number | Type | Material | Qty | Ref | Status | Date", 9.0, Mm(20.0), Mm(y), &font_bold);
                y -= 6.0;
                for (num, typ, mat, qty, ref_, sts, dt) in &tx_data {
                    if y < 20.0 { current_layer.use_text("...continued on next page", 8.0, Mm(20.0), Mm(15.0), &font_reg); break; }
                    current_layer.use_text(&format!("{} | {} | {} | {} | {} | {} | {}", num, typ, mat, qty, ref_, sts, dt), 7.0, Mm(20.0), Mm(y), &font_reg);
                    y -= 4.5;
                }
                current_layer.use_text(&format!("Page 1 | {} - Transactions Report", company_name), 7.0, Mm(20.0), Mm(10.0), &font_reg);
            }
            _ => {}
        }

        doc.save_to_bytes().map_err(|e| AppError::Internal(e.to_string()))
    }).await.map_err(|e| AppError::Internal(e.to_string()))??;

    Ok(bytes)
}

// ── MoM KPIs ──

#[tauri::command]
pub async fn get_mom_kpis(pool: State<'_, DbPool>, token: String) -> Result<Vec<MomKpi>, AppError> {
    pool.verify_token(&token)?;

    let now = chrono::Local::now().naive_local();
    let cur_month_start = now.format("%Y-%m-01 00:00:00").to_string();
    let prev_month_start = (now - chrono::Duration::days(now.day() as i64)).format("%Y-%m-01 00:00:00").to_string();
    let prev_month_end = cur_month_start.clone();

    let cur_materials: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await?;
    let cur_value: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity*price),0) FROM materials WHERE is_active=true")
        .fetch_one(&pool.pool).await?;
    let cur_low_stock: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE quantity<=min_stock AND min_stock>0 AND is_active=true")
        .fetch_one(&pool.pool).await?;
    let cur_transactions: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM transactions")
        .fetch_one(&pool.pool).await?;
    let cur_tx_month: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM transactions WHERE created_at>=$1")
        .bind(&cur_month_start).fetch_one(&pool.pool).await?;

    let prev_materials: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE is_active=true AND created_at<$1")
        .bind(&cur_month_start).fetch_one(&pool.pool).await.unwrap_or(cur_materials);
    let prev_value: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity*price),0) FROM materials WHERE is_active=true AND created_at<$1")
        .bind(&cur_month_start).fetch_one(&pool.pool).await.unwrap_or(0.0);
    let prev_low_stock: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM materials WHERE quantity<=min_stock AND min_stock>0 AND is_active=true AND created_at<$1")
        .bind(&cur_month_start).fetch_one(&pool.pool).await.unwrap_or(0.0);
    let prev_transactions: f64 = sqlx::query_scalar("SELECT COUNT(*)::float FROM transactions WHERE created_at>=$1 AND created_at<$2")
        .bind(&prev_month_start).bind(&prev_month_end).fetch_one(&pool.pool).await.unwrap_or(0.0);

    fn pct(cur: f64, prev: f64) -> f64 { if prev == 0.0 { 0.0 } else { ((cur - prev) / prev * 100.0 * 100.0).round() / 100.0 } }

    Ok(vec![
        MomKpi { current_value: cur_materials, prev_value: prev_materials, change_pct: pct(cur_materials, prev_materials) },
        MomKpi { current_value: cur_value, prev_value: prev_value, change_pct: pct(cur_value, prev_value) },
        MomKpi { current_value: cur_low_stock, prev_value: prev_low_stock, change_pct: pct(cur_low_stock, prev_low_stock) },
        MomKpi { current_value: cur_transactions, prev_value: prev_transactions, change_pct: pct(cur_transactions, prev_transactions) },
        MomKpi { current_value: cur_tx_month, prev_value: prev_transactions, change_pct: pct(cur_tx_month, prev_transactions) },
    ])
}

// ── Aging Report ──

#[tauri::command]
pub async fn get_aging_report(pool: State<'_, DbPool>, token: String) -> Result<Vec<AgingItem>, AppError> {
    pool.verify_token(&token)?;

    let mut items = Vec::new();
    for (bucket, days) in [("30 days", 30i64), ("60 days", 60i64), ("90 days", 90i64), ("90+ days", 9999i64)] {
        if days < 9999 {
            let cnt: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM materials m WHERE is_active=true AND (SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - created_at))/86400, 999) FROM transactions WHERE material_id=m.id AND type!='opname') <= $1 AND (SELECT MIN(COALESCE(EXTRACT(EPOCH FROM (NOW() - created_at))/86400, 999)) FROM transactions WHERE material_id=m.id) > 0"
            ).bind(days as f64).fetch_one(&pool.pool).await.unwrap_or(0);
            let val: f64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(m.quantity*m.price),0) FROM materials m WHERE is_active=true AND (SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at))/86400), 999) FROM transactions WHERE material_id=m.id AND type!='opname') <= $1"
            ).bind(days as f64).fetch_one(&pool.pool).await.unwrap_or(0.0);
            items.push(AgingItem { bucket: bucket.into(), count: cnt, total_value: val });
        } else {
            let cnt: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM materials m WHERE is_active=true AND ((SELECT MAX(created_at) FROM transactions WHERE material_id=m.id AND type!='opname') IS NULL OR EXTRACT(EPOCH FROM (NOW() - COALESCE((SELECT MAX(created_at) FROM transactions WHERE material_id=m.id AND type!='opname'),'2000-01-01'::timestamp)))/86400 > 90)"
            ).fetch_one(&pool.pool).await.unwrap_or(0);
            items.push(AgingItem { bucket: bucket.into(), count: cnt, total_value: 0.0 });
        }
    }
    Ok(items)
}

// ── Stock Movement Summary ──

#[tauri::command]
pub async fn get_stock_movement(pool: State<'_, DbPool>, token: String, period_start: String, period_end: String) -> Result<Vec<StockMovement>, AppError> {
    pool.verify_token(&token)?;

    let rows = sqlx::query("SELECT m.id, m.name, m.quantity FROM materials m WHERE m.is_active=true ORDER BY m.name")
        .fetch_all(&pool.pool).await?;
    let materials: Vec<(String, String, f64)> = rows.iter().map(|row| (row.get(0), row.get(1), row.get(2))).collect();

    let mut result = Vec::new();
    for (mid, mname, closing) in materials {
        let qty_in: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity),0) FROM transactions WHERE material_id=$1 AND type='in' AND created_at>=$2 AND created_at<$3")
            .bind(&mid).bind(&period_start).bind(&period_end).fetch_one(&pool.pool).await.unwrap_or(0.0);
        let qty_out: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(quantity),0) FROM transactions WHERE material_id=$1 AND type='out' AND created_at>=$2 AND created_at<$3")
            .bind(&mid).bind(&period_start).bind(&period_end).fetch_one(&pool.pool).await.unwrap_or(0.0);
        let opening = closing + qty_out - qty_in;
        result.push(StockMovement { material_name: mname, opening: opening.round(), qty_in: qty_in.round(), qty_out: qty_out.round(), closing: closing.round() });
    }
    Ok(result)
}

// ── Transaction Type Pie ──

#[tauri::command]
pub async fn get_tx_type_summary(pool: State<'_, DbPool>, token: String) -> Result<Vec<CategoryValue>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT type, COUNT(*)::bigint, COALESCE(SUM(quantity*price),0) FROM transactions WHERE status='approved' GROUP BY type ORDER BY COUNT(*) DESC")
        .fetch_all(&pool.pool).await?;
    let mut v = Vec::new();
    for row in &rows { v.push(CategoryValue { name: row.get(0), count: row.get::<i64,_>(1), value: row.get(2) }); }
    Ok(v)
}

// ── Group by User ──

#[tauri::command]
pub async fn get_tx_by_user(pool: State<'_, DbPool>, token: String, date_start: Option<String>, date_end: Option<String>) -> Result<Vec<UserTxSummary>, AppError> {
    pool.verify_token(&token)?;

    let mut sql = "SELECT COALESCE(t.user_id,''), COALESCE(u.full_name,'System'), COUNT(*)::bigint, COALESCE(SUM(t.quantity*t.price),0) FROM transactions t LEFT JOIN users u ON t.user_id=u.id WHERE t.status='approved'".to_string();
    let mut param_idx = 1;
    if let Some(ref _ds) = date_start { sql.push_str(&format!(" AND t.created_at>=${}", param_idx)); param_idx += 1; }
    if let Some(ref _de) = date_end { sql.push_str(&format!(" AND t.created_at<=${}", param_idx)); }
    sql.push_str(" GROUP BY t.user_id ORDER BY COUNT(*) DESC");
    let mut q = sqlx::query(&sql);
    if let Some(ref ds) = date_start { q = q.bind(ds); }
    if let Some(ref de) = date_end { q = q.bind(de); }
    let rows = q.fetch_all(&pool.pool).await?;
    let mut v = Vec::new();
    for row in &rows { v.push(UserTxSummary { user_id: row.get(0), user_name: row.get(1), total_count: row.get::<i64,_>(2), total_value: row.get(3) }); }
    Ok(v)
}

// ── Daily Trend ──

#[tauri::command]
pub async fn get_daily_trend(pool: State<'_, DbPool>, token: String, date_start: String, date_end: String) -> Result<Vec<DailyTrend>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT DATE(created_at)::text, COUNT(*)::bigint, COALESCE(SUM(quantity*price),0) FROM transactions WHERE status='approved' AND created_at>=$1 AND created_at<=$2 GROUP BY DATE(created_at) ORDER BY DATE(created_at)")
        .bind(&date_start).bind(&date_end).fetch_all(&pool.pool).await?;
    let mut v = Vec::new();
    for row in &rows { v.push(DailyTrend { date: row.get(0), count: row.get::<i64,_>(1), value: row.get(2) }); }
    Ok(v)
}

// ── Date Comparison (2 series) ──

#[tauri::command]
pub async fn get_tx_date_comparison(pool: State<'_, DbPool>, token: String, a_start: String, a_end: String, b_start: String, b_end: String) -> Result<Vec<DailyTrend>, AppError> {
    pool.verify_token(&token)?;
    let rows_a = sqlx::query("SELECT DATE(created_at)::text, COUNT(*)::bigint, COALESCE(SUM(quantity*price),0) FROM transactions WHERE status='approved' AND created_at>=$1 AND created_at<=$2 GROUP BY DATE(created_at) ORDER BY DATE(created_at)")
        .bind(&a_start).bind(&a_end).fetch_all(&pool.pool).await?;
    let mut result: Vec<DailyTrend> = Vec::new();
    for row in &rows_a { let mut d = DailyTrend { date: row.get(0), count: row.get::<i64,_>(1), value: row.get(2) }; d.date = format!("A_{}", d.date); result.push(d); }
    let rows_b = sqlx::query("SELECT DATE(created_at)::text, COUNT(*)::bigint, COALESCE(SUM(quantity*price),0) FROM transactions WHERE status='approved' AND created_at>=$1 AND created_at<=$2 GROUP BY DATE(created_at) ORDER BY DATE(created_at)")
        .bind(&b_start).bind(&b_end).fetch_all(&pool.pool).await?;
    for row in &rows_b { let mut d = DailyTrend { date: row.get(0), count: row.get::<i64,_>(1), value: row.get(2) }; d.date = format!("B_{}", d.date); result.push(d); }
    Ok(result)
}

// ── Opname Variance by Category ──

#[tauri::command]
pub async fn get_opname_variance(pool: State<'_, DbPool>, token: String, opname_id: String) -> Result<Vec<OpnameVariance>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT COALESCE(c.name,'Uncategorized'), SUM(soi.difference) FROM stock_opname_items soi LEFT JOIN materials m ON soi.material_id=m.id LEFT JOIN categories c ON m.category_id=c.id WHERE soi.opname_id=$1 GROUP BY c.name ORDER BY SUM(soi.difference) DESC")
        .bind(&opname_id).fetch_all(&pool.pool).await?;
    let mut v = Vec::new();
    for row in &rows { v.push(OpnameVariance { category: row.get(0), total_diff: row.get(1) }); }
    Ok(v)
}

// ── Approve/Reject Opname Adjustment ──

#[tauri::command]
pub async fn approve_opname_adjustment(pool: State<'_, DbPool>, token: String, opname_id: String, approved: bool) -> Result<(), AppError> {
    let user_id = pool.verify_token(&token)?;
    let mut tx = pool.pool.begin().await?;

    if approved {
        let items: Vec<(String, f64)> = sqlx::query("SELECT material_id, physical_qty FROM stock_opname_items WHERE opname_id=$1")
            .bind(&opname_id).fetch_all(&mut *tx).await?.iter().map(|row| (row.get(0), row.get(1))).collect();
        for (mid, phy_qty) in items {
            sqlx::query("UPDATE materials SET quantity=$1 WHERE id=$2")
                .bind(phy_qty).bind(&mid).execute(&mut *tx).await?;
        }
        sqlx::query("UPDATE stock_opname SET status='completed', updated_at=NOW() WHERE id=$1")
            .bind(&opname_id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE stock_opname SET status='draft', updated_at=NOW() WHERE id=$1")
            .bind(&opname_id).execute(&mut *tx).await?;
    }

    let action = if approved { "approve_opname" } else { "reject_opname" };
    sqlx::query(
        "INSERT INTO audit_log (id, user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)"
    )
        .bind(uuid::Uuid::new_v4().to_string()).bind(&user_id).bind(action).bind("stock_opname").bind(&opname_id).bind("")
        .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

// ── XLSX Export ──

#[tauri::command]
pub async fn export_opname_xlsx(pool: State<'_, DbPool>, token: String, opname_id: String) -> Result<Vec<u8>, AppError> {
    pool.verify_token(&token)?;
    use rust_xlsxwriter::*;

    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("Opname Result")?;

    let header = Format::new().set_bold().set_border(FormatBorder::Thin).set_background_color("CCCCCC");
    let cell_fmt = Format::new().set_border(FormatBorder::Thin);

    sheet.write_string_with_format(0, 0, "Material", &header)?;
    sheet.write_string_with_format(0, 1, "System Qty", &header)?;
    sheet.write_string_with_format(0, 2, "Physical Qty", &header)?;
    sheet.write_string_with_format(0, 3, "Difference", &header)?;
    sheet.write_string_with_format(0, 4, "Notes", &header)?;

    let rows = sqlx::query("SELECT m.name, soi.system_qty, soi.physical_qty, soi.difference, soi.notes FROM stock_opname_items soi LEFT JOIN materials m ON soi.material_id=m.id WHERE soi.opname_id=$1 ORDER BY m.name")
        .bind(&opname_id).fetch_all(&pool.pool).await?;

    let mut row = 1;
    for r in &rows {
        let mat: String = r.get(0); let sys: f64 = r.get(1); let phy: f64 = r.get(2); let diff: f64 = r.get(3); let notes: String = r.get(4);
        sheet.write_string_with_format(row, 0, &mat, &cell_fmt)?;
        sheet.write_number_with_format(row, 1, sys, &cell_fmt)?;
        sheet.write_number_with_format(row, 2, phy, &cell_fmt)?;
        sheet.write_number_with_format(row, 3, diff, &cell_fmt)?;
        sheet.write_string_with_format(row, 4, &notes, &cell_fmt)?;
        row += 1;
    }

    sheet.set_column_width(0, 30)?;
    sheet.set_column_width(1, 12)?;
    sheet.set_column_width(2, 14)?;
    sheet.set_column_width(3, 12)?;
    sheet.set_column_width(4, 20)?;

    Ok(workbook.save_to_buffer()?)
}

// ── Report Schedule CRUD ──

#[tauri::command]
pub async fn get_report_schedules(pool: State<'_, DbPool>, token: String) -> Result<Vec<ReportSchedule>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT id, report_type, email_to, frequency, day_of_week, hour, is_active, created_at FROM report_schedules ORDER BY created_at")
        .fetch_all(&pool.pool).await?;
    let mut v = Vec::new();
    for row in &rows {
        v.push(ReportSchedule {
            id: row.get(0), report_type: row.get(1), email_to: row.get(2),
            frequency: row.get(3), day_of_week: row.get(4), hour: row.get(5),
            is_active: row.get::<bool,_>(6), created_at: row.get(7),
        });
    }
    Ok(v)
}

#[tauri::command]
pub async fn save_report_schedule(pool: State<'_, DbPool>, token: String, schedule: ReportSchedule) -> Result<(), AppError> {
    pool.verify_token(&token)?;
    sqlx::query(
        "INSERT INTO report_schedules (id, report_type, email_to, frequency, day_of_week, hour, is_active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE((SELECT created_at FROM report_schedules WHERE id=$1),NOW())) ON CONFLICT(id) DO UPDATE SET report_type=$2, email_to=$3, frequency=$4, day_of_week=$5, hour=$6, is_active=$7"
    )
        .bind(&schedule.id).bind(&schedule.report_type).bind(&schedule.email_to).bind(&schedule.frequency).bind(&schedule.day_of_week).bind(&schedule.hour).bind(schedule.is_active)
        .execute(&pool.pool).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_report_schedule(pool: State<'_, DbPool>, token: String, id: String) -> Result<(), AppError> {
    pool.verify_token(&token)?;
    sqlx::query("DELETE FROM report_schedules WHERE id=$1").bind(&id).execute(&pool.pool).await?;
    Ok(())
}

// ── Category Value (for pie chart) ──

#[tauri::command]
pub async fn get_category_value_summary(pool: State<'_, DbPool>, token: String) -> Result<Vec<CategoryValue>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query("SELECT COALESCE(c.name,'Uncategorized'), COUNT(m.id)::bigint, COALESCE(SUM(m.quantity*m.price),0) FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true GROUP BY c.name ORDER BY SUM(m.quantity*m.price) DESC")
        .fetch_all(&pool.pool).await?;
    let mut v = Vec::new();
    for row in &rows { v.push(CategoryValue { name: row.get(0), count: row.get::<i64,_>(1), value: row.get(2) }); }
    Ok(v)
}

// ── Receipt PDF Formal ──

#[tauri::command]
pub async fn generate_receipt_pdf(pool: State<'_, DbPool>, token: String, tx_id: String) -> Result<Vec<u8>, AppError> {
    pool.verify_token(&token)?;

    let company_name: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());
    let company_addr: String = sqlx::query_scalar("SELECT COALESCE(address,'') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_default();
    let company_phone: String = sqlx::query_scalar("SELECT COALESCE(phone,'') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_default();
    let company_email: String = sqlx::query_scalar("SELECT COALESCE(email,'') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_default();

    let tx_row = sqlx::query(
        "SELECT transaction_number, type, reference, po_number, invoice_no, created_at, user_id FROM transactions WHERE id=$1"
    )
        .bind(&tx_id).fetch_optional(&pool.pool).await?
        .ok_or_else(|| AppError::NotFound("Transaction not found".into()))?;
    let tx_num: String = tx_row.get(0); let tx_type: String = tx_row.get(1);
    let tx_ref: String = tx_row.get(2); let tx_po: String = tx_row.get(3);
    let tx_inv: String = tx_row.get(4); let tx_date: String = tx_row.get(5);

    let tx_items: Vec<(String, String, String, f64, f64)> = {
        let rows = sqlx::query("SELECT ti.material_id, COALESCE(m.sku,''), COALESCE(ti.batch_id,''), ti.quantity, ti.price FROM transaction_items ti LEFT JOIN materials m ON ti.material_id=m.id WHERE ti.tx_id=$1 ORDER BY m.name")
            .bind(&tx_id).fetch_all(&pool.pool).await?;
        rows.iter().map(|row| (row.get(0), row.get(1), row.get(2), row.get(3), row.get(4))).collect()
    };

    let bytes = tokio::task::spawn_blocking(move || {
        use printpdf::*;
        let (doc, page1, layer1) = PdfDocument::new(&format!("{} - Receipt", company_name), Mm(210.0), Mm(297.0), "Receipt");
        let current_layer = doc.get_page(page1).get_layer(layer1);
        let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| AppError::Internal(e.to_string()))?;
        let font_reg = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| AppError::Internal(e.to_string()))?;
        let font_mono = doc.add_builtin_font(BuiltinFont::Courier).map_err(|e| AppError::Internal(e.to_string()))?;

        let mut y = 275.0;
        current_layer.use_text(&company_name, 20.0, Mm(20.0), Mm(y), &font_bold);
        y -= 7.0;
        if !company_addr.is_empty() { current_layer.use_text(&company_addr, 9.0, Mm(20.0), Mm(y), &font_reg); y -= 5.0; }
        if !company_phone.is_empty() { current_layer.use_text(&format!("Phone: {}", company_phone), 9.0, Mm(20.0), Mm(y), &font_reg); y -= 5.0; }
        if !company_email.is_empty() { current_layer.use_text(&company_email, 9.0, Mm(20.0), Mm(y), &font_reg); y -= 5.0; }
        y -= 5.0;

        y -= 3.0;
        current_layer.use_text("─".repeat(100).as_str(), 9.0, Mm(20.0), Mm(y), &font_mono);
        y -= 8.0;

        current_layer.use_text("RECEIPT", 16.0, Mm(90.0), Mm(y), &font_bold);
        y -= 10.0;
        current_layer.use_text(&format!("No: {}", tx_num), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        current_layer.use_text(&format!("Date: {}", tx_date), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        current_layer.use_text(&format!("Type: {}", tx_type.to_uppercase()), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        if !tx_ref.is_empty() { current_layer.use_text(&format!("Reference: {}", tx_ref), 10.0, Mm(20.0), Mm(y), &font_reg); y -= 6.0; }
        if !tx_po.is_empty() { current_layer.use_text(&format!("PO: {}", tx_po), 10.0, Mm(20.0), Mm(y), &font_reg); y -= 6.0; }
        if !tx_inv.is_empty() { current_layer.use_text(&format!("Invoice: {}", tx_inv), 10.0, Mm(20.0), Mm(y), &font_reg); y -= 6.0; }

        y -= 3.0;
        current_layer.use_text("─".repeat(100).as_str(), 9.0, Mm(20.0), Mm(y), &font_mono);
        y -= 8.0;

        current_layer.use_text("SKU | Material | Batch | Qty | Subtotal", 9.0, Mm(20.0), Mm(y), &font_bold);
        y -= 6.0;

        for item in &tx_items {
            if y < 25.0 { current_layer.use_text("...continued", 8.0, Mm(20.0), Mm(15.0), &font_reg); break; }
            current_layer.use_text(&format!("{} | {} | {} | {} | {}", item.1, item.2, item.3, item.4, if item.3 > 0.0 { format!("{}", item.3 * item.4) } else { "-".into() }), 8.0, Mm(20.0), Mm(y), &font_reg);
            y -= 5.0;
        }

        current_layer.use_text(&format!("Page 1 | {} - Receipt", company_name), 7.0, Mm(20.0), Mm(10.0), &font_reg);

        doc.save_to_bytes().map_err(|e| AppError::Internal(e.to_string()))
    }).await.map_err(|e| AppError::Internal(e.to_string()))??;

    Ok(bytes)
}

// ── Picking List PDF ──

#[tauri::command]
pub async fn generate_picking_list_pdf(pool: State<'_, DbPool>, token: String, tx_id: String) -> Result<Vec<u8>, AppError> {
    pool.verify_token(&token)?;

    let company_name: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());

    let tx_row = sqlx::query(
        "SELECT transaction_number, reference, created_at FROM transactions WHERE id=$1"
    )
        .bind(&tx_id).fetch_optional(&pool.pool).await?
        .ok_or_else(|| AppError::NotFound("Transaction not found".into()))?;
    let tx_num: String = tx_row.get(0); let tx_ref: String = tx_row.get(1); let tx_date: String = tx_row.get(2);

    let picking_items: Vec<(String, String, String, f64, String)> = {
        let rows = sqlx::query(
            "SELECT COALESCE(r.rack_name,'No Rack'), COALESCE(r.area,''), COALESCE(m.sku,''), ti.quantity, COALESCE(m.name,'') FROM transaction_items ti LEFT JOIN materials m ON ti.material_id=m.id LEFT JOIN racks r ON m.rack_id=r.id WHERE ti.tx_id=$1 ORDER BY r.warehouse_id, r.area, r.rack_name, m.name"
        ).bind(&tx_id).fetch_all(&pool.pool).await?;
        rows.iter().map(|row| (row.get(0), row.get(1), row.get(2), row.get(3), row.get(4))).collect()
    };

    let bytes = tokio::task::spawn_blocking(move || {
        use printpdf::*;
        let (doc, page1, layer1) = PdfDocument::new(&format!("{} - Picking List", company_name), Mm(210.0), Mm(297.0), "PickingList");
        let current_layer = doc.get_page(page1).get_layer(layer1);
        let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| AppError::Internal(e.to_string()))?;
        let font_reg = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| AppError::Internal(e.to_string()))?;

        let mut y = 275.0;
        current_layer.use_text(&company_name, 18.0, Mm(20.0), Mm(y), &font_bold);
        y -= 10.0;
        current_layer.use_text("PICKING LIST", 16.0, Mm(80.0), Mm(y), &font_bold);
        y -= 10.0;
        current_layer.use_text(&format!("Transaction: {}", tx_num), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        current_layer.use_text(&format!("Reference: {}", tx_ref), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        current_layer.use_text(&format!("Date: {}", tx_date), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 10.0;

        current_layer.use_text("Rack | Area | SKU | Material | Qty", 9.0, Mm(20.0), Mm(y), &font_bold);
        y -= 6.0;

        for (rack, area, sku, qty, name) in &picking_items {
            if y < 20.0 { break; }
            current_layer.use_text(&format!("{} | {} | {} | {} | {}", rack, area, sku, name, qty), 8.0, Mm(20.0), Mm(y), &font_reg);
            y -= 5.0;
        }

        current_layer.use_text(&format!("Page 1 | {} - Picking List", company_name), 7.0, Mm(20.0), Mm(10.0), &font_reg);
        doc.save_to_bytes().map_err(|e| AppError::Internal(e.to_string()))
    }).await.map_err(|e| AppError::Internal(e.to_string()))??;

    Ok(bytes)
}

// ── Delivery Order PDF ──

#[tauri::command]
pub async fn generate_do_pdf(pool: State<'_, DbPool>, token: String, tx_id: String) -> Result<Vec<u8>, AppError> {
    pool.verify_token(&token)?;

    let company_name: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());
    let company_addr: String = sqlx::query_scalar("SELECT COALESCE(address,'') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_default();
    let company_phone: String = sqlx::query_scalar("SELECT COALESCE(phone,'') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_default();
    let company_email: String = sqlx::query_scalar("SELECT COALESCE(email,'') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or_default();

    let tx_row = sqlx::query(
        "SELECT transaction_number, reference, notes, created_at FROM transactions WHERE id=$1"
    )
        .bind(&tx_id).fetch_optional(&pool.pool).await?
        .ok_or_else(|| AppError::NotFound("Transaction not found".into()))?;
    let do_num: String = tx_row.get(0); let do_ref: String = tx_row.get(1);
    let do_notes: String = tx_row.get(2); let do_date: String = tx_row.get(3);

    let do_items: Vec<(String, String, f64, String)> = {
        let rows = sqlx::query(
            "SELECT COALESCE(m.sku,''), COALESCE(m.name,''), ti.quantity, COALESCE(m.unit_id,'pcs') FROM transaction_items ti LEFT JOIN materials m ON ti.material_id=m.id WHERE ti.tx_id=$1 ORDER BY m.name"
        ).bind(&tx_id).fetch_all(&pool.pool).await?;
        rows.iter().map(|row| (row.get(0), row.get(1), row.get(2), row.get(3))).collect()
    };

    let bytes = tokio::task::spawn_blocking(move || {
        use printpdf::*;
        let (doc, page1, layer1) = PdfDocument::new(&format!("{} - Delivery Order", company_name), Mm(210.0), Mm(297.0), "DO");
        let current_layer = doc.get_page(page1).get_layer(layer1);
        let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| AppError::Internal(e.to_string()))?;
        let font_reg = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| AppError::Internal(e.to_string()))?;
        let font_mono = doc.add_builtin_font(BuiltinFont::Courier).map_err(|e| AppError::Internal(e.to_string()))?;

        let mut y = 275.0;
        current_layer.use_text(&company_name, 20.0, Mm(20.0), Mm(y), &font_bold);
        y -= 7.0;
        if !company_addr.is_empty() { current_layer.use_text(&company_addr, 9.0, Mm(20.0), Mm(y), &font_reg); y -= 5.0; }
        if !company_phone.is_empty() { current_layer.use_text(&format!("Phone: {}", company_phone), 9.0, Mm(20.0), Mm(y), &font_reg); y -= 5.0; }
        if !company_email.is_empty() { current_layer.use_text(&company_email, 9.0, Mm(20.0), Mm(y), &font_reg); y -= 5.0; }
        y -= 5.0;

        current_layer.use_text("─".repeat(100).as_str(), 9.0, Mm(20.0), Mm(y), &font_mono);
        y -= 8.0;

        current_layer.use_text("DELIVERY ORDER", 16.0, Mm(80.0), Mm(y), &font_bold);
        y -= 10.0;
        current_layer.use_text(&format!("DO No: {}", do_num), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        current_layer.use_text(&format!("Date: {}", do_date), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        if !do_ref.is_empty() { current_layer.use_text(&format!("Reference: {}", do_ref), 10.0, Mm(20.0), Mm(y), &font_reg); y -= 6.0; }
        if !do_notes.is_empty() { current_layer.use_text(&format!("Notes: {}", do_notes), 10.0, Mm(20.0), Mm(y), &font_reg); y -= 6.0; }
        y -= 3.0;

        current_layer.use_text("─".repeat(100).as_str(), 9.0, Mm(20.0), Mm(y), &font_mono);
        y -= 8.0;

        current_layer.use_text("No | SKU | Description | Qty | Unit", 9.0, Mm(20.0), Mm(y), &font_bold);
        y -= 6.0;

        for (i, (sku, name, qty, unit)) in do_items.iter().enumerate() {
            if y < 35.0 { break; }
            current_layer.use_text(&format!("{} | {} | {} | {} | {}", i + 1, sku, name, qty, unit), 8.0, Mm(20.0), Mm(y), &font_reg);
            y -= 5.0;
        }

        y = 30.0;
        current_layer.use_text("Dikirim oleh: _______________", 10.0, Mm(20.0), Mm(y), &font_reg);
        current_layer.use_text("Diterima oleh: _______________", 10.0, Mm(120.0), Mm(y), &font_reg);
        y -= 12.0;
        current_layer.use_text(&format!("Page 1 | {} - Delivery Order", company_name), 7.0, Mm(20.0), Mm(y), &font_reg);

        doc.save_to_bytes().map_err(|e| AppError::Internal(e.to_string()))
    }).await.map_err(|e| AppError::Internal(e.to_string()))??;

    Ok(bytes)
}

// ── Phase 14: Run Report Schedule (execute now) ──

#[tauri::command]
pub async fn run_report_schedule(pool: State<'_, DbPool>, token: String, schedule_id: String) -> Result<String, AppError> {
    let user_id = pool.verify_token(&token)?;
    let sched = sqlx::query(
        "SELECT id, report_type, email_to, frequency, day_of_week, hour, is_active FROM report_schedules WHERE id=$1"
    )
        .bind(&schedule_id).fetch_optional(&pool.pool).await?
        .map(|row| ReportSchedule {
            id: row.get(0), report_type: row.get(1), email_to: row.get(2),
            frequency: row.get(3), day_of_week: row.get(4), hour: row.get(5),
            is_active: row.get::<bool,_>(6), created_at: String::new(),
        })
        .ok_or_else(|| AppError::NotFound("Schedule not found".into()))?;

    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let report_result = match sched.report_type.as_str() {
        "materials" => {
            let rows = sqlx::query("SELECT m.sku, m.name, COALESCE(c.name,''), m.quantity, m.price, m.min_stock FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true ORDER BY m.name")
                .fetch_all(&pool.pool).await?;
            let lines: Vec<String> = rows.iter().map(|row| format!("{}|{}|{}|{}|{}|{}", row.get::<String,_>(0), row.get::<String,_>(1), row.get::<String,_>(2), row.get::<f64,_>(3), row.get::<f64,_>(4), row.get::<f64,_>(5))).collect();
            format!("Material Report - {}\n\nSKU|Name|Category|Qty|Price|Min\n{}", now_str, lines.join("\n"))
        }
        "stock" => {
            let rows = sqlx::query("SELECT m.sku, m.name, COALESCE(w.name,''), m.quantity, m.min_stock FROM materials m LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.is_active=true ORDER BY w.name, m.name")
                .fetch_all(&pool.pool).await?;
            let lines: Vec<String> = rows.iter().map(|row| format!("{}|{}|{}|{}|{}", row.get::<String,_>(0), row.get::<String,_>(1), row.get::<String,_>(2), row.get::<f64,_>(3), row.get::<f64,_>(4))).collect();
            format!("Stock Report - {}\n\nSKU|Name|Warehouse|Qty|Min\n{}", now_str, lines.join("\n"))
        }
        "transactions" => {
            let rows = sqlx::query("SELECT t.transaction_number, t.type, COALESCE(m.name,''), t.quantity, t.status, t.created_at FROM transactions t LEFT JOIN materials m ON t.material_id=m.id ORDER BY t.created_at DESC LIMIT 500")
                .fetch_all(&pool.pool).await?;
            let lines: Vec<String> = rows.iter().map(|row| format!("{}|{}|{}|{}|{}|{}", row.get::<String,_>(0), row.get::<String,_>(1), row.get::<String,_>(2), row.get::<f64,_>(3), row.get::<String,_>(4), row.get::<String,_>(5))).collect();
            format!("Transaction Report - {}\n\nNumber|Type|Material|Qty|Status|Date\n{}", now_str, lines.join("\n"))
        }
        _ => return Err(AppError::Validation("Unknown report type".into())),
    };

    sqlx::query("UPDATE report_schedules SET is_active=true WHERE id=$1").bind(&schedule_id).execute(&pool.pool).await?;
    sqlx::query(
        "INSERT INTO audit_log (id, user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)"
    )
        .bind(uuid::Uuid::new_v4().to_string()).bind(&user_id).bind("run_schedule").bind("report_schedule").bind(&schedule_id).bind(&report_result[..std::cmp::min(500, report_result.len())])
        .execute(&pool.pool).await?;
    Ok(format!("Report generated at {} ({} lines)", now_str, report_result.lines().count()))
}

// ── Phase 14: Multi-Warehouse Comparison ──

#[tauri::command]
pub async fn get_multi_warehouse_comparison(pool: State<'_, DbPool>, token: String) -> Result<Vec<serde_json::Value>, AppError> {
    pool.verify_token(&token)?;
    let rows = sqlx::query(
        "SELECT w.id, w.name, w.code, w.location,
            (SELECT COUNT(*)::bigint FROM materials m WHERE m.warehouse_id=w.id AND m.is_active=true) as mat_count,
            (SELECT COALESCE(SUM(m.quantity*m.price),0) FROM materials m WHERE m.warehouse_id=w.id AND m.is_active=true) as stock_value,
            (SELECT COUNT(*)::bigint FROM racks r WHERE r.warehouse_id=w.id) as rack_count,
            (SELECT COUNT(*)::bigint FROM transactions t WHERE t.warehouse_id=w.id AND t.created_at>=TO_CHAR(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD HH24:MI:SS')) as tx_30d,
            (SELECT COALESCE(SUM(CASE WHEN t.type='in' THEN t.quantity ELSE 0 END),0) FROM transactions t WHERE t.warehouse_id=w.id AND t.created_at>=TO_CHAR(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD HH24:MI:SS')) as inbound_30d,
            (SELECT COALESCE(SUM(CASE WHEN t.type='out' THEN t.quantity ELSE 0 END),0) FROM transactions t WHERE t.warehouse_id=w.id AND t.created_at>=TO_CHAR(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD HH24:MI:SS')) as outbound_30d,
            (SELECT COUNT(*)::bigint FROM stock_opname so WHERE so.warehouse_id=w.id AND so.status='completed' AND so.created_at>=TO_CHAR(CURRENT_DATE - INTERVAL '90 days','YYYY-MM-DD HH24:MI:SS')) as opname_90d
        FROM warehouses w ORDER BY w.name"
    ).fetch_all(&pool.pool).await?;
    let mut v = Vec::new();
    for row in &rows {
        v.push(serde_json::json!({
            "id": row.get::<String,_>(0),
            "name": row.get::<String,_>(1),
            "code": row.get::<String,_>(2),
            "location": row.get::<String,_>(3),
            "material_count": row.get::<i64,_>(4),
            "stock_value": row.get::<f64,_>(5),
            "rack_count": row.get::<i64,_>(6),
            "tx_30d": row.get::<i64,_>(7),
            "inbound_30d": row.get::<f64,_>(8),
            "outbound_30d": row.get::<f64,_>(9),
            "opname_90d": row.get::<i64,_>(10),
        }));
    }
    Ok(v)
}

// ── Phase 14: Pivot Report ──

#[tauri::command]
pub async fn get_pivot_report(pool: State<'_, DbPool>, token: String, row_field: String, col_field: String, value_field: String, agg_function: String, date_start: Option<String>, date_end: Option<String>) -> Result<serde_json::Value, AppError> {
    pool.verify_token(&token)?;

    let row_col = match row_field.as_str() {
        "category" => "COALESCE(c.name,'Uncat')",
        "warehouse" => "COALESCE(w.name,'Unknown')",
        "month" => "TO_CHAR(t.created_at, 'YYYY-MM')",
        "type" => "t.type",
        "status" => "t.status",
        "user" => "COALESCE(u.full_name,'System')",
        _ => "COALESCE(c.name,'Uncat')",
    };
    let col_sel = match col_field.as_str() {
        "type" => "t.type",
        "status" => "t.status",
        "month" => "TO_CHAR(t.created_at, 'YYYY-MM')",
        "category" => "COALESCE(c.name,'Uncat')",
        "user" => "COALESCE(u.full_name,'System')",
        _ => "t.type",
    };
    let val_sel = match value_field.as_str() {
        "quantity" => "t.quantity",
        "value" => "t.quantity * t.price",
        "count" => "1",
        _ => "t.quantity",
    };
    let agg = match agg_function.as_str() {
        "SUM" => "SUM",
        "COUNT" => "COUNT",
        "AVG" => "AVG",
        "MIN" => "MIN",
        "MAX" => "MAX",
        _ => "SUM",
    };

    let mut sql = format!(
        "SELECT {}, {}, {}({}) as val FROM transactions t
         LEFT JOIN materials m ON t.material_id=m.id
         LEFT JOIN categories c ON m.category_id=c.id
         LEFT JOIN warehouses w ON t.warehouse_id=w.id
         LEFT JOIN users u ON t.user_id=u.id
         WHERE t.status='approved'", row_col, col_sel, agg, val_sel
    );
    let mut param_idx = 1;
    let mut binds: Vec<String> = Vec::new();
    if let Some(ref ds) = date_start { sql.push_str(&format!(" AND t.created_at>=${}", param_idx)); param_idx += 1; binds.push(ds.clone()); }
    if let Some(ref de) = date_end { sql.push_str(&format!(" AND t.created_at<=${}", param_idx)); binds.push(format!("{} 23:59:59", de)); let _ = param_idx; }
    sql.push_str(" GROUP BY 1,2 ORDER BY 1,2");

    let mut q = sqlx::query(&sql);
    for b in &binds { q = q.bind(b); }
    let rows = q.fetch_all(&pool.pool).await?;
    let mut rows_data: Vec<(String, String, f64)> = Vec::new();
    for row in &rows { rows_data.push((row.get(0), row.get(1), row.get(2))); }

    let mut row_keys: Vec<String> = Vec::new();
    let mut col_keys: Vec<String> = Vec::new();
    for (rk, ck, _) in &rows_data {
        if !row_keys.contains(rk) { row_keys.push(rk.clone()); }
        if !col_keys.contains(ck) { col_keys.push(ck.clone()); }
    }
    row_keys.sort();
    col_keys.sort();

    let mut table: Vec<serde_json::Value> = Vec::new();
    for rk in &row_keys {
        let mut row = serde_json::json!({ "row": rk });
        for ck in &col_keys {
            let val = rows_data.iter().find(|(r, c, _)| r == rk && c == ck).map(|(_, _, v)| *v).unwrap_or(0.0);
            row[ck] = serde_json::json!(val);
        }
        table.push(row);
    }

    Ok(serde_json::json!({
        "rows": row_keys,
        "cols": col_keys,
        "data": table,
        "row_field": row_field,
        "col_field": col_field,
        "value_field": value_field,
        "agg_function": agg_function,
    }))
}

// ── Phase 14: Variance Root Cause Analysis ──

#[tauri::command]
pub async fn get_variance_root_cause(pool: State<'_, DbPool>, token: String, opname_id: String) -> Result<Vec<serde_json::Value>, AppError> {
    pool.verify_token(&token)?;

    let rows = sqlx::query(
        "SELECT m.id, m.name, COALESCE(c.name,'Uncategorized'), m.sku, soi.system_qty, soi.physical_qty, soi.difference,
                COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='in' AND t.created_at>=TO_CHAR(CURRENT_DATE - INTERVAL '90 days','YYYY-MM-DD HH24:MI:SS')),0) as inbound_90d,
                COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.material_id=m.id AND t.type='out' AND t.created_at>=TO_CHAR(CURRENT_DATE - INTERVAL '90 days','YYYY-MM-DD HH24:MI:SS')),0) as outbound_90d,
                COALESCE((SELECT COUNT(*)::bigint FROM stock_opname_items soi2 WHERE soi2.material_id=m.id),0) as opname_count,
                m.min_stock, m.max_stock,
                CASE WHEN soi.difference > 0 THEN 'surplus' WHEN soi.difference < 0 THEN 'shortage' ELSE 'match' END as variance_type
         FROM stock_opname_items soi
         JOIN materials m ON soi.material_id=m.id
         LEFT JOIN categories c ON m.category_id=c.id
         WHERE soi.opname_id=$1
         ORDER BY ABS(soi.difference) DESC"
    ).bind(&opname_id).fetch_all(&pool.pool).await?;
    let mut v = Vec::new();
    for row in &rows {
        v.push(serde_json::json!({
            "material_id": row.get::<String,_>(0),
            "material_name": row.get::<String,_>(1),
            "category": row.get::<String,_>(2),
            "sku": row.get::<String,_>(3),
            "system_qty": row.get::<f64,_>(4),
            "physical_qty": row.get::<f64,_>(5),
            "difference": row.get::<f64,_>(6),
            "inbound_90d": row.get::<f64,_>(7),
            "outbound_90d": row.get::<f64,_>(8),
            "opname_count": row.get::<i64,_>(9),
            "min_stock": row.get::<f64,_>(10),
            "max_stock": row.get::<f64,_>(11),
            "variance_type": row.get::<String,_>(12),
            "probable_cause": probable_cause(&row),
        }));
    }
    Ok(v)
}

// ── Count Sheet PDF (blank form for manual counting, Phase 11) ──

#[tauri::command]
pub async fn generate_count_sheet_pdf(pool: State<'_, DbPool>, token: String, warehouse_id: String) -> Result<Vec<u8>, AppError> {
    pool.verify_token(&token)?;

    let company_name: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1")
        .fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());
    let wh_name: String = sqlx::query_scalar("SELECT name FROM warehouses WHERE id=$1")
        .bind(&warehouse_id).fetch_optional(&pool.pool).await?.unwrap_or("Unknown".into());

    let rows: Vec<(String, String, String, f64)> = {
        let r = sqlx::query("SELECT m.sku, m.name, COALESCE(r.rack_name,'-'), m.quantity FROM materials m LEFT JOIN racks r ON m.rack_id=r.id WHERE m.warehouse_id=$1 AND m.is_active=true ORDER BY m.name")
            .bind(&warehouse_id).fetch_all(&pool.pool).await?;
        r.iter().map(|row| (row.get(0), row.get(1), row.get(2), row.get(3))).collect()
    };

    let bytes = tokio::task::spawn_blocking(move || {
        use printpdf::*;
        let (doc, page1, layer1) = PdfDocument::new(&format!("{} - Count Sheet", company_name), Mm(210.0), Mm(297.0), "CountSheet");
        let current_layer = doc.get_page(page1).get_layer(layer1);
        let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| AppError::Internal(e.to_string()))?;
        let font_reg = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| AppError::Internal(e.to_string()))?;
        let font_mono = doc.add_builtin_font(BuiltinFont::Courier).map_err(|e| AppError::Internal(e.to_string()))?;

        let mut y = 275.0;
        current_layer.use_text(&company_name, 18.0, Mm(20.0), Mm(y), &font_bold);
        y -= 8.0;
        current_layer.use_text("COUNT SHEET", 16.0, Mm(80.0), Mm(y), &font_bold);
        y -= 10.0;
        current_layer.use_text(&format!("Warehouse: {}", wh_name), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        current_layer.use_text(&format!("Date: {}", chrono::Local::now().format("%Y-%m-%d")), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 6.0;
        current_layer.use_text("Counter: _______________", 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 10.0;

        current_layer.use_text("─".repeat(100).as_str(), 9.0, Mm(20.0), Mm(y), &font_mono);
        y -= 8.0;

        current_layer.use_text("No | SKU | Material Name | Rack | System Qty | Physical Qty | Diff | Notes", 8.0, Mm(20.0), Mm(y), &font_bold);
        y -= 6.0;

        let mut idx = 1;
        for (sku, name, rack, sys_qty) in &rows {
            if y < 25.0 {
                current_layer.use_text("...continued on next page", 8.0, Mm(20.0), Mm(15.0), &font_reg);
                break;
            }
            current_layer.use_text(&format!("{} | {} | {} | {} | {} | ________ | ________ | ________", idx, sku, name, rack, sys_qty), 7.0, Mm(20.0), Mm(y), &font_reg);
            y -= 5.0;
            idx += 1;
        }

        y = 25.0;
        current_layer.use_text("Supervisor: _______________", 10.0, Mm(20.0), Mm(y), &font_reg);
        current_layer.use_text("Counter: _______________", 10.0, Mm(120.0), Mm(y), &font_reg);
        current_layer.use_text(&format!("Page 1 | {} - Count Sheet", company_name), 7.0, Mm(20.0), Mm(10.0), &font_reg);

        doc.save_to_bytes().map_err(|e| AppError::Internal(e.to_string()))
    }).await.map_err(|e| AppError::Internal(e.to_string()))??;

    Ok(bytes)
}

fn probable_cause(row: &sqlx::postgres::PgRow) -> String {
    let diff: f64 = row.get::<f64,_>(6);
    let inbound: f64 = row.get::<f64,_>(7);
    let outbound: f64 = row.get::<f64,_>(8);
    if diff.abs() < 0.5 { "Rounding / negligible".into()
    } else if diff > 0.0 && inbound > outbound * 1.5 { "Over-receiving / duplicate entry".into()
    } else if diff < 0.0 && outbound > inbound * 1.5 { "Unrecorded outbound / theft".into()
    } else if diff > 0.0 { "Possible over-count / data entry error".into()
    } else { "Possible under-count / unrecorded movement".into() }
}
