use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use sqlx::Row;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvQuery { pub report_type: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfQuery { pub report_type: String, pub opname_id: Option<String>, pub date_start: Option<String>, pub date_end: Option<String>, pub type_filter: Option<String>, pub status_filter: Option<String> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpnameQuery { pub opname_id: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxQuery { pub tx_id: String }

pub async fn export_csv(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<CsvQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut wtr = csv::Writer::from_writer(Vec::new());
    match q.report_type.as_str() {
        "materials" => {
            wtr.write_record(["SKU","Name","Category","Quantity","Price","Min Stock","Expiry Date"]).map_err(|e| crate::server::server_error(e))?;
            let rows = sqlx::query("SELECT m.sku,m.name,COALESCE(c.name,''),m.quantity,m.price,m.min_stock,COALESCE(m.expiry_date,'') FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true ORDER BY m.name").fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            for row in &rows { wtr.write_record([row.get::<String,_>(0),row.get::<String,_>(1),row.get::<String,_>(2),row.get::<f64,_>(3).to_string(),row.get::<f64,_>(4).to_string(),row.get::<f64,_>(5).to_string(),row.get::<String,_>(6)]).map_err(|e| crate::server::server_error(e))?; }
        }
        "transactions" => {
            wtr.write_record(["Number","Type","Material","Quantity","Date"]).map_err(|e| crate::server::server_error(e))?;
            let rows = sqlx::query("SELECT t.transaction_number,t.type,COALESCE(m.name,''),t.quantity,t.created_at FROM transactions t LEFT JOIN materials m ON t.material_id=m.id ORDER BY t.created_at DESC").fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            for row in &rows { wtr.write_record([row.get::<String,_>(0),row.get::<String,_>(1),row.get::<String,_>(2),row.get::<f64,_>(3).to_string(),row.get::<String,_>(4)]).map_err(|e| crate::server::server_error(e))?; }
        }
        _ => return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": "Unknown report type"})))),
    }
    let data = wtr.into_inner().map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"csv": String::from_utf8(data).unwrap_or_default()})))
}

