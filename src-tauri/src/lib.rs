use backend::db_pool::DbPool;
use backend::commands;
use tauri::Manager;
use serde::Serialize;
use std::io::Write;

fn startup_log(msg: &str) {
    eprintln!("{}", msg);
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let log_path = dir.join("startup.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(f, "{}", msg);
            }
        }
    }
}

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
    startup_log(&format!("ERROR_DIALOG: {} - {}", title, message));
    unsafe {
        MessageBoxW(null_mut(), message_wide.as_ptr(), title_wide.as_ptr(), 0x00000010 | 0x00000000);
    }
}

#[cfg(not(windows))]
fn show_error_dialog(title: &str, message: &str) {
    eprintln!("{}: {}", title, message);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub status: String,
    pub message: String,
}

async fn check_health(timeout_secs: u64) -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build().ok();
    let client = match client {
        Some(c) => c,
        None => return false,
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        if let Ok(resp) = client.get("http://localhost:3000/api/health").send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    false
}

#[tauri::command]
async fn ensure_server_running() -> Result<ServerStatus, String> {
    #[cfg(windows)]
    {
        let output = std::process::Command::new("sc")
            .args(["query", "ThermaltrueServer"])
            .output()
            .map_err(|e| format!("Failed to run sc query: {}", e))?;
        let stdout = String::from_utf8_lossy(&output.stdout);

        if stdout.contains("1060") || stdout.contains("FAILED") || stdout.contains("not exist") {
            // Service not installed — try direct HTTP health check as fallback
            if check_health(5).await {
                return Ok(ServerStatus {
                    status: "running".into(),
                    message: "Server is reachable via HTTP.".into(),
                });
            }
            return Ok(ServerStatus {
                status: "not_installed".into(),
                message: "Server service 'ThermaltrueServer' is not installed. Run 'server.exe install' as Administrator first.".into(),
            });
        }

        if stdout.contains("RUNNING") || stdout.contains("STOP_PENDING") {
            if check_health(5).await {
                return Ok(ServerStatus {
                    status: "running".into(),
                    message: "Server is running.".into(),
                });
            }
            return Ok(ServerStatus {
                status: "timeout".into(),
                message: "Server service found but health check timed out.".into(),
            });
        }

        if stdout.contains("STOPPED") {
            let start = std::process::Command::new("sc")
                .args(["start", "ThermaltrueServer"])
                .output()
                .map_err(|e| format!("Failed to start server service: {}", e))?;
            let start_out = String::from_utf8_lossy(&start.stdout);
            if !start_out.contains("RUNNING") && !start_out.contains("START_PENDING") {
                return Ok(ServerStatus {
                    status: "start_failed".into(),
                    message: format!("Failed to start server service: {}", start_out),
                });
            }
            if check_health(15).await {
                return Ok(ServerStatus {
                    status: "started".into(),
                    message: "Server service started successfully.".into(),
                });
            }
            return Ok(ServerStatus {
                status: "timeout".into(),
                message: "Server service started but health check timed out after 15s.".into(),
            });
        }

        Ok(ServerStatus {
            status: "unknown".into(),
            message: format!("Unexpected sc query result: {}", stdout),
        })
    }

    #[cfg(not(windows))]
    {
        if check_health(5).await {
            Ok(ServerStatus {
                status: "running".into(),
                message: "Server is reachable.".into(),
            })
        } else {
            Ok(ServerStatus {
                status: "unreachable".into(),
                message: "Could not connect to server at http://localhost:3000. Make sure it is running.".into(),
            })
        }
    }
}

fn run_tauri_app() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::dotenv();
    startup_log("Tauri app starting...");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_barcode_scanner::init())

        .setup(|app| {
            startup_log("Tauri setup hook started...");
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let db_ok = match std::env::var("DATABASE_URL") {
                Ok(url) => {
                    startup_log("DATABASE_URL found, attempting connection...");
                    match tauri::async_runtime::block_on(DbPool::new(&url)) {
                        Ok(pool) => {
                            startup_log("DB pool created successfully");
                            app.manage(pool);
                            let handle = app.handle().clone();
                            tauri::async_runtime::spawn(async move {
                                loop {
                                    tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                                    if let Some(pool) = handle.try_state::<DbPool>() {
                                        pool.cleanup_expired_sessions();
                                    }
                                }
                            });
                            true
                        }
                        Err(e) => {
                            startup_log(&format!("WARN: DB connection failed ({}). App will use HTTP mode.", e));
                            false
                        }
                    }
                }
                Err(_) => {
                    startup_log("INFO: DATABASE_URL not set. App will use HTTP mode via server.exe");
                    false
                }
            };
            if !db_ok {
                startup_log("INFO: DB not available — Tauri invoke commands will not work, use HTTP mode instead.");
            }
            startup_log("Tauri setup hook complete.");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_server_running,
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
            commands::get_roles,
            commands::clone_role,
            commands::check_permission,
            commands::update_role,
            commands::export_audit_csv_filtered,
            commands::update_zone,
            commands::get_locations,
            commands::create_location,
            commands::delete_location,
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
            commands::auto_generate_cycle_opname,
            commands::batch_transfer_rack,
            commands::generate_count_sheet_pdf,
            commands::run_report_schedule,
            commands::get_multi_warehouse_comparison,
            commands::get_pivot_report,
            commands::get_variance_root_cause,
            commands::get_label_templates,
            commands::get_label_template,
            commands::save_label_template,
            commands::delete_label_template,
        ])
        .run(tauri::generate_context!())
        .map_err(|e| {
            let msg = format!("Tauri app error: {}", e);
            startup_log(&msg);
            Box::new(std::io::Error::new(std::io::ErrorKind::Other, msg)) as Box<dyn std::error::Error>
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    startup_log("=== THERMALTRUE APP STARTING ===");
    startup_log(&format!("Args: {:?}", std::env::args().collect::<Vec<_>>()));
    startup_log(&format!("Current dir: {:?}", std::env::current_dir()));

    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_tauri_app())) {
        Ok(Ok(())) => {
            startup_log("Tauri app exited normally.");
        }
        Ok(Err(e)) => {
            let msg = format!("Tauri app failed: {}", e);
            startup_log(&msg);
            show_error_dialog("Thermaltrue Error", &msg);
        }
        Err(panic_info) => {
            let msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                format!("Application crashed (panic): {}", s)
            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                format!("Application crashed (panic): {}", s)
            } else {
                "Application crashed due to an unexpected error (panic)".to_string()
            };
            startup_log(&msg);
            show_error_dialog("Thermaltrue Crash", &msg);
        }
    }
    startup_log("=== THERMALTRUE APP EXITED ===");
}
