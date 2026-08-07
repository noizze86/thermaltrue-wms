-- ============================================================
-- Monitoring Integrasi — Cek Kesehatan Real-Time
-- Jalankan kapan saja untuk melihat status pipeline data
-- ============================================================

-- 1. TRIGGER STATUS — Apakah semua trigger masih aktif?
SELECT '1. TRIGGER STATUS' as section;

SELECT trigger_name, event_manipulation, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_name LIKE 'trg_%'
ORDER BY trigger_name;

-- 2. REALTIME SUMMARY — Status integrasi 1 jam terakhir
SELECT '2. REALTIME (1 JAM TERAKHIR)' as section;

SELECT
    process_name,
    status,
    COUNT(*) as total_events,
    COALESCE(SUM(affected_rows), 0) as total_rows_affected,
    ROUND(COALESCE(AVG(execution_time_ms), 0)) as avg_exec_ms,
    MAX(created_at) as last_event,
    CASE
        WHEN COUNT(*) FILTER (WHERE status = 'failed') > 0 THEN '⚠️ PERLU CEK'
        WHEN MAX(created_at) < NOW() - INTERVAL '1 hour' AND process_name != 'batch_nightly_recalc' THEN '⚠️ TIDAK AKTIF'
        ELSE '✅ OK'
    END as health
FROM integration_log
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY process_name, status
ORDER BY process_name, status;

-- 3. FAILED INTEGRATIONS — Semua error yang belum selesai
SELECT '3. FAILED INTEGRATIONS' as section;

SELECT
    id,
    process_name,
    source_table,
    material_id,
    warehouse_id,
    error_message,
    retry_count,
    created_at,
    CASE
        WHEN retry_count >= 3 THEN '🔴 GAGAL 3x+'
        WHEN retry_count >= 1 THEN '🟡 SUDAH DIRETRY'
        ELSE '🟠 PERLU DIRETRY'
    END as action_needed
FROM integration_log
WHERE status = 'failed'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- 4. DATA CONSISTENCY — Cek apakah data analysis sinkron dengan source
SELECT '4. DATA CONSISTENCY CHECK' as section;

