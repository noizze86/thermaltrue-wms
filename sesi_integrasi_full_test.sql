-- ============================================================
-- INTEGRATION TEST — Verifikasi Seluruh Menu Aplikasi
-- ============================================================

-- ============================================================
-- TEST 1: DASHBOARD — Data Source Summary
-- ============================================================
SELECT '=== TEST 1: DASHBOARD HEALTH ===' as test_group;

SELECT '1a. Source Operational Hari Ini' as test_name,
       (SELECT COUNT(*) FROM receiving_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) as receiving,
       (SELECT COUNT(*) FROM picking_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) as picking,
       (SELECT COUNT(*) FROM shipping_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) as shipping,
       (SELECT COUNT(*) FROM cycle_count_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) as cycle_count,
       (SELECT COUNT(*) FROM batch_material_usage WHERE consumption_date >= CURRENT_DATE::TIMESTAMP) as production,
       '✅' as status;

SELECT '1b. Dashboard Metrics' as test_name,
       health_index, trend_direction,
       yesterday_health_index, avg_7days_health_index,
       capacity_pressure_score, capacity_status
FROM dashboard_metrics
ORDER BY created_at DESC LIMIT 1;

SELECT '1c. Top Losses (from JSONB)' as test_name,
       biggest_loss_item_1, biggest_loss_item_2, biggest_loss_item_3
FROM dashboard_metrics
ORDER BY created_at DESC LIMIT 1;

-- ============================================================
-- TEST 2: MATERIAL ANALYSIS — material_metrics
-- ============================================================
SELECT '=== TEST 2: MATERIAL ANALYSIS ===' as test_group;

SELECT '2a. Material Summary' as test_name,
       COUNT(*) as total_materials,
       COUNT(*) FILTER (WHERE is_dead_stock = true) as dead_stock,
       COUNT(*) FILTER (WHERE is_slow_moving = true) as slow_moving,
       COUNT(*) FILTER (WHERE stockout_risk >= 70) as high_risk,
       ROUND(AVG(COALESCE(turnover_ratio, 0))::numeric, 2) as avg_itr
FROM material_metrics
WHERE period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

SELECT '2b. Material Details (Top 10 by Risk)' as test_name,
       mm.material_id, m.name as material_name,
       mm.current_qty, mm.stockout_risk, mm.days_cover,
       mm.turnover_ratio, mm.is_dead_stock, mm.is_slow_moving,
       mm.risk_trend, mm.abc_class
FROM material_metrics mm
LEFT JOIN materials m ON m.id::TEXT = mm.material_id
WHERE mm.period_type = 'daily'
  AND mm.period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
ORDER BY mm.stockout_risk DESC
LIMIT 10;

-- ============================================================
-- TEST 3: CONSUMPTION — consumption_metrics
-- ============================================================
SELECT '=== TEST 3: CONSUMPTION ===' as test_group;

SELECT '3a. Consumption Summary' as test_name,
       COUNT(*) as total_materials,
       ROUND(AVG(consumption_1mo)::numeric, 0) as avg_monthly_1mo,
       ROUND(AVG(consumption_3mo)::numeric, 0) as avg_monthly_3mo,
       ROUND(SUM(consumption_1mo)::numeric, 0) as total_consumption_1mo,
       ROUND(SUM(consumption_3mo)::numeric, 0) as total_consumption_3mo
FROM consumption_metrics
WHERE period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

SELECT '3b. Top 10 Consumed Materials' as test_name,
       cm.material_id, m.name,
       cm.consumption_1mo, cm.consumption_3mo,
       cm.consumption_6mo, cm.consumption_12mo
FROM consumption_metrics cm
LEFT JOIN materials m ON m.id::TEXT = cm.material_id
WHERE cm.period_type = 'daily'
  AND cm.period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
ORDER BY cm.consumption_1mo DESC
LIMIT 10;

-- ============================================================
-- TEST 4: COST ANALYSIS — cost_metrics + cost_per_order
-- ============================================================
SELECT '=== TEST 4: COST ANALYSIS ===' as test_group;

