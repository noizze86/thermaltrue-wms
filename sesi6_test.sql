-- Sesi 6 — Trigger Cycle Count: Testing Script

-- 1. Cek current_qty SEBELUM cycle count (material sku_id=1 = 59ecf3b1)
SELECT 'BEFORE' as test, material_id, current_qty, period_start
FROM material_metrics
WHERE material_id = (SELECT material_id FROM sku_mapping WHERE sku_id = 1)
  AND period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

-- 2. Insert cycle count resolved (is_resolved=true)
INSERT INTO cycle_count_transactions (sku_id, warehouse_id, system_qty, physical_qty, is_resolved)
VALUES (1, 1, 50, 48, true);

-- 3. Cek current_qty SETELAH cycle count (harus 48)
SELECT 'AFTER' as test, material_id, period_start, current_qty
FROM material_metrics
WHERE material_id = (SELECT material_id FROM sku_mapping WHERE sku_id = 1)
  AND period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

-- 4. Cek integration_log
SELECT 'LOG' as test, process_name, status, affected_rows, error_message
FROM integration_log
WHERE process_name LIKE 'trg_cyclecount%'
ORDER BY created_at DESC
LIMIT 5;

-- 5. Test unresolved (guard clause — trigger TIDAK jalan)
INSERT INTO cycle_count_transactions (sku_id, warehouse_id, system_qty, physical_qty, is_resolved)
VALUES (1, 1, 48, 48, false);

-- 6. Pastikan tidak ada log baru
SELECT 'NO_LOG' as test, COUNT(*) as cnt
FROM integration_log
WHERE process_name LIKE 'trg_cyclecount%'
  AND created_at >= NOW() - INTERVAL '1 second';

SELECT 'SESI 6 COMPLETE' as status, 'Trigger cycle count → material_metrics siap' as result;
