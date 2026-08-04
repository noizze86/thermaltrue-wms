use std::sync::Arc;
use axum::{Json, extract::{State, Path, Query}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
pub struct UpdateStatusBody { pub status: String }

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SaveItemBody {
    pub opname_id: String,
    pub material_id: String,
    pub system_qty: f64,
    pub physical_qty: f64,
    pub difference: f64,
    pub notes: String,
    #[serde(default)]
    pub remark: String,
}

pub async fn list(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at, cycle_mode, deadline, blind_mode, tolerance_pct, assigned_to, zone_id, recount_of FROM stock_opname ORDER BY created_at DESC")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "opname_number": row.get::<String,_>("opname_number"),
            "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "status": row.get::<String,_>("status"),
            "notes": row.get::<String,_>("notes"), "created_by": row.get::<Option<String>,_>("created_by"),
            "created_at": row.get::<String,_>("created_at"), "updated_at": row.get::<String,_>("updated_at"),
            "cycle_mode": row.get::<String,_>("cycle_mode"), "deadline": row.get::<String,_>("deadline"),
            "blind_mode": row.get::<bool,_>("blind_mode"), "tolerance_pct": row.get::<f64,_>("tolerance_pct"),
            "assigned_to": row.get::<String,_>("assigned_to"), "zone_id": row.get::<String,_>("zone_id"),
            "recount_of": row.get::<String,_>("recount_of")})
    }).collect::<Vec<_>>())))
}

pub async fn create(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname")
        .fetch_one(&pool.pool).await.unwrap_or(1);
    let opname_number = format!("OPN-{:04}", count);
    let wh_id = body.get("warehouse_id").and_then(|v| v.as_str());
    let notes = body.get("notes").and_then(|v| v.as_str()).unwrap_or("");
    let deadline = body.get("deadline").and_then(|v| v.as_str()).unwrap_or("");
    let blind_mode = body.get("blind_mode").and_then(|v| v.as_bool()).unwrap_or(false);
    let assigned_to = body.get("assigned_to").and_then(|v| v.as_str()).unwrap_or("");
    let zone_id = body.get("zone_id").and_then(|v| v.as_str()).unwrap_or("");
    let cycle_mode = body.get("cycle_mode").and_then(|v| v.as_str()).unwrap_or("manual");
    let material_ids: Vec<String> = body.get("material_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at, cycle_mode, deadline, blind_mode, assigned_to, zone_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
        .bind(&id).bind(&opname_number).bind(wh_id).bind("open").bind(notes).bind(&user_id).bind(&now).bind(&now)
        .bind(&cycle_mode).bind(&deadline).bind(blind_mode).bind(&assigned_to).bind(&zone_id)
        .execute(&mut *db_tx).await
        .map_err(|e| crate::server::server_error(e))?;
    if !material_ids.is_empty() {
        let mut mat_builder = sqlx::QueryBuilder::new("SELECT id, quantity FROM materials WHERE is_active=true AND id IN (");
        let mut sep = mat_builder.separated(", ");
        for mid in &material_ids { sep.push_bind(mid); }
        mat_builder.push(")");
        if let Some(ref w) = wh_id { mat_builder.push(" AND warehouse_id = "); mat_builder.push_bind(w); }
        let materials: Vec<(String, f64)> = mat_builder.build().fetch_all(&mut *db_tx).await
            .map_err(|e| crate::server::server_error(e))?
            .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1))).collect();
        for (mid, qty) in &materials {
            let iid = uuid::Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference, cycle_round) VALUES ($1,$2,$3,$4,$5,0,1)")
                .bind(&iid).bind(&id).bind(mid).bind(qty).bind(qty)
                .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        }
    }
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    crate::server::handlers::audit(&pool.pool, &user_id, "create", "stock_opname", &id, &format!("{} - warehouse {:?} items {} deadline {}", opname_number, wh_id, material_ids.len(), deadline)).await;
    Ok(Json(json!({"id": id, "opname_number": opname_number, "warehouse_id": wh_id, "status": "open", "notes": notes, "created_by": user_id, "created_at": now, "updated_at": now, "cycle_mode": cycle_mode, "deadline": deadline, "blind_mode": blind_mode, "assigned_to": assigned_to, "zone_id": zone_id})))
}

