-- ============================================================
-- Sesi 2 — Source Tables: Testing Script
-- ============================================================

-- 1. Cek semua tabel sudah dibuat
SELECT 'TABLE_CHECK' as test_name, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'receiving_transactions', 'picking_transactions',
    'shipping_transactions', 'cycle_count_transactions',
    'production_batch', 'batch_material_usage'
  )
ORDER BY table_name;

-- 2. Seed: mapping materials yang ada ke sku_mapping (pastikan)
INSERT INTO sku_mapping (material_id, warehouse_id, sku_code, sku_name)
SELECT m.id, '', m.sku, m.name
FROM materials m
WHERE NOT EXISTS (SELECT 1 FROM sku_mapping s WHERE s.material_id = m.id);

-- 3. Test INSERT receiving_transactions
DO $$
DECLARE
    v_sku_id INT;
    v_wh_id INT := 1;
BEGIN
    SELECT sku_id INTO v_sku_id FROM sku_mapping LIMIT 1;

    INSERT INTO receiving_transactions (sku_id, warehouse_id, qty_received, purchase_price)
    VALUES (v_sku_id, v_wh_id, 100, 15000.00);

    RAISE NOTICE 'receiving_transactions: OK (sku=%, qty=100, price=15000)', v_sku_id;
END;
$$;

-- 4. Test INSERT picking_transactions
DO $$
DECLARE
    v_sku_id INT;
BEGIN
    SELECT sku_id INTO v_sku_id FROM sku_mapping LIMIT 1;

    INSERT INTO picking_transactions (sku_id, warehouse_id, order_id, qty_picked, pick_time_seconds)
    VALUES (v_sku_id, 1, 1001, 10, 120);

    RAISE NOTICE 'picking_transactions: OK (sku=%, qty=10, pick_time=120s)', v_sku_id;
END;
$$;

-- 5. Test INSERT shipping_transactions
INSERT INTO shipping_transactions (order_id, shipping_cost, carrier, is_on_time)
VALUES (1001, 25000.00, 'JNE', TRUE);

-- 6. Test INSERT cycle_count_transactions
DO $$
DECLARE
    v_sku_id INT;
BEGIN
    SELECT sku_id INTO v_sku_id FROM sku_mapping LIMIT 1;

    INSERT INTO cycle_count_transactions (sku_id, warehouse_id, system_qty, physical_qty)
    VALUES (v_sku_id, 1, 100, 98);

    RAISE NOTICE 'cycle_count_transactions: OK (system=100, physical=98, variance=%, accuracy=%)',
        (SELECT variance_qty FROM cycle_count_transactions ORDER BY id DESC LIMIT 1),
        (SELECT accuracy_pct FROM cycle_count_transactions ORDER BY id DESC LIMIT 1);
END;
$$;

-- 7. Test INSERT production_batch + batch_material_usage
DO $$
DECLARE
    v_batch_id INT;
    v_product_sku INT;
    v_material_sku INT;
BEGIN
    SELECT sku_id INTO v_product_sku FROM sku_mapping LIMIT 1;
    SELECT sku_id INTO v_material_sku FROM sku_mapping OFFSET 1 LIMIT 1;

    INSERT INTO production_batch (batch_code, product_sku_id, planned_qty, actual_qty, start_date, end_date, status)
    VALUES ('BATCH-2026-001', v_product_sku, 50, 45, NOW() - INTERVAL '2 days', NOW(), 'completed')
    RETURNING id INTO v_batch_id;

    INSERT INTO batch_material_usage (batch_id, sku_id, warehouse_id, planned_qty, actual_qty, reject_qty)
    VALUES (v_batch_id, v_material_sku, 1, 100, 95, 3);

    RAISE NOTICE 'production_batch + batch_material_usage: OK (batch_id=%)', v_batch_id;
END;
$$;

-- 8. Verifikasi data
SELECT 'RECEIVING' as src, COUNT(*) as rows FROM receiving_transactions
UNION ALL
SELECT 'PICKING', COUNT(*) FROM picking_transactions
UNION ALL
SELECT 'SHIPPING', COUNT(*) FROM shipping_transactions
UNION ALL
SELECT 'CYCLE_COUNT', COUNT(*) FROM cycle_count_transactions
UNION ALL
SELECT 'PROD_BATCH', COUNT(*) FROM production_batch
UNION ALL
SELECT 'BATCH_USAGE', COUNT(*) FROM batch_material_usage;

-- 9. Cek stored column: variance_qty dan accuracy_pct
SELECT id, sku_id, system_qty, physical_qty, variance_qty, accuracy_pct
FROM cycle_count_transactions
ORDER BY id DESC LIMIT 5;

-- ============================================================
-- RESUME
-- ============================================================
SELECT 'SESI 2 COMPLETE' as status, '6 source tables siap' as result;
