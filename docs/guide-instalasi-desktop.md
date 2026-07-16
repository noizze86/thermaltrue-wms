# Panduan Instalasi Thermaltrue WMS — Desktop App (MSI/NSIS)

Panduan ini untuk instalasi **Desktop App** (`app.exe`) menggunakan installer MSI atau NSIS. Aplikasi berjalan sebagai aplikasi desktop Windows dengan WebView2.

---

## 1. Persyaratan Sistem

| Komponen | Minimal | Rekomendasi |
|----------|---------|-------------|
| OS | Windows 10 64-bit | Windows 11 64-bit |
| RAM | 4 GB | 8 GB |
| Storage | 500 MB | 1 GB |
| WebView2 | Windows 11 (built-in) / Microsoft Edge WebView2 Runtime | — |
| Database | PostgreSQL 14+ | PostgreSQL 16 |
| Jaringan | Koneksi ke server database | LAN / VPN |

### 1.1 Install WebView2 Runtime (jika belum ada)

Windows 11 sudah include WebView2 secara default. Untuk Windows 10, unduh dari:
https://developer.microsoft.com/en-us/microsoft-edge/webview2/

Atau install langsung via cmd:

```powershell
# Cek apakah sudah terinstall
Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue

# Jika belum, unduh dari link di atas
```

### 1.2 Install PostgreSQL (jika lokal)

Jika database berjalan di server terpisah, langkah ini tidak perlu dilakukan di client.

1. Download installer dari https://www.postgresql.org/download/windows/
2. Jalankan installer, catat port (`5432`) dan password user `postgres`
3. Buat database:
   ```sql
   CREATE DATABASE thermaltrue;
   ```

---

## 2. Install Aplikasi

### 2.1 Install via MSI

File: `Thermaltrue_0.1.0_x64_en-US.msi` (12.9 MB)

