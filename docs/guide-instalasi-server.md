# Panduan Instalasi Server Thermaltrue WMS v1.0.4

Panduan ini menjelaskan **instalasi server** menggunakan installer satu-file **`Thermaltrue-Setup-1.0.4.exe`**. Installer ini otomatis memasang:

- **PostgreSQL 18** (database dibundel — tidak perlu install manual)
- **API server** (`server.exe`) + web UI (`dist/`)
- **Windows Service** `ThermaltrueServer` (auto-start saat boot)
- **Aturan Firewall** untuk port API
- **Selftest otomatis** pasca-instalasi (laporan `readiness-report.json`)

> Instalasi aplikasi Desktop (MSI/NSIS) ada di dokumen terpisah: `docs/guide-instalasi-desktop.md`.

---

## 1. Persyaratan Sistem (Server)

| Komponen | Minimal | Rekomendasi |
|----------|---------|-------------|
| OS | Windows 10 64-bit (build 19044+/20H2+) atau Windows Server 2016+ | Windows 11 / Server 2022 |
| Arsitektur | x64 | x64 |
| CPU | 2 core | 4 core |
| RAM | 4 GB | 8 GB |
| Storage | 10 GB free | 50 GB SSD |
| Hak akses | **Administrator** (wajib — untuk install service + firewall) | — |
| Database | Tidak perlu — PostgreSQL 18 terpasang otomatis | — |

> [!NOTE]
> Installer membutuhkan hak **Administrator**. Klik kanan setup → **Run as administrator**.

---

## 2. Unduh Installer

1. Buka halaman rilis: **https://github.com/noizze86/thermaltrue-wms/releases**
2. Cari rilis **v1.0.4**
3. Download **`Thermaltrue-Setup-1.0.4.exe`** (± 386 MB)

Verifikasi ukuran file (sekali waktu):

```powershell
(Get-Item "C:\temp\Thermaltrue-Setup-1.0.4.exe").Length
# Harus: 386046262
```

---

## 3. Instalasi Server

### 3.1. Jalankan Installer

Klik kanan `Thermaltrue-Setup-1.0.4.exe` → **Run as administrator** → wizard Inno Setup muncul.

### 3.2. Pilih Komponen

| Jenis | Isi | Kapan digunakan |
|-------|-----|-----------------|
| **Full** | Server + database + Desktop client | Satu PC sebagai server sekaligus client |
| **Server** | Server + database (tanpa client) | PC server murni; client akses browser/desktop |
| **Client** | Hanya aplikasi Desktop (tanpa server/db) | PC kerja yang memakai server lain |

> Untuk server produksi biasa: pilih **Server** (atau **Full** bila PC itu juga dipakai kerja).

### 3.3. Port

Wizard menampilkan halaman **Server ports**:

| Kolom | Default | Keterangan |
|-------|---------|------------|
| API server port | `3000` | Web UI + REST API |
| PostgreSQL port | `5432` | Database PostgreSQL 18 |

Jika port sudah dipakai program lain, ganti sekarang (lihat §8.2).

### 3.4. Proses Install (otomatis)