-- 4a. Source → Analysis: Receiving vs Cost
SELECT
    'Receiving → Cost' as pipeline,
    (SELECT COUNT(*) FROM receiving_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) as source_events,
    (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_receiving_to_analysis' AND status = 'success' AND created_at >= CURRENT_DATE::TIMESTAMP) as integrated_ok,
    CASE
        WHEN (SELECT COUNT(*) FROM receiving_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) =
             (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_receiving_to_analysis' AND status = 'success' AND created_at >= CURRENT_DATE::TIMESTAMP)
        THEN '✅ OK'
        ELSE '⚠️ MISSING'
    END as status;

-- 4b. Source → Analysis: Picking vs Consumption
SELECT
    'Picking → Consumption' as pipeline,
    (SELECT COUNT(*) FROM picking_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) as source_events,
    (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_picking_to_analysis' AND status = 'success' AND created_at >= CURRENT_DATE::TIMESTAMP) as integrated_ok,
    CASE
        WHEN (SELECT COUNT(*) FROM picking_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) =
             (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_picking_to_analysis' AND status = 'success' AND created_at >= CURRENT_DATE::TIMESTAMP)
        THEN '✅ OK'
        ELSE '⚠️ MISSING'
    END as status;

-- 4c. Source → Analysis: Shipping vs Cost
SELECT
    'Shipping → Cost' as pipeline,
    (SELECT COUNT(*) FROM shipping_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) as source_events,
    (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_shipping_to_analysis' AND status IN ('success','partial') AND created_at >= CURRENT_DATE::TIMESTAMP) as integrated_ok,
    CASE
        WHEN (SELECT COUNT(*) FROM shipping_transactions WHERE created_at >= CURRENT_DATE::TIMESTAMP) <=
             (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_shipping_to_analysis' AND status IN ('success','partial') AND created_at >= CURRENT_DATE::TIMESTAMP)
        THEN '✅ OK'
        ELSE '⚠️ MISSING'
    END as status;

-- 4d. Source → Analysis: Cycle Count vs Material
SELECT
    'Cycle Count → Material' as pipeline,
    (SELECT COUNT(*) FROM cycle_count_transactions WHERE is_resolved = true AND created_at >= CURRENT_DATE::TIMESTAMP) as source_events,
    (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_cyclecount_to_analysis' AND status = 'success' AND created_at >= CURRENT_DATE::TIMESTAMP) as integrated_ok,
    CASE
        WHEN (SELECT COUNT(*) FROM cycle_count_transactions WHERE is_resolved = true AND created_at >= CURRENT_DATE::TIMESTAMP) =
             (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_cyclecount_to_analysis' AND status = 'success' AND created_at >= CURRENT_DATE::TIMESTAMP)
        THEN '✅ OK'
        ELSE '⚠️ MISSING'
    END as status;

-- 4e. Source → Analysis: Production vs Consumption
SELECT
    'Production → Consumption' as pipeline,
    (SELECT COUNT(*) FROM batch_material_usage WHERE consumption_date >= CURRENT_DATE::TIMESTAMP) as source_events,
    (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_production_to_analysis' AND status = 'success' AND created_at >= CURRENT_DATE::TIMESTAMP) as integrated_ok,
    CASE
        WHEN (SELECT COUNT(*) FROM batch_material_usage WHERE consumption_date >= CURRENT_DATE::TIMESTAMP) =
             (SELECT COUNT(*) FROM integration_log WHERE process_name = 'trg_production_to_analysis' AND status = 'success' AND created_at >= CURRENT_DATE::TIMESTAMP)
        THEN '✅ OK'
        ELSE '⚠️ MISSING'
    END as status;

-- 5. PENDING SOURCE DATA — Data di source yang belum terintegrasi
SELECT '5. UNINTEGRATED SOURCE DATA' as section;

-- 5a. Receiving tanpa integrasi
SELECT
    'receiving_transactions' as source_table,
    rt.id,
    rt.sku_id,
    sm.material_id,
    rt.qty_received,
    rt.created_at,
    'TIDAK ADA LOG' as reason
FROM receiving_transactions rt
LEFT JOIN sku_mapping sm ON sm.sku_id = rt.sku_id
LEFT JOIN integration_log il ON il.process_name = 'trg_receiving_to_analysis'
    AND il.source_table = 'receiving_transactions'
    AND il.status = 'success'
    AND il.created_at >= rt.created_at - INTERVAL '1 second'
    AND il.created_at <= rt.created_at + INTERVAL '5 seconds'
WHERE rt.created_at >= CURRENT_DATE::TIMESTAMP
  AND il.id IS NULL
LIMIT 10;

-- 5b. Picking tanpa integrasi
SELECT
    'picking_transactions' as source_table,
    pt.id,
    pt.sku_id,
    sm.material_id,
    pt.qty_picked,
    pt.created_at,
    'TIDAK ADA LOG' as reason
FROM picking_transactions pt
LEFT JOIN sku_mapping sm ON sm.sku_id = pt.sku_id
LEFT JOIN integration_log il ON il.process_name = 'trg_picking_to_analysis'
    AND il.source_table = 'picking_transactions'
    AND il.status = 'success'
    AND il.created_at >= pt.created_at - INTERVAL '1 second'
    AND il.created_at <= pt.created_at + INTERVAL '5 seconds'
WHERE pt.created_at >= CURRENT_DATE::TIMESTAMP
  AND il.id IS NULL
LIMIT 10;

-- 6. SKU MAPPING ISSUE — Data tanpa mapping
SELECT '6. ORPHANED SKU (TANPA MAPPING)' as section;

SELECT 'receiving' as source, rt.sku_id, rt.qty_received, rt.created_at
FROM receiving_transactions rt
LEFT JOIN sku_mapping sm ON sm.sku_id = rt.sku_id
WHERE sm.sku_id IS NULL
UNION ALL
SELECT 'picking', pt.sku_id, pt.qty_picked, pt.created_at
FROM picking_transactions pt
LEFT JOIN sku_mapping sm ON sm.sku_id = pt.sku_id
WHERE sm.sku_id IS NULL
UNION ALL
SELECT 'production', bmu.sku_id, bmu.actual_qty, bmu.consumption_date
FROM batch_material_usage bmu
LEFT JOIN sku_mapping sm ON sm.sku_id = bmu.sku_id
WHERE sm.sku_id IS NULL
LIMIT 20;

-- 7. LAG MONITOR — Apakah trigger merespon cepat?
SELECT '7. TRIGGER PERFORMANCE (24 JAM)' as section;

SELECT
    process_name,
    COUNT(*) as total_calls,
    ROUND(AVG(execution_time_ms)) as avg_ms,
    ROUND(MAX(execution_time_ms)) as max_ms,
    CASE
        WHEN AVG(execution_time_ms) < 10 THEN '⚡ Sangat Cepat'
        WHEN AVG(execution_time_ms) < 50 THEN '✅ Normal'
        WHEN AVG(execution_time_ms) < 200 THEN '⚠️ Lambat'
        ELSE '🔴 Sangat Lambat'
    END as perf_rating
FROM integration_log
WHERE created_at >= NOW() - INTERVAL '24 hours'
  AND execution_time_ms > 0
GROUP BY process_name
ORDER BY process_name;

-- 8. DAILY TREND — Volume integrasi per jam (hari ini)
SELECT '8. HOURLY VOLUME (HARI INI)' as section;

SELECT
    TO_CHAR(created_at, 'HH24:00') as hour,
    COUNT(*) as total_events,
    COUNT(*) FILTER (WHERE status = 'success') as success,
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    COUNT(*) FILTER (WHERE status = 'partial') as partial
FROM integration_log
WHERE created_at >= CURRENT_DATE::TIMESTAMP
GROUP BY TO_CHAR(created_at, 'HH24:00')
ORDER BY hour;

-- 9. MAINTENANCE — Trigger perlu recreate?
SELECT '9. TRIGGER HEALTH' as section;

SELECT
    event_object_table as table_name,
    trigger_name,
    string_agg(DISTINCT action_timing || ' ' || event_manipulation, ', ') as trigger_events,
    CASE
        WHEN COUNT(*) = 1 THEN '✅ OK'
        ELSE '⚠️ DUPLICATE'
    END as status
FROM information_schema.triggers
WHERE trigger_name LIKE 'trg_%'
GROUP BY event_object_table, trigger_name
ORDER BY table_name;

-- 10. RINGKASAN EKSEKUTIF
SELECT '10. EXECUTIVE SUMMARY' as section;

SELECT
    'INTEGRATION HEALTH' as metric,
    CASE
        WHEN v_failed_1h = 0 THEN format('✅ SEHAT — %s trigger aktif, %s event sukses hari ini',
            v_triggers::TEXT, v_events_today::TEXT)
        WHEN v_failed_1h <= 2 THEN format('⚠️ STABIL — %s error dalam 1 jam, %s sudah diretry',
            v_failed_1h::TEXT, v_retried::TEXT)
        ELSE format('🔴 KRITIS — %s error dalam 1 jam, perlu intervensi',
            v_failed_1h::TEXT)
    END as diagnosis
FROM (
    SELECT
        (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_name LIKE 'trg_%') as v_triggers,
        (SELECT COUNT(*) FROM integration_log WHERE created_at >= CURRENT_DATE::TIMESTAMP AND status = 'success') as v_events_today,
        (SELECT COUNT(*) FROM integration_log WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '1 hour') as v_failed_1h,
        (SELECT COUNT(*) FROM integration_log WHERE status = 'failed' AND retry_count > 0 AND created_at >= NOW() - INTERVAL '1 hour') as v_retried
) sub;

-- 11. SHIPPING PARTIAL ALERT — Cek partial rate > 20%
SELECT '11. SHIPPING PARTIAL ALERT' as section;

SELECT
    CASE
        WHEN total_shipping = 0 THEN '✅ Tidak ada shipping hari ini'
        WHEN partial_rate > 20 THEN format('🔴 KRITIS: %s%% partial (%s/%s shipping)',
            ROUND(partial_rate::numeric, 1)::TEXT, partial_count::TEXT, total_shipping::TEXT)
        WHEN partial_rate > 0 THEN format('⚠️ %s%% partial (%s/%s shipping) — normal',
            ROUND(partial_rate::numeric, 1)::TEXT, partial_count::TEXT, total_shipping::TEXT)
        ELSE '✅ Semua shipping terintegrasi penuh'
    END as shipping_health
FROM (
    SELECT
        COUNT(*) as total_shipping,
        COUNT(*) FILTER (WHERE status = 'partial') as partial_count,
        CASE WHEN COUNT(*) > 0
            THEN COUNT(*) FILTER (WHERE status = 'partial')::DOUBLE PRECISION / COUNT(*) * 100
            ELSE 0
        END as partial_rate
    FROM integration_log
    WHERE process_name = 'trg_shipping_to_analysis'
      AND created_at >= CURRENT_DATE::TIMESTAMP
) sub;

-- 12. DASHBOARD HEALTH STATUS — Cek apakah dashboard_metrics terisi hari ini
SELECT '12. DASHBOARD HEALTH STATUS' as section;

SELECT
    CASE
        WHEN COUNT(*) = 0 THEN '⚠️ KOSONG — Jalankan POST /api/batch/dashboard atau SELECT batch_dashboard_refresh()'
        ELSE format('✅ OK — %s entry hari ini, health_index=%.1f trend=%s capacity=%s',
            COUNT(*)::TEXT,
            COALESCE(MAX(health_index), 0),
            COALESCE(MAX(trend_direction), '?'),
            COALESCE(MAX(capacity_status), '?'))
    END as dashboard_status
FROM dashboard_metrics
WHERE metric_date = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');

-- 13. ABC STATUS — Cek apakah abc_class terisi
SELECT '13. ABC CLASSIFICATION STATUS' as section;

SELECT
    CASE
        WHEN unclassified = total THEN '⚠️ BELUM DIKLASIFIKASI — Jalankan SELECT batch_abc_classify()'
        WHEN classified > 0 THEN format('✅ %s material terklasifikasi (A=%s B=%s C=%s)',
            classified::TEXT, class_a::TEXT, class_b::TEXT, class_c::TEXT)
        ELSE '⚠️ Tidak ada material'
    END as abc_status
FROM (
    SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE abc_class != '') as classified,
        COUNT(*) FILTER (WHERE abc_class = '') as unclassified,
        COUNT(*) FILTER (WHERE abc_class = 'A') as class_a,
        COUNT(*) FILTER (WHERE abc_class = 'B') as class_b,
        COUNT(*) FILTER (WHERE abc_class = 'C') as class_c
    FROM material_metrics
    WHERE period_type = 'daily'
      AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
) sub;

-- 14. FORECAST STATUS — Cek apakah forecast_metrics untuk hari ini ada
SELECT '14. FORECAST STATUS' as section;

SELECT
    CASE
        WHEN COUNT(*) = 0 THEN '⚠️ BELUM DI-GENERATE — Jalankan batch_nightly_recalc() atau POST /api/batch/nightly'
        ELSE format('✅ %s material di-forecast (model: %s)', COUNT(*)::TEXT, string_agg(DISTINCT forecast_model, ', '))
    END as forecast_status
FROM forecast_metrics
WHERE period = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');
