-- Migration 0031: Integrate transactions → Source Tables
-- Bridge the gap: Goods In/Out UI → receiving_transactions / picking_transactions → analysis tables

-- ============================================================
-- 1. Add warehouse_text_id column
--    Menampung TEXT warehouse UUID dari transactions table
-- ============================================================
ALTER TABLE receiving_transactions ADD COLUMN IF NOT EXISTS warehouse_text_id TEXT DEFAULT '';
ALTER TABLE picking_transactions ADD COLUMN IF NOT EXISTS warehouse_text_id TEXT DEFAULT '';

-- ============================================================
-- 2. Update trg_receiving_to_analysis — gunakan warehouse_text_id
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

    IF NEW.sku_id IS NULL OR NEW.qty_received IS NULL OR NEW.qty_received <= 0 THEN
        RETURN NEW;
    END IF;

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

    v_warehouse_id := COALESCE(NULLIF(NEW.warehouse_text_id, ''), NEW.warehouse_id::TEXT);

    SELECT COALESCE(current_qty, 0), COALESCE(unit_price, 0)
    INTO v_old_qty, v_old_price
    FROM material_metrics
    WHERE material_id = v_material_id
      AND warehouse_id = v_warehouse_id
      AND period_type = 'daily'
      AND period_start = v_period_start;

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
-- 3. Update trg_picking_to_analysis — gunakan warehouse_text_id
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

    IF NEW.sku_id IS NULL OR NEW.qty_picked IS NULL OR NEW.qty_picked <= 0 THEN
        RETURN NEW;
    END IF;

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

    v_warehouse_id := COALESCE(NULLIF(NEW.warehouse_text_id, ''), NEW.warehouse_id::TEXT);
    v_period_start := TO_CHAR(NEW.pick_date, 'YYYY-MM-DD');
    v_period_end := TO_CHAR(NEW.pick_date, 'YYYY-MM-DD');
    v_hourly_rate := get_hourly_rate();

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

    UPDATE material_metrics
    SET days_since_last_tx = 0,
        last_tx_date = v_period_start
    WHERE material_id = v_material_id
      AND warehouse_id = v_warehouse_id;

    v_picking_cost := NEW.pick_time_seconds * (v_hourly_rate / 3600.0);
    v_total_cost := v_picking_cost;
    v_order_margin := 0;

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

    PERFORM log_integration(
        'trg_picking_to_analysis', 'picking_transactions',
        v_material_id, v_warehouse_id, 'success', 1,
        '', 0,
        EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
    );

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
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
-- 4. Trigger: trg_transactions_to_source
--    Menjembatani transactions → receiving/picking_transactions
--    Bekerja dengan prinsip: jangan pernah rollback transaksi utama
-- ============================================================
CREATE OR REPLACE FUNCTION trg_transactions_to_source()
RETURNS TRIGGER AS $$
DECLARE
    v_sku_id INT;
    v_warehouse_int INT;
    v_start_ts TIMESTAMP;
    v_source_id INT;
BEGIN
    v_start_ts := clock_timestamp();

    -- Guard: hanya proses jika quantity valid
    IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
        RETURN NEW;
    END IF;

    -- Guard: hanya untuk tipe 'in' dan 'out'
    IF NEW.type NOT IN ('in', 'out') THEN
        RETURN NEW;
    END IF;

    -- Resolve material_id → sku_id
    SELECT sku_id INTO v_sku_id
    FROM sku_mapping
    WHERE material_id = NEW.material_id
    LIMIT 1;

    IF v_sku_id IS NULL THEN
        -- Auto-create mapping
        INSERT INTO sku_mapping (material_id, warehouse_id, sku_code, sku_name, is_active)
        VALUES (NEW.material_id, COALESCE(NEW.warehouse_id, ''), '', '', true)
        RETURNING sku_id INTO v_sku_id;
    END IF;

    -- Warehouse: hash UUID to INT (deterministic)
    SELECT ('x' || SUBSTRING(MD5(COALESCE(NEW.warehouse_id, '0')), 1, 8))::BIT(32)::INT
    INTO v_warehouse_int;

    IF NEW.type = 'in' THEN
        INSERT INTO receiving_transactions (
            sku_id, warehouse_id, warehouse_text_id,
            qty_received, purchase_price,
            receipt_date, created_at
        ) VALUES (
            v_sku_id, v_warehouse_int, NEW.warehouse_id,
            NEW.quantity::INT, COALESCE(NEW.price, 0),
            COALESCE(NEW.created_at::TIMESTAMP, NOW()), NOW()
        )
        RETURNING id INTO v_source_id;

        PERFORM log_integration(
            'trg_transactions_to_source', 'transactions',
            NEW.material_id, COALESCE(NEW.warehouse_id, ''),
            'success', 1,
            format('type=in sku=%s qty=%s receiving_id=%s', v_sku_id::TEXT, NEW.quantity::TEXT, v_source_id::TEXT),
            0,
            EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
        );

    ELSIF NEW.type = 'out' THEN
        INSERT INTO picking_transactions (
            sku_id, warehouse_id, warehouse_text_id,
            qty_picked, order_id, pick_date, created_at
        ) VALUES (
            v_sku_id, v_warehouse_int, NEW.warehouse_id,
            NEW.quantity::INT, 0,
            COALESCE(NEW.created_at::TIMESTAMP, NOW()), NOW()
        )
        RETURNING id INTO v_source_id;

        PERFORM log_integration(
            'trg_transactions_to_source', 'transactions',
            NEW.material_id, COALESCE(NEW.warehouse_id, ''),
            'success', 1,
            format('type=out sku=%s qty=%s picking_id=%s', v_sku_id::TEXT, NEW.quantity::TEXT, v_source_id::TEXT),
            0,
            EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
        );
    END IF;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'trg_transactions_to_source', 'transactions',
        NEW.material_id, COALESCE(NEW.warehouse_id, ''),
        'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE WARNING 'trg_transactions_to_source gagal untuk tx=%s type=%s: %', NEW.id, NEW.type, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Pasang trigger ke transactions table
--    AFTER INSERT, untuk status approved (aktif langsung)
-- ============================================================
DROP TRIGGER IF EXISTS trg_transactions_to_source ON transactions;
CREATE TRIGGER trg_transactions_to_source
    AFTER INSERT ON transactions
    FOR EACH ROW
    WHEN (NEW.status IN ('approved', '') OR NEW.status IS NULL)
    EXECUTE FUNCTION trg_transactions_to_source();

-- ============================================================
-- 6. Recreate triggers on source tables (biar pakai function baru)
-- ============================================================
DROP TRIGGER IF EXISTS trg_receiving_to_analysis ON receiving_transactions;
CREATE TRIGGER trg_receiving_to_analysis
    AFTER INSERT ON receiving_transactions
    FOR EACH ROW
    EXECUTE FUNCTION trg_receiving_to_analysis();

DROP TRIGGER IF EXISTS trg_picking_to_analysis ON picking_transactions;
CREATE TRIGGER trg_picking_to_analysis
    AFTER INSERT ON picking_transactions
    FOR EACH ROW
    EXECUTE FUNCTION trg_picking_to_analysis();
