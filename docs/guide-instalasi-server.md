# Panduan Instalasi Server Thermaltrue WMS

Panduan ini untuk deployment **Opsi B (Browser-based)** — pengguna mengakses aplikasi via web browser, tanpa perlu install MSI.

---

## 1. Persiapan

### 1.1 Spesifikasi Minimal Server

| Komponen | Minimal | Rekomendasi |
|----------|---------|-------------|
| OS | Windows 10/11 / Windows Server 2019+ | Windows Server 2022 |
| CPU | 2 core | 4 core |
| RAM | 4 GB | 8 GB |
| Storage | 10 GB free | 50 GB SSD |
| Database | PostgreSQL 14+ | PostgreSQL 16 |

### 1.2 Install PostgreSQL

1. Download installer dari https://www.postgresql.org/download/windows/
2. Jalankan installer, catat **port** (default `5432`) dan **password user `postgres`**
3. Pastikan service PostgreSQL berjalan:
   ```powershell
   Get-Service postgresql*
   ```

### 1.3 Buat Database

Buka **SQL Shell (psql)** atau gunakan pgAdmin, lalu jalankan:

```sql
CREATE DATABASE thermaltrue;
```

Atau via command line:

```powershell
psql -U postgres -c "CREATE DATABASE thermaltrue;"
```

---

## 2. Instalasi Server

### 2.1 File yang Dibutuhkan

Salin folder berikut ke server:

```
server/
├── server.exe          # Aplikasi server (~20 MB)
└── dist/               # Frontend (hasilkan dari npm run build)
    ├── index.html
    ├── favicon.svg
    ├── manifest.json
    ├── icons.svg
    └── assets/
        ├── index-*.js
        ├── vendor-*.js
        ├── index-*.css
        └── ...
```

Bisa diletakkan di mana saja, misal `C:\thermaltrue\`.

### 2.2 Cara Mendapatkan File

#### Opsi A — Build sendiri (dari source code)

```powershell
# 1. Build frontend
cd C:\thermaltrue\project
npm run build

# 2. Build server
cargo build --release -p server

# 3. Salin ke folder deploy
mkdir C:\thermaltrue\server
copy target\release\server.exe C:\thermaltrue\server\
copy -Recurse dist C:\thermaltrue\server\dist\
```

#### Opsi B — Download rilis (jika sudah ada rilis)

Ambil file `server.exe` dan `dist.zip` dari halaman Releases repository.

### 2.3 Struktur Folder Final

```
C:\thermaltrue\server\
├── server.exe
├── dist\
│   ├── index.html
│   └── assets\...
├── .env                 # (dibuat otomatis atau manual)
└── logs\                # (opsional, untuk log file)
```

### 2.4 Konfigurasi Environment

Buat file `.env` di folder yang sama dengan `server.exe`:

```ini
# Wajib
DATABASE_URL=postgresql://postgres:password@localhost:5432/thermaltrue?sslmode=disable

# Opsional (dibuat otomatis jika tidak diisi)
JWT_SECRET=your-random-secret-key-min-32-characters

# Opsional
PORT=3000
FRONTEND_DIST=C:\thermaltrue\server\dist
```

**Penjelasan:**

| Variabel | Wajib | Default | Keterangan |
|----------|-------|---------|------------|
| `DATABASE_URL` | ✅ | — | Koneksi ke PostgreSQL (`user:password@host:port/db`) |
| `JWT_SECRET` | ❌ | Auto-generated | Kunci untuk token login (min 32 karakter) |
| `PORT` | ❌ | `3000` | Port HTTP server |
| `FRONTEND_DIST` | ❌ | Deteksi otomatis | Path folder `dist/` (jika tidak di folder yang sama) |

> **Catatan:** Jika `JWT_SECRET` tidak diisi, server akan membuatnya otomatis dan menyimpannya ke file `.env` saat pertama kali jalan.

---

## 3. Menjalankan Server

### 3.1 Mode Foreground (testing)

```powershell
cd C:\thermaltrue\server
.\server.exe run
```

Output yang diharapkan:

```
[INFO  server] Connecting to database...
[INFO  sqlx::postgres::notice] relation "_sqlx_migrations" already exists, skipping
[INFO  server] Server listening on http://0.0.0.0:3000
```

Server jalan di foreground. Tekan `Ctrl+C` untuk menghentikan.

### 3.2 Mode Windows Service (produksi)

Jalankan PowerShell sebagai **Administrator**:

```powershell
# 1. Install service (cukup sekali)
cd C:\thermaltrue\server
.\server.exe install

# Output:
# [OK] Service 'ThermaltrueServer' installed.
# [OK] Firewall rule added for port 3000

# 2. Start service
.\server.exe start