SELECT '4a. Cost Summary per Material' as test_name,
       cm.material_id, m.name,
       cm.purchase_price, cm.carrying_cost_value,
       cm.efficiency_penalty_cost, cm.true_unit_cost
FROM cost_metrics cm
LEFT JOIN materials m ON m.id::TEXT = cm.material_id
WHERE cm.period_type = 'daily'
  AND cm.period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
ORDER BY cm.carrying_cost_value DESC
LIMIT 10;

SELECT '4b. Cost Per Order (Cost-to-Serve)' as test_name,
       transaction_id,
       picking_cost, shipping_cost, admin_cost,
       total_cost, order_margin, is_profitable
FROM cost_per_order
ORDER BY created_at DESC
LIMIT 10;

SELECT '4c. Cost Metrics Hari Ini' as test_name,
       ROUND(SUM(COALESCE(purchase_price, 0))::numeric, 0) as total_purchase_price,
       ROUND(SUM(COALESCE(carrying_cost_value, 0))::numeric, 0) as total_carrying_cost,
       ROUND(SUM(COALESCE(efficiency_penalty_cost, 0))::numeric, 0) as total_penalty,
       ROUND(AVG(COALESCE(true_unit_cost, 0))::numeric, 0) as avg_true_unit_cost
FROM cost_metrics
WHERE period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

-- ============================================================
-- TEST 5: ABC ANALYSIS — abc_classification
-- ============================================================
SELECT '=== TEST 5: ABC ANALYSIS ===' as test_group;

SELECT '5a. ABC Summary' as test_name,
       COUNT(*) as total_classified,
       COUNT(*) FILTER (WHERE abc_class = 'A') as class_a,
       COUNT(*) FILTER (WHERE abc_class = 'B') as class_b,
       COUNT(*) FILTER (WHERE abc_class = 'C') as class_c
FROM material_metrics
WHERE period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
  AND abc_class IN ('A', 'B', 'C');

SELECT '5b. Material by ABC Class' as test_name,
       mm.abc_class, mm.material_id, m.name,
       mm.abc_score, mm.current_qty, mm.inventory_value
FROM material_metrics mm
LEFT JOIN materials m ON m.id::TEXT = mm.material_id
WHERE mm.period_type = 'daily'
  AND mm.period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
  AND mm.abc_class IN ('A', 'B', 'C')
ORDER BY mm.abc_class, mm.abc_score DESC;

-- ============================================================
-- TEST 6: FORECAST — forecast_metrics
-- ============================================================
SELECT '=== TEST 6: FORECAST ===' as test_group;

SELECT '6a. Forecast Summary' as test_name,
       COUNT(*) as total_forecasted,
       COUNT(*) FILTER (WHERE trend = '▲') as trend_up,
       COUNT(*) FILTER (WHERE trend = '▼') as trend_down,
       ROUND(AVG(COALESCE(mape, 0))::numeric, 2) as avg_mape,
       COUNT(*) FILTER (WHERE is_seasonal = true) as seasonal
FROM forecast_metrics
WHERE period = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

SELECT '6b. Forecast Details (Top 10)' as test_name,
       fm.material_id, m.name,
       fm.forecast_1mo, fm.forecast_3mo, fm.forecast_6mo,
       fm.mape, fm.trend, fm.is_seasonal,
       fm.recommendations
FROM forecast_metrics fm
LEFT JOIN materials m ON m.id::TEXT = fm.material_id
ORDER BY fm.mape ASC NULLS LAST
LIMIT 10;

-- ============================================================
-- TEST 7: PIPELINE END-TO-END
-- ============================================================
SELECT '=== TEST 7: PIPELINE E2E ===' as test_group;

-- 7a. Receiving → Material + Cost
SELECT '7a. Receiving Pipeline' as test_name,
       rt.id as source_id, rt.sku_id, sm.material_id,
       rt.qty_received, rt.purchase_price,
       mm.current_qty, mm.unit_price, mm.inventory_value,
       CASE WHEN mm.current_qty > 0 AND mm.unit_price > 0 THEN '✅' ELSE '⚠️' END as material_ok,
       cm.purchase_price as cost_price,
       CASE WHEN cm.purchase_price = mm.unit_price THEN '✅' ELSE '⚠️' END as cost_match