pub async fn update_status(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateStatusBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let task_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM stock_opname WHERE id=$1)")
        .bind(&id).fetch_one(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    if !task_exists { return Err((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Stock opname task not found"})))); }
    let allowed = ["open", "in_progress", "pending_review", "completed", "expired", "draft", "voided", "rejected"];
    if !allowed.contains(&body.status.as_str()) {
        return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": format!("Invalid status transition: {}", body.status)}))));
    }
    sqlx::query("UPDATE stock_opname SET status=$1, updated_at=$2 WHERE id=$3")
        .bind(&body.status).bind(&now).bind(&id)
        .execute(&mut *db_tx).await
        .map_err(|e| crate::server::server_error(e))?;
    if body.status == "completed" {
        let task: Option<(String, f64)> = sqlx::query_as::<_, (String, f64)>("SELECT deadline, tolerance_pct FROM stock_opname WHERE id=$1")
            .bind(&id).fetch_optional(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?
            .map(|r| (r.0, r.1));
        let task_tol = task.as_ref().map(|t| t.1).unwrap_or(5.0);
        let mut needs_review = false;
        let items: Vec<(String, f64, f64)> = sqlx::query("SELECT material_id, physical_qty, system_qty FROM stock_opname_items WHERE opname_id=$1")
            .bind(&id).fetch_all(&mut *db_tx).await
            .map_err(|e| crate::server::server_error(e))?
            .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1), row.get::<f64,_>(2))).collect();
        for (mid, phy_qty, sys_qty) in items {
            let diff = phy_qty - sys_qty;
            let cls: String = sqlx::query_scalar("SELECT abc_class FROM abc_classification WHERE material_id=$1 ORDER BY period DESC LIMIT 1")
                .bind(&mid).fetch_optional(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?
                .unwrap_or("C".to_string());
            let tol: f64 = if task_tol != 5.0 { task_tol } else { match cls.as_str() { "A" => 0.0, "B" => 1.0, _ => 3.0 } };
            let within = sys_qty != 0.0 && (diff.abs() / sys_qty) * 100.0 <= tol;
            if within {
                let old_qty: f64 = sys_qty;
                sqlx::query("UPDATE materials SET quantity=$1 WHERE id=$2")
                    .bind(phy_qty).bind(&mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
                sqlx::query("INSERT INTO cycle_count_history (id, task_id, material_id, action, before_qty, after_qty, changed_by) VALUES ($1,$2,$3,'approve',$4,$5,$6)")
                    .bind(uuid::Uuid::new_v4().to_string()).bind(&id).bind(&mid).bind(old_qty).bind(phy_qty).bind(&user_id)
                    .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
                sqlx::query("UPDATE stock_opname_items SET approved_status='approved', reviewer_id=$1, reviewed_at=$2 WHERE opname_id=$3 AND material_id=$4")
                    .bind(&user_id).bind(&now).bind(&id).bind(&mid)
                    .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
                let acc: f64 = if sys_qty != 0.0 { 100.0 - ((diff.abs() / sys_qty) * 100.0) } else { 100.0 };
                sqlx::query("UPDATE material_metrics SET accuracy_pct=$1, last_cycle_count_qty=$2, last_cycle_count_date=$3, updated_at=$4 WHERE material_id=$5")
                    .bind(acc).bind(phy_qty).bind(&today).bind(&now).bind(&mid)
                    .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
            } else {
                needs_review = true;
                sqlx::query("UPDATE stock_opname_items SET approved_status='flagged' WHERE opname_id=$1 AND material_id=$2")
                    .bind(&id).bind(&mid).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
            }
        }
        if needs_review {
            sqlx::query("UPDATE stock_opname SET status='pending_review', updated_at=$1 WHERE id=$2")
                .bind(&now).bind(&id).execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        }
    }
    if body.status == "expired" {
        let deadline: String = sqlx::query_scalar("SELECT COALESCE(deadline,'') FROM stock_opname WHERE id=$1")
            .bind(&id).fetch_one(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
        if deadline.is_empty() || deadline >= today {
            return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Cannot expire task without a past deadline"}))));
        }
    }
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    crate::server::handlers::audit(&pool.pool, &user_id, "update", "stock_opname", &id, &format!("status -> {}", body.status)).await;
    Ok(Json(json!({"status": body.status})))
}

pub async fn get_items(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, opname_id, material_id, system_qty, physical_qty, difference, notes, cycle_round, approved_status, reviewer_id, reviewed_at, remark FROM stock_opname_items WHERE opname_id=$1")
        .bind(&id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "opname_id": row.get::<String,_>("opname_id"),
            "material_id": row.get::<String,_>("material_id"), "system_qty": row.get::<f64,_>("system_qty"),
            "physical_qty": row.get::<f64,_>("physical_qty"), "difference": row.get::<f64,_>("difference"),
            "notes": row.get::<String,_>("notes"), "cycle_round": row.get::<i64,_>("cycle_round"),
            "approved_status": row.get::<String,_>("approved_status"), "reviewer_id": row.get::<String,_>("reviewer_id"),
            "reviewed_at": row.get::<String,_>("reviewed_at"), "remark": row.get::<String,_>("remark")})
    }).collect::<Vec<_>>())))
}

