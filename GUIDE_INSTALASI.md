# Panduan Instalasi Thermaltrue WMS v1.0.0

## Daftar Isi

1. [Prasyarat](#1-prasyarat)
2. [Setup Database PostgreSQL](#2-setup-database-postgresql)
3. [Build & Install Server API](#3-build--install-server-api)
4. [Akses Aplikasi via Browser](#4-akses-aplikasi-via-browser)
5. [Build MSI Installer (Desktop App)](#5-build-msi-installer-desktop-app)
6. [Instalasi MSI di Komputer Client](#6-instalasi-msi-di-komputer-client)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Prasyarat

### Spesifikasi Minimum Server

| Komponen | Minimal | Rekomendasi |
|----------|---------|-------------|
| OS | Windows 10 / Server 2019+ | Windows 11 / Server 2022+ |
| CPU | 2 core | 4 core |
| RAM | 4 GB | 8 GB |
| Storage | 10 GB free | SSD 50 GB+ |
| PostgreSQL | 14+ | 16+ |

### Software yang Harus Diinstal

**Untuk Build dari Source Code:**

- [Rust](https://rustup.rs/) — `rustup-init.exe`, pilih `default` (stable)
- [Node.js 22+](https://nodejs.org/) — LTS version
- [Git](https://git-scm.com/) — opsional, untuk clone repo
- **Visual Studio Build Tools** — untuk compile Rust:

  ```
  https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
  ```

  Install **"Desktop development with C++"** workload

**Untuk Runtime (client komputer):**

- [PostgreSQL 16](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) — pilih `EDB Installer`
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) — sudah bawaan Windows 11

### Cek Instalasi

Jalankan di PowerShell:

```powershell
rustc --version
node --version
npm --version
git --version
psql --version
```

---

## 2. Setup Database PostgreSQL

### Opsi A: Pakai Docker (Rekomendasi)

```powershell
cd C:\
git clone https://github.com/thermaltrue/wms.git
cd wms

# Start PostgreSQL via Docker Compose
docker compose up -d

# Verifikasi
docker ps
```

### Opsi B: Instalasi PostgreSQL Native

1. Jalankan installer PostgreSQL 16 (dari EnterpriseDB)
2. Set password user `postgres` (catat baik-baik)
3. Port: `5432` (default)
4. Buka **SQL Shell (psql)** atau **pgAdmin**, jalankan:

```sql
CREATE DATABASE thermaltrue;
```

### Opsi C: Pakai PostgreSQL yang Sudah Ada

Cek koneksi:

```powershell
psql -U postgres -d thermaltrue -c "SELECT 1"
```

---

## 3. Build & Install Server API

### 3.1 Clone / Buka Source Code

```powershell
cd C:\test wms\thermaltrue
```

### 3.2 Konfigurasi Environment

```powershell
# copy dari template
copy .env.example .env

# Edit .env — isi password PostgreSQL Anda
```

Isi file `.env` minimal:

```ini
DATABASE_URL=postgresql://postgres:password@localhost:5432/thermaltrue?sslmode=disable
JWT_SECRET=GantiDenganStringAcak64Karakter1234567890abcdefghijklmn
PORT=3000
CORS_ORIGIN=
RUST_LOG=info
```

### 3.3 Build Frontend

```powershell
npm install
npm run build
```

Hasil: folder `dist/` — berisi file HTML, JS, CSS.

### 3.4 Build Server Binary

```powershell
cargo build -p server --release
```

Duration: ~10-15 menit (tergantung spesifikasi).

Hasil: `target\release\server.exe` (± 20 MB)

### 3.5 Deploy ke Direktori Instalasi

```powershell
# Buat folder tujuan
mkdir "C:\Program Files\Thermaltrue" -Force
mkdir "C:\Program Files\Thermaltrue\dist" -Force

# Copy binary
copy "target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"

# Copy environment
copy .env "C:\Program Files\Thermaltrue\.env"

# Copy frontend
xcopy /E /I /Y dist "C:\Program Files\Thermaltrue\dist"
```

### 3.6 Install & Start Windows Service

Buka **PowerShell sebagai Administrator**, lalu:

```powershell
cd "C:\Program Files\Thermaltrue"

# Install service
.\server.exe install

# Start service
.\server.exe start

# Cek status
.\server.exe status
```

Expected output:

```
Installing service...
Starting service...
Status: running
```

### 3.7 Verifikasi

```powershell
# Cek log
Get-Content "$env:ProgramData\Thermaltrue\logs\server.log" -Tail 20

# Test API
curl http://localhost:3000/api/health
```

Response:

```json
{"status":"ok"}
```

### Manajemen Service

```powershell
# Stop
.\server.exe stop

# Restart
.\server.exe restart

# Uninstall
.\server.exe stop
.\server.exe uninstall

# Cek status
.\server.exe status
```

---

## 4. Akses Aplikasi via Browser

Buka browser di **komputer mana pun dalam 1 jaringan LAN**:

```
http://<IP_SERVER>:3000
```

Contoh: `http://192.168.1.100:3000`

### Login Default

- **Username:** `admin`
- **Password:** Lihat log server saat pertama kali jalan:

  ```powershell
  Get-Content "$env:ProgramData\Thermaltrue\logs\server.log" | Select-String "password"
  ```

  Akan muncul: `DEFAULT ADMIN PASSWORD: xxxxxxxx`

- Atau jika sudah diset via `.env` dengan `DEFAULT_ADMIN_PASSWORD`, gunakan password tersebut.

### Konfigurasi Multi-Client

Satu server bisa melayani banyak client browser. Tidak perlu install apa-apa di client selain browser.

---

## 5. Build MSI Installer (Desktop App)

> **Catatan:** MSI hanya perlu di-build **sekali** di komputer server, lalu hasilnya didistribusikan ke komputer client.

### 5.1 Prasyarat MSI Build

- **Tauri CLI**: sudah include di `package.json`
- **WebView2**: sudah bawaan Windows 11 / Windows 10 update terbaru
- **NSIS** (opsional): untuk alternatif installer selain MSI

### 5.2 Build MSI/NSIS

```powershell
cd C:\test wms\thermaltrue

# Build MSI + NSIS
npx tauri build --bundles msi,nsis
```

Duration: ~20-30 menit.

### 5.3 Output Build

```
target/release/bundle/
├── msi/
│   └── Thermaltrue_WMS_1.0.0_x64_en-US.msi   ← MSI Installer
└── nsis/
    └── Thermaltrue_WMS_1.0.0_x64-setup.exe    ← NSIS Installer
```

### 5.4 File Update JSON (Auto-Updater)

File `update.json` di-generate otomatis oleh GitHub Actions saat release.

Untuk build manual:

```json
{
  "version": "1.0.0",
  "notes": "Rilis pertama Thermaltrue WMS",
  "pub_date": "2026-07-19T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "",
      "url": "https://github.com/thermaltrue/wms/releases/download/v1.0.0/Thermaltrue_WMS_1.0.0_x64_en-US.msi"
    }
  }
}
```

---

## 6. Instalasi MSI di Komputer Client

### Metode A: Manual (Double-click)

1. Copy file `.msi` ke komputer client (via USB / network share)
2. Double-click `Thermaltrue_WMS_1.0.0_x64_en-US.msi`
3. Ikuti wizard instalasi:
   - **Destination Folder:** `C:\Program Files\Thermaltrue Client\` (default)
   - Setujui license
4. Klik **Install**
5. Selesai — shortcut akan muncul di **Start Menu** dan **Desktop**

### Metode B: Silent Install (untuk deployment massal via GPO/PDQ)

```powershell
msiexec /i "Thermaltrue_WMS_1.0.0_x64_en-US.msi" /qn /norestart
```

### 6.1 Konfigurasi Client

1. Buka aplikasi **Thermaltrue WMS** dari Start Menu
2. Di halaman login, klik **Settings** (icon gear)
3. Isi **Server URL**: `http://<IP_SERVER>:3000`
4. Klik **Save**, kembali ke login
5. Login dengan akun yang sudah dibuat di server

### 6.2 Cara Client Mengetahui IP Server

Di komputer server, jalankan:

```powershell
ipconfig | Select-String "IPv4"
```

Gunakan alamat IPv4 tersebut (contoh: `192.168.1.100`).

---

## 7. Troubleshooting

### Service Gagal Start

```powershell
# Cek log error
Get-Content "$env:ProgramData\Thermaltrue\logs\server.log" -Tail 50

# Pastikan PostgreSQL running
Get-Service postgresql* | Format-Table Name,Status

# Test koneksi DB manual
psql -U postgres -d thermaltrue -c "SELECT 1"
```

### MSI Build Gagal

```powershell
# Hapus cache build
rm -r "src-tauri\target" -Force

# Pastikan Rust toolchain update
rustup update

# Coba build ulang
npx tauri build --bundles msi
```

### Update dari Versi Lama

```powershell
# Stop service
cd "C:\Program Files\Thermaltrue"
.\server.exe stop

# Backup database
pg_dump -U postgres thermaltrue > backup_$(Get-Date -Format yyyyMMdd).sql

# Replace binary
copy /Y "C:\path\to\new\server.exe" ".\server.exe"

# Start service
.\server.exe start
```

### Reset Password Admin

```powershell
psql -U postgres -d thermaltrue -c "UPDATE users SET password_hash='' WHERE username='admin'"
# Restart service — akan generate password baru di log
```

---

## Diagram Arsitektur Deployment

```
┌─────────────────────────────────────────────────────┐
│                  SERVER (Windows)                    │
│                                                      │
│  ┌──────────────┐    ┌─────────────────────────┐    │
│  │  PostgreSQL   │◄───│    server.exe           │    │
│  │  (port 5432)  │    │  Windows Service        │    │
│  │              │    │  (port 3000)             │    │
│  └──────────────┘    └──────────┬──────────────┘    │
│                                 │                    │
│                     ┌───────────┴───────────┐       │
│                     │   dist/ (frontend)     │       │
│                     │   HTML/CSS/JS          │       │
│                     └───────────────────────┘       │
└──────────────────────┬──────────────────────────────┘
                       │ LAN / HTTP
         ┌─────────────┼─────────────┐
         │             │             │
┌────────▼──┐  ┌───────▼─────┐  ┌───▼────────┐
│ Browser    │  │ Tauri App  │  │ Browser    │
│ (PC 1)     │  │ (PC 2)     │  │ (PC 3)     │
│ http://    │  │ MSI        │  │ http://    │
│ server:3000│  │ Installer  │  │ server:3000│
└────────────┘  └────────────┘  └────────────┘
```
