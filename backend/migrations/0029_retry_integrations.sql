-- Migration 0029: Retry & Reprocess Failed Integrations
-- Fungsi untuk mendiagnosis dan memperbaiki data yang gagal integrasi

-- ============================================================
-- 1. retry_failed_integrations()
--    Retry otomatis untuk integration_log yang gagal (< 3x retry)
-- ============================================================
CREATE OR REPLACE FUNCTION retry_failed_integrations(
    p_max_retries INT DEFAULT 3,
    p_dry_run BOOLEAN DEFAULT false
) RETURNS TABLE (
    log_id INT,
    process_name VARCHAR,
    table_name VARCHAR,
    current_retry INT,
    action_taken TEXT
) AS $$
DECLARE
    v_rec RECORD;
    v_action TEXT;
    v_start_ts TIMESTAMP;
BEGIN
    v_start_ts := clock_timestamp();

    FOR v_rec IN
        SELECT il.id, il.process_name, il.source_table, il.material_id,
               il.warehouse_id, il.retry_count, il.error_message
        FROM integration_log il
        WHERE il.status = 'failed'
          AND il.retry_count < p_max_retries
          AND il.created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY il.created_at DESC
    LOOP
        log_id := v_rec.id;
        process_name := v_rec.process_name;
        table_name := v_rec.source_table;
        current_retry := v_rec.retry_count;

        IF p_dry_run THEN
            action_taken := format('[DRY-RUN] would retry %s (attempt %s/3)',
                v_rec.process_name, v_rec.retry_count + 1);
        ELSE
            -- Update retry count
            UPDATE integration_log
            SET retry_count = retry_count + 1,
                error_message = '',
                updated_at = NOW()
            WHERE id = v_rec.id;

            action_taken := format('retry registered (attempt %s/%s)',
                v_rec.retry_count + 1, p_max_retries);
        END IF;

        RETURN NEXT;
    END LOOP;

    IF NOT FOUND THEN
        log_id := 0;
        process_name := '';
        table_name := '';
        current_retry := 0;
        action_taken := 'No failed integrations found in last 24 hours';
        RETURN NEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. reprocess_pending_source()
--    Cari source data yang tidak memiliki integration_log
--    Catatan: karena trigger AFTER INSERT sudah lewat,
--    fungsi ini hanya MENDETEKSI, tidak auto-trigger ulang.
--    Admin harus re-insert data untuk trigger ulang.
-- ============================================================
CREATE OR REPLACE FUNCTION reprocess_pending_source()
RETURNS TABLE (
    source_table TEXT,
    source_id TEXT,
    sku_id INT,
    material_id TEXT,
    created_at TEXT,
    recommended_action TEXT
) AS $$
DECLARE
    v_now TIMESTAMP;