1. **Double klik** file MSI
2. Klik **Next**
3. Pilih folder instalasi (default: `C:\Program Files\Thermaltrue\`)
4. Klik **Install**
5. Tunggu selesai, klik **Finish**
6. Aplikasi muncul di **Start Menu > Thermaltrue WMS**

### 2.2 Install via NSIS

File: `Thermaltrue_0.1.0_x64-setup.exe` (8.5 MB)

1. **Double klik** file setup
2. Pilih bahasa (Indonesia / English)
3. Klik **Next**
4. Pilih folder instalasi (default: `C:\Program Files\Thermaltrue\`)
5. Centang opsi:
   - ✅ Create desktop shortcut
   - ✅ Create Start Menu shortcuts
6. Klik **Install**
7. Klik **Finish**
8. Shortcut muncul di **Desktop** dan **Start Menu**

### 2.3 Struktur Folder Setelah Install

```
C:\Program Files\Thermaltrue\
├── app.exe                     # Aplikasi utama
├── Thermaltrue_0.1.0_x64_en-US.msi
└── resources/
    └── (file pendukung runtime)
```

---

## 3. Konfigurasi Awal

### 3.1 File `.env`

Buat file `.env` di folder yang sama dengan `app.exe`:

```ini
DATABASE_URL=postgresql://postgres:password@localhost:5432/thermaltrue?sslmode=disable
JWT_SECRET=your-random-secret-key-min-32-characters
VITE_FORCE_HTTP=true
```

Jika database di server terpisah:

```ini
DATABASE_URL=postgresql://postgres:password@192.168.1.100:5432/thermaltrue?sslmode=disable
```

> **Catatan:** `VITE_FORCE_HTTP=true` membuat aplikasi menggunakan HTTP mode, artinya semua API call dikirim ke `localhost:3000`. Jika ingin aplikasi berjalan standalone tanpa `server.exe`, set `VITE_FORCE_HTTP=false` atau hapus baris tersebut.

### 3.2 Mode Aplikasi

Aplikasi bisa berjalan dalam 2 mode:

| Mode | VITE_FORCE_HTTP | Butuh server.exe | Koneksi DB |
|------|-----------------|-----------------|------------|
| **HTTP** | `true` | ✅ Ya, via localhost:3000 | Lewat server backend |
| **IPC** | `false` atau tidak ada | ❌ Tidak | Langsung dari app.exe |

---

## 4. Menjalankan Aplikasi

### 4.1 Melalui Start Menu

1. Klik **Start** > cari **Thermaltrue WMS**
2. Klik icon aplikasi
3. Aplikasi akan terbuka sebagai jendela desktop

### 4.2 Login

Halaman login akan muncul. Gunakan kredensial default:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin123` |

> **Penting:** Segera ganti password setelah login pertama.

### 4.3 Jika Menggunakan HTTP Mode (VITE_FORCE_HTTP=true)

Pastikan `server.exe` sudah berjalan sebelum membuka aplikasi:

```powershell
# Di komputer server (bisa server terpisah atau localhost)
cd C:\thermaltrue\server
.\server.exe run
```

Atau install server sebagai Windows Service agar auto-start:

```powershell
# PowerShell sebagai Administrator
.\server.exe install
.\server.exe start
```

---

## 5. Update Aplikasi

### 5.1 Install Versi Baru

1. Download MSI/NSIS versi terbaru
2. **MSI:** Double klik → Next → Upgrade → Selesai
3. **NSIS:** Double klik → Next → Install (otomatis overwrite)

> File `.env` tidak terhapus saat upgrade.

### 5.2 Cek Versi Terinstall

Buka aplikasi, masuk ke **Settings > About** untuk melihat versi saat ini.

Atau cek via file properties:

```powershell
(Get-Item "C:\Program Files\Thermaltrue\app.exe").VersionInfo.ProductVersion
```

---

## 6. Uninstall

### 6.1 Uninstall MSI / NSIS

**Cara 1 — Windows Settings:**

1. Buka **Settings** (Win + I)
2. **Apps > Installed apps**
3. Cari **Thermaltrue WMS**
4. Klik **⋮** > **Uninstall**
5. Konfirmasi

**Cara 2 — Control Panel:**

1. Buka **Control Panel > Programs and Features**
2. Pilih **Thermaltrue WMS**
3. Klik **Uninstall**

### 6.2 Hapus Sisa Folder

Jika ada sisa file konfigurasi:

```powershell
Remove-Item -Recurse "C:\Program Files\Thermaltrue" -Force
Remove-Item "$env:APPDATA\com.thermaltrue.wms" -Recurse -Force -ErrorAction SilentlyContinue
```

---

## 7. Troubleshooting

### 7.1 "Connection refused" saat membuka aplikasi

**Penyebab:** Aplikasi menggunakan HTTP mode (`VITE_FORCE_HTTP=true`) tapi `server.exe` tidak berjalan.

**Solusi:**
1. Pastikan `server.exe` berjalan:
   ```powershell
   curl.exe http://localhost:3000/api/health
   ```
2. Jika belum, jalankan server:
   ```powershell
   cd C:\thermaltrue\server
   .\server.exe run
   ```
3. Atau nonaktifkan HTTP mode (set `VITE_FORCE_HTTP=false` di `.env`)

### 7.2 "WebView2 not found" / Aplikasi tidak bisa dibuka

**Penyebab:** WebView2 Runtime tidak terinstall.

**Solusi:**
- Windows 11: Install Windows Update terbaru
- Windows 10: Download WebView2 Runtime dari https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- Install Evergreen Bootstrapper

### 7.3 Aplikasi gagal connect ke database

**Penyebab:** PostgreSQL tidak bisa diakses atau kredensial salah.

**Solusi:**
1. Cek PostgreSQL berjalan:
   ```powershell
   Get-Service postgresql* | Where-Object {$_.Status -eq "Running"}
   ```
2. Test koneksi manual:
   ```powershell
   psql -U postgres -h localhost -d thermaltrue -c "SELECT 1"
   ```
3. Periksa `DATABASE_URL` di file `.env`
4. Pastikan database `thermaltrue` sudah dibuat:
   ```sql
   CREATE DATABASE thermaltrue;
   ```

### 7.4 MSI gagal install "Another version is already installed"

**Penyebab:** Versi lama masih terdaftar.

**Solusi:**
1. Uninstall versi lama dari Control Panel
2. Restart komputer
3. Install ulang

### 7.5 Aplikasi terbuka tapi halaman putih / blank

**Penyebab:** WebView2 gagal load halaman frontend.

**Solusi:**
1. Restart aplikasi
2. Update WebView2 Runtime ke versi terbaru
3. Reset aplikasi:
   ```powershell
   Remove-Item "$env:APPDATA\com.thermaltrue.wms" -Recurse -Force
   ```

### 7.6 Login gagal meskipun username/password benar

**Solusi:**
1. Reset password admin via database:
   ```powershell
   psql -U postgres -d thermaltrue -c "UPDATE users SET password_hash='\$2b\$12\$LJ3m4ys3Lk0TSwHnbfOMiOXPm1Qlq5GzGmZm7sZwmL6mQq7b5x1(y' WHERE username='admin';"
   ```
   > Hash di atas adalah bcrypt dari `admin123`.

2. Atau buat user baru langsung di database.

---

## 8. Tips Produksi

### 8.1 Kombinasi Desktop + Browser

Anda bisa menjalankan **keduanya** secara bersamaan:

| Komputer | Install |
|----------|---------|
| Server kantor | `server.exe` (Windows Service) + PostgreSQL |
| PC admin | MSI + akses via browser |
| PC gudang | MSI (desktop app) konek ke server yang sama |
| Tablet / HP | Browser akses `http://server-ip:3000` |

Semua client berbagi **1 database** yang sama.

### 8.2 Backup Database

```powershell
pg_dump -U postgres -d thermaltrue -F c -f "backup_thermaltrue_$(Get-Date -Format yyyyMMdd).dump"
```

### 8.3 Log Aplikasi

Log aplikasi disimpan di:

```
%APPDATA%\com.thermaltrue.wms\
├── logs\
│   └── app.log
└── .env
```
