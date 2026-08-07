-- Sesi 4 — Trigger Receiving: Testing Script

-- 1. Insert receiving baru
DO $$
DECLARE
    v_sku_id INT;
BEGIN
    SELECT sku_id INTO v_sku_id FROM sku_mapping LIMIT 1;

    INSERT INTO receiving_transactions (sku_id, warehouse_id, qty_received, purchase_price)
    VALUES (v_sku_id, 1, 50, 12000);

    RAISE NOTICE 'Insert receiving OK (sku_id=%)', v_sku_id;
END;
$$;

-- 2. Cek material_metrics: current_qty, inbound_30d, unit_price
SELECT 'MATERIAL_CHECK' as test,
       material_id, period_start,
       current_qty, inbound_30d, unit_price, inventory_value
FROM material_metrics
WHERE period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
ORDER BY created_at DESC
LIMIT 5;

-- 3. Cek cost_metrics: purchase_price ter-update
SELECT 'COST_CHECK' as test,
       material_id, period_start,
       purchase_price, carrying_cost_rate
FROM cost_metrics
WHERE period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
ORDER BY created_at DESC
LIMIT 5;

-- 4. Cek integration_log
SELECT 'LOG_CHECK' as test,
       process_name, source_table, status, affected_rows
FROM integration_log
WHERE process_name LIKE 'trg_receiving%'
ORDER BY created_at DESC
LIMIT 5;

-- 5. Validasi weighted average price (material dengan receiving tertinggi)
SELECT 'VALIDATION' as test,
       material_id, current_qty, unit_price, inventory_value
FROM material_metrics
WHERE period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
  AND current_qty > 0
ORDER BY created_at DESC
LIMIT 3;

SELECT 'SESI 4 COMPLETE' as status, 'Trigger receiving → material, cost siap' as result;
