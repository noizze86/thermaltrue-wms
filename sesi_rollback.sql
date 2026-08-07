-- ============================================================
-- ROLLBACK STRATEGIES — Integration Trigger Error Recovery
-- ============================================================

-- ============================================================
-- STRATEGI 1: AUTO-ROLLBACK (Default Behavior)
-- Trigger gagal → INSERT dibatalkan otomatis oleh PostgreSQL
-- TIDAK PERLU TINDAKAN MANUAL
-- ============================================================
-- Semua trigger menggunakan EXCEPTION WHEN OTHERS THEN
-- yang me-RAISE WARNING (bukan RAISE EXCEPTION).
-- Ini berarti: data SOURCE TETAP TERSIMPAN,
-- analysis table TIDAK terupdate.
--
-- KEAMANAN: Data transaksi tidak hilang, hanya analysis yang
-- perlu diperbaiki dan dire-proses.
--
-- Jika ingin behavior SEBALIKNYA (INSERT batal total):
-- ganti "RAISE WARNING" → "RAISE" di trigger function

-- ============================================================
-- STRATEGI 2: Cek apa yang error
-- ============================================================
SELECT 'STRATEGI 2: DIAGNOSA ERROR' as strategi;

-- 2a. Lihat error terbaru
SELECT id, process_name, source_table, error_message, created_at
FROM integration_log
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 5;

-- 2b. Lihat detail error untuk material tertentu
SELECT * FROM integration_log
WHERE material_id = '<material_id>'
  AND status = 'failed'
ORDER BY created_at DESC;

-- ============================================================
-- STRATEGI 3: Fix Error + Retry Trigger
-- ============================================================
SELECT 'STRATEGI 3: RETRY TRIGGER' as strategi;

-- 3a. Jika error karena bug di trigger function (spt column name salah):
--    Fix function, lalu retry dengan menjalankan ulang logic untuk data yang gagal

-- Contoh: retry picking yang gagal
-- (identifikasi dari integration_log.error_message + source_table)
DO $$
DECLARE
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT il.source_table,
               CASE
                   WHEN il.source_table = 'receiving_transactions' THEN
                       (SELECT jsonb_build_object('id', rt.id, 'sku_id', rt.sku_id, 'warehouse_id', rt.warehouse_id, 'qty_received', rt.qty_received, 'purchase_price', rt.purchase_price)::TEXT
                        FROM receiving_transactions rt WHERE rt.id = ANY(
                            SELECT unnest(string_to_array(regexp_replace(il.error_message, '.*?(\d+).*', '\1'), ','))::INT
                        ))
                   ELSE NULL
               END as source_data
        FROM integration_log il
        WHERE il.status = 'failed'
          AND il.created_at >= NOW() - INTERVAL '24 hours'
    LOOP
        RAISE NOTICE 'Need retry for: %', v_rec.source_table;
    END LOOP;
END;
$$;

-- 3b. Atau langsung re-insert data source (akan memicu trigger lagi)
--    HAPUS dulu data lama jika perlu:
-- DELETE FROM receiving_transactions WHERE id = <failed_id>;
-- INSERT INTO receiving_transactions ... (data yang sama)

-- ============================================================
-- STRATEGI 4: Hapus Data Analysis yang Salah
-- ============================================================
SELECT 'STRATEGI 4: HAPUS DATA SALAH' as strategi;

-- Hapus data analysis untuk periode tertentu
-- (lalu trigger ulang dari source)

-- 4a. Hapus consumption_metrics untuk hari tertentu
-- SELECT COUNT(*) as akan_dihapus FROM consumption_metrics
-- WHERE material_id = '<material_id>'
--   AND period_start = 'YYYY-MM-DD';
--
-- BEGIN;
-- DELETE FROM consumption_metrics
-- WHERE material_id = '<material_id>'
--   AND period_start = 'YYYY-MM-DD';
-- COMMIT; -- atau ROLLBACK

-- 4b. Hapus cost_per_order untuk transaksi tertentu
-- BEGIN;
-- DELETE FROM cost_per_order
-- WHERE transaction_id = '<transaction_id>';
-- COMMIT;

-- 4c. Reset material_metrics ke nilai sebelum trigger
-- BEGIN;
-- UPDATE material_metrics
-- SET current_qty = current_qty - <jumlah_yang_salah>,
--     inbound_30d = inbound_30d - <jumlah_yang_salah>,
--     updated_at = TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
-- WHERE material_id = '<material_id>'
--   AND warehouse_id = '<warehouse_id>'
--   AND period_type = 'daily'
--   AND period_start = TO_CHAR(NOW(), 'YYYY-MM-DD');
-- COMMIT;

-- ============================================================
-- STRATEGI 5: Nonaktifkan / Aktifkan Trigger Sementara
-- ============================================================
SELECT 'STRATEGI 5: DISABLE/ENABLE TRIGGER' as strategi;

-- 5a. Nonaktifkan trigger (untuk maintenance / bulk insert)
-- ALTER TABLE receiving_transactions DISABLE TRIGGER trg_receiving_to_analysis;
-- ALTER TABLE picking_transactions DISABLE TRIGGER trg_picking_to_analysis;
-- ALTER TABLE shipping_transactions DISABLE TRIGGER trg_shipping_to_analysis;
-- ALTER TABLE cycle_count_transactions DISABLE TRIGGER trg_cyclecount_to_analysis;
-- ALTER TABLE batch_material_usage DISABLE TRIGGER trg_production_to_analysis;

-- 5b. Lakukan bulk insert (trigger TIDAK jalan)
-- INSERT INTO receiving_transactions ... (ribuan row)