# Output:
# [OK] Service 'ThermaltrueServer' started.
```

Service akan otomatis menyala setiap kali Windows boot.

**Perintah lain:**

```powershell
.\server.exe status    # Cek status service
.\server.exe stop      # Stop service
.\server.exe uninstall # Hapus service
```

### 3.3 Firewall

Port `3000` harus dibuka di Firewall Windows agar client bisa mengakses.

Jika menjalankan `server.exe install`, firewall rule otomatis ditambahkan.

Jika ingin manual:

```powershell
netsh advfirewall firewall add rule name="Thermaltrue WMS" dir=in action=allow protocol=TCP localport=3000
```

### 3.4 Verifikasi Server Berjalan

Buka browser di server, akses:

```
http://localhost:3000
```

Jika halaman login Thermaltrue muncul, server berjalan dengan benar.

Cek API health:

```powershell
curl.exe http://localhost:3000/api/health
# Output: {"status":"ok"}
```

---

## 4. Akses dari Client

### 4.1 LAN (Local Network)

Cari IP address server:

```powershell
ipconfig
# Contoh: IPv4 Address. . . . . . : 192.168.1.100
```

Client di jaringan yang sama buka browser:

```
http://192.168.1.100:3000
```

### 4.2 VPN / Remote

Jika client di luar kantor, gunakan VPN (WireGuard/OpenVPN) agar terhubung ke jaringan server. Setelah VPN aktif, akses via IP lokal server.

### 4.3 Internet / Publik (Advanced)

> ⚠️ Sangat tidak disarankan mengekspos server langsung ke internet tanpa reverse proxy dan HTTPS.

Setup yang direkomendasikan:

1. Gunakan Nginx sebagai reverse proxy
2. Pasang SSL certificate (Let's Encrypt)
3. Forward domain ke server internal

### 4.4 Login Pertama

Buka halaman login, gunakan kredensial default:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin123` |

> **Penting:** Segera ganti password setelah login pertama.

---

## 5. Update Server

### 5.1 Persiapan File Baru

1. Build frontend terbaru: `npm run build` → folder `dist/`
2. Build server terbaru: `cargo build --release -p server` → `target/release/server.exe`

### 5.2 Ganti File

```powershell
# Stop service (Admin)
.\server.exe stop

# Backup folder lama
rename C:\thermaltrue\server C:\thermaltrue\server_backup

# Copy folder baru
mkdir C:\thermaltrue\server
copy target\release\server.exe C:\thermaltrue\server\
copy -Recurse dist C:\thermaltrue\server\dist\

# Copy .env dari backup
copy C:\thermaltrue\server_backup\.env C:\thermaltrue\server\.env

# Start service
.\server.exe start

# Verifikasi
curl.exe http://localhost:3000/api/health
```

### 5.3 Rollback Jika Gagal

```powershell
.\server.exe stop
Remove-Item -Recurse C:\thermaltrue\server
rename C:\thermaltrue\server_backup C:\thermaltrue\server
.\server.exe start
```

---

## 6. Troubleshooting

### 6.1 "Connection refused" saat akses dari browser

```powershell
# 1. Cek apakah server berjalan
Get-Process -Name server

# 2. Cek port
netstat -ano | findstr ":3000"

# 3. Cek firewall
netsh advfirewall firewall show rule name="Thermaltrue WMS"

# 4. Cek dari localhost dulu
curl.exe http://localhost:3000
```

### 6.2 "Cannot bind to 0.0.0.0:3000"

Port 3000 sudah dipakai program lain.

```powershell
# Cek proses yang memakai port 3000
netstat -ano | findstr ":3000"

# Ganti port server dengan env PORT=3001
# atau matikan program lain
```

### 6.3 "Cannot connect to database"

```powershell
# 1. Cek PostgreSQL berjalan
Get-Service postgresql*

# 2. Test koneksi manual
psql -U postgres -h localhost -d thermaltrue -c "SELECT 1"

# 3. Periksa DATABASE_URL di file .env
type C:\thermaltrue\server\.env
```

### 6.4 "Frontend dist not found"

Folder `dist/` tidak ditemukan di samping `server.exe`.

Solusi:
- Pastikan folder `dist/` ada di direktori yang sama dengan `server.exe`
- Atau set environment variable: `FRONTEND_DIST=C:\path\ke\dist`

### 6.5 Halaman Login Muncul Tapi Gagal Login

```powershell
# Reset password admin via database
psql -U postgres -d thermaltrue -c "UPDATE users SET password_hash='$2b$12$LJ3m4ys3Lk0TSwHnbfOMiOXPm1Qlq5GzGmZm7sZwmL6mQq7b5x1(y' WHERE username='admin';"
```
> **Catatan:** Hash di atas adalah `admin123` dengan bcrypt. Jika gagal, buat ulang via aplikasi.

---

## 7. Referensi

| Perintah | Fungsi |
|----------|--------|
| `server.exe run` | Jalankan server di foreground |
| `server.exe install` | Install sebagai Windows Service |
| `server.exe start` | Start service |
| `server.exe stop` | Stop service |
| `server.exe status` | Cek status service |
| `server.exe uninstall` | Hapus service |
| `http://localhost:3000` | Akses aplikasi via browser |
| `http://localhost:3000/api/health` | Cek status API |