BEGIN
    v_now := NOW();

    -- 1. Receiving tanpa integrasi
    RETURN QUERY
    SELECT
        'receiving_transactions'::TEXT,
        rt.id::TEXT,
        rt.sku_id,
        COALESCE(sm.material_id, '(not mapped)'),
        TO_CHAR(rt.created_at, 'YYYY-MM-DD HH24:MI:SS'),
        CASE WHEN sm.material_id IS NULL THEN '⚠️ BUAT SKU MAPPING DAHULU'
             ELSE '🔄 RE-INSERT row ini untuk trigger ulang'
        END
    FROM receiving_transactions rt
    LEFT JOIN sku_mapping sm ON sm.sku_id = rt.sku_id
    LEFT JOIN LATERAL (
        SELECT 1 as found FROM integration_log il
        WHERE il.process_name = 'trg_receiving_to_analysis'
          AND il.created_at >= rt.created_at - INTERVAL '2 seconds'
          AND il.created_at <= rt.created_at + INTERVAL '5 seconds'
        LIMIT 1
    ) il ON true
    WHERE rt.created_at >= CURRENT_DATE::TIMESTAMP - INTERVAL '3 days'
      AND il.found IS NULL;

    -- 2. Picking tanpa integrasi
    RETURN QUERY
    SELECT
        'picking_transactions'::TEXT,
        pt.id::TEXT,
        pt.sku_id,
        COALESCE(sm.material_id, '(not mapped)'),
        TO_CHAR(pt.created_at, 'YYYY-MM-DD HH24:MI:SS'),
        CASE WHEN sm.material_id IS NULL THEN '⚠️ BUAT SKU MAPPING DAHULU'
             ELSE '🔄 RE-INSERT row ini untuk trigger ulang'
        END
    FROM picking_transactions pt
    LEFT JOIN sku_mapping sm ON sm.sku_id = pt.sku_id
    LEFT JOIN LATERAL (
        SELECT 1 as found FROM integration_log il
        WHERE il.process_name = 'trg_picking_to_analysis'
          AND il.created_at >= pt.created_at - INTERVAL '2 seconds'
          AND il.created_at <= pt.created_at + INTERVAL '5 seconds'
        LIMIT 1
    ) il ON true
    WHERE pt.created_at >= CURRENT_DATE::TIMESTAMP - INTERVAL '3 days'
      AND il.found IS NULL;

    -- 3. Cycle count resolved tanpa integrasi
    RETURN QUERY
    SELECT
        'cycle_count_transactions'::TEXT,
        cct.id::TEXT,
        cct.sku_id,
        COALESCE(sm.material_id, '(not mapped)'),
        TO_CHAR(cct.created_at, 'YYYY-MM-DD HH24:MI:SS'),
        CASE WHEN sm.material_id IS NULL THEN '⚠️ BUAT SKU MAPPING DAHULU'
             ELSE '🔄 RE-INSERT row ini untuk trigger ulang'
        END
    FROM cycle_count_transactions cct
    LEFT JOIN sku_mapping sm ON sm.sku_id = cct.sku_id
    LEFT JOIN LATERAL (
        SELECT 1 as found FROM integration_log il
        WHERE il.process_name = 'trg_cyclecount_to_analysis'
          AND il.created_at >= cct.created_at - INTERVAL '2 seconds'
          AND il.created_at <= cct.created_at + INTERVAL '5 seconds'
        LIMIT 1
    ) il ON true
    WHERE cct.is_resolved = true
      AND cct.created_at >= CURRENT_DATE::TIMESTAMP - INTERVAL '3 days'
      AND il.found IS NULL;

    -- 4. Batch material usage tanpa integrasi
    RETURN QUERY
    SELECT
        'batch_material_usage'::TEXT,
        bmu.id::TEXT,
        bmu.sku_id,
        COALESCE(sm.material_id, '(not mapped)'),
        TO_CHAR(bmu.consumption_date, 'YYYY-MM-DD HH24:MI:SS'),
        CASE WHEN sm.material_id IS NULL THEN '⚠️ BUAT SKU MAPPING DAHULU'
             ELSE '🔄 RE-INSERT row ini untuk trigger ulang'
        END
    FROM batch_material_usage bmu
    LEFT JOIN sku_mapping sm ON sm.sku_id = bmu.sku_id
    LEFT JOIN LATERAL (
        SELECT 1 as found FROM integration_log il
        WHERE il.process_name = 'trg_production_to_analysis'
          AND il.created_at >= bmu.consumption_date::TIMESTAMP - INTERVAL '2 seconds'
          AND il.created_at <= bmu.consumption_date::TIMESTAMP + INTERVAL '5 seconds'
        LIMIT 1
    ) il ON true
    WHERE bmu.consumption_date >= CURRENT_DATE::TIMESTAMP - INTERVAL '3 days'
      AND il.found IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. auto_reprocess_retry()
--    Gabungan: retry failed + deteksi pending
--    Untuk dipanggil manual oleh admin
-- ============================================================
CREATE OR REPLACE FUNCTION auto_reprocess_retry(
    p_dry_run BOOLEAN DEFAULT false
) RETURNS TABLE (
    step TEXT,
    detail TEXT
) AS $$
DECLARE
    v_failed_count INT;
    v_pending_count INT;
BEGIN
    -- Step 1: Retry failed integrations
    SELECT COUNT(*) INTO v_failed_count
    FROM integration_log
    WHERE status = 'failed'
      AND retry_count < 3
      AND created_at >= NOW() - INTERVAL '24 hours';

    step := '1. RETRY FAILED';
    detail := format('%s failed integration(s) ditemukan (max 3 retry)', v_failed_count);
    RETURN NEXT;

    IF NOT p_dry_run AND v_failed_count > 0 THEN
        PERFORM retry_failed_integrations(3, false);
        detail := format('%s failed integration(s) sudah di-retry', v_failed_count);
        RETURN NEXT;
    END IF;

    -- Step 2: Deteksi pending source
    SELECT COUNT(*) INTO v_pending_count
    FROM reprocess_pending_source() rps;

    step := '2. PENDING SOURCE';
    detail := format('%s source row(s) tanpa integrasi dalam 3 hari terakhir', v_pending_count);
    RETURN NEXT;

    IF v_pending_count > 0 THEN
        detail := 'Jalankan: SELECT * FROM reprocess_pending_source() untuk detail';
        RETURN NEXT;
    END IF;

    step := '3. SELESAI';
    detail := format('Retry: %s, Pending: %s, Dry-run: %s',
        v_failed_count::TEXT, v_pending_count::TEXT, p_dry_run::TEXT);
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