pub async fn save_item(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SaveItemBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    if body.physical_qty < 0.0 { return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"Physical quantity cannot be negative"})))); }
    let opname_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM stock_opname WHERE id=$1)")
        .bind(&body.opname_id).fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    if !opname_exists { return Err((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Stock opname not found"})))); }
    let mat_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM materials WHERE id=$1)")
        .bind(&body.material_id).fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    if !mat_exists { return Err((axum::http::StatusCode::NOT_FOUND, Json(json!({"error":"Material not found"})))); }
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM stock_opname_items WHERE opname_id=$1 AND material_id=$2")
        .bind(&body.opname_id).bind(&body.material_id)
        .fetch_optional(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    if existing.is_some() {
        sqlx::query("UPDATE stock_opname_items SET physical_qty=$1, difference=$2, notes=$3, remark=$4 WHERE opname_id=$5 AND material_id=$6")
            .bind(body.physical_qty).bind(body.physical_qty - body.system_qty).bind(&body.notes).bind(&body.remark)
            .bind(&body.opname_id).bind(&body.material_id)
            .execute(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?;
    } else {
        let item_id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference, notes, remark, cycle_round) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)")
            .bind(&item_id).bind(&body.opname_id).bind(&body.material_id).bind(body.system_qty).bind(body.physical_qty)
            .bind(body.physical_qty - body.system_qty).bind(&body.notes).bind(&body.remark)
            .execute(&pool.pool).await
            .map_err(|e| crate::server::server_error(e))?;
    }
    crate::server::handlers::audit(&pool.pool, &user_id, "adjust", "stock_opname_item", &body.material_id, &format!("opname {} physical {} system {} remark {}", body.opname_id, body.physical_qty, body.system_qty, body.remark)).await;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct ScopeQuery { pub warehouse_id: Option<String>, pub category_id: Option<String>, pub rack_id: Option<String> }

pub async fn get_scope_items(
    State(pool): State<Arc<DbPool>>,
    Query(q): Query<ScopeQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut builder = sqlx::QueryBuilder::new("SELECT m.id, m.sku, m.name, m.quantity, m.min_stock, COALESCE(m.rack_id,'') AS rack_id, COALESCE(m.category_id,'') AS category_id FROM materials m WHERE m.is_active=true");
    if let Some(ref w) = q.warehouse_id { builder.push(" AND m.warehouse_id = "); builder.push_bind(w); }
    if let Some(ref c) = q.category_id { builder.push(" AND m.category_id = "); builder.push_bind(c); }
    if let Some(ref r) = q.rack_id { builder.push(" AND m.rack_id = "); builder.push_bind(r); }
    builder.push(" ORDER BY m.sku");
    let rows = builder.build().fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "sku": row.get::<String,_>("sku"),
            "name": row.get::<String,_>("name"), "quantity": row.get::<f64,_>("quantity"),
            "min_stock": row.get::<Option<f64>,_>("min_stock"),
            "rack_id": row.get::<String,_>("rack_id"), "category_id": row.get::<String,_>("category_id")})
    }).collect::<Vec<_>>())))
}