pub async fn export_pdf(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<PdfQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let company: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());
    let addr: String = sqlx::query_scalar("SELECT COALESCE(address,'') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or_default();
    let mat_data: Vec<(String,String,String,f64,f64,f64)>;
    let stk_data: Vec<(String,String,String,f64,f64)>;
    let opn_data: Vec<(String,f64,f64,f64,String)>;
    let tx_data: Vec<(String,String,String,f64,String,String,String)>;
    match q.report_type.as_str() {
        "materials" => {
            let rows = sqlx::query("SELECT m.sku,m.name,COALESCE(c.name,''),m.quantity,m.price,m.min_stock FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true ORDER BY m.name").fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            mat_data = rows.iter().map(|r| (r.get(0),r.get(1),r.get(2),r.get(3),r.get(4),r.get(5))).collect();
            stk_data = Vec::new(); opn_data = Vec::new(); tx_data = Vec::new();
        }
        "stock" => {
            let rows = sqlx::query("SELECT m.sku,m.name,COALESCE(w.name,''),m.quantity,m.min_stock FROM materials m LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.is_active=true ORDER BY w.name,m.name").fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            mat_data = Vec::new(); stk_data = rows.iter().map(|r| (r.get(0),r.get(1),r.get(2),r.get(3),r.get(4))).collect();
            opn_data = Vec::new(); tx_data = Vec::new();
        }
        "opname" => {
            let oid = q.opname_id.unwrap_or_default();
            let rows = sqlx::query("SELECT m.name,soi.system_qty,soi.physical_qty,soi.difference,soi.notes FROM stock_opname_items soi LEFT JOIN materials m ON soi.material_id=m.id WHERE soi.opname_id=$1 ORDER BY m.name").bind(&oid).fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            mat_data = Vec::new(); stk_data = Vec::new();
            opn_data = rows.iter().map(|r| (r.get(0),r.get(1),r.get(2),r.get(3),r.get(4))).collect();
            tx_data = Vec::new();
        }
        "transactions" => {
            let mut sql = String::from("SELECT t.transaction_number,t.type,COALESCE(m.name,''),t.quantity,COALESCE(t.reference,''),t.status,t.created_at FROM transactions t LEFT JOIN materials m ON t.material_id=m.id WHERE 1=1");
            let mut p = 1;
            if let Some(ref ds) = q.date_start { if !ds.is_empty() { sql.push_str(&format!(" AND t.created_at>=${}",p)); p+=1; } }
            if let Some(ref de) = q.date_end { if !de.is_empty() { sql.push_str(&format!(" AND t.created_at<=${}",p)); p+=1; } }
            if let Some(ref tf) = q.type_filter { if !tf.is_empty() && tf!="all" { sql.push_str(&format!(" AND t.type=${}",p)); p+=1; } }
            if let Some(ref sf) = q.status_filter { if !sf.is_empty() && sf!="all" { sql.push_str(&format!(" AND t.status=${}",p)); } }
            sql.push_str(" ORDER BY t.created_at DESC LIMIT 500");
            let mut qb = sqlx::query(&sql);
            if let Some(ref ds) = q.date_start { if !ds.is_empty() { qb = qb.bind(ds); } }
            if let Some(ref de) = q.date_end { if !de.is_empty() { qb = qb.bind(format!("{} 23:59:59",de)); } }
            if let Some(ref tf) = q.type_filter { if !tf.is_empty() && tf!="all" { qb = qb.bind(tf); } }
            if let Some(ref sf) = q.status_filter { if !sf.is_empty() && sf!="all" { qb = qb.bind(sf); } }
            let rows = qb.fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            mat_data = Vec::new(); stk_data = Vec::new(); opn_data = Vec::new();
            tx_data = rows.iter().map(|r| (r.get(0),r.get(1),r.get(2),r.get(3),r.get(4),r.get(5),r.get(6))).collect();
        }
        _ => { mat_data = Vec::new(); stk_data = Vec::new(); opn_data = Vec::new(); tx_data = Vec::new(); }
    }
    let b64 = tokio::task::spawn_blocking(move || -> Result<String, String> {
        use printpdf::*;
        let (doc,page1,layer1) = PdfDocument::new(&format!("{} Report",company),Mm(210.0),Mm(297.0),"Report");
        let cl = doc.get_page(page1).get_layer(layer1);
        let fb = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| e.to_string())?;
        let fr = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| e.to_string())?;
        cl.use_text(&company,18.0,Mm(20.0),Mm(275.0),&fb);
        if !addr.is_empty() { cl.use_text(&addr,9.0,Mm(20.0),Mm(268.0),&fr); }
        cl.use_text(&format!("{} Report - Generated {}",q.report_type,chrono::Local::now().format("%Y-%m-%d %H:%M")),11.0,Mm(20.0),Mm(260.0),&fb);
        let mut y = 245.0;
        match q.report_type.as_str() {
            "materials" => {
                cl.use_text("SKU | Name | Category | Qty | Price | Min",9.0,Mm(20.0),Mm(y),&fb); y-=6.0;
                for (sk,nm,ct,qt,pr,mn) in &mat_data { if y<20.0{break;} cl.use_text(&format!("{}|{}|{}|{}|{}|{}",sk,nm,ct,qt,pr,mn),8.0,Mm(20.0),Mm(y),&fr); y-=5.0; }
            }
            "stock" => {
                cl.use_text("SKU | Name | Warehouse | Qty | Min",9.0,Mm(20.0),Mm(y),&fb); y-=6.0;
                for (sk,nm,wh,qt,mn) in &stk_data { if y<20.0{break;} cl.use_text(&format!("{}|{}|{}|{}|{}",sk,nm,wh,qt,mn),8.0,Mm(20.0),Mm(y),&fr); y-=5.0; }
            }
            "opname" => {
                cl.use_text("Material | System | Physical | Diff | Notes",9.0,Mm(20.0),Mm(y),&fb); y-=6.0;
                for (mt,sy,ph,df,no) in &opn_data { if y<20.0{break;} cl.use_text(&format!("{}|{}|{}|{}|{}",mt,sy,ph,df,no),8.0,Mm(20.0),Mm(y),&fr); y-=5.0; }
                y=40.0; cl.use_text("Supervisor: _______________",10.0,Mm(20.0),Mm(y),&fr);
                cl.use_text("Mengetahui: _______________",10.0,Mm(120.0),Mm(y),&fr);
            }
            "transactions" => {
                cl.use_text("Number | Type | Material | Qty | Ref | Status | Date",9.0,Mm(20.0),Mm(y),&fb); y-=6.0;
                for (nu,tp,mt,qt,rf,st,dt) in &tx_data { if y<20.0{break;} cl.use_text(&format!("{}|{}|{}|{}|{}|{}|{}",nu,tp,mt,qt,rf,st,dt),7.0,Mm(20.0),Mm(y),&fr); y-=4.5; }
            }
            _ => {}
        }
        cl.use_text(&format!("Page 1 | {} - {} Report",company,q.report_type),7.0,Mm(20.0),Mm(10.0),&fr);
        let bytes = doc.save_to_bytes().map_err(|e| e.to_string())?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes))
    }).await.map_err(|e| crate::server::server_error(e))?
    .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"pdf": b64})))
}

