-- Migration 0021: Trigger Picking → Consumption, Material, Cost
-- Real-time integration dari picking_transactions ke analysis tables

-- ============================================================
-- Pastikan extension uuid tersedia (built-in PG 13+)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Helper: ambil hourly_labor_rate dari company_profile
-- ============================================================
CREATE OR REPLACE FUNCTION get_hourly_rate()
RETURNS DOUBLE PRECISION AS $$
DECLARE
    v_rate DOUBLE PRECISION;
BEGIN
    SELECT COALESCE(hourly_labor_rate, 5000) INTO v_rate
    FROM company_profile LIMIT 1;
    RETURN v_rate;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Trigger Function: trg_picking_to_analysis
-- Dipanggil AFTER INSERT ON picking_transactions
-- ============================================================
CREATE OR REPLACE FUNCTION trg_picking_to_analysis()
RETURNS TRIGGER AS $$
DECLARE
    v_material_id TEXT;
    v_warehouse_id TEXT;
    v_period_start TEXT;
    v_period_end TEXT;
    v_period TEXT;
    v_consumption_id TEXT;
    v_metrics_id TEXT;
    v_cpo_id TEXT;
    v_hourly_rate DOUBLE PRECISION;
    v_picking_cost DOUBLE PRECISION;
    v_total_cost DOUBLE PRECISION;
    v_is_profitable BOOLEAN;
    v_order_margin DOUBLE PRECISION;
    v_now TEXT;
    v_start_ts TIMESTAMP;
    v_log_id INT;
BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_period := TO_CHAR(NOW(), 'YYYY-MM-DD');

    -- Validasi guard clause: jangan proses jika data tidak valid
    IF NEW.sku_id IS NULL OR NEW.qty_picked IS NULL OR NEW.qty_picked <= 0 THEN
        RETURN NEW;
    END IF;

    -- Ambil material_id dari mapping
    SELECT material_id INTO v_material_id
    FROM sku_mapping WHERE sku_id = NEW.sku_id;

    IF v_material_id IS NULL THEN
        PERFORM log_integration(
            'trg_picking_to_analysis', 'picking_transactions',
            '', '', 'failed', 0,
            format('sku_id %s tidak ditemukan di sku_mapping', NEW.sku_id)
        );
        RETURN NEW;
    END IF;

    v_warehouse_id := NEW.warehouse_id::TEXT;
    v_period_start := TO_CHAR(NEW.pick_date, 'YYYY-MM-DD');
    v_period_end := TO_CHAR(NEW.pick_date, 'YYYY-MM-DD');
    v_hourly_rate := get_hourly_rate();

    -- ============================================================
    -- A. Update consumption_metrics
    --    Akumulasi actual_consumption harian
    -- ============================================================
    v_consumption_id := gen_random_uuid()::TEXT;

    INSERT INTO consumption_metrics (
        id, material_id, warehouse_id, period_type, period_start, period_end,
        consumption_1mo, consumption_3mo, consumption_6mo, consumption_12mo,
        avg_monthly_1mo, avg_monthly_3mo, avg_monthly_6mo, avg_monthly_12mo,
        current_qty, created_at, updated_at
    ) VALUES (
        v_consumption_id, v_material_id, v_warehouse_id,
        'daily', v_period_start, v_period_end,
        NEW.qty_picked, NEW.qty_picked, NEW.qty_picked, NEW.qty_picked,
        NEW.qty_picked, NEW.qty_picked, NEW.qty_picked, NEW.qty_picked,
        0, v_now, v_now
    ) ON CONFLICT (material_id, warehouse_id, period_type, period_start)
    DO UPDATE SET
        consumption_1mo = COALESCE(consumption_metrics.consumption_1mo, 0) + EXCLUDED.consumption_1mo,
        consumption_3mo = COALESCE(consumption_metrics.consumption_3mo, 0) + EXCLUDED.consumption_3mo,
        consumption_6mo = COALESCE(consumption_metrics.consumption_6mo, 0) + EXCLUDED.consumption_6mo,
        consumption_12mo = COALESCE(consumption_metrics.consumption_12mo, 0) + EXCLUDED.consumption_12mo,
        avg_monthly_1mo = COALESCE(consumption_metrics.avg_monthly_1mo, 0) + EXCLUDED.avg_monthly_1mo,
        avg_monthly_3mo = COALESCE(consumption_metrics.avg_monthly_3mo, 0) + EXCLUDED.avg_monthly_3mo,
        avg_monthly_6mo = COALESCE(consumption_metrics.avg_monthly_6mo, 0) + EXCLUDED.avg_monthly_6mo,
        avg_monthly_12mo = COALESCE(consumption_metrics.avg_monthly_12mo, 0) + EXCLUDED.avg_monthly_12mo,
        updated_at = EXCLUDED.updated_at;

    -- ============================================================
    -- B. Update material_metrics
    --    pick_frequency, total_qty_picked, days_since_last_pick
    -- ============================================================
    v_metrics_id := gen_random_uuid()::TEXT;

    INSERT INTO material_metrics (
        id, material_id, warehouse_id, period_type, period_start, period_end,
        outbound_30d, days_since_last_tx, last_tx_date,
        created_at, updated_at
    ) VALUES (
        v_metrics_id, v_material_id, v_warehouse_id,
        'daily', v_period_start, v_period_end,
        NEW.qty_picked, 0, v_period_start,
        v_now, v_now
    ) ON CONFLICT (material_id, warehouse_id, period_type, period_start)
    DO UPDATE SET
        outbound_30d = COALESCE(material_metrics.outbound_30d, 0) + EXCLUDED.outbound_30d,
        days_since_last_tx = 0,
        last_tx_date = EXCLUDED.last_tx_date,
        updated_at = EXCLUDED.updated_at;

    -- Reset days_since_last_tx untuk semua record material ini (bulanan juga)
    UPDATE material_metrics
    SET days_since_last_tx = 0,
        last_tx_date = v_period_start
    WHERE material_id = v_material_id
      AND warehouse_id = v_warehouse_id;

    -- ============================================================
    -- C. Insert cost_per_order + Update cost_metrics.picking_cost
    --    Biaya picking = pick_time_seconds * hourly_rate / 3600
    -- ============================================================
    v_picking_cost := NEW.pick_time_seconds * (v_hourly_rate / 3600.0);
    v_total_cost := v_picking_cost; -- + packing + admin (0 untuk sekarang)
    v_order_margin := 0; -- akan diupdate oleh shipping trigger nanti

    v_cpo_id := gen_random_uuid()::TEXT;

    INSERT INTO cost_per_order (
        id, transaction_id, material_id,
        picking_cost, packing_cost, shipping_cost, admin_cost,
        total_cost, order_margin, is_profitable, created_at
    ) VALUES (
        v_cpo_id, NEW.id::TEXT, v_material_id,
        v_picking_cost, 0, 0, 2000,
        v_total_cost, v_order_margin, (v_order_margin > 0), v_now
    ) ON CONFLICT(id) DO NOTHING;

    -- ============================================================
    -- D. Logging sukses
    -- ============================================================
    PERFORM log_integration(
        'trg_picking_to_analysis', 'picking_transactions',
        v_material_id, v_warehouse_id, 'success', 1,
        '', 0,
        EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
    );

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    -- Error handling: log dan lanjutkan (jangan rollback transaksi utama)
    PERFORM log_integration(
        'trg_picking_to_analysis', 'picking_transactions',
        v_material_id, v_warehouse_id, 'failed', 0,
        LEFT(SQLERRM, 500)
    );

    RAISE WARNING 'trg_picking_to_analysis gagal untuk picking_id=%: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Pasang trigger ke picking_transactions
-- ============================================================
DROP TRIGGER IF EXISTS trg_picking_to_analysis ON picking_transactions;
CREATE TRIGGER trg_picking_to_analysis
    AFTER INSERT ON picking_transactions
    FOR EACH ROW
    EXECUTE FUNCTION trg_picking_to_analysis();
