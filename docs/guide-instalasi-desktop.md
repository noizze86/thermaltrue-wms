# Panduan Instalasi Desktop Client — Thermaltrue WMS v1.0.4

Panduan ini menjelaskan **instalasi aplikasi Desktop** (`Thermaltrue`) untuk Windows menggunakan installer **MSI** atau **NSIS**.

Aplikasi Desktop adalah jendela WebView2 yang menampilkan web UI WMS. **Aplikasi tidak berisi database atau server** — ia harus terhubung ke **Thermaltrue Server** (lihat `docs/guide-instalasi-server.md`).

> Installer gabungan **`Thermaltrue-Setup-1.0.4.exe`** (Full = server + database + Desktop, atau opsi **Client** = hanya Desktop) dijelaskan di `docs/guide-instalasi-server.md`.

---

## 1. Persyaratan Sistem

| Komponen | Minimal | Rekomendasi |
|----------|---------|-------------|
| OS | Windows 10 64-bit (build 19044+/20H2+) | Windows 11 64-bit |
| Arsitektur | x64 | x64 |
| RAM | 4 GB | 8 GB |
| Storage | 500 MB free | 1 GB SSD |
| WebView2 Runtime | Windows 11: built-in; Windows 10: install manual (lihat §1.1) | — |
| Server | **Wajib ada** Thermaltrue Server yang bisa diakses (local atau LAN) | Server produksi di jaringan |

Aplikasi berkomunikasi dengan server melalui HTTP — tidak perlu PostgreSQL, `.env`, maupun port database di komputer client.

### 1.1. WebView2 Runtime (Windows 10)

Windows 11 sudah menyertakan WebView2. Untuk Windows 10, unduh **Evergreen Runtime**:

- https://developer.microsoft.com/en-us/microsoft-edge/webview2/

Install sekali; semua aplikasi WebView2 (termasuk Thermaltrue) akan memakainya.

---

## 2. Unduh Installer

Rilis: **https://github.com/noizze86/thermaltrue-wms/releases** → pilih **v1.0.4**

| File | Ukuran | Keterangan |
|------|--------|------------|
| `Thermaltrue_1.0.4_x64-setup.exe` | ± 8.8 MB | NSIS — per-user, tanpa admin |
| `Thermaltrue_1.0.4_x64_en-US.msi` | ± 13 MB | MSI — untuk deployment (SCCM/Intune) |

---

## 3. Instalasi

### 3.1. NSIS (setup.exe)

1. Jalankan `Thermaltrue_1.0.4_x64-setup.exe`
2. Pilih lokasi install (default sesuai pengguna)
3. Klik **Install** → **Finish**
4. Shortcut muncul di Desktop & Start Menu

### 3.2. MSI

1. Jalankan `Thermaltrue_1.0.4_x64_en-US.msi` (butuh hak admin)
2. Ikuti wizard → **Install**
3. Selesai, aplikasi di **Start Menu → Thermaltrue**

Kedua installer memakai **update checker otomatis** (lihat §6).

---

## 4. Menjalankan & Menghubungkan ke Server

### 4.1. Bagaimana Client Menemukan Server

Client bersifat **universal** — MSI client **tidak perlu di-build ulang untuk tiap jaringan/perusahaan**. Jendela app membuka **Connect Page bawaan** (`tauri://localhost`, dari `dist-client-stub`), lalu otomatis menemukan server:

