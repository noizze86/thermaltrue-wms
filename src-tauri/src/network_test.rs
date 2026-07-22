use chrono::Local;
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use serde::Serialize;

// ── Shared state ──────────────────────────────────────────────────────────

static LISTENER_ACTIVE: AtomicBool = AtomicBool::new(false);
static LISTENER_PORT: Mutex<u16> = Mutex::new(0);
static LOG: OnceLock<Mutex<Vec<TestLogEntry>>> = OnceLock::new();
static DEVICES: OnceLock<Mutex<HashMap<String, DeviceEntry>>> = OnceLock::new();

fn get_log() -> &'static Mutex<Vec<TestLogEntry>> {
    LOG.get_or_init(|| Mutex::new(Vec::new()))
}

fn get_devices() -> &'static Mutex<HashMap<String, DeviceEntry>> {
    DEVICES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn log(action: &str, detail: &str, success: bool) {
    let entry = TestLogEntry {
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
        action: action.to_string(),
        detail: detail.to_string(),
        success,
    };
    get_log().lock().unwrap().push(entry);
}

// ── Types ─────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestLogEntry {
    pub timestamp: String,
    pub action: String,
    pub detail: String,
    pub success: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub device_ip: String,
    pub latency_ms: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub responses: Vec<PingResponse>,
    pub total_devices: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEntry {
    pub ip: String,
    pub last_seen_ms: u64,
    pub latency_ms: Option<u64>,
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn get_local_ip_inner() -> Option<String> {
    if_addrs::get_if_addrs().ok().and_then(|ifs| {
        ifs.into_iter()
            .find(|iface| {
                if iface.is_loopback() {
                    return false;
                }
                matches!(iface.addr, if_addrs::IfAddr::V4(_))
            })
            .map(|iface| iface.ip().to_string())
    })
}

fn get_broadcast_addr() -> Option<String> {
    if_addrs::get_if_addrs().ok().and_then(|ifs| {
        ifs.into_iter().find_map(|iface| {
            if iface.is_loopback() {
                return None;
            }
            if let if_addrs::IfAddr::V4(addr) = iface.addr {
                let ip = addr.ip.octets();
                let mask = addr.netmask.octets();
                let bcast = [
                    ip[0] | !mask[0],
                    ip[1] | !mask[1],
                    ip[2] | !mask[2],
                    ip[3] | !mask[3],
                ];
                Some(format!("{}.{}.{}.{}", bcast[0], bcast[1], bcast[2], bcast[3]))
            } else {
                None
            }
        })
    })
}

fn update_device(ip: &str, latency: Option<u64>) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let mut devices = get_devices().lock().unwrap();
    devices.insert(
        ip.to_string(),
        DeviceEntry {
            ip: ip.to_string(),
            last_seen_ms: now,
            latency_ms: latency,
        },
    );
}

fn remove_old_devices(max_age_ms: u64) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let mut devices = get_devices().lock().unwrap();
    devices.retain(|_, entry| now - entry.last_seen_ms < max_age_ms);
}

// ── Tauri Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_local_ip() -> String {
    get_local_ip_inner().unwrap_or_else(|| "Not found".to_string())
}

#[tauri::command]
pub fn get_listener_status() -> bool {
    LISTENER_ACTIVE.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn get_listener_port() -> u16 {
    *LISTENER_PORT.lock().unwrap()
}

#[tauri::command]
pub async fn send_ping(
    app: AppHandle,
    port: u16,
    timeout_ms: u64,
) -> PingResult {
    let timeout_ms = timeout_ms.max(500).min(10000);
    let local_ip = get_local_ip_inner().unwrap_or_default();
    let broadcast = get_broadcast_addr().unwrap_or_else(|| "255.255.255.255".to_string());

    let result = tokio::task::spawn_blocking(move || {
        let socket = match UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(_) => {
                return PingResult {
                    responses: vec![],
                    total_devices: 0,
                };
            }
        };
        let _ = socket.set_broadcast(true);
        let _ = socket.set_read_timeout(Some(Duration::from_millis(timeout_ms.min(1000))));

        let target = format!("{}:{}", broadcast, port);
        let start = Instant::now();
        let deadline = start + Duration::from_millis(timeout_ms);

        let _ = socket.send_to(b"ping", &target);

        let mut responses = Vec::new();
        let mut buf = [0u8; 1024];

        while Instant::now() < deadline {
            match socket.recv_from(&mut buf) {
                Ok((size, src)) => {
                    let msg = String::from_utf8_lossy(&buf[..size]).trim().to_string();
                    let src_ip = src.ip().to_string();
                    if msg == "pong" {
                        let elapsed = start.elapsed().as_millis() as u64;
                        if src_ip == local_ip {
                            continue;
                        }
                        let exists = responses.iter().any(|r: &PingResponse| r.device_ip == src_ip);
                        if !exists {
                            responses.push(PingResponse {
                                device_ip: src_ip.clone(),
                                latency_ms: elapsed,
                                success: true,
                                error: None,
                            });
                            update_device(&src_ip, Some(elapsed));
                        }
                    }
                }
                Err(_) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    let _ = socket.set_read_timeout(Some(Duration::from_millis(
                        deadline.saturating_duration_since(Instant::now()).as_millis().max(100) as u64,
                    )));
                }
            }
        }

        PingResult {
            total_devices: responses.len(),
            responses,
        }
    })
    .await
    .unwrap_or_else(|_| PingResult {
        responses: vec![],
        total_devices: 0,
    });

    // Log results
    if result.responses.is_empty() {
        log("send_ping", &format!("No responses from port {} (timeout: {}ms)", port, timeout_ms), false);
    } else {
        let ips: Vec<&str> = result.responses.iter().map(|r| r.device_ip.as_str()).collect();
        log(
            "send_ping",
            &format!("Found {} device(s): {} (port {}, timeout: {}ms)", result.total_devices, ips.join(", "), port, timeout_ms),
            true,
        );
    }

    // Emit results event
    let _ = app.emit("pong-results", &result);

    result
}

