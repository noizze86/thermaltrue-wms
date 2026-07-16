use std::sync::Arc;
use axum::{Json, extract::{State, Query, Path}, Extension};
use serde::Deserialize;
use serde_json::json;
use crate::db_pool::DbPool;
use crate::models::{Category, CategoryTreeNode};
use crate::validate;
use sqlx::Row;

#[derive(Deserialize)]
pub struct ListParams { pub search: Option<String> }

pub async fn list(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Category>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let rows = sqlx::query(
        "SELECT id, name, description, parent_id, icon, color, created_at FROM categories WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%') ORDER BY name"
    )
    .bind(&params.search)
    .fetch_all(&pool.pool)
    .await
    .map_err(|e| crate::server::server_error(e))?;
    let list = rows.iter().map(|row| {
        Category { id: row.get(0), name: row.get(1), description: row.get(2), parent_id: row.get(3), icon: row.get(4), color: row.get(5), created_at: row.get(6) }
    }).collect();
    Ok(Json(list))
}

pub async fn tree(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
) -> Result<Json<Vec<CategoryTreeNode>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    let rows = sqlx::query("SELECT id, name, description, parent_id, icon, color, created_at FROM categories ORDER BY name")
        .fetch_all(&pool.pool)
        .await
        .map_err(|e| crate::server::server_error(e))?;
    let all: Vec<Category> = rows.iter().map(|row| {
        Category { id: row.get(0), name: row.get(1), description: row.get(2), parent_id: row.get(3), icon: row.get(4), color: row.get(5), created_at: row.get(6) }
    }).collect();
    fn build_tree(parent_id: Option<String>, all: &[Category]) -> Vec<CategoryTreeNode> {
        all.iter().filter(|c| c.parent_id == parent_id).map(|c| {
            let children = build_tree(Some(c.id.clone()), all);
            CategoryTreeNode { id: c.id.clone(), name: c.name.clone(), description: c.description.clone(), parent_id: c.parent_id.clone(), icon: c.icon.clone(), color: c.color.clone(), created_at: c.created_at.clone(), children }
        }).collect()
    }
    Ok(Json(build_tree(None, &all)))
}

#[derive(Deserialize)]
pub struct CreateBody { pub name: String, pub description: String, pub parent_id: Option<String>, pub icon: String, pub color: String }

pub async fn create(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<CreateBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    validate::validate_string(&body.name, "Category name", 100).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO categories (id, name, description, parent_id, icon, color) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&body.name).bind(&body.description).bind(&body.parent_id).bind(&body.icon).bind(&body.color)
        .execute(&pool.pool)
        .await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct UpdateBody { pub id: String, pub name: String, pub description: String, pub parent_id: Option<String>, pub icon: String, pub color: String }

pub async fn update(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Json(body): Json<UpdateBody>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE categories SET name=$1, description=$2, parent_id=$3, icon=$4, color=$5 WHERE id=$6")
        .bind(&body.name).bind(&body.description).bind(&body.parent_id).bind(&body.icon).bind(&body.color).bind(&body.id)
        .execute(&pool.pool)
        .await
        .map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}

pub async fn delete(
    Extension(user_id): Extension<String>,
    State(pool): State<Arc<DbPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    if !validate::check_user_permission(&pool.pool, &user_id, "manage_settings").await.map_err(|e| (axum::http::StatusCode::FORBIDDEN, Json(json!({"error": e.to_string()}))))? { return Err((axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Permission denied"})))); }
    sqlx::query("UPDATE categories SET parent_id=NULL WHERE parent_id=$1").bind(&id).execute(&pool.pool).await.ok();
    sqlx::query("DELETE FROM categories WHERE id=$1").bind(&id).execute(&pool.pool).await.map_err(|e| crate::server::server_error(e))?;
    Ok(Json(()))
}