| # | Mekanisme | Keterangan |
|---|-----------|------------|
| 1 | **Startup Rust** (`ensure_server_running`): `localhost:3000` → `127.0.0.1:3000` → **LAN subnet scan `/24`** (batch 32, prioritas IP sendiri/gateway) | Men-navigasi window ke server yang ditemukan di subnet manapun — client **sembuh sendiri** walau IP server/IP client berubah (DHCP/hotspot) |
| 2 | **Connect Page** (stub `dist-client-stub`): auto-scan `get_detected_api_url` + form **Test & Connect** (`check_server_url`) + tombol **Scan Otomatis** | Muncul hanya bila scan tidak menemukan server (mis. subnet berbeda/VLAN); URL sukses disimpan ke `wms_api_url` (localStorage) untuk koneksi cepat berikutnya |
| 3 | **Cache alamat sukses** (`wms_api_url_cache`, TTL 24 jam, maks. 5) | Client yang pernah connect tersambung cepat saat restart tanpa scan |
| 4 | **Set manual** di UI: **Settings → API Settings → Server URL** | Alternatif untuk server di subnet berbeda/VPN |

> Karena client universal, **IP server boleh berubah kapan pun** (ganti komputer, pindah subnet, DHCP) — client hanya butuh satu syarat: **sekali akses ke subnet yang sama** (otomatis via scan) atau sekali isi URL di Connect Page. Tidak ada lagi rebuild MSI per jaringan.

### 4.2. Alur Koneksi (ringkas)

1. Installer memasang MSI client (`Thermaltrue_1.0.1_x64_en-US.msi`) — tanpa `server.exe`.
2. App start → Rust cek `localhost`/`127.0.0.1` → **subnet scan `/24`** → navigasi ke server yang ditemukan.
3. Bila tidak ditemukan → **Connect Page** tampil (auto-scan ulang + form URL manual).
4. Optional: bake URL patrian ketika IP server **diketahui & statis** → `build-client.ps1 -ServerUrl http://IP_SERVER:3000` (lihat §8.5) — mempercepat koneksi awal, tetap tidak mengunci bila IP berubah.

### 4.3. Set Manual Alamat Server

1. Cek alamat server: browser ke `http://IP_SERVER:3000` (web UI) dari PC lain
2. Di aplikasi: **Settings → API Settings → Server URL**
3. Isi `http://IP_SERVER:3000` (contoh: `http://192.168.1.100:3000`)
4. Simpan → aplikasi mengarah ke server itu

---

## 5. Login

Kredensial dikelola **oleh server**, sama seperti login via browser:

| Field | Nilai |
|-------|-------|
| Username | sesuai akun yang dibuat di server (default: `admin`) |
| Password | password akun (lihat dokumen server — §5 Login Pertama) |

> Password default admin di-generate saat instalasi server (acak `AdminXXXXXXXX`) atau via `DEFAULT_ADMIN_PASSWORD` di `.env` server. Ganti password setelah login pertama: **Settings → My Profile → Change Password**.

---

## 6. Update Aplikasi

Aplikasi terhubung ke **updater** (endpoint GitHub `update.json` di rilis v1.0.4):

- Saat versi baru dirilis, muncul notifikasi di dalam aplikasi
- Klik **Update** → unduh & pasang versi baru, data (cache) tetap

Update manual: unduh installer terbaru dari halaman rilis → jalankan di atas instalasi lama. Data tidak hilang.

---

## 7. Uninstall

- **Windows Settings → Apps → Installed apps → Thermaltrue** → *Uninstall*
- Sisa data lokal (cache, dll) dapat dihapus:

```powershell
Remove-Item "$env:APPDATA\com.thermaltrue.wms" -Recurse -Force -ErrorAction SilentlyContinue
```

Uninstall aplikasi Desktop **tidak** menyentuh server/database.

---

## 8. Troubleshooting

### 8.1. Jendela kosong / "Connection refused"

**Runbook diagnostik (jalankan di SERVER):**

```powershell
sc query ThermaltrueServer          # STATE: 4 RUNNING?
netstat -ano | findstr :3000        # harus ada 0.0.0.0:3000 LISTENING
ipconfig                            # catat IPv4 LAN server (mis. 192.168.43.247)
netsh advfirewall firewall show rule name=all | findstr /i "3000 Thermaltrue"
```

**Di CLIENT:**

