-- Migration 0024: Trigger Cycle Count → Material Metrics
-- Menyesuaikan current_qty dan mencatat akurasi inventory

-- ============================================================
-- Trigger Function: trg_cyclecount_to_analysis
-- Dipanggil AFTER INSERT ON cycle_count_transactions (saat resolved)
-- ============================================================
CREATE OR REPLACE FUNCTION trg_cyclecount_to_analysis()
RETURNS TRIGGER AS $$
DECLARE
    v_material_id TEXT;
    v_warehouse_id TEXT;
    v_period TEXT;
    v_now TEXT;
    v_start_ts TIMESTAMP;
    v_metrics_id TEXT;
BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_period := TO_CHAR(NOW(), 'YYYY-MM-DD');

    -- Guard: hanya proses jika resolved
    IF NOT NEW.is_resolved THEN
        RETURN NEW;
    END IF;

    IF NEW.sku_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Ambil material_id
    SELECT material_id INTO v_material_id
    FROM sku_mapping WHERE sku_id = NEW.sku_id;

    IF v_material_id IS NULL THEN
        PERFORM log_integration(
            'trg_cyclecount_to_analysis', 'cycle_count_transactions',
            '', '', 'failed', 0,
            format('sku_id %s tidak ditemukan di sku_mapping', NEW.sku_id)
        );
        RETURN NEW;
    END IF;

    v_warehouse_id := NEW.warehouse_id::TEXT;

    -- ============================================================
    -- Update material_metrics
    --   current_qty → physical_qty (adjustment)
    --   accuracy_pct → record accuracy
    --   last_cycle_count_qty/date → tracking
    -- ============================================================
    INSERT INTO material_metrics (
        id, material_id, warehouse_id,
        period_type, period_start, period_end,
        current_qty, accuracy_pct,
        last_cycle_count_qty, last_cycle_count_date,
        created_at, updated_at
    ) VALUES (
        gen_random_uuid()::TEXT, v_material_id, v_warehouse_id,
        'daily', v_period, v_period,
        NEW.physical_qty, NEW.accuracy_pct,
        NEW.physical_qty, v_period,
        v_now, v_now
    ) ON CONFLICT (material_id, warehouse_id, period_type, period_start)
    DO UPDATE SET
        current_qty = EXCLUDED.current_qty,
        accuracy_pct = EXCLUDED.accuracy_pct,
        last_cycle_count_qty = EXCLUDED.last_cycle_count_qty,
        last_cycle_count_date = EXCLUDED.last_cycle_count_date,
        updated_at = EXCLUDED.updated_at;

    -- ============================================================
    -- Logging
    -- ============================================================
    PERFORM log_integration(
        'trg_cyclecount_to_analysis', 'cycle_count_transactions',
        v_material_id, v_warehouse_id, 'success', 1,
        format('acc=%s%% variance=%s', ROUND(NEW.accuracy_pct::numeric, 1)::TEXT, NEW.variance_qty::TEXT),
        0,
        EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
    );

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'trg_cyclecount_to_analysis', 'cycle_count_transactions',
        v_material_id, v_warehouse_id, 'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE WARNING 'trg_cyclecount_to_analysis gagal: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Pasang trigger ke cycle_count_transactions
-- ============================================================
DROP TRIGGER IF EXISTS trg_cyclecount_to_analysis ON cycle_count_transactions;
CREATE TRIGGER trg_cyclecount_to_analysis
    AFTER INSERT ON cycle_count_transactions
    FOR EACH ROW
    WHEN (NEW.is_resolved = true)
    EXECUTE FUNCTION trg_cyclecount_to_analysis();
