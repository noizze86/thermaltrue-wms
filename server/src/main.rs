use std::ffi::OsString;
use std::time::Duration;
use std::io::Write;
use rand::RngCore;
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
        "status"    => cmd_status(),
        "service"   => {
            env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
                .format_timestamp_millis()
                .init();
            log_panics::init();
            service_dispatcher::start(SERVICE_NAME, ffi_service_main)
                .expect("Failed to start service dispatcher");
        }
        "run"       => cmd_run().await,
        _           => println!("Usage: server.exe [install|uninstall|start|stop|status|run]"),
    }
}

// ── Service main (runs on background thread) ─────────────────────────────

fn service_main(_arguments: Vec<OsString>) {
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

// ── Auto-backup scheduler ───────────────────────────────────────────────

fn spawn_backup_scheduler() {
    let backup_dir = std::env::var("BACKUP_DIR").unwrap_or_else(|_| "backups".into());
    let backup_interval_secs: u64 = std::env::var("BACKUP_INTERVAL_HOURS").ok()
        .and_then(|h| h.parse::<u64>().ok())
        .unwrap_or(24)
        * 3600;
    std::fs::create_dir_all(&backup_dir).ok();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(backup_interval_secs)).await;
            log::info!("Starting scheduled database backup...");
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let filename = format!("{}/backup-{}.sql", backup_dir, ts);
            let db_url = get_database_url();
            match tokio::process::Command::new("pg_dump")
                .args(["--clean", "--if-exists", "--no-owner", "--dbname", &db_url, "--file", &filename])
                .output().await
            {
                Ok(out) if out.status.success() => {
                    log::info!("Backup completed: {} ({} bytes)", filename, out.stdout.len());
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    log::error!("Backup failed (exit={}): {}", out.status, stderr);
                }
                Err(e) => log::error!("Backup spawn failed: {}", e),
            }
            if let Ok(mut entries) = tokio::fs::read_dir(&backup_dir).await {
                let mut files: Vec<_> = vec![];
                while let Ok(Some(e)) = entries.next_entry().await {
                    files.push(e.path());
                }
                files.sort();
                while files.len() > 30 {
                    if let Some(old) = files.first().cloned() {
                        let _ = tokio::fs::remove_file(old).await;
                        files.remove(0);
                    }
                }
            }
        }
    });
}

// ── Shared helpers ───────────────────────────────────────────────────────

fn get_database_url() -> String {
    std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable".into()
    })
}

fn ensure_jwt_secret() {
    if std::env::var("JWT_SECRET").is_err() {
        let mut buf = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut buf);
        let secret = hex::encode(buf);
        std::env::set_var("JWT_SECRET", &secret);
        if let Ok(mut f) = std::fs::OpenOptions::new().append(true).create(true).open(".env") {
            writeln!(f, "JWT_SECRET={}", secret).ok();
        }
        log::info!("Auto-generated JWT_SECRET and saved to .env");
    }
}

fn ensure_env() {
    let _ = dotenvy::dotenv();
    ensure_jwt_secret();
}

fn is_production() -> bool {
    let mode = std::env::var("APP_MODE")
        .or_else(|_| std::env::var("NODE_ENV"))
        .unwrap_or_default();
    mode.eq_ignore_ascii_case("production")
}

fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:53").ok()?;
    let local = socket.local_addr().ok()?;
    Some(local.ip().to_string())
}



async fn init_db() -> DbPool {
    ensure_env();
    let url = get_database_url();
    log::info!("Connecting to database...");
    DbPool::new(&url).await.unwrap_or_else(|e| {
        log::error!("Cannot connect to database: {}", e);
        std::process::exit(1);
    })
}

async fn serve(pool: DbPool) {
    spawn_backup_scheduler();
    let app = create_router(pool);

    let prod = is_production();
    let host = if prod { "0.0.0.0" } else { "127.0.0.1" };
    let port = std::env::var("PORT").unwrap_or_else(|_| if prod { "8000" } else { "3000" }.into());
    let addr = format!("{}:{}", host, port);

    log::info!("┌─────────────────────────────────────┐");
    log::info!("│ Thermaltrue WMS API Server          │");
    log::info!("│ Mode:    {}", format_args!("{:<28}", if prod { "PRODUCTION" } else { "DEVELOPMENT" }));
    log::info!("│ Bind:    {:<28}", addr);
    if prod {
        if let Some(local) = get_local_ip() {
            log::info!("│ Access:  http://{}:{:<21}", local, port);
        }
    }
    log::info!("└─────────────────────────────────────┘");

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

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
    match std::process::Command::new("netsh")
        .args(["advfirewall", "firewall", "add", "rule",
            &format!("name=Tthermaltrue WMS (port {})", port),
            "dir=in", "action=allow", "protocol=TCP",
            &format!("localport={}", port)])
        .output()
    {
        Ok(o) if o.status.success() => println!("[OK] Firewall rule added for port {}", port),
        _ => eprintln!("[WARN] Could not add firewall rule. Run as Administrator or add manually:\n  netsh advfirewall firewall add rule name=\"Thermaltrue WMS\" dir=in action=allow protocol=TCP localport={}", port),
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

fn cmd_status() {
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT,
    ).expect("Failed to open service manager (run as Administrator)");

    match manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS) {
        Ok(service) => {
            match service.query_status() {
                Ok(status) => {
                    let state = match status.current_state {
                        ServiceState::Running => "Running",
                        ServiceState::Stopped => "Stopped",
                        ServiceState::StartPending => "Start Pending",
                        ServiceState::StopPending => "Stop Pending",
                        _ => "Unknown",
                    };
                    println!("[OK] Service '{}' is {}", SERVICE_NAME, state);
                }
                Err(e) => eprintln!("[FAIL] Could not query status: {}", e),
            }
        }
        Err(_) => println!("[INFO] Service '{}' is not installed.", SERVICE_NAME),
    }
}