FROM receiving_transactions rt
LEFT JOIN sku_mapping sm ON sm.sku_id = rt.sku_id
LEFT JOIN material_metrics mm ON mm.material_id = sm.material_id
    AND mm.warehouse_id = rt.warehouse_id::TEXT
    AND mm.period_type = 'daily'
    AND mm.period_start = TO_CHAR(rt.receipt_date, 'YYYY-MM-DD')
LEFT JOIN cost_metrics cm ON cm.material_id = sm.material_id
    AND cm.warehouse_id = rt.warehouse_id::TEXT
    AND cm.period_type = 'daily'
    AND cm.period_start = TO_CHAR(rt.receipt_date, 'YYYY-MM-DD')
WHERE rt.created_at >= CURRENT_DATE::TIMESTAMP
ORDER BY rt.id DESC
LIMIT 10;

-- 7b. Picking → Consumption + Cost
SELECT '7b. Picking Pipeline' as test_name,
       pt.id as source_id, pt.order_id,
       pt.sku_id, sm.material_id,
       pt.qty_picked, pt.pick_time_seconds,
       cm.consumption_1mo,
       cpo.picking_cost, cpo.total_cost,
       CASE WHEN cm.consumption_1mo >= pt.qty_picked THEN '✅' ELSE '⚠️' END as consumption_ok,
       CASE WHEN COALESCE(cpo.picking_cost, 0) > 0 THEN '✅' ELSE '⚠️' END as cost_ok
FROM picking_transactions pt
LEFT JOIN sku_mapping sm ON sm.sku_id = pt.sku_id
LEFT JOIN consumption_metrics cm ON cm.material_id = sm.material_id
    AND cm.warehouse_id = pt.warehouse_id::TEXT
    AND cm.period_type = 'daily'
    AND cm.period_start = TO_CHAR(pt.pick_date, 'YYYY-MM-DD')
LEFT JOIN cost_per_order cpo ON cpo.transaction_id = pt.id::TEXT
WHERE pt.created_at >= CURRENT_DATE::TIMESTAMP
ORDER BY pt.id DESC
LIMIT 10;

-- 7c. Shipping → Cost
SELECT '7c. Shipping Pipeline' as test_name,
       st.id as source_id, st.order_id, st.shipping_cost,
       cpo.transaction_id, cpo.shipping_cost, cpo.total_cost,
       cpo.order_margin, cpo.is_profitable,
       CASE WHEN COALESCE(cpo.shipping_cost, 0) >= st.shipping_cost THEN '✅' ELSE '⚠️' END as shipping_ok
FROM shipping_transactions st
LEFT JOIN cost_per_order cpo ON cpo.transaction_id = st.order_id::TEXT
WHERE st.created_at >= CURRENT_DATE::TIMESTAMP
ORDER BY st.id DESC
LIMIT 10;

-- 7d. Cycle Count → Material
SELECT '7d. Cycle Count Pipeline' as test_name,
       cct.id as source_id, cct.sku_id, sm.material_id,
       cct.system_qty, cct.physical_qty, cct.variance_qty, cct.accuracy_pct,
       mm.current_qty,
       CASE WHEN mm.current_qty = cct.physical_qty THEN '✅' ELSE '⚠️' END as stock_match
FROM cycle_count_transactions cct
LEFT JOIN sku_mapping sm ON sm.sku_id = cct.sku_id
LEFT JOIN material_metrics mm ON mm.material_id = sm.material_id
    AND mm.warehouse_id = cct.warehouse_id::TEXT
    AND mm.period_type = 'daily'
    AND mm.period_start = TO_CHAR(cct.count_date, 'YYYY-MM-DD')
WHERE cct.is_resolved = true
  AND cct.created_at >= CURRENT_DATE::TIMESTAMP
ORDER BY cct.id DESC
LIMIT 10;

