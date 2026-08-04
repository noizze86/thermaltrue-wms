-- Migration 0025: Trigger Production Batch → Consumption, Material, Cost
-- batch_material_usage INSERT = konsumsi material riil

-- ============================================================
-- Trigger Function: trg_production_to_analysis
-- Dipanggil AFTER INSERT ON batch_material_usage
-- ============================================================
CREATE OR REPLACE FUNCTION trg_production_to_analysis()
RETURNS TRIGGER AS $$
DECLARE
    v_material_id TEXT;
    v_warehouse_id TEXT;
    v_period TEXT;
    v_now TEXT;
    v_start_ts TIMESTAMP;
    v_consumed_qty DOUBLE PRECISION;
    v_reject_cost DOUBLE PRECISION;
    v_unit_price DOUBLE PRECISION;
BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_period := TO_CHAR(NOW(), 'YYYY-MM-DD');

    -- Guard clause
    IF NEW.sku_id IS NULL OR NEW.actual_qty IS NULL OR NEW.actual_qty <= 0 THEN
        RETURN NEW;
    END IF;

    -- Ambil material_id dari mapping
    SELECT material_id INTO v_material_id
    FROM sku_mapping WHERE sku_id = NEW.sku_id;

    IF v_material_id IS NULL THEN
        PERFORM log_integration(
            'trg_production_to_analysis', 'batch_material_usage',
            '', '', 'failed', 0,
            format('sku_id %s tidak ditemukan di sku_mapping', NEW.sku_id)
        );
        RETURN NEW;
    END IF;

    v_warehouse_id := NEW.warehouse_id::TEXT;
    v_consumed_qty := NEW.actual_qty + COALESCE(NEW.reject_qty, 0);

    -- Ambil unit_price terakhir
    SELECT unit_price INTO v_unit_price
    FROM material_metrics
    WHERE material_id = v_material_id
      AND warehouse_id = v_warehouse_id
    ORDER BY created_at DESC LIMIT 1;

    IF v_unit_price IS NULL THEN v_unit_price := 0; END IF;

    v_reject_cost := COALESCE(NEW.reject_qty, 0) * v_unit_price;

    -- ============================================================
    -- A. Update consumption_metrics
    --    actual_consumption = actual_qty + reject_qty
    -- ============================================================
    INSERT INTO consumption_metrics (
        id, material_id, warehouse_id, period_type, period_start, period_end,
        consumption_1mo, consumption_3mo, consumption_6mo, consumption_12mo,
        avg_monthly_1mo, avg_monthly_3mo, avg_monthly_6mo, avg_monthly_12mo,
        current_qty, created_at, updated_at
    ) VALUES (
        gen_random_uuid()::TEXT, v_material_id, v_warehouse_id,
        'daily', v_period, v_period,
        v_consumed_qty, v_consumed_qty, v_consumed_qty, v_consumed_qty,
        v_consumed_qty, v_consumed_qty, v_consumed_qty, v_consumed_qty,
        0, v_now, v_now
    ) ON CONFLICT (material_id, warehouse_id, period_type, period_start)
    DO UPDATE SET
        consumption_1mo = COALESCE(consumption_metrics.consumption_1mo, 0) + EXCLUDED.consumption_1mo,
        consumption_3mo = COALESCE(consumption_metrics.consumption_3mo, 0) + EXCLUDED.consumption_3mo,
        consumption_6mo = COALESCE(consumption_metrics.consumption_6mo, 0) + EXCLUDED.consumption_6mo,
        consumption_12mo = COALESCE(consumption_metrics.consumption_12mo, 0) + EXCLUDED.consumption_12mo,
        updated_at = EXCLUDED.updated_at;

    -- ============================================================
    -- B. Update material_metrics.current_qty (kurangi stock)
    -- ============================================================
    INSERT INTO material_metrics (
        id, material_id, warehouse_id, period_type, period_start, period_end,
        current_qty, created_at, updated_at
    ) VALUES (
        gen_random_uuid()::TEXT, v_material_id, v_warehouse_id,
        'daily', v_period, v_period,
        -v_consumed_qty, v_now, v_now
    ) ON CONFLICT (material_id, warehouse_id, period_type, period_start)
    DO UPDATE SET
        current_qty = COALESCE(material_metrics.current_qty, 0) - v_consumed_qty,
        updated_at = EXCLUDED.updated_at;

    -- ============================================================
    -- C. Update cost_metrics.efficiency_penalty_cost (reject_cost)
    -- ============================================================
    IF v_reject_cost > 0 THEN
        INSERT INTO cost_metrics (
            id, material_id, warehouse_id, period_type, period_start, period_end,
            efficiency_penalty_cost, total_cost, total_units, true_unit_cost,
            created_at, updated_at
        ) VALUES (
            gen_random_uuid()::TEXT, v_material_id, v_warehouse_id,
            'daily', v_period, v_period,
            v_reject_cost, v_reject_cost, NEW.reject_qty,
            v_reject_cost / NULLIF(NEW.reject_qty, 0),
            v_now, v_now
        ) ON CONFLICT (material_id, warehouse_id, period_type, period_start)
        DO UPDATE SET
            efficiency_penalty_cost = COALESCE(cost_metrics.efficiency_penalty_cost, 0) + EXCLUDED.efficiency_penalty_cost,
            total_cost = COALESCE(cost_metrics.total_cost, 0) + EXCLUDED.total_cost,
            total_units = COALESCE(cost_metrics.total_units, 0) + EXCLUDED.total_units,
            updated_at = EXCLUDED.updated_at;
    END IF;

    -- ============================================================
    -- D. Logging
    -- ============================================================
    PERFORM log_integration(
        'trg_production_to_analysis', 'batch_material_usage',
        v_material_id, v_warehouse_id, 'success', 1,
        format('consumed=%s reject_cost=%s', v_consumed_qty::TEXT, ROUND(v_reject_cost::numeric)::TEXT),
        0,
        EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
    );

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'trg_production_to_analysis', 'batch_material_usage',
        v_material_id, v_warehouse_id, 'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE WARNING 'trg_production_to_analysis gagal: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Pasang trigger ke batch_material_usage
-- ============================================================
DROP TRIGGER IF EXISTS trg_production_to_analysis ON batch_material_usage;
CREATE TRIGGER trg_production_to_analysis
    AFTER INSERT ON batch_material_usage
    FOR EACH ROW
    EXECUTE FUNCTION trg_production_to_analysis();
