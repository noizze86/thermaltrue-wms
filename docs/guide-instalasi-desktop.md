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

### 4.1. Jalankan Pertama

1. Buka aplikasi **Thermaltrue WMS** dari Start Menu
2. Secara default, jendela membuka `http://127.0.0.1:3000` — cocok bila server ada di PC yang sama
3. Jika server di PC lain, lihat §4.2

### 4.2. Menemukan Server di Jaringan (LAN)

Aplikasi melakukan **deteksi otomatis**:

- Mencari server yang tersedia di jaringan (cache `wms_api_url_cache`, maks. 5 alamat, TTL 10 menit)
- Menyimpan alamat yang sering dipakai sebagai **preferred**
- Beralih otomatis bila server utama tidak merespons

### 4.3. Set Manual Alamat Server

Jika deteksi tidak menemukan (misal server di VPN/alamat statis):

1. Login dulu lewat browser ke `http://IP_SERVER:3000` (web UI)
2. Di aplikasi: **Settings → API Settings → Server URL**
3. Isi `http://IP_SERVER:3000` (contoh: `http://192.168.1.100:3000`)
4. Simpan → aplikasi mengarah ke server itu

> `http://127.0.0.1:3000` adalah default; jika server remote WAJIB set manual (jangan pakai localhost).

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

- Server berjalan? Cek dari browser: `http://127.0.0.1:3000` (PC server itu sendiri)
- Jika server di PC lain: set alamat di Settings → API Settings (jangan `localhost`)
- Firewall server harus mengizinkan port API (dibuat otomatis saat instal server)

### 8.2. "WebView2 not found"

Windows 10: install Evergreen Runtime WebView2 (lihat §1.1).

### 8.3. Koneksi sering putus di jaringan besar

- Pastikan IP server **statis** (jangan DHCP berubah-ubah)
- Set manual alamat server di API Settings agar tidak berganti-ganti
- Hindari jaringan dengan proxy ketat — gunakan VPN

### 8.4. Update tidak jalan

- File `update.json` baca dari GitHub — butuh akses internet ke `github.com`
- Enterprise yang blokir GitHub: unduh installer terbaru secara manual

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
| Default URL | `http://127.0.0.1:3000` |
| Update | auto-check `update.json` (GitHub) |
| Data lokal | `%APPDATA%\com.thermaltrue.wms` |
| Browser alternatif | `http://IP_SERVER:3000` |

---

_© 2026 Thermaltrue — update terakhir: v1.0.4._