pub async fn approve_opname(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = body.get("opnameId").and_then(|v| v.as_str()).unwrap_or("");
    let approved = body.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    if approved {
        let items: Vec<(String,f64)> = sqlx::query("SELECT material_id,physical_qty FROM stock_opname_items WHERE opname_id=$1").bind(id).fetch_all(&mut *tx).await.map_err(|e| crate::server::server_error(e))?.iter().map(|r| (r.get(0),r.get(1))).collect();
        for (mid,qty) in items { sqlx::query("UPDATE materials SET quantity=$1 WHERE id=$2").bind(qty).bind(&mid).execute(&mut *tx).await.map_err(|e| crate::server::server_error(e))?; }
        sqlx::query("UPDATE stock_opname SET status='completed', updated_at=NOW() WHERE id=$1").bind(id).execute(&mut *tx).await.map_err(|e| crate::server::server_error(e))?;
    } else {
        sqlx::query("UPDATE stock_opname SET status='draft', updated_at=NOW() WHERE id=$1").bind(id).execute(&mut *tx).await.map_err(|e| crate::server::server_error(e))?;
    }
    sqlx::query("INSERT INTO audit_log (id,user_id,action,entity,entity_id) VALUES ($1,$2,$3,$4,$5)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&user_id).bind(if approved{"approve_opname"}else{"reject_opname"}).bind("stock_opname").bind(id)
        .execute(&mut *tx).await.map_err(|e| crate::server::server_error(e))?;
    tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn export_opname_xlsx(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<OpnameQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT m.name,soi.system_qty,soi.physical_qty,soi.difference,soi.notes FROM stock_opname_items soi LEFT JOIN materials m ON soi.material_id=m.id WHERE soi.opname_id=$1 ORDER BY m.name")
        .bind(&q.opname_id).fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let b64 = tokio::task::spawn_blocking(move || -> Result<String,String> {
        use rust_xlsxwriter::*;
        let mut wb = Workbook::new();
        let sh = wb.add_worksheet(); sh.set_name("Opname Result").map_err(|e| e.to_string())?;
        let hdr = Format::new().set_bold().set_border(FormatBorder::Thin).set_background_color("CCCCCC");
        let cf = Format::new().set_border(FormatBorder::Thin);
        sh.write_string_with_format(0,0,"Material",&hdr).map_err(|e| e.to_string())?;
        sh.write_string_with_format(0,1,"System Qty",&hdr).map_err(|e| e.to_string())?;
        sh.write_string_with_format(0,2,"Physical Qty",&hdr).map_err(|e| e.to_string())?;
        sh.write_string_with_format(0,3,"Difference",&hdr).map_err(|e| e.to_string())?;
        sh.write_string_with_format(0,4,"Notes",&hdr).map_err(|e| e.to_string())?;
        for (i,r) in rows.iter().enumerate() { let ri=(i+1)as u32;
            sh.write_string_with_format(ri,0,r.get::<String,_>(0),&cf).map_err(|e| e.to_string())?;
            sh.write_number_with_format(ri,1,r.get::<f64,_>(1),&cf).map_err(|e| e.to_string())?;
            sh.write_number_with_format(ri,2,r.get::<f64,_>(2),&cf).map_err(|e| e.to_string())?;
            sh.write_number_with_format(ri,3,r.get::<f64,_>(3),&cf).map_err(|e| e.to_string())?;
            sh.write_string_with_format(ri,4,r.get::<String,_>(4),&cf).map_err(|e| e.to_string())?;
        }
        sh.set_column_width(0,30).map_err(|e| e.to_string())?;
        sh.set_column_width(1,12).map_err(|e| e.to_string())?;
        sh.set_column_width(2,14).map_err(|e| e.to_string())?;
        sh.set_column_width(3,12).map_err(|e| e.to_string())?;
        sh.set_column_width(4,20).map_err(|e| e.to_string())?;
        let bytes = wb.save_to_buffer().map_err(|e| e.to_string())?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes))
    }).await.map_err(|e| crate::server::server_error(e))?
    .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"xlsx": b64})))
}