-- 7e. Production → Consumption + Cost
SELECT '7e. Production Pipeline' as test_name,
       bmu.id as source_id, bmu.sku_id, sm.material_id,
       bmu.actual_qty, bmu.reject_qty,
       (bmu.actual_qty + bmu.reject_qty) as total_consumed,
       cm.consumption_1mo,
       cme.efficiency_penalty_cost,
       CASE WHEN cm.consumption_1mo >= bmu.actual_qty THEN '✅' ELSE '⚠️' END as consumption_ok,
       CASE WHEN COALESCE(cme.efficiency_penalty_cost, 0) > 0 THEN '✅' ELSE '⚠️' END as penalty_ok
FROM batch_material_usage bmu
LEFT JOIN sku_mapping sm ON sm.sku_id = bmu.sku_id
LEFT JOIN consumption_metrics cm ON cm.material_id = sm.material_id
    AND cm.warehouse_id = bmu.warehouse_id::TEXT
    AND cm.period_type = 'daily'
    AND cm.period_start = TO_CHAR(bmu.consumption_date, 'YYYY-MM-DD')
LEFT JOIN cost_metrics cme ON cme.material_id = sm.material_id
    AND cme.warehouse_id = bmu.warehouse_id::TEXT
    AND cme.period_type = 'daily'
    AND cme.period_start = TO_CHAR(bmu.consumption_date, 'YYYY-MM-DD')
WHERE bmu.consumption_date >= CURRENT_DATE::TIMESTAMP
ORDER BY bmu.id DESC
LIMIT 10;

-- ============================================================
-- TEST 8: INTEGRATION LOG + TRIGGER HEALTH
-- ============================================================
SELECT '=== TEST 8: INTEGRITY CHECK ===' as test_group;

SELECT '8a. Pipeline Health Summary' as test_name,
       process_name,
       COUNT(*) as total_runs,
       COUNT(*) FILTER (WHERE status = 'success') as success,
       COUNT(*) FILTER (WHERE status = 'failed') as failed,
       COUNT(*) FILTER (WHERE status = 'partial') as partial,
       ROUND(COUNT(*) FILTER (WHERE status = 'success') * 100.0 / GREATEST(COUNT(*), 1), 1) as success_rate
FROM integration_log
WHERE created_at >= CURRENT_DATE::TIMESTAMP
GROUP BY process_name
ORDER BY process_name;

SELECT '8b. Trigger Status' as test_name,
       event_object_table, trigger_name,
       event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_name LIKE 'trg_%'
ORDER BY trigger_name;

-- ============================================================
-- TEST 9: CROSS-TABLE VALIDATION
-- ============================================================
SELECT '=== TEST 9: CROSS-TABLE VALIDATION ===' as test_group;

SELECT '9a. Source Table Row Count' as test_name,
       'receiving_transactions' as tbl, COUNT(*) as rows FROM receiving_transactions
UNION ALL SELECT '9a. Source Table Row Count', 'picking_transactions', COUNT(*) FROM picking_transactions
UNION ALL SELECT '9a. Source Table Row Count', 'shipping_transactions', COUNT(*) FROM shipping_transactions
UNION ALL SELECT '9a. Source Table Row Count', 'cycle_count_transactions', COUNT(*) FROM cycle_count_transactions
UNION ALL SELECT '9a. Source Table Row Count', 'batch_material_usage', COUNT(*) FROM batch_material_usage;

SELECT '9b. Analysis Table Row Count' as test_name,
       'material_metrics' as tbl, COUNT(*) FROM material_metrics
UNION ALL SELECT '9b. Analysis Table Row Count', 'consumption_metrics', COUNT(*) FROM consumption_metrics
UNION ALL SELECT '9b. Analysis Table Row Count', 'cost_metrics', COUNT(*) FROM cost_metrics
UNION ALL SELECT '9b. Analysis Table Row Count', 'cost_per_order', COUNT(*) FROM cost_per_order
UNION ALL SELECT '9b. Analysis Table Row Count', 'forecast_metrics', COUNT(*) FROM forecast_metrics;