#[tauri::command]
pub fn start_udp_listener(app: AppHandle, port: u16) -> Result<(), String> {
    if LISTENER_ACTIVE.load(Ordering::SeqCst) {
        return Err("Listener is already running".to_string());
    }

    let socket = UdpSocket::bind(format!("0.0.0.0:{}", port))
        .map_err(|e| format!("Failed to bind to port {}: {}", port, e))?;
    let _ = socket.set_read_timeout(Some(Duration::from_secs(1)));

    LISTENER_ACTIVE.store(true, Ordering::SeqCst);
    *LISTENER_PORT.lock().unwrap() = port;

    log("listener_start", &format!("Started UDP listener on port {}", port), true);

    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        while LISTENER_ACTIVE.load(Ordering::SeqCst) {
            match socket.recv_from(&mut buf) {
                Ok((size, src)) => {
                    let msg = String::from_utf8_lossy(&buf[..size]).trim().to_string();
                    if msg == "ping" {
                        let _ = socket.send_to(b"pong", src);
                        let src_ip = src.ip().to_string();
                        update_device(&src_ip, None);
                        log(
                            "receive_ping",
                            &format!("Ping from {}, responded with pong", src_ip),
                            true,
                        );
                        let _ = app.emit("ping-received", serde_json::json!({
                            "deviceIp": src_ip,
                        }));
                    } else if msg == "pong" {
                        let src_ip = src.ip().to_string();
                        update_device(&src_ip, None);
                        log(
                            "receive_pong",
                            &format!("Unsolicited pong from {}", src_ip),
                            true,
                        );
                    }
                }
                Err(_) => {}
            }
        }
        log("listener_stop", "UDP listener stopped", true);
    });

    Ok(())
}

#[tauri::command]
pub fn stop_udp_listener() -> Result<(), String> {
    if !LISTENER_ACTIVE.load(Ordering::SeqCst) {
        return Err("Listener is not running".to_string());
    }
    LISTENER_ACTIVE.store(false, Ordering::SeqCst);
    let port = *LISTENER_PORT.lock().unwrap();
    log("listener_stop", &format!("Stopped UDP listener on port {}", port), true);

    // Send a dummy packet to unblock the recv_from loop
    if let Ok(s) = UdpSocket::bind("0.0.0.0:0") {
        let _ = s.send_to(b"stop", format!("127.0.0.1:{}", port));
    }

    Ok(())
}

#[tauri::command]
pub fn get_discovered_devices() -> Vec<DeviceEntry> {
    remove_old_devices(300_000);
    let devices = get_devices().lock().unwrap();
    let mut list: Vec<DeviceEntry> = devices.values().cloned().collect();
    list.sort_by(|a, b| a.ip.cmp(&b.ip));
    list
}

#[tauri::command]
pub fn clear_discovered_devices() -> Result<(), String> {
    get_devices().lock().unwrap().clear();
    log("devices_clear", "Discovered devices list cleared", true);
    Ok(())
}

#[tauri::command]
pub fn get_test_log(limit: usize) -> Vec<TestLogEntry> {
    let log = get_log().lock().unwrap();
    let limit = limit.min(log.len());
    log.iter().rev().take(limit).cloned().collect()
}

#[tauri::command]
pub fn clear_test_log() -> Result<(), String> {
    get_log().lock().unwrap().clear();
    Ok(())
}

#[tauri::command]
pub fn export_test_log_csv() -> String {
    let log = get_log().lock().unwrap();
    let mut csv = String::from("Timestamp,Action,Detail,Success\n");
    for entry in log.iter() {
        let detail_safe = entry.detail.replace('"', "\"\"");
        csv.push_str(&format!(
            "{},{},\"{}\",{}\n",
            entry.timestamp,
            entry.action,
            detail_safe,
            if entry.success { "OK" } else { "FAIL" }
        ));
    }
    csv
}
