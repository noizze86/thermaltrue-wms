-- Migration 0022: Trigger Receiving → Material & Cost
-- Real-time integration dari receiving_transactions ke analysis tables

-- ============================================================
-- Trigger Function: trg_receiving_to_analysis
-- Dipanggil AFTER INSERT ON receiving_transactions
-- ============================================================
CREATE OR REPLACE FUNCTION trg_receiving_to_analysis()
RETURNS TRIGGER AS $$
DECLARE
    v_material_id TEXT;
    v_warehouse_id TEXT;
    v_period_start TEXT;
    v_period_end TEXT;
    v_metrics_id TEXT;
    v_cost_id TEXT;
    v_now TEXT;
    v_start_ts TIMESTAMP;
    v_old_qty DOUBLE PRECISION;
    v_old_price DOUBLE PRECISION;
    v_new_avg_price DOUBLE PRECISION;
    v_carrying_cost_rate DOUBLE PRECISION;
    v_inventory_value DOUBLE PRECISION;
BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_period_start := TO_CHAR(NOW(), 'YYYY-MM-DD');
    v_period_end := v_period_start;

    -- Guard clause
    IF NEW.sku_id IS NULL OR NEW.qty_received IS NULL OR NEW.qty_received <= 0 THEN
        RETURN NEW;
    END IF;

    -- Ambil material_id dari mapping
    SELECT material_id INTO v_material_id
    FROM sku_mapping WHERE sku_id = NEW.sku_id;

    IF v_material_id IS NULL THEN
        PERFORM log_integration(
            'trg_receiving_to_analysis', 'receiving_transactions',
            '', '', 'failed', 0,
            format('sku_id %s tidak ditemukan di sku_mapping', NEW.sku_id)
        );
        RETURN NEW;
    END IF;

    v_warehouse_id := NEW.warehouse_id::TEXT;

    -- ============================================================
    -- A. Update material_metrics
    --    stock_on_hand (+ qty_received), inventory_value (weighted)
    -- ============================================================
    -- Ambil qty & harga lama dari material_metrics hari ini
    SELECT COALESCE(current_qty, 0), COALESCE(unit_price, 0)
    INTO v_old_qty, v_old_price
    FROM material_metrics
    WHERE material_id = v_material_id
      AND warehouse_id = v_warehouse_id
      AND period_type = 'daily'
      AND period_start = v_period_start;

    -- Hitung weighted average price
    IF v_old_qty + NEW.qty_received > 0 THEN
        v_new_avg_price := (v_old_qty * v_old_price + NEW.qty_received * NEW.purchase_price)
                         / (v_old_qty + NEW.qty_received);
    ELSE
        v_new_avg_price := NEW.purchase_price;
    END IF;

    v_inventory_value := (v_old_qty + NEW.qty_received) * v_new_avg_price;

    v_metrics_id := gen_random_uuid()::TEXT;

    INSERT INTO material_metrics (
        id, material_id, warehouse_id, period_type, period_start, period_end,
        current_qty, outbound_30d, inbound_30d,
        unit_price, inventory_value,
        days_since_last_tx, last_tx_date,
        created_at, updated_at
    ) VALUES (
        v_metrics_id, v_material_id, v_warehouse_id,
        'daily', v_period_start, v_period_end,
        NEW.qty_received, 0, NEW.qty_received,
        v_new_avg_price, v_inventory_value,
        0, v_period_start,
        v_now, v_now
    ) ON CONFLICT (material_id, warehouse_id, period_type, period_start)
    DO UPDATE SET
        current_qty = COALESCE(material_metrics.current_qty, 0) + EXCLUDED.current_qty,
        inbound_30d = COALESCE(material_metrics.inbound_30d, 0) + EXCLUDED.inbound_30d,
        unit_price = EXCLUDED.unit_price,
        inventory_value = (COALESCE(material_metrics.current_qty, 0) + EXCLUDED.current_qty) * EXCLUDED.unit_price,
        updated_at = EXCLUDED.updated_at;

    -- ============================================================
    -- B. Update cost_metrics.purchase_price (weighted average)
    -- ============================================================
    -- Ambil carrying cost rate dari company_profile
    SELECT COALESCE(carrying_cost_rate, 20.0) INTO v_carrying_cost_rate
    FROM company_profile LIMIT 1;

    v_cost_id := gen_random_uuid()::TEXT;

    INSERT INTO cost_metrics (
        id, material_id, warehouse_id, period_type, period_start, period_end,
        purchase_price, carrying_cost_rate, carrying_cost_value,
        total_cost, total_units, true_unit_cost,
        created_at, updated_at
    ) VALUES (
        v_cost_id, v_material_id, v_warehouse_id,
        'daily', v_period_start, v_period_end,
        v_new_avg_price, v_carrying_cost_rate, 0,
        0, 0, v_new_avg_price,
        v_now, v_now
    ) ON CONFLICT (material_id, warehouse_id, period_type, period_start)
    DO UPDATE SET
        purchase_price = EXCLUDED.purchase_price,
        carrying_cost_rate = EXCLUDED.carrying_cost_rate,
        updated_at = EXCLUDED.updated_at;

    -- ============================================================
    -- C. Logging sukses
    -- ============================================================
    PERFORM log_integration(
        'trg_receiving_to_analysis', 'receiving_transactions',
        v_material_id, v_warehouse_id, 'success', 1,
        '', 0,
        EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
    );

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'trg_receiving_to_analysis', 'receiving_transactions',
        v_material_id, v_warehouse_id, 'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE WARNING 'trg_receiving_to_analysis gagal untuk receiving_id=%: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Pasang trigger ke receiving_transactions
-- ============================================================
DROP TRIGGER IF EXISTS trg_receiving_to_analysis ON receiving_transactions;
CREATE TRIGGER trg_receiving_to_analysis
    AFTER INSERT ON receiving_transactions
    FOR EACH ROW
    EXECUTE FUNCTION trg_receiving_to_analysis();