-- 5c. Aktifkan kembali trigger
-- ALTER TABLE receiving_transactions ENABLE TRIGGER trg_receiving_to_analysis;
-- ALTER TABLE picking_transactions ENABLE TRIGGER trg_picking_to_analysis;
-- ALTER TABLE shipping_transactions ENABLE TRIGGER trg_shipping_to_analysis;
-- ALTER TABLE cycle_count_transactions ENABLE TRIGGER trg_cyclecount_to_analysis;
-- ALTER TABLE batch_material_usage ENABLE TRIGGER trg_production_to_analysis;

-- 5d. Proses ulang data yang terlewat (jalankan fungsi trigger manual)
-- SELECT 'Data siap diproses ulang via re-insert atau batch_nightly_recalc()' as info;

-- ============================================================
-- STRATEGI 6: Re-proses Semua Data Source (Full Rebuild)
-- ============================================================
SELECT 'STRATEGI 6: FULL REBUILD' as strategi;

-- HANYA jika analysis table dalam keadaan kacau total.
-- Ini akan menghapus semua data analysis untuk hari ini
-- dan memproses ulang dari source.

-- BEGIN;
-- -- 1. Backup dulu
-- CREATE TABLE backup_consumption_metrics AS SELECT * FROM consumption_metrics;
-- CREATE TABLE backup_material_metrics AS SELECT * FROM material_metrics;
-- CREATE TABLE backup_cost_metrics AS SELECT * FROM cost_metrics;
-- CREATE TABLE backup_cost_per_order AS SELECT * FROM cost_per_order;
--
-- -- 2. Hapus data analysis
-- TRUNCATE consumption_metrics;
-- TRUNCATE cost_per_order;
-- UPDATE material_metrics SET
--     current_qty = 0, inbound_30d = 0, outbound_30d = 0,
--     stockout_risk = 0, days_cover = 0,
--     is_dead_stock = false, is_slow_moving = false;
--
-- -- 3. Re-process semua source (trigger akan jalan)
-- INSERT INTO receiving_transactions (sku_id, warehouse_id, qty_received, purchase_price, receipt_date)
-- SELECT sku_id, warehouse_id, qty_received, purchase_price, receipt_date
-- FROM backup_source_data...;
--
-- -- 4. Jalankan nightly batch
-- SELECT * FROM batch_nightly_recalc();
-- COMMIT;

-- ============================================================
-- STRATEGI 7: Simulasi Rollback (Dry Run)
-- ============================================================
SELECT 'STRATEGI 7: SIMULASI SEBELUM EKSEKUSI' as strategi;

BEGIN; -- <-- TRANSACTION: semua perubahan bisa ROLLBACK

-- Lakukan operasi berbahaya di sini
-- DELETE FROM cost_per_order WHERE ...;
-- UPDATE material_metrics SET ...;

-- Cek dulu hasilnya
SELECT 'CEK: perubahan akan di-rollback' as info;

ROLLBACK; -- <-- Batalkan semua perubahan
-- COMMIT; -- <-- Ganti dengan ini jika sudah yakin

-- ============================================================
-- CHEAT SHEET: Perintah Cepat
-- ============================================================
SELECT 'CHEAT SHEET' as strategi;

SELECT '🔴 Darurat: HENTIKAN semua trigger' as cmd
UNION ALL SELECT '  ALTER TABLE receiving_transactions DISABLE TRIGGER trg_receiving_to_analysis;'
UNION ALL SELECT '  ALTER TABLE picking_transactions DISABLE TRIGGER trg_picking_to_analysis;'
UNION ALL SELECT '  ALTER TABLE shipping_transactions DISABLE TRIGGER trg_shipping_to_analysis;'
UNION ALL SELECT '  ALTER TABLE cycle_count_transactions DISABLE TRIGGER trg_cyclecount_to_analysis;'
UNION ALL SELECT '  ALTER TABLE batch_material_usage DISABLE TRIGGER trg_production_to_analysis;'
UNION ALL SELECT ''
UNION ALL SELECT '🟢 Aktifkan kembali:'
UNION ALL SELECT '  ALTER TABLE receiving_transactions ENABLE TRIGGER trg_receiving_to_analysis;'
UNION ALL SELECT '  ALTER TABLE picking_transactions ENABLE TRIGGER trg_picking_to_analysis;'
UNION ALL SELECT '  ALTER TABLE shipping_transactions ENABLE TRIGGER trg_shipping_to_analysis;'
UNION ALL SELECT '  ALTER TABLE cycle_count_transactions ENABLE TRIGGER trg_cyclecount_to_analysis;'
UNION ALL SELECT '  ALTER TABLE batch_material_usage ENABLE TRIGGER trg_production_to_analysis;'
UNION ALL SELECT ''
UNION ALL SELECT '📋 Cek trigger aktif/tidak:'
UNION ALL SELECT '  SELECT event_object_table, trigger_name, action_timing || '' '' || event_manipulation as event'
UNION ALL SELECT '  FROM information_schema.triggers WHERE trigger_name LIKE ''trg_%'';'
UNION ALL SELECT ''
UNION ALL SELECT '🔍 Cek error terbaru:'
UNION ALL SELECT '  SELECT * FROM integration_log WHERE status = ''failed'' ORDER BY created_at DESC LIMIT 5;'
UNION ALL SELECT ''
UNION ALL SELECT '🧹 Hapus log error (setelah diperbaiki):'
UNION ALL SELECT '  DELETE FROM integration_log WHERE status = ''failed'' AND created_at < NOW() - INTERVAL ''7 days'';';
