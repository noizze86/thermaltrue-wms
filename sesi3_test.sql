-- ============================================================
-- Sesi 3 — Trigger Picking: Testing Script
-- ============================================================

-- 1. Insert picking baru → trigger otomatis jalan
DO $$
DECLARE
    v_sku_id INT;
BEGIN
    SELECT sku_id INTO v_sku_id FROM sku_mapping WHERE material_id IN
        (SELECT id FROM materials LIMIT 1);

    INSERT INTO picking_transactions (sku_id, warehouse_id, order_id, qty_picked, pick_time_seconds)
    VALUES (v_sku_id, 1, 2001, 15, 180);

    RAISE NOTICE 'Insert picking OK (sku_id=%)', v_sku_id;
END;
$$;

-- 2. Cek consumption_metrics ter-update
SELECT 'CONSUMPTION_CHECK' as test,
       material_id, period_start,
       consumption_1mo, consumption_3mo, consumption_6mo
FROM consumption_metrics
ORDER BY created_at DESC
LIMIT 5;

-- 3. Cek material_metrics ter-update
SELECT 'MATERIAL_CHECK' as test,
       material_id, period_start,
       outbound_30d, days_since_last_tx, last_tx_date
FROM material_metrics
ORDER BY created_at DESC
LIMIT 5;

-- 4. Cek cost_per_order ter-insert
SELECT 'CPO_CHECK' as test,
       transaction_id, material_id,
       picking_cost, total_cost, is_profitable
FROM cost_per_order
ORDER BY created_at DESC
LIMIT 5;

-- 5. Cek integration_log
SELECT 'LOG_CHECK' as test,
       process_name, source_table, status, affected_rows, error_message
FROM integration_log
WHERE process_name = 'trg_picking_to_analysis'
ORDER BY created_at DESC
LIMIT 5;

-- 6. Test dengan qty_picked = 0 (guard clause, harus dilewati)
INSERT INTO picking_transactions (sku_id, warehouse_id, order_id, qty_picked, pick_time_seconds)
VALUES (1, 1, 9999, 0, 0);

-- 7. Test dengan sku_id tidak valid (guard clause, harus log error)
INSERT INTO picking_transactions (sku_id, warehouse_id, order_id, qty_picked, pick_time_seconds)
VALUES (99999, 1, 9998, 10, 60);

-- 8. Cek log terakhir (harus ada 1 failed + 1 skipped)
SELECT 'ERROR_LOG_CHECK' as test,
       process_name, status, error_message
FROM integration_log
WHERE process_name = 'trg_picking_to_analysis'
ORDER BY created_at DESC
LIMIT 5;

-- 9. Validasi: jumlah consumption vs total picking hari ini
SELECT 'VALIDATION' as test,
       (SELECT COALESCE(SUM(qty_picked), 0) FROM picking_transactions
        WHERE pick_date >= CURRENT_DATE) as total_picked_today,
       (SELECT COALESCE(SUM(consumption_1mo), 0) FROM consumption_metrics
        WHERE period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
          AND period_type = 'daily') as total_consumption_today;

-- ============================================================
-- RESUME
-- ============================================================
SELECT 'SESI 3 COMPLETE' as status, 'Trigger picking → consumption, material, cost siap' as result;