pub async fn get_task_history(
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, task_id, material_id, action, before_qty, after_qty, changed_by, created_at FROM cycle_count_history WHERE task_id=$1 ORDER BY created_at DESC")
        .bind(&id).fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "task_id": row.get::<String,_>("task_id"),
            "material_id": row.get::<String,_>("material_id"), "action": row.get::<String,_>("action"),
            "before_qty": row.get::<f64,_>("before_qty"), "after_qty": row.get::<f64,_>("after_qty"),
            "changed_by": row.get::<String,_>("changed_by"), "created_at": row.get::<String,_>("created_at")})
    }).collect::<Vec<_>>())))
}

pub async fn get_cycle_zones(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, zone_id, warehouse_id, assign_mode, last_date, next_date, created_at FROM cycle_count_zones ORDER BY next_date")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "zone_id": row.get::<String,_>("zone_id"),
            "warehouse_id": row.get::<Option<String>,_>("warehouse_id"), "assign_mode": row.get::<String,_>("assign_mode"),
            "last_date": row.get::<String,_>("last_date"), "next_date": row.get::<String,_>("next_date"),
            "created_at": row.get::<String,_>("created_at")})
    }).collect::<Vec<_>>())))
}

pub async fn get_config(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let blind: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='blind_count_mode'),'false')")
        .fetch_one(&pool.pool).await.unwrap_or("false".into());
    let threshold: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='auto_adjust_threshold'),'0')")
        .fetch_one(&pool.pool).await.unwrap_or("0".into());
    let low_trigger: String = sqlx::query_scalar("SELECT COALESCE((SELECT value FROM app_config WHERE key='cycle_low_stock_trigger'),'false')")
        .fetch_one(&pool.pool).await.unwrap_or("false".into());
    Ok(Json(json!({"blind_count_mode": blind == "true", "auto_adjust_threshold": threshold.parse::<f64>().unwrap_or(0.0), "cycle_low_stock_trigger": low_trigger == "true"})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateZoneScheduleBody { pub zone_id: String, pub warehouse_id: Option<String>, pub assign_mode: String }

pub async fn create_zone_schedule(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateZoneScheduleBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    if body.assign_mode != "daily" && body.assign_mode != "weekly" {
        return Err((axum::http::StatusCode::BAD_REQUEST, Json(json!({"error":"assign_mode must be 'daily' or 'weekly'"}))));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO cycle_count_zones (id, zone_id, warehouse_id, assign_mode, next_date, created_at) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5)")
        .bind(&id).bind(&body.zone_id).bind(&body.warehouse_id).bind(&body.assign_mode).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    crate::server::handlers::audit(&pool.pool, &user_id, "create", "cycle_count_zone", &id, &format!("zone {} mode {}", body.zone_id, body.assign_mode)).await;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    Ok(Json(json!({"id": id, "zone_id": body.zone_id, "warehouse_id": body.warehouse_id, "assign_mode": body.assign_mode, "last_date": "", "next_date": today, "created_at": now})))
}

pub async fn delete_zone_schedule(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM cycle_count_zones WHERE id=$1").bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    crate::server::handlers::audit(&pool.pool, &user_id, "delete", "cycle_count_zone", &id, "Zone schedule deleted").await;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct SetConfigBody { pub key: String, pub value: String }

pub async fn set_config(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<SetConfigBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        .bind(&body.key).bind(&body.value)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    crate::server::handlers::audit(&pool.pool, &user_id, "update", "app_config", &body.key, &format!("{} -> {}", body.key, body.value)).await;
    Ok(Json(()))
}

pub async fn get_cycle_schedules(
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, warehouse_id, class, frequency_days, next_date, last_date, created_at FROM cycle_schedules ORDER BY next_date")
        .fetch_all(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|row| {
        json!({"id": row.get::<String,_>("id"), "warehouse_id": row.get::<Option<String>,_>("warehouse_id"),
            "class": row.get::<String,_>("class"), "frequency_days": row.get::<i64,_>("frequency_days"),
            "next_date": row.get::<String,_>("next_date"), "last_date": row.get::<Option<String>,_>("last_date"),
            "created_at": row.get::<String,_>("created_at")})
    }).collect::<Vec<_>>())))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCycleBody { pub warehouse_id: Option<String>, pub class: String, pub frequency_days: i64 }

pub async fn create_cycle_schedule(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateCycleBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("INSERT INTO cycle_schedules (id, warehouse_id, class, frequency_days, next_date, created_at) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5)")
        .bind(&id).bind(&body.warehouse_id).bind(&body.class).bind(body.frequency_days).bind(&now)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    crate::server::handlers::audit(&pool.pool, &user_id, "create", "cycle_schedule", &id, &format!("class {} every {} day(s)", body.class, body.frequency_days)).await;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    Ok(Json(json!({"id": id, "warehouse_id": body.warehouse_id, "class": body.class, "frequency_days": body.frequency_days, "next_date": today, "last_date": null, "created_at": now})))
}

pub async fn delete_cycle_schedule(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("DELETE FROM cycle_schedules WHERE id=$1").bind(&id)
        .execute(&pool.pool).await
        .map_err(|e| crate::server::server_error(e))?;
    crate::server::handlers::audit(&pool.pool, &user_id, "delete", "cycle_schedule", &id, "Cycle schedule deleted").await;
    Ok(Json(()))
}

pub async fn auto_generate(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let (created, expired_count) = crate::cycle_count::run_auto_generate(&pool.pool, &user_id).await.map_err(|e| crate::server::server_error(e))?;
    crate::server::handlers::audit(&pool.pool, &user_id, "create", "stock_opname", "auto", &format!("Auto-generated {} task(s), expired {}", created, expired_count)).await;
    Ok(Json(json!({"created": created, "expired": expired_count})))
}

pub async fn recount(
    Extension(_user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let user_id = Extension(_user_id).0;
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_warehouse").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let src = sqlx::query("SELECT warehouse_id, cycle_mode, deadline, blind_mode, assigned_to, zone_id, tolerance_pct, opname_number FROM stock_opname WHERE id=$1")
        .bind(&id).fetch_optional(&pool.pool).await.map_err(|e| crate::server::server_error(e))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, Json(json!({"error": "Task not found"}))))?;
    let src_wh: String = src.get(0);
    let src_mode: String = src.get(1);
    let src_deadline: String = src.get(2);
    let src_blind: bool = src.get(3);
    let src_assigned: String = src.get(4);
    let src_zone: String = src.get(5);
    let src_tol: f64 = src.get(6);

    let round: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(cycle_round),0) + 1 FROM stock_opname_items WHERE opname_id=$1")
        .bind(&id).fetch_one(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;

    let mut db_tx = pool.pool.begin().await.map_err(|e| crate::server::server_error(e))?;
    let oid = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) + 1 FROM stock_opname").fetch_one(&mut *db_tx).await.unwrap_or(1);
    let opname_number = format!("OPN-{:04}", count);
    sqlx::query("INSERT INTO stock_opname (id, opname_number, warehouse_id, status, notes, created_by, created_at, updated_at, cycle_mode, task_type, deadline, blind_mode, assigned_to, zone_id, tolerance_pct, recount_of) VALUES ($1,$2,$3,'open',$4,$5,$6,$6,$7,'recount',$8,$9,$10,$11,$12,$13)")
        .bind(&oid).bind(&opname_number).bind(&src_wh).bind(format!("Recount round {} of previous count", round)).bind(&user_id)
        .bind(&now).bind(&src_mode).bind(&src_deadline).bind(src_blind).bind(&src_assigned).bind(&src_zone).bind(src_tol).bind(&id)
        .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    // copy unresolved items (flagged/rejected/pending) with fresh system_qty
    let items: Vec<(String, f64)> = sqlx::query("SELECT i.material_id, m.quantity FROM stock_opname_items i JOIN materials m ON m.id=i.material_id WHERE i.opname_id=$1 AND i.approved_status IN ('pending','rejected','flagged')")
        .bind(&id).fetch_all(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?
        .iter().map(|row| (row.get::<String,_>(0), row.get::<f64,_>(1))).collect();
    for (mid, qty) in &items {
        let iid = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO stock_opname_items (id, opname_id, material_id, system_qty, physical_qty, difference, cycle_round) VALUES ($1,$2,$3,$4,$5,0,$6)")
            .bind(&iid).bind(&oid).bind(mid).bind(qty).bind(qty).bind(round)
            .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    }
    // log recount action on original task + notify assignee
    sqlx::query("INSERT INTO cycle_count_history (id, task_id, material_id, action, changed_by, created_at) VALUES ($1,$2,'','recount',$3,$4)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&id).bind(&user_id).bind(&now)
        .execute(&mut *db_tx).await.map_err(|e| crate::server::server_error(e))?;
    db_tx.commit().await.map_err(|e| crate::server::server_error(e))?;
    if !src_assigned.is_empty() {
        sqlx::query("INSERT INTO app_notifications (id, user_id, title, message, notif_type) VALUES ($1,$2,$3,$4,'info')")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&src_assigned)
            .bind(format!("New recount task {}", opname_number))
            .bind(format!("Recount round {} for {} items", round, items.len()))
            .execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    }
    crate::server::handlers::audit(&pool.pool, &user_id, "recount", "stock_opname", &oid, &format!("Recount of {} — round {} ({} items)", id, round, items.len())).await;
    Ok(Json(json!({"id": oid, "opname_number": opname_number, "warehouse_id": src_wh, "status": "open", "cycle_mode": src_mode, "cycle_round": round, "recount_of": id, "created_at": now})))
}

// Fase 4: in-app notifications
pub async fn list_notifications(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let rows = sqlx::query("SELECT id, user_id, title, message, notif_type, is_read, created_at FROM app_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50")
        .bind(&user_id).fetch_all(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(json!(rows.iter().map(|r| {
        json!({"id": r.get::<String,_>(0), "user_id": r.get::<String,_>(1), "title": r.get::<String,_>(2),
            "message": r.get::<String,_>(3), "type": r.get::<String,_>(4), "is_read": r.get::<bool,_>(5),
            "created_at": r.get::<String,_>(6)})
    }).collect::<Vec<_>>())))
}

pub async fn mark_notification_read(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(nid): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("UPDATE app_notifications SET is_read=true WHERE id=$1 AND user_id=$2")
        .bind(&nid).bind(&user_id).execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn mark_all_notifications_read(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    sqlx::query("UPDATE app_notifications SET is_read=true WHERE user_id=$1 AND is_read=false")
        .bind(&user_id).execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}
