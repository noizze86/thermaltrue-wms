use std::ffi::OsString;
use std::time::Duration;
use backend::db_pool::DbPool;
use backend::server::create_router;
use windows_service::define_windows_service;
use windows_service::service::*;
use windows_service::service_manager::*;
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;

const SERVICE_NAME: &str = "ThermaltrueServer";
const DISPLAY_NAME: &str = "Thermaltrue WMS API Server";
const DESCRIPTION: &str = "REST API server for Thermaltrue Warehouse Management System";

// ── Windows Service entry macro ──────────────────────────────────────────

define_windows_service!(ffi_service_main, service_main);

// ── Main entry ───────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("run");

    match cmd {
        "install"   => cmd_install(),
        "uninstall" => cmd_uninstall(),
        "start"     => cmd_start(),
        "stop"      => cmd_stop(),
        "service"   => {
            env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
                .format_timestamp_millis()
                .init();
            log_panics::init();
            service_dispatcher::start(SERVICE_NAME, ffi_service_main)
                .expect("Failed to start service dispatcher");
        }
        "run" | _   => cmd_run().await,
    }
}

// ── Service main (runs on background thread) ─────────────────────────────

fn service_main(_arguments: Vec<OsString>) {
    let _ = dotenvy::dotenv();

    let status_handle = service_control_handler::register(SERVICE_NAME, move |control_event| {
        match control_event {
            ServiceControl::Stop | ServiceControl::Interrogate => {
                ServiceControlHandlerResult::NoError
            }
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    }).expect("Failed to register service control handler");

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    }).expect("Failed to set service status");

    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
    rt.block_on(async {
        let pool = init_db().await;
        serve(pool).await;
    });
}

// ── Foreground mode ──────────────────────────────────────────────────────

async fn cmd_run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();
    log_panics::init();
    let pool = init_db().await;
    serve(pool).await;
}

// ── Shared helpers ───────────────────────────────────────────────────────

fn get_database_url() -> String {
    std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable".into()
    })
}

async fn init_db() -> DbPool {
    let url = get_database_url();
    log::info!("Connecting to database...");
    DbPool::new(&url).await.unwrap_or_else(|e| {
        log::error!("Cannot connect to database: {}", e);
        std::process::exit(1);
    })
}

async fn serve(pool: DbPool) {
    let app = create_router(pool);
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("0.0.0.0:{}", port);
    log::info!("Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        log::error!("Cannot bind to {}: {}", addr, e);
        std::process::exit(1);
    });

    axum::serve(listener, app).await.unwrap_or_else(|e| {
        log::error!("Server error: {}", e);
        std::process::exit(1);
    });
}

// ── Service management commands ──────────────────────────────────────────

fn cmd_install() {
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    ).expect("Failed to open service manager (run as Administrator)");

    let exe_path = std::env::current_exe().expect("Cannot get exe path");

    let service_info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe_path,
        launch_arguments: vec![OsString::from("service")],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    };

    match manager.create_service(&service_info, ServiceAccess::CHANGE_CONFIG) {
        Ok(service) => {
            service.set_description(DESCRIPTION).ok();
            println!("[OK] Service '{}' installed.", SERVICE_NAME);
        }
        Err(e) => eprintln!("[FAIL] Install: {}", e),
    }
}

fn cmd_uninstall() {
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT,
    ).expect("Failed to open service manager (run as Administrator)");

    match manager.open_service(SERVICE_NAME, ServiceAccess::DELETE) {
        Ok(service) => {
            service.delete().expect("Delete failed");
            println!("[OK] Service '{}' uninstalled.", SERVICE_NAME);
        }
        Err(e) => eprintln!("[FAIL] Uninstall: {}", e),
    }
}

fn cmd_start() {
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT,
    ).expect("Failed to open service manager");

    match manager.open_service(SERVICE_NAME, ServiceAccess::START) {
        Ok(service) => {
            service.start(&[] as &[OsString]).expect("Start failed");
            println!("[OK] Service '{}' started.", SERVICE_NAME);
        }
        Err(e) => eprintln!("[FAIL] Start: {}", e),
    }
}

fn cmd_stop() {
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT,
    ).expect("Failed to open service manager");

    match manager.open_service(SERVICE_NAME, ServiceAccess::STOP) {
        Ok(service) => {
            service.stop().expect("Stop failed");
            println!("[OK] Service '{}' stopped.", SERVICE_NAME);
        }
        Err(e) => eprintln!("[FAIL] Stop: {}", e),
    }
}