```powershell
Test-NetConnection <IP_SERVER> -Port 3000   # TcpTestSucceeded: True?
Test-NetConnection 127.0.0.1 -Port 3000     # False = normal di client
```

**Log:** `%TEMP%\thermaltrue.log` + `startup.log` di samping `app.exe` — cari `FOUND at http://...` (subnet scan) / `target URL =`.

**Perbaikan cepat:**
- Server tidak di PC yang sama → restart app (auto-scan subnet) atau set alamat di Connect Page / Settings → API Settings (jangan pakai `localhost`)
- IP server berubah/hotspot/DHCP → **tidak perlu build ulang** — subnet scan + Connect Page menyesuaikan otomatis
- Firewall server harus mengizinkan port API (rule `Thermaltrue WMS (port 3000)` dibuat otomatis saat install server — verifikasi `netsh show rule` di atas)
- Subnet scan hanya menjangkau subnet yang sama; server di subnet/VPN → **Connect Page** (isi URL sekali) atau set manual

### 8.2. "WebView2 not found"

Windows 10: install Evergreen Runtime WebView2 (lihat §1.1).

### 8.3. Koneksi sering putus di jaringan besar

- Pastikan IP server **statis** (jangan DHCP berubah-ubah)
- Set manual alamat server di API Settings agar tidak berganti-ganti
- Hindari jaringan dengan proxy ketat — gunakan VPN

### 8.4. Update tidak jalan

- File `update.json` baca dari GitHub — butuh akses internet ke `github.com`
- Enterprise yang blokir GitHub: unduh installer terbaru secara manual

### 8.5. Rebuild Client MSI (opsional — hanya untuk IP statis)

MSI default bersifat **universal** (auto-discover), jadi rebuild hanya dilakukan bila IP server **diketahui & statis** dan ingin koneksi awal lebih cepat:

```powershell
.\scripts\build-client.ps1 -ServerUrl http://192.168.1.100:3000
# tanpa argumen        -> universal: Connect Page "tauri://localhost" (default)
# dengan -ServerUrl    -> baked URL server (pintasan cepat; scan tetap jadi fallback)
```

Menghasilkan `target\release\bundle\msi\Thermaltrue_1.0.1_x64_en-US.msi`. Setelah itu rebuild installer gabungan:

```powershell
.\installer\build-installer.ps1   # bundel MSI client + server.exe + dist
.\deploy.ps1                      # admin; deploy server + dist, UAC muncul
```

> Selaras: `installer\thermaltrue-server.iss` dan `installer\build-installer.ps1` mereferensikan MSI client **versi 1.0.1** — jangan dinaikkan tanpa mengubah keduanya.

---

## 9. Keamanan

- Aplikasi client menyimpan **alamat** server di lokal (bukan password) — aman
- Login & token disimpan di cookie server (`httpOnly`)
- Jangan jalankan aplikasi dari PC publik tanpa konsekuensi — patuhi kebijakan jaringan
- Bila akses remote: gunakan TLS / reverse proxy di sisi server (lihat dokumen server §9)

---

## 10. Referensi

| Item | Nilai |
|------|-------|
| Download | GitHub Releases v1.0.4 (`.exe` / `.msi`) |
| Server | docs `guide-instalasi-server.md` |
| Client MSI terkini | `Thermaltrue_1.0.1_x64_en-US.msi` — **universal** (Connect Page `tauri://localhost` + auto-discover scan) — di-bundel ke installer gabungan |
| Default URL | Connect Page universal (`tauri://localhost`) + auto-discover (localhost → scan /24) |
| Cache alamat | `wms_api_url_cache` (TTL 24 jam, maks. 5 alamat) |
| Update | auto-check `update.json` (GitHub) |
| Data lokal | `%APPDATA%\com.thermaltrue.wms` |
| Browser alternatif | `http://IP_SERVER:3000` |

---

_© 2026 Thermaltrue — update terakhir: v1.0.4._