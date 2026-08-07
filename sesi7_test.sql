-- Sesi 7 — Trigger Production Batch: Testing Script

-- 1. Cek data SEBELUM
SELECT 'BEFORE' as test,
       m.material_id, mm.current_qty, mm.unit_price
FROM material_metrics mm
JOIN sku_mapping m ON m.material_id = mm.material_id
WHERE m.sku_id = 1
  AND mm.period_type = 'daily'
  AND mm.period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

-- 2. Insert production batch + material usage
--    Butuh batch_id dari production_batch
DO $$
DECLARE
    v_batch_id INT;
BEGIN
    INSERT INTO production_batch (batch_code, product_sku_id, planned_qty, actual_qty, status)
    VALUES ('BATCH-TEST-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS'), 1, 100, 95, 'completed')
    RETURNING id INTO v_batch_id;

    INSERT INTO batch_material_usage (batch_id, sku_id, warehouse_id, planned_qty, actual_qty, reject_qty)
    VALUES (v_batch_id, 1, 1, 100, 92, 3);

    RAISE NOTICE 'Insert produksi OK (batch_id=%, sku_id=1)', v_batch_id;
END;
$$;

-- 3. Cek consumption_metrics terupdate (consumption = 92+3 = 95)
SELECT 'CONSUMPTION' as test,
       material_id, period_start,
       consumption_1mo, consumption_3mo
FROM consumption_metrics
WHERE material_id = (SELECT material_id FROM sku_mapping WHERE sku_id = 1)
  AND period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

-- 4. Cek material_metrics (current_qty berkurang 95)
SELECT 'STOCK' as test,
       material_id, period_start, current_qty
FROM material_metrics
WHERE material_id = (SELECT material_id FROM sku_mapping WHERE sku_id = 1)
  AND period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

-- 5. Cek cost_metrics.efficiency_penalty_cost (3 reject × unit_price)
SELECT 'COST' as test,
       material_id, period_start,
       efficiency_penalty_cost, total_cost, total_units
FROM cost_metrics
WHERE material_id = (SELECT material_id FROM sku_mapping WHERE sku_id = 1)
  AND period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
  AND COALESCE(efficiency_penalty_cost, 0) > 0;

-- 6. Cek integration_log
SELECT 'LOG' as test,
       process_name, status, affected_rows, error_message
FROM integration_log
WHERE process_name LIKE 'trg_production%'
ORDER BY created_at DESC
LIMIT 5;

SELECT 'SESI 7 COMPLETE' as status, 'Trigger production → consumption, material, cost siap' as result;