-- ============================================================
-- TEST 10: EXECUTIVE SUMMARY
-- ============================================================
SELECT '=== TEST 10: EXECUTIVE SUMMARY ===' as test_group;

SELECT test_group, result FROM (
    SELECT 'Dashboard' as test_group,
           COALESCE('✅ Health Index: ' || ROUND(dm.health_index::numeric, 1) || ' | Trend: ' || dm.trend_direction, '⚠️ Kosong') as result
    FROM (SELECT health_index, trend_direction FROM dashboard_metrics ORDER BY created_at DESC LIMIT 1) dm
    UNION ALL
    SELECT 'Material Analysis',
           CASE WHEN COUNT(*) > 0 THEN '✅ ' || COUNT(*) || ' material | Dead: ' || COUNT(*) FILTER (WHERE is_dead_stock) || ' Slow: ' || COUNT(*) FILTER (WHERE is_slow_moving) || ' High Risk: ' || COUNT(*) FILTER (WHERE stockout_risk>=70) ELSE '⚠️ Kosong' END
    FROM material_metrics WHERE period_type='daily' AND period_start=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')
    UNION ALL
    SELECT 'Consumption',
           CASE WHEN COUNT(*) > 0 THEN '✅ ' || COUNT(*) || ' material | Total: ' || ROUND(SUM(consumption_1mo)::numeric, 0) || ' (1mo)' ELSE '⚠️ Kosong' END
    FROM consumption_metrics WHERE period_type='daily' AND period_start=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')
    UNION ALL
    SELECT 'Cost Analysis',
           CASE WHEN COUNT(*) > 0 THEN '✅ ' || COUNT(*) || ' entries | Penalty: Rp ' || ROUND(SUM(COALESCE(efficiency_penalty_cost,0))::numeric, 0) ELSE '⚠️ Kosong' END
    FROM cost_metrics WHERE period_type='daily' AND period_start=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')
    UNION ALL
    SELECT 'Cost Per Order',
           CASE WHEN COUNT(*) > 0 THEN '✅ ' || COUNT(*) || ' orders | Profitable: ' || COUNT(*) FILTER (WHERE is_profitable) ELSE '⚠️ Kosong' END
    FROM cost_per_order
    UNION ALL
    SELECT 'ABC Analysis',
           CASE WHEN COUNT(*) > 0 THEN '✅ A:' || COUNT(*) FILTER (WHERE abc_class='A') || ' B:' || COUNT(*) FILTER (WHERE abc_class='B') || ' C:' || COUNT(*) FILTER (WHERE abc_class='C') ELSE '⚠️ Belum diklasifikasi' END
    FROM material_metrics WHERE period_type='daily' AND period_start=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD') AND abc_class IN ('A','B','C')
    UNION ALL
    SELECT 'Forecast',
           CASE WHEN COUNT(*) > 0 THEN '✅ ' || COUNT(*) || ' materials | MAPE: ' || ROUND(AVG(COALESCE(mape,0))::numeric, 1) || '%' ELSE '⚠️ Belum di-generate' END
    FROM forecast_metrics WHERE period=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')
    UNION ALL
    SELECT 'Integration Log',
           CASE WHEN COUNT(*) > 0 THEN '✅ ' || COUNT(*) || ' events | Fail: ' || COUNT(*) FILTER (WHERE status='failed') || ' Partial: ' || COUNT(*) FILTER (WHERE status='partial') ELSE '⚠️ Tidak ada log' END
    FROM integration_log WHERE created_at >= CURRENT_DATE::TIMESTAMP
    UNION ALL
    SELECT 'Triggers',
           CASE WHEN COUNT(*) = 5 THEN '✅ ' || COUNT(*) || ' trigger aktif' ELSE '⚠️ ' || COUNT(*) || ' trigger (harusnya 5)' END
    FROM information_schema.triggers WHERE trigger_name LIKE 'trg_%'
) sub ORDER BY test_group;

SELECT '✅ TEST SELESAI — Semua 10 test group diverifikasi' as closing;
