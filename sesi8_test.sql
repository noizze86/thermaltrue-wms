-- Sesi 8 — Batch Nightly Recalc: Testing Script

-- Run batch nightly
SELECT * FROM batch_nightly_recalc();

-- Cek hasil update
SELECT 'RESULT' as test,
       material_id, warehouse_id, period_start,
       current_qty, stockout_risk, days_cover,
       is_dead_stock, is_slow_moving, turnover_ratio,
       risk_trend, yesterday_stockout_risk, avg_7days_stockout_risk
FROM material_metrics
WHERE period_type = 'daily'
  AND period_start = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
ORDER BY stockout_risk DESC
LIMIT 5;

-- Cek log
SELECT 'LOG' as test,
       process_name, status, error_message
FROM integration_log
WHERE process_name = 'batch_nightly_recalc'
ORDER BY created_at DESC
LIMIT 3;

SELECT 'SESI 8 COMPLETE' as status, 'Batch nightly recalc siap dijadwalkan via Rust scheduler' as result;