1. **PostgreSQL 18** diinstall silent — superuser `postgres` dibuat dengan **password acak** (disimpan ke `installer-notes.txt`)
2. **server.exe** + **dist/** disalin ke `C:\Program Files\Thermaltrue\`
3. **Windows Service** `ThermaltrueServer` dibuat (auto-start) + aturan firewall untuk port API
4. **`.env`** dibuat otomatis (DATABASE_URL mengarah ke PG yang baru, PORT, JWT_SECRET auto-generate)
5. **Selftest** dijalankan: cek `/api/health/db` → hasil `readiness-report.json`

Tunggu proses selesai (± 3–7 menit tergantung PC; pertama kali install PG).

### 3.5. Setelah Selesai

Server **langsung berjalan** sebagai service. Selesai wizard → buka browser:

```
http://localhost:3000
```

---

## 4. Verifikasi Instalasi

### 4.1. Status Service

```powershell
# PowerShell sebagai Administrator
Get-Service ThermaltrueServer

# atau
& "C:\Program Files\Thermaltrue\server.exe" status
```

### 4.2. Health Check

```powershell
curl.exe http://localhost:3000/api/health
# {"status":"ok"}

curl.exe http://localhost:3000/api/health/db
# {"status":"ok"}
```

### 4.3. Laporan Selftest

```
C:\Program Files\Thermaltrue\readiness-report.json
```

Isi:

```json
{
  "apiPort": 3000,
  "service": "ThermaltrueServer",
  "serverReachable": true,
  "health": { "status": "ok" }
}
```

### 4.4. File Penting hasil Instalasi

| File | Lokasi | Isi |
|------|--------|-----|
| `server.exe` + `dist/` | `C:\Program Files\Thermaltrue\` | API server + web UI |
| `.env` | `C:\Program Files\Thermaltrue\` | DATABASE_URL, PORT, JWT_SECRET, dll |
| `installer-notes.txt` | `C:\Program Files\Thermaltrue\` | **Kredensial PostgreSQL** — simpan aman |
| `readiness-report.json` | `C:\Program Files\Thermaltrue\` | Laporan selftest |

---

## 5. Login Pertama

Kredensial default user admin:

| Field | Nilai |
|-------|-------|
| Username | `admin` |
| Password | **Tergantung konfigurasi** (lihat di bawah) |

Server otomatis membuat user **`admin`** saat pertama kali database kosong (seed di `db_pool.rs`):

1. Jika `.env` memuat `DEFAULT_ADMIN_PASSWORD=xxx` → password-nya `xxx`
2. Jika tidak di set → password **acak** `AdminXXXXXXXX` (contoh: `Adminkd3f8j2a`) & ditulis ke file **`admin-credentials.txt`** di folder yang sama dengan `server.exe` (bukan hanya log tersembunyi service)

Karena service berjalan tersembunyi, cara paling aman adalah **set password admin sendiri**:

Edit (atau buat) `C:\Program Files\Thermaltrue\.env` **sebelum server pertama kali start**:

```ini
DEFAULT_ADMIN_PASSWORD=adminkuat123
```

Server membaca `.env` di folder yang sama dengan `server.exe`.

> [!IMPORTANT]
> Jika sudah login pernah dilakukan, ubah password lewat aplikasi: **Settings → My Profile → Change Password**. Lihat §11.5 bila lupa password admin (cara termudah: CLI `set-admin-password` di bawah).

### Reset Password Admin via CLI (tanpa psql)

`server.exe` punya perintah bawaan untuk mereset password user `admin` — bisa dijalankan kapan saja, bahkan saat service berjalan:

```powershell
cd C:\Program Files\Thermaltrue
server.exe set-admin-password PasswordBaru123
# [OK] Password for user 'admin' updated.
```

Syarat password: min 8 karakter, maks 128, wajib ada huruf besar, huruf kecil, dan angka.

### Login & Akses

1. Buka `http://localhost:3000` di server (atau `http://IP_SERVER:3000` dari PC lain)
2. Masukkan admin + password
3. **Wajib diganti setelah login pertama** — Settings → My Profile → Change Password

---

## 6. Akses dari Client

### 6.1. Browser (Web)

Tanpa install apapun: buka `http://IP_SERVER:3000` dari browser mana pun di jaringan yang sama.

Cari IP server:

```powershell
ipconfig
# IPv4 Address. . . . . : 192.168.1.100   <-- pakai ini
```

### 6.2. Aplikasi Desktop (Windows)

Install via **Full installer** (opsi Client) atau **MSI/NSIS** terpisah — lihat `docs/guide-instalasi-desktop.md`.

Aplikasi Desktop otomatis melakukan **LAN-first detection** (mencari server di jaringan). Jika server ditentukan IP manual: **Settings → API Settings → Server URL**: `http://IP_SERVER:3000`.

### 6.3. VPN / Remote / Internet (Advanced)

- **LAN/VPN**: client bergabung di jaringan yang sama (WireGuard/OpenVPN) → akses IP lokal
- **Publik**: ⚠️ JANGAN ekspos port 3000 langsung ke internet; gunakan reverse proxy + HTTPS (§9)

---

## 7. Update & Rollback

### 7.1. Update via Installer

1. Unduh setup versi baru (mis. `Thermaltrue-Setup-x.y.z.exe`)
2. Jalankan → installer mendeteksi instalasi lama & **upgrade**
3. Database tetap; `.env` lama tetap dipakai

### 7.2. Update Manual (ganti file)

```powershell
# PowerShell sebagai Administrator
$installDir = "C:\Program Files\Thermaltrue"

# 1) Backup .env
Copy-Item "$installDir\.env" "$installDir\.env.bak"

# 2) Stop service
& "$installDir\server.exe" stop

# 3) Ganti file (bugfix manual dari repo — build sendiri)
Copy-Item "path\to\server.exe" "$installDir\server.exe" -Force
Copy-Item "path\to\dist" "$installDir\dist\" -Recurse -Force

# 4) Start kembali
& "$installDir\server.exe" start

# 5) Verifikasi
curl.exe http://localhost:3000/api/health
```

### 7.3. Rollback

```powershell
& "$installDir\server.exe" stop
# restore server.exe / dist lama dari backup
& "$installDir\server.exe" start
```

---

## 8. Backups

### 8.1. Auto-Backup (bawaan server)

Server menjalankan **scheduled backup** tiap **24 jam** (default):

- Folder tujuan: `C:\Program Files\Thermaltrue\backups\`
- File: `backup-<timestamp>.sql` (format SQL dump, `pg_dump --clean --if-exists`)
- Penyimpanan: **30 backup terakhir** dipertahankan

Ubah `BACKUP_DIR` / `BACKUP_INTERVAL_HOURS` di `.env` jika perlu.

### 8.2. Backup Manual

```powershell
pg_dump -U postgres -d thermaltrue -F c -f "C:\backups\thermal_$(Get-Date -Format yyyyMMdd_HHmm).dump"
```

> Password postgres ada di `installer-notes.txt`.

### 8.3. Restore

```powershell
pg_restore -U postgres -d thermaltrue --clean "C:\backups\thermal_2026...dump"
# atau SQL: psql -U postgres -d thermaltrue -f backup.sql
```

Detail lengkap: `docs/backup-restore.md`.

---

## 9. Keamanan (Wajib untuk Produksi)

### 9.1. HTTPS / TLS

Secara default server berjalan **HTTP**. Untuk produksi:

1. Siapkan sertifikat (Let's Encrypt `certbot` / enterprise CA)
2. Tambah di `.env`:
   ```
   TLS_CERT_PATH=C:\cert\fullchain.pem
   TLS_KEY_PATH=C:\cert\privkey.pem
   ```
3. Restart service → HTTPS otomatis aktif

Alternatif umum: reverse proxy (Nginx/IIS) + TLS di depan port 3000:

```nginx
server {
    listen 443 ssl;
    server_name wms.domain.com;
    ssl_certificate     /etc/letsencrypt/live/wms.domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wms.domain.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 9.2. CORS

| Value | Akibat |
|-------|--------|
| (kosong) | Izinkan semua origin (default; aman untuk LAN) |
| `https://wms.domain.com` | Batasi hanya origin itu (mengaktifkan proteksi CSRF) |

### 9.3. Rate Limiter

- General API: **600 request/menit per IP** (anti-DoS)
- Login: **5 percobaan / 15 menit per user** (429 Too Many Requests setelah melampaui)

### 9.4. JWT Secret

- Auto-generate saat start pertama kali, disimpan ke `.env` (`JWT_SECRET`)
- Jika diubah → semua session invalid

### 9.5. File `.env`

- File sensitif (password DB, secret JWT) — **jangan dibagikan / commit** (sudah ada di `.gitignore`)
- Batasi akses: hak Administrator saja

---

## 10. Uninstal Server

1. **Windows Settings → Apps → Installed apps** → cari **Thermaltrue WMS** → **Uninstall**
   (atau jalankan `unins000.exe` di `C:\Program Files\Thermaltrue\`)
2. **Uninstall PostgreSQL 18** (Apps → PostgreSQL 18) — **lakukan backup dulu!** (semua database terhapus)

Jika mau tetap PostgreSQL: cukup uninstall "Thermaltrue WMS" saja, service `ThermaltrueServer` akan dihapus juga.

---

## 11. Troubleshooting Umum

### 11.1. "Connection refused" dari Localhost

```powershell
Get-Service ThermaltrueServer          # Running?
& "$env:ProgramFiles\Thermaltrue\server.exe" status
netstat -ano | findstr ":3000"
curl.exe http://localhost:3000/api/health/db
```

### 11.2. Port 3000 / 5432 sudah dipakai

- Ganti di wizard saat install (halaman Port) → API `3001`, PG `5433`
- atau temukan proses pemakai: `netstat -ano | findstr ":3000"` → `Stop-Process -Id <PID>` (atau sesuaikan port di `.env` + restart manual) — jika `server.exe` sudah install, edit `.env` di `C:\Program Files\Thermaltrue\.env` → `PORT=3001` (misal) → restart

### 11.3. Login gagal berulang ("Invalid username")

1. Kredensial salah / rate-limit login sementara (tunggu 10–15 menit) — lihat §5
2. Reset password admin (kondisi masih bisa akses DB)

### 11.4. Lupa password admin (sudah pernah login)

Cara termudah — reset via CLI bawaan (tidak perlu psql, bisa sambil service berjalan):

```powershell
cd C:\Program Files\Thermaltrue
server.exe set-admin-password PasswordBaru123
# [OK] Password for user 'admin' updated.
```

> [!NOTE]
> Setelah reset, jika masih ditolak login: tunggu 15 menit (rate limit 5 percobaan gagal) atau restart service (`server.exe restart` setara `sc stop` + `sc start`).

Cara alternatif (langsung ke database PostgreSQL):

```powershell
# 1. Stop server
& "$env:ProgramFiles\Thermaltrue\server.exe" stop

# 2. Set password admin baru langsung di database PostgreSQL
$env:PGPASSWORD = "<password-postgres-dari-installer-notes>"
& "$env:ProgramFiles\PostgreSQL\18\bin\psql.exe" -U postgres -d thermaltrue -c "UPDATE users SET password_hash='\$2b\$12\$...' WHERE username='admin';"
```

> 💡 Hash bcrypt harus dibuat di luar aplikasi (misal: generator online / `htpasswd -bnBC 12 "" <password>`). Setelah UPDATE selesai, start ulang service & login dengan password baru. Cara alternatif lain: set `DEFAULT_ADMIN_PASSWORD` di `.env`, hapus user `admin` dari tabel `users`, lalu restart server (user di-seed ulang).

### 11.5. Selftest gagal / "serverReachable": false

1. Service running? (`Get-Service ThermaltrueServer`)
2. PG berjalan? (`Get-Service postgresql*`)
3. Lihat `readiness-report.json` & log service (Event Viewer → Windows Logs → Application → Thermal)

### 11.6. "Cannot bind to 0.0.0.0:3000"

1. Port dipakai proses lain → ubah PORT di `.env` (lihat §11.2)
2. Restart service

### 11.7. Dialog "PostgreSQL did not start" saat install

- Pastikan port 5432 bebas (tidak dipakai PG lain) saat wizard → gunakan port lain
- Data PG lama tidak tersentuh — instalasi baru tidak menyentuh data lama

---

## 12. Ringkasan Perintah

| Perintah | Fungsi |
|----------|--------|
| `server.exe install` | Install service (otomatis saat wizard) |
| `server.exe uninstall` | Hapus service |
| `server.exe start` | Start service |
| `server.exe stop` | Stop service |
| `server.exe status` | Tampilkan status |
| `server.exe run` | Jalankan foreground (untuk debug/log) |
| `server.exe set-admin-password <pw>` | Reset password user `admin` (tanpa psql) |

Service juga bisa dikelola: `services.msc` → `ThermaltrueServer`.

---

## 13. Referensi

| Item | Nilai |
|------|-------|
| Download | GitHub Releases: `Thermaltrue-Setup-1.0.4.exe` |
| Web UI | `http://IP_SERVER:3000` |
| Health | `/api/health` , `/api/health/db` |
| Service | `ThermaltrueServer` (Windows) |
| Folder install | `C:\Program Files\Thermaltrue\` |
| Environment | `.env` di folder install |
| Kredensi DB | `installer-notes.txt` |
| Dokter client | `docs/guide-instalasi-desktop.md` |
| Backup | `docs/backup-restore.md` |

---

_© 2026 Thermaltrue — update terakhir: v1.0.4._