use backend::db_pool::DbPool;
use backend::commands;
use tauri::Manager;

#[cfg(windows)]
fn show_error_dialog(title: &str, message: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    extern "system" {
        fn MessageBoxW(hWnd: *mut std::ffi::c_void, lpText: *const u16, lpCaption: *const u16, uType: u32) -> i32;
    }
    let title_wide: Vec<u16> = OsStr::new(title).encode_wide().chain(std::iter::once(0)).collect();
    let message_wide: Vec<u16> = OsStr::new(message).encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        MessageBoxW(null_mut(), message_wide.as_ptr(), title_wide.as_ptr(), 0x00000010 | 0x00000000);
    }
}

#[cfg(not(windows))]
fn show_error_dialog(title: &str, message: &str) {
    eprintln!("{}: {}", title, message);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv(); // Load .env file, ignore if not found
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                eprintln!("WARN: DATABASE_URL not set, using default (postgresql://postgres@localhost:5432/thermaltrue)");
                "postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable".into()
            });
            let pool = tauri::async_runtime::block_on(
                DbPool::new(&database_url)
            ).unwrap_or_else(|e| {
                let msg = format!("Cannot connect to database.\nURL: {}\nError: {}\n\nMake sure PostgreSQL is running and the database 'thermaltrue' exists.", database_url, e);
                eprintln!("FATAL: {}", msg);
                std::fs::write("thermaltrue_error.log", &msg).ok();
                show_error_dialog("Thermaltrue - Database Error", &msg);
                std::process::exit(1);
            });
            app.manage(pool);
            // Periodic session cleanup every 10 minutes
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                        if let Some(pool) = handle.try_state::<DbPool>() {
                            pool.cleanup_expired_sessions();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::logout,
            commands::get_current_user,
            commands::get_materials,
            commands::get_material,
            commands::create_material,
            commands::update_material,
            commands::delete_material,
            commands::delete_materials_bulk,
            commands::update_materials_bulk,
            commands::import_materials_csv,
            commands::get_materials_low_stock,
            commands::get_expiring_materials,
            commands::get_transactions,
            commands::create_transaction,
            commands::approve_transaction,
            commands::reject_transaction,
            commands::get_pending_transactions,
            commands::get_transaction_by_id,
            commands::get_transaction_items,
            commands::reverse_transaction,
            commands::reverse_transactions_bulk,
            commands::get_purchase_orders,
            commands::create_purchase_order,
            commands::update_purchase_order_status,
            commands::get_po_items,
            commands::get_sales_orders,
            commands::create_sales_order,
            commands::update_sales_order_status,
            commands::get_so_items,
            commands::get_transaction_attachments,
            commands::create_transaction_attachment,
            commands::delete_transaction_attachment,
            commands::get_quality_inspections,
            commands::create_quality_inspection,
            commands::get_fifo_fefo_suggestion,
            commands::generate_tx_number,
            commands::get_warehouses,
            commands::create_warehouse,
            commands::update_warehouse,
            commands::delete_warehouse,
            commands::get_racks,
            commands::create_rack,
            commands::update_rack,
            commands::delete_rack,
            commands::get_stock_opnames,
            commands::create_stock_opname,
            commands::update_stock_opname_status,
            commands::get_stock_opname_items,
            commands::save_stock_opname_item,
            commands::get_rack_occupancy,
            commands::get_rack_occupancy_details,
            commands::get_warehouse_stats,
            commands::get_rack_utilization_history,
            commands::suggest_putaway,
            commands::get_zones,
            commands::create_zone,
            commands::delete_zone,
            commands::transfer_material,
            commands::transfer_materials_bulk,
            commands::get_dashboard_kpi,
            commands::get_analysis_all,
            commands::get_abc_analysis,
            commands::export_report_csv,
            commands::generate_report_pdf,
            commands::get_mom_kpis,
            commands::get_aging_report,
            commands::get_stock_movement,
            commands::get_tx_type_summary,
            commands::get_tx_by_user,
            commands::get_daily_trend,
            commands::get_tx_date_comparison,
            commands::get_opname_variance,
            commands::approve_opname_adjustment,
            commands::export_opname_xlsx,
            commands::get_report_schedules,
            commands::save_report_schedule,
            commands::delete_report_schedule,
            commands::get_category_value_summary,
            commands::get_users,
            commands::create_user,
            commands::update_user,
            commands::change_password,
            commands::delete_user,
            commands::get_categories,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            commands::get_units,
            commands::create_unit,
            commands::update_unit,
            commands::delete_unit,
            commands::get_suppliers,
            commands::create_supplier,
            commands::update_supplier,
            commands::delete_supplier,
            commands::get_audit_logs,
            commands::get_audit_logs_filtered,
            commands::count_audit_logs_filtered,
            commands::add_audit_log,
            commands::purge_old_audit_logs,
            commands::backup_database,
            commands::restore_database,
            commands::get_db_stats,
            commands::generate_qr_code,
            commands::update_user_photo,
            commands::get_user_activity,
            commands::log_user_activity,
            commands::get_category_tree,
            commands::get_unit_conversions,
            commands::create_unit_conversion,
            commands::delete_unit_conversion,
            commands::convert_unit,
            commands::get_supplier_ratings,
            commands::create_supplier_rating,
            commands::get_supplier_prices,
            commands::create_supplier_price,
            commands::get_company_profile,
            commands::save_company_profile,
            commands::get_app_config,
            commands::set_app_config,
            commands::get_all_app_config,
            commands::delete_app_config,
            commands::get_notification_config,
            commands::set_notification_config,
            // Phase 3 — Materials features
            commands::get_material_batches,
            commands::create_material_batch,
            commands::delete_material_batch,
            commands::get_material_images,
            commands::create_material_image,
            commands::delete_material_image,
            commands::reorder_material_images,
            commands::get_stock_valuation,
            commands::import_materials_xlsx,
            commands::preview_import_xlsx,
            commands::export_stock_xlsx,
            commands::generate_zpl,
            commands::get_stock_timeline,
            // Phase 1 — RBAC / Roles
            commands::get_roles,
            commands::clone_role,
            commands::check_permission,
            commands::update_role,
            commands::export_audit_csv_filtered,
            // Phase 2 — Zone update + Locations
            commands::update_zone,
            commands::get_locations,
            commands::create_location,
            commands::delete_location,
            // Phase 5 — Warehouse Operations
            commands::get_throughput_metrics,
            commands::get_picker_activity,
            commands::get_slotting_suggestions,
            commands::get_transfer_orders,
            commands::create_transfer_order,
            commands::update_transfer_order_status,
            commands::get_transfer_items,
            commands::get_cycle_schedules,
            commands::create_cycle_schedule,
            commands::delete_cycle_schedule,
            commands::get_opname_config,
            commands::set_opname_config,
            // Phase 9A — Advanced backend
            commands::get_budgets,
            commands::save_budget,
            commands::delete_budget,
            commands::get_abc_weights,
            commands::set_abc_weight,
            commands::get_forecast_cache,
            commands::set_forecast_cache,
            commands::delete_forecast_cache,
            commands::get_login_history,
            commands::get_user_login_history,
            commands::clear_login_history,
            commands::generate_qr_zip,
            commands::generate_receipt_pdf,
            commands::generate_picking_list_pdf,
            commands::generate_do_pdf,
            // Phase 11 — Operations Automation
            commands::auto_generate_cycle_opname,
            commands::batch_transfer_rack,
            commands::generate_count_sheet_pdf,
            // Phase 14 — Reports & Export Mastery
            commands::run_report_schedule,
            commands::get_multi_warehouse_comparison,
            commands::get_pivot_report,
            commands::get_variance_root_cause,
            // Label Templates
            commands::get_label_templates,
            commands::get_label_template,
            commands::save_label_template,
            commands::delete_label_template,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