pub async fn get_schedules(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<serde_json::Value>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id,report_type,email_to,frequency,day_of_week,hour,is_active,created_at FROM report_schedules ORDER BY created_at")
        .fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let v = rows.iter().map(|r| json!({"id":r.get::<String,_>(0),"reportType":r.get::<String,_>(1),"emailTo":r.get::<String,_>(2),"frequency":r.get::<String,_>(3),"dayOfWeek":r.get::<i32,_>(4),"hour":r.get::<i32,_>(5),"isActive":r.get::<bool,_>(6),"createdAt":r.get::<String,_>(7)})).collect();
    Ok(Json(v))
}

pub async fn save_schedule(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let id = body.get("id").and_then(|v| v.as_str()).unwrap_or(&uuid::Uuid::new_v4().to_string()).to_string();
    let rt = body.get("reportType").and_then(|v| v.as_str()).unwrap_or("");
    let em = body.get("emailTo").and_then(|v| v.as_str()).unwrap_or("");
    let fr = body.get("frequency").and_then(|v| v.as_str()).unwrap_or("daily");
    let dw = body.get("dayOfWeek").and_then(|v| v.as_i64()).unwrap_or(0);
    let hr = body.get("hour").and_then(|v| v.as_i64()).unwrap_or(8);
    let ia = body.get("isActive").and_then(|v| v.as_bool()).unwrap_or(true);
    sqlx::query("INSERT INTO report_schedules (id,report_type,email_to,frequency,day_of_week,hour,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET report_type=$2,email_to=$3,frequency=$4,day_of_week=$5,hour=$6,is_active=$7")
        .bind(&id).bind(rt).bind(em).bind(fr).bind(dw).bind(hr).bind(ia)
        .execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn delete_schedule(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("DELETE FROM report_schedules WHERE id=$1").bind(&id).execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn run_schedule(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let sched = sqlx::query("SELECT id,report_type,email_to,frequency,day_of_week,hour,is_active FROM report_schedules WHERE id=$1").bind(&id).fetch_optional(&pool.pool).await.map_err(|e| crate::server::server_error(e))?.ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Schedule not found"}))))?;
    let rt: String = sched.get(1);
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let lines = match rt.as_str() {
        "materials" => {
            let rows = sqlx::query("SELECT m.sku,m.name,COALESCE(c.name,''),m.quantity,m.price,m.min_stock FROM materials m LEFT JOIN categories c ON m.category_id=c.id WHERE m.is_active=true ORDER BY m.name").fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            rows.iter().map(|r| format!("{}|{}|{}|{}|{}|{}",r.get::<String,_>(0),r.get::<String,_>(1),r.get::<String,_>(2),r.get::<f64,_>(3),r.get::<f64,_>(4),r.get::<f64,_>(5))).collect::<Vec<_>>().join("\n")
        }
        "stock" => {
            let rows = sqlx::query("SELECT m.sku,m.name,COALESCE(w.name,''),m.quantity,m.min_stock FROM materials m LEFT JOIN warehouses w ON m.warehouse_id=w.id WHERE m.is_active=true ORDER BY w.name,m.name").fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            rows.iter().map(|r| format!("{}|{}|{}|{}|{}",r.get::<String,_>(0),r.get::<String,_>(1),r.get::<String,_>(2),r.get::<f64,_>(3),r.get::<f64,_>(4))).collect::<Vec<_>>().join("\n")
        }
        "transactions" => {
            let rows = sqlx::query("SELECT t.transaction_number,t.type,COALESCE(m.name,''),t.quantity,t.status,t.created_at FROM transactions t LEFT JOIN materials m ON t.material_id=m.id ORDER BY t.created_at DESC LIMIT 500").fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
            rows.iter().map(|r| format!("{}|{}|{}|{}|{}|{}",r.get::<String,_>(0),r.get::<String,_>(1),r.get::<String,_>(2),r.get::<f64,_>(3),r.get::<String,_>(4),r.get::<String,_>(5))).collect::<Vec<_>>().join("\n")
        }
        _ => return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Unknown report type"})))),
    };
    sqlx::query("UPDATE report_schedules SET is_active=true WHERE id=$1").bind(&id).execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    sqlx::query("INSERT INTO audit_log (id,user_id,action,entity,entity_id,details) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&user_id).bind("run_schedule").bind("report_schedule").bind(&id).bind(&lines[..std::cmp::min(500,lines.len())])
        .execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"message": format!("Report generated at {} ({} lines)",now_str,lines.lines().count())})))
}

