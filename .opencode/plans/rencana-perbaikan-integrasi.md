# Rencana Eksekusi: Perbaikan Integrasi — 6 Prioritas

## Prioritas 1: Dashboard Batch (`0027_batch_dashboard.sql` + Rust handler)

### File baru: `backend/migrations/0027_batch_dashboard.sql`
- Function `batch_dashboard_refresh()` — compute & persist:
  - 5 komponen health_index (accuracy=20%, productivity=20%, on_time_shipping=20%, utilization=20%, stock_availability=20%)
  - Trend (▲/▼/→) compared to yesterday & 7-day avg
  - capacity_pressure_score (0-100) from utilization + avg daily inbound/outbound
  - predicted_full_date
  - top_losses (JSONB) from cost_metrics.efficiency_penalty_cost
  - Semua disimpan via UPSERT ke `dashboard_metrics`
- Logging via `log_integration()`

### File diubah: `backend/src/server/handlers/batch.rs`
- Tambah handler `dashboard_refresh()` — panggil `SELECT * FROM batch_dashboard_refresh()`

### File diubah: `backend/src/server/mod.rs`
- Tambah route: `.route("/api/batch/dashboard", post(handlers::batch::dashboard_refresh))`

---

## Prioritas 2: ABC Classification (`0028_batch_abc.sql`)

### File baru: `backend/migrations/0028_batch_abc.sql`
- Function `batch_abc_classify()` — compute & persist:
  - Composite score dari value_contribution (40%), turnover (30%), recency (30%)
  - Class A: top 20%, Class B: next 30%, Class C: bottom 50%
  - Update `material_metrics.abc_class` dan `abc_score`
  - Insert ke `abc_classification` table dengan `analysis_mode='batch_auto'`
  - Log aktivitas ke `abc_change_history` jika class berubah

---

## Prioritas 3: Forecast di Nightly (modifikasi `0026_batch_nightly.sql`)

### File diubah: `backend/migrations/0026_batch_nightly.sql`
- Tambah function baru `batch_generate_forecasts()` di file migration yang sama (append di akhir)
  - Query material_metrics period_type='daily' untuk current date
  - Ambil consumption_1mo dari consumption_metrics untuk tiap material
  - Simple forecast: AVG monthly consumption × 1/3/6 bulan
  - Insert/update ke `forecast_metrics` dengan `forecast_model='sql_batch'`
- Modifikasi `batch_nightly_recalc()` — panggil `batch_generate_forecasts()` di akhir loop

---

## Prioritas 4: Retry Data (`0029_retry_integrations.sql`)

### File baru: `backend/migrations/0029_retry_integrations.sql`
- Function `retry_failed_integrations()`:
  - Scan `integration_log` untuk status='failed' dengan retry_count < 3
  - Untuk tiap failed record: cek apakah source data masih ada, update retry_count, log ulang
- Function `reprocess_pending_source()`:
  - Scan source tables (receiving, picking, cycle_count, batch_material_usage) 
  - Cari row yang tidak punya integration_log entry dalam 5 detik setelah created_at
  - Kembalikan daftar ID yang perlu reprocess (tidak auto-trigger karena trigger AFTER INSERT sudah lewat)
  - Admin bisa pakai hasilnya untuk re-insert data

---

## Prioritas 5: Cycle Count Improvement (modifikasi `0024_trigger_cyclecount.sql`)

### File diubah: `backend/migrations/0024_trigger_cyclecount.sql`
- Tambah update kolom di `material_metrics`:
  - `last_cycle_count_qty` = NEW.physical_qty
  - `last_cycle_count_date` = v_period
  - Juga update `accuracy_pct` dari cycle count
- Perlu migration terpisah untuk ADD COLUMN (dari pada migrate `0024` yang sudah jalan, buat `0030_add_cycle_count_columns.sql`)

### File baru: `backend/migrations/0030_add_cycle_count_columns.sql`
- `ALTER TABLE material_metrics ADD COLUMN IF NOT EXISTS last_cycle_count_qty DOUBLE PRECISION DEFAULT 0;`
- `ALTER TABLE material_metrics ADD COLUMN IF NOT EXISTS last_cycle_count_date TEXT DEFAULT '';`
- `ALTER TABLE material_metrics ADD COLUMN IF NOT EXISTS accuracy_pct DOUBLE PRECISION DEFAULT 0;`

### File diubah: `backend/migrations/0024_trigger_cyclecount.sql`
- Tambah update `last_cycle_count_qty`, `last_cycle_count_date`, `accuracy_pct` di trigger function

---

## Prioritas 6: Monitor Alert (modifikasi `sesi_monitor.sql`)

### File diubah: `sesi_monitor.sql`
- Tambah section 11: `SHIPPING PARTIAL ALERT` — cek partial rate > 20%
- Tambah section 12: `DASHBOARD HEALTH STATUS` — cek apakah dashboard_metrics terisi hari ini
- Tambah section 13: `ABC STATUS` — cek apakah abc_class terisi
- Tambah section 14: `FORECAST STATUS` — cek apakah forecast_metrics untuk bulan ini ada

---

## Urutan Eksekusi

1. `0027_batch_dashboard.sql` → jalankan `psql -f`
2. Edit `batch.rs` + `mod.rs` → Rust handler + route
3. `0028_batch_abc.sql` → jalankan `psql -f`
4. `0026_batch_nightly.sql` (modifikasi) → jalankan `psql -f`
5. `0030_add_cycle_count_columns.sql` → jalankan `psql -f`
6. `0024_trigger_cyclecount.sql` (modifikasi) → jalankan `psql -f`
7. `0029_retry_integrations.sql` → jalankan `psql -f`
8. `sesi_monitor.sql` (modifikasi) → sudah siap
9. `cargo check -p server` → build Rust
10. Deploy + test semua endpoint
