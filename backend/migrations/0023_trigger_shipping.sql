-- Migration 0023: Trigger Shipping → Cost & Material
-- shipping_transactions = order-level (tanpa sku_id)
-- Distribusi biaya shipping proporsional ke tiap material via picking_transactions

-- ============================================================
-- Trigger Function: trg_shipping_to_analysis
-- Dipanggil AFTER INSERT ON shipping_transactions
-- ============================================================
CREATE OR REPLACE FUNCTION trg_shipping_to_analysis()
RETURNS TRIGGER AS $$
DECLARE
    rec RECORD;
    v_total_qty DOUBLE PRECISION;
    v_material_id TEXT;
    v_warehouse_id TEXT;
    v_portion DOUBLE PRECISION;
    v_shipping_portion DOUBLE PRECISION;
    v_curr_total DOUBLE PRECISION;
    v_curr_margin DOUBLE PRECISION;
    v_is_profitable BOOLEAN;
    v_now TEXT;
    v_period TEXT;
    v_start_ts TIMESTAMP;
    v_success_count INT := 0;
    v_fail_count INT := 0;
    v_last_error TEXT := '';
BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_period := TO_CHAR(NOW(), 'YYYY-MM-DD');

    IF NEW.shipping_cost IS NULL OR NEW.shipping_cost <= 0 THEN
        RETURN NEW;
    END IF;

    -- Hitung total qty pesanan ini
    SELECT COALESCE(SUM(qty_picked), 0) INTO v_total_qty
    FROM picking_transactions
    WHERE order_id = NEW.order_id;

    IF v_total_qty <= 0 THEN
        PERFORM log_integration(
            'trg_shipping_to_analysis', 'shipping_transactions',
            '', '', 'partial', 0,
            format('order_id %s: tidak ada picking ditemukan', NEW.order_id)
        );
        RETURN NEW;
    END IF;

    -- Loop setiap material dalam order ini
    FOR rec IN
        SELECT pt.sku_id, pt.qty_picked, pt.warehouse_id,
               sm.material_id
        FROM picking_transactions pt
        JOIN sku_mapping sm ON sm.sku_id = pt.sku_id
        WHERE pt.order_id = NEW.order_id
    LOOP
        v_material_id := rec.material_id;
        v_warehouse_id := rec.warehouse_id::TEXT;

        -- Proporsi biaya shipping untuk material ini
        v_portion := rec.qty_picked / v_total_qty;
        v_shipping_portion := NEW.shipping_cost::DOUBLE PRECISION * v_portion;

        BEGIN
            -- Update atau insert cost_per_order untuk material ini
            SELECT total_cost, order_margin INTO v_curr_total, v_curr_margin
            FROM cost_per_order
            WHERE transaction_id = NEW.order_id::TEXT
              AND material_id = v_material_id
            ORDER BY created_at DESC LIMIT 1;

            IF v_curr_total IS NULL THEN
                v_curr_total := v_shipping_portion + 2000;
                v_curr_margin := 0;
            ELSE
                v_curr_total := v_curr_total + v_shipping_portion;
                v_curr_margin := v_curr_margin - v_shipping_portion;
            END IF;

            v_is_profitable := (v_curr_margin >= 0);

            INSERT INTO cost_per_order (
                id, transaction_id, material_id,
                picking_cost, packing_cost, shipping_cost, admin_cost,
                total_cost, order_margin, is_profitable, created_at
            ) VALUES (
                gen_random_uuid()::TEXT,
                NEW.order_id::TEXT, v_material_id,
                0, 0, v_shipping_portion, 2000,
                v_curr_total, v_curr_margin, v_is_profitable,
                v_now
            ) ON CONFLICT (id) DO UPDATE SET
                shipping_cost = COALESCE(cost_per_order.shipping_cost, 0) + v_shipping_portion,
                total_cost = v_curr_total,
                order_margin = v_curr_margin,
                is_profitable = v_is_profitable;

            v_success_count := v_success_count + 1;

        EXCEPTION WHEN OTHERS THEN
            v_fail_count := v_fail_count + 1;
            v_last_error := SQLERRM;
        END;
    END LOOP;

    -- Logging
    IF v_fail_count > 0 THEN
        PERFORM log_integration(
            'trg_shipping_to_analysis', 'shipping_transactions',
            '', '', 'partial', v_success_count,
            format('%s dari %s gagal: %s', v_fail_count, v_success_count + v_fail_count, v_last_error),
            0,
            EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
        );
    ELSE
        PERFORM log_integration(
            'trg_shipping_to_analysis', 'shipping_transactions',
            '', '', 'success', v_success_count,
            '', 0,
            EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts))::INT * 1000
        );
    END IF;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'trg_shipping_to_analysis', 'shipping_transactions',
        '', '', 'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE WARNING 'trg_shipping_to_analysis gagal: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Pasang trigger ke shipping_transactions
-- ============================================================
DROP TRIGGER IF EXISTS trg_shipping_to_analysis ON shipping_transactions;
CREATE TRIGGER trg_shipping_to_analysis
    AFTER INSERT ON shipping_transactions
    FOR EACH ROW
    EXECUTE FUNCTION trg_shipping_to_analysis();