pub async fn multi_warehouse_comparison(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<serde_json::Value>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
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
    ).fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let v = rows.iter().map(|r| json!({"id":r.get::<String,_>(0),"name":r.get::<String,_>(1),"code":r.get::<String,_>(2),"location":r.get::<String,_>(3),"material_count":r.get::<i64,_>(4),"stock_value":r.get::<f64,_>(5),"rack_count":r.get::<i64,_>(6),"tx_30d":r.get::<i64,_>(7),"inbound_30d":r.get::<f64,_>(8),"outbound_30d":r.get::<f64,_>(9),"opname_90d":r.get::<i64,_>(10)})).collect();
    Ok(Json(v))
}

pub async fn pivot_report(
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let row_f = body.get("rowField").and_then(|v| v.as_str()).unwrap_or("category");
    let col_f = body.get("colField").and_then(|v| v.as_str()).unwrap_or("type");
    let val_f = body.get("valueField").and_then(|v| v.as_str()).unwrap_or("quantity");
    let agg_f = body.get("aggFunction").and_then(|v| v.as_str()).unwrap_or("SUM");
    let ds = body.get("dateStart").and_then(|v| v.as_str()).filter(|s|!s.is_empty());
    let de = body.get("dateEnd").and_then(|v| v.as_str()).filter(|s|!s.is_empty());
    let rc = match row_f {"category"=>"COALESCE(c.name,'Uncat')","warehouse"=>"COALESCE(w.name,'Unknown')","month"=>"TO_CHAR(t.created_at,'YYYY-MM')","type"=>"t.type","status"=>"t.status","user"=>"COALESCE(u.full_name,'System')",_=>"COALESCE(c.name,'Uncat')"};
    let cc = match col_f {"type"=>"t.type","status"=>"t.status","month"=>"TO_CHAR(t.created_at,'YYYY-MM')","category"=>"COALESCE(c.name,'Uncat')","user"=>"COALESCE(u.full_name,'System')",_=>"t.type"};
    let vc = match val_f {"quantity"=>"t.quantity","value"=>"t.quantity*t.price","count"=>"1",_=>"t.quantity"};
    let ag = match agg_f {"SUM"=>"SUM","COUNT"=>"COUNT","AVG"=>"AVG","MIN"=>"MIN","MAX"=>"MAX",_=>"SUM"};
    let mut sql = format!("SELECT {},{},{}({}) as val FROM transactions t LEFT JOIN materials m ON t.material_id=m.id LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN warehouses w ON t.warehouse_id=w.id LEFT JOIN users u ON t.user_id=u.id WHERE t.status='approved'",rc,cc,ag,vc);
    let mut binds: Vec<String> = Vec::new();
    if let Some(ref d) = ds { sql.push_str(&format!(" AND t.created_at>=${}",binds.len()+1)); binds.push(d.to_string()); }
    if let Some(ref d) = de { sql.push_str(&format!(" AND t.created_at<=${}",binds.len()+1)); binds.push(format!("{} 23:59:59",d)); }
    sql.push_str(" GROUP BY 1,2 ORDER BY 1,2");
    let mut qb = sqlx::query(&sql);
    for b in &binds { qb = qb.bind(b); }
    let rows = qb.fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    let data: Vec<(String,String,f64)> = rows.iter().map(|r| (r.get(0),r.get(1),r.get(2))).collect();
    let mut rk: Vec<String> = Vec::new(); let mut ck: Vec<String> = Vec::new();
    for (a,b,_) in &data { if !rk.contains(a) { rk.push(a.clone()); } if !ck.contains(b) { ck.push(b.clone()); } }
    let mut rows_v = Vec::new();
    for ra in &rk {
        let mut row_obj = json!({"name": ra});
        let mut row_total = 0.0;
        for ca in &ck {
            let v = data.iter().find(|(a,b,_)| a==ra && b==ca).map(|(_,_,v)| *v).unwrap_or(0.0);
            row_total += v;
            row_obj.as_object_mut().map(|o| { o.insert(ca.clone(), json!(v)); });
        }
        row_obj.as_object_mut().map(|o| { o.insert("total".into(), json!(row_total)); });
        rows_v.push(row_obj);
    }
    let cols_v: Vec<serde_json::Value> = ck.iter().map(|c| json!(c)).collect();
    Ok(Json(json!({"rows": rows_v, "columns": cols_v, "rowField": row_f, "colField": col_f, "aggFunction": agg_f})))
}

