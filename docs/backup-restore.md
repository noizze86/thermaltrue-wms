# Backup & Restore — Thermaltrue WMS

Prosedur manual untuk server produksi (`C:\Program Files\Thermaltrue`). Berlaku juga
untuk pose di instalasi baru (lihat `guide-instalasi-server.md`).

## Lokasi data

| Item | Lokasi |
|---|---|
| Database | PostgreSQL lokal (instance `postgresql-x64-18`, database `thermaltrue`) |
| .env (konfigurasi) | `C:\Program Files\Thermaltrue\.env` |
| Backup scheduler (otomatis) | `C:\Program Files\Thermaltrue\backups\backup-<unix>.sql` — dijalankan tiap `BACKUP_INTERVAL_HOURS` (default 24 jam). Lewatkan env `BACKUP_DIR` untuk memindah lokasi. |

Backup scheduler memakai `pg_dump` (format SQL) — pos memang, bimurni ke file.

---

## 1. Backup manual

```powershell
# sebagai admin, stop dulu agar konsisten
sc.exe stop ThermaltrueServer

& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" `
  -U postgres -h localhost -d thermaltrue `
  -Fc -f "C:\Program Files\Thermaltrue\backups\backup-manual.dump"

sc.exe start ThermaltrueServer
```

Format `-Fc` (custom) direkomendasikan: kompres, bisa dipilih tabel, dan restore via `pg_restore`. Format `.sql` plain-text juga valid untuk schema+cdata tunggal.

## 2. Restore (uji pernah dilakukan — lihat E2E-REPORT / catatan Fase 2)

```powershell
# 1) buat database baru (jangan timpa data produksi saat uji)
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres -h localhost thermaltrue_restoretest

# 2) restore isi dari dump
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" `
  -U postgres -h localhost -d thermaltrue_restoretest `
  --no-owner --no-privileges "C:\Program Files\Thermaltrue\backups\backup-manual.dump"

# 3) verifikasi cepat
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d thermaltrue_restoretest -c "SELECT COUNT(*) FROM materials;"

# 4) cleanup database uji
& "C:\Program Files\PostgreSQL\18\bin\dropdb.exe" -U postgres -h localhost thermaltrue_restoretest
```

**Untuk restore produksi sesungguhnya**: overwrite `thermaltrue` yang lama:

```powershell
# stop server, drop, create baru, restore, start
sc.exe stop ThermaltrueServer
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "DROP DATABASE thermaltrue;"
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres -h localhost thermaltrue
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -U postgres -h localhost -d thermaltrue --no-owner --no-privileges "dump-file"
sc.exe start ThermaltrueServer
```

> Peringatan: aksi drop memusnahkan data; pastikan dump valid dan sudah dibackup dua lapis (mis. copy dump ke drive lain).

## 3. Verifikasi integritas

1. Jalankan home kesehatan setelah restore: `GET /api/health/db` → `{"status":"ok"}`.
2. Login `admin` — jika password admin terenkripsi ikut ter-bump, ikuti petunjuk `guide-instalasi-server.md` (reset via `DEFAULT_ADMIN_PASSWORD`).
3. Cek data di tiap modul (Materials, Transactions) bila ada spot check penting.

## 4. Jadwal backup otomatis

Server menghidupkan scheduler saat **run** (bukan install). Interval default = 24 jam.

- Ubah interval: tambah `BACKUP_INTERVAL_HOURS=6` di `.env` lalu restart server.
- Ubah folder: `BACKUP_DIR=C:\ThermalBackups` di `.env`.
- File hasil: `backup-<timestamp>.sql` — isi plain SQL (siap di-psql).
- File langsung di `C:\Program Files\Thermaltrue\backups`.

> Untuk kepatuhan safety: copy folder `backups` ke media lain secara berkala (plan sederhana: `robocopy .../backups D:\backup\thermal` tiap malam via Task Scheduler).

## 5. Drill yang sudah dilakukan (Fase 2, 9 Agustus 2026)

- `pg_dump -Fc` → `backup-drill.dump` (321.002 bytes, 39 tabel).
- `createdb thermaltrue_restoretest` → `pg_restore --no-owner --no-privileges` → sukses, tidak ada error.
- Verifikasi: `SELECT COUNT(*) FROM materials` → `5` (sama dengan produksi).
- Cleanup: database uji sudah `dropdb`.