pub async fn generate_receipt_pdf(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<TxQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let co: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());
    let ca: String = sqlx::query_scalar("SELECT COALESCE(address,'') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or_default();
    let cp: String = sqlx::query_scalar("SELECT COALESCE(phone,'') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or_default();
    let ce: String = sqlx::query_scalar("SELECT COALESCE(email,'') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or_default();
    let tx = sqlx::query("SELECT transaction_number,type,COALESCE(reference,''),COALESCE(po_number,''),COALESCE(invoice_no,''),created_at FROM transactions WHERE id=$1").bind(&q.tx_id).fetch_optional(&pool.pool).await.map_err(|e| crate::server::server_error(e))?.ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Transaction not found"}))))?;
    let tn: String = tx.get(0); let tt: String = tx.get(1); let tr: String = tx.get(2); let tp: String = tx.get(3); let ti: String = tx.get(4); let td: String = tx.get(5);
    let items: Vec<(String,String,String,f64,f64)> = sqlx::query("SELECT ti.material_id,COALESCE(m.sku,''),COALESCE(ti.batch_id,''),ti.quantity,ti.price FROM transaction_items ti LEFT JOIN materials m ON ti.material_id=m.id WHERE ti.tx_id=$1 ORDER BY m.name").bind(&q.tx_id).fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?.iter().map(|r| (r.get(0),r.get(1),r.get(2),r.get(3),r.get(4))).collect();
    let b64 = tokio::task::spawn_blocking(move || -> Result<String,String> {
        use printpdf::*;
        let (doc,p1,l1)=PdfDocument::new(&format!("{} - Receipt",co),Mm(210.0),Mm(297.0),"Receipt");
        let cl=doc.get_page(p1).get_layer(l1);
        let fb=doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e|e.to_string())?;
        let fr=doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e|e.to_string())?;
        let fm=doc.add_builtin_font(BuiltinFont::Courier).map_err(|e|e.to_string())?;
        let mut y=275.0; cl.use_text(&co,20.0,Mm(20.0),Mm(y),&fb); y-=7.0;
        if !ca.is_empty(){cl.use_text(&ca,9.0,Mm(20.0),Mm(y),&fr);y-=5.0;}
        if !cp.is_empty(){cl.use_text(&format!("Phone: {}",cp),9.0,Mm(20.0),Mm(y),&fr);y-=5.0;}
        if !ce.is_empty(){cl.use_text(&ce,9.0,Mm(20.0),Mm(y),&fr);y-=5.0;} y-=5.0;
        cl.use_text(&"\u{2500}".repeat(100),9.0,Mm(20.0),Mm(y),&fm); y-=8.0;
        cl.use_text("RECEIPT",16.0,Mm(90.0),Mm(y),&fb); y-=10.0;
        cl.use_text(&format!("No: {}",tn),10.0,Mm(20.0),Mm(y),&fr); y-=6.0;
        cl.use_text(&format!("Date: {}",td),10.0,Mm(20.0),Mm(y),&fr); y-=6.0;
        cl.use_text(&format!("Type: {}",tt.to_uppercase()),10.0,Mm(20.0),Mm(y),&fr); y-=6.0;
        if !tr.is_empty(){cl.use_text(&format!("Reference: {}",tr),10.0,Mm(20.0),Mm(y),&fr);y-=6.0;}
        if !tp.is_empty(){cl.use_text(&format!("PO: {}",tp),10.0,Mm(20.0),Mm(y),&fr);y-=6.0;}
        if !ti.is_empty(){cl.use_text(&format!("Invoice: {}",ti),10.0,Mm(20.0),Mm(y),&fr);y-=6.0;} y-=3.0;
        cl.use_text(&"\u{2500}".repeat(100),9.0,Mm(20.0),Mm(y),&fm); y-=8.0;
        cl.use_text("SKU | Material | Batch | Qty | Subtotal",9.0,Mm(20.0),Mm(y),&fb); y-=6.0;
        for (_,sk,ba,qt,pr) in &items { if y<25.0{break;} let sub=if *qt>0.0{format!("{}",*qt**pr)}else{"-".into()}; cl.use_text(&format!("{}|{}|{}|{}|{}",sk,"",ba,qt,sub),8.0,Mm(20.0),Mm(y),&fr); y-=5.0; }
        cl.use_text(&format!("Page 1 | {} - Receipt",co),7.0,Mm(20.0),Mm(10.0),&fr);
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &doc.save_to_bytes().map_err(|e|e.to_string())?))
    }).await.map_err(|e| crate::server::server_error(e))?.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"pdf": b64})))
}

pub async fn generate_picking_list_pdf(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<TxQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let co: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());
    let tx = sqlx::query("SELECT transaction_number,COALESCE(reference,''),created_at FROM transactions WHERE id=$1").bind(&q.tx_id).fetch_optional(&pool.pool).await.map_err(|e| crate::server::server_error(e))?.ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Transaction not found"}))))?;
    let tn: String = tx.get(0); let tr: String = tx.get(1); let td: String = tx.get(2);
    let items: Vec<(String,String,String,f64,String)> = sqlx::query("SELECT COALESCE(r.rack_name,'No Rack'),COALESCE(r.area,''),COALESCE(m.sku,''),ti.quantity,COALESCE(m.name,'') FROM transaction_items ti LEFT JOIN materials m ON ti.material_id=m.id LEFT JOIN racks r ON m.rack_id=r.id WHERE ti.tx_id=$1 ORDER BY r.warehouse_id,r.area,r.rack_name,m.name").bind(&q.tx_id).fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?.iter().map(|r| (r.get(0),r.get(1),r.get(2),r.get(3),r.get(4))).collect();
    let b64 = tokio::task::spawn_blocking(move || -> Result<String,String> {
        use printpdf::*;
        let (doc,p1,l1)=PdfDocument::new(&format!("{} - Picking List",co),Mm(210.0),Mm(297.0),"PickingList");
        let cl=doc.get_page(p1).get_layer(l1);
        let fb=doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e|e.to_string())?;
        let fr=doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e|e.to_string())?;
        let mut y=275.0; cl.use_text(&co,18.0,Mm(20.0),Mm(y),&fb); y-=10.0;
        cl.use_text("PICKING LIST",16.0,Mm(80.0),Mm(y),&fb); y-=10.0;
        cl.use_text(&format!("Transaction: {}",tn),10.0,Mm(20.0),Mm(y),&fr); y-=6.0;
        cl.use_text(&format!("Reference: {}",tr),10.0,Mm(20.0),Mm(y),&fr); y-=6.0;
        cl.use_text(&format!("Date: {}",td),10.0,Mm(20.0),Mm(y),&fr); y-=10.0;
        cl.use_text("Rack | Area | SKU | Material | Qty",9.0,Mm(20.0),Mm(y),&fb); y-=6.0;
        for (rk,ar,sk,qt,nm) in &items { if y<20.0{break;} cl.use_text(&format!("{}|{}|{}|{}|{}",rk,ar,sk,nm,qt),8.0,Mm(20.0),Mm(y),&fr); y-=5.0; }
        cl.use_text(&format!("Page 1 | {} - Picking List",co),7.0,Mm(20.0),Mm(10.0),&fr);
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &doc.save_to_bytes().map_err(|e|e.to_string())?))
    }).await.map_err(|e| crate::server::server_error(e))?.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"pdf": b64})))
}

pub async fn generate_do_pdf(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<TxQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let co: String = sqlx::query_scalar("SELECT COALESCE(company_name,'Thermaltrue') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or("Thermaltrue".into());
    let ca: String = sqlx::query_scalar("SELECT COALESCE(address,'') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or_default();
    let cp: String = sqlx::query_scalar("SELECT COALESCE(phone,'') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or_default();
    let ce: String = sqlx::query_scalar("SELECT COALESCE(email,'') FROM company_profile LIMIT 1").fetch_one(&pool.pool).await.unwrap_or_default();
    let tx = sqlx::query("SELECT transaction_number,COALESCE(reference,''),COALESCE(notes,''),created_at FROM transactions WHERE id=$1").bind(&q.tx_id).fetch_optional(&pool.pool).await.map_err(|e| crate::server::server_error(e))?.ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Transaction not found"}))))?;
    let dn: String = tx.get(0); let dr: String = tx.get(1); let dno: String = tx.get(2); let dd: String = tx.get(3);
    let items: Vec<(String,String,f64,String)> = sqlx::query("SELECT COALESCE(m.sku,''),COALESCE(m.name,''),ti.quantity,COALESCE(m.unit_id,'pcs') FROM transaction_items ti LEFT JOIN materials m ON ti.material_id=m.id WHERE ti.tx_id=$1 ORDER BY m.name").bind(&q.tx_id).fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?.iter().map(|r| (r.get(0),r.get(1),r.get(2),r.get(3))).collect();
    let b64 = tokio::task::spawn_blocking(move || -> Result<String,String> {
        use printpdf::*;
        let (doc,p1,l1)=PdfDocument::new(&format!("{} - Delivery Order",co),Mm(210.0),Mm(297.0),"DO");
        let cl=doc.get_page(p1).get_layer(l1);
        let fb=doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e|e.to_string())?;
        let fr=doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e|e.to_string())?;
        let fm=doc.add_builtin_font(BuiltinFont::Courier).map_err(|e|e.to_string())?;
        let mut y=275.0; cl.use_text(&co,20.0,Mm(20.0),Mm(y),&fb); y-=7.0;
        if !ca.is_empty(){cl.use_text(&ca,9.0,Mm(20.0),Mm(y),&fr);y-=5.0;}
        if !cp.is_empty(){cl.use_text(&format!("Phone: {}",cp),9.0,Mm(20.0),Mm(y),&fr);y-=5.0;}
        if !ce.is_empty(){cl.use_text(&ce,9.0,Mm(20.0),Mm(y),&fr);y-=5.0;} y-=5.0;
        cl.use_text(&"\u{2500}".repeat(100),9.0,Mm(20.0),Mm(y),&fm); y-=8.0;
        cl.use_text("DELIVERY ORDER",16.0,Mm(80.0),Mm(y),&fb); y-=10.0;
        cl.use_text(&format!("DO No: {}",dn),10.0,Mm(20.0),Mm(y),&fr); y-=6.0;
        cl.use_text(&format!("Date: {}",dd),10.0,Mm(20.0),Mm(y),&fr); y-=6.0;
        if !dr.is_empty(){cl.use_text(&format!("Reference: {}",dr),10.0,Mm(20.0),Mm(y),&fr);y-=6.0;}
        if !dno.is_empty(){cl.use_text(&format!("Notes: {}",dno),10.0,Mm(20.0),Mm(y),&fr);y-=6.0;} y-=3.0;
        cl.use_text(&"\u{2500}".repeat(100),9.0,Mm(20.0),Mm(y),&fm); y-=8.0;
        cl.use_text("No | SKU | Description | Qty | Unit",9.0,Mm(20.0),Mm(y),&fb); y-=6.0;
        for (i,(sk,nm,qt,un)) in items.iter().enumerate() { if y<35.0{break;} cl.use_text(&format!("{}|{}|{}|{}|{}",i+1,sk,nm,qt,un),8.0,Mm(20.0),Mm(y),&fr); y-=5.0; }
        y=30.0; cl.use_text("Dikirim oleh: _______________",10.0,Mm(20.0),Mm(y),&fr);
        cl.use_text("Diterima oleh: _______________",10.0,Mm(120.0),Mm(y),&fr); y-=12.0;
        cl.use_text(&format!("Page 1 | {} - Delivery Order",co),7.0,Mm(20.0),Mm(y),&fr);
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &doc.save_to_bytes().map_err(|e|e.to_string())?))
    }).await.map_err(|e| crate::server::server_error(e))?.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!({"pdf": b64})))
}
