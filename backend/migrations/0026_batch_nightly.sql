-- Migration 0026: Batch Nightly Recalculation
-- Fungsi untuk dipanggil scheduler (Rust endpoint atau pg_cron)
-- Update: stockout_risk, days_cover, dead_stock, slow_moving, turnover, trend

-- ============================================================
-- Fungsi: hitung_stockout_risk
-- ============================================================
CREATE OR REPLACE FUNCTION hitung_stockout_risk(
    p_current_qty DOUBLE PRECISION,
    p_avg_daily DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
BEGIN
    IF p_current_qty <= 0 THEN
        RETURN 100.0;
    END IF;
    IF p_avg_daily <= 0 THEN
        RETURN 0.0;
    END IF;
    -- Risk = (1 - days_cover / 30) * 100, clamp 0-100
    RETURN GREATEST(0, LEAST(100, (1.0 - (p_current_qty / p_avg_daily) / 30.0) * 100.0));
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Fungsi utama: batch_nightly_recalc()
-- Dipanggil setiap malam via scheduler
-- ============================================================
CREATE OR REPLACE FUNCTION batch_nightly_recalc()
RETURNS TABLE (
    out_material_id TEXT,
    out_warehouse_id TEXT,
    out_action TEXT,
    out_detail TEXT
) AS $$
DECLARE
    v_rec RECORD;
    v_avg_daily DOUBLE PRECISION;
    v_days_cover DOUBLE PRECISION;
    v_risk DOUBLE PRECISION;
    v_yesterday_risk DOUBLE PRECISION;
    v_avg7_risk DOUBLE PRECISION;
    v_trend TEXT;
    v_now TEXT;
    v_period TEXT;
    v_prev_period TEXT;
    v_month_start TEXT;
    v_is_dead BOOLEAN;
    v_is_slow BOOLEAN;
    v_turnover DOUBLE PRECISION;
    v_inventory_value DOUBLE PRECISION;
    v_last_tx_date TEXT;
    v_days_since_tx INT;
    v_action TEXT;
    v_detail TEXT;
    v_start_ts TIMESTAMP;
    v_current_qty DOUBLE PRECISION;
    v_unit_price DOUBLE PRECISION;
    v_row_count INT := 0;
BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_period := TO_CHAR(NOW(), 'YYYY-MM-DD');
    v_prev_period := TO_CHAR(NOW() - INTERVAL '1 day', 'YYYY-MM-DD');
    v_month_start := TO_CHAR(DATE_TRUNC('month', NOW()), 'YYYY-MM-DD');

    --- Loop semua material yang punya data
    FOR v_rec IN
        SELECT DISTINCT mm.material_id, mm.warehouse_id
        FROM material_metrics mm
        WHERE mm.period_type = 'daily'
          AND mm.period_start = v_period
    LOOP
        v_action := 'none';
        v_detail := '';

        -- Ambil current_qty
        SELECT mm.current_qty,
               COALESCE(mm.last_tx_date, ''),
               COALESCE(mm.days_since_last_tx, 999)
        INTO v_current_qty, v_last_tx_date, v_days_since_tx
        FROM material_metrics mm
        WHERE mm.material_id = v_rec.material_id
          AND mm.warehouse_id = v_rec.warehouse_id
          AND mm.period_type = 'daily'
          AND mm.period_start = v_period
        LIMIT 1;

        -- Hitung avg_daily_consumption (3 bulan terakhir / 90)
        SELECT COALESCE(AVG(c.consumption_1mo), 0)
        INTO v_avg_daily
        FROM consumption_metrics c
        WHERE c.material_id = v_rec.material_id
          AND c.warehouse_id = v_rec.warehouse_id
          AND c.period_type = 'daily'
          AND c.period_start >= TO_CHAR(NOW() - INTERVAL '90 days', 'YYYY-MM-DD')
          AND c.period_start <= v_period;

        -- ============================================================
        -- 1. days_cover
        -- ============================================================
        IF v_avg_daily > 0 THEN
            v_days_cover := v_current_qty / v_avg_daily;
        ELSE
            v_days_cover := 999;
        END IF;

        -- ============================================================
        -- 2. stockout_risk
        -- ============================================================
        v_risk := hitung_stockout_risk(v_current_qty, v_avg_daily);

        -- Ambil risk kemarin & 7 hari rata-rata untuk trend
        SELECT mm.stockout_risk INTO v_yesterday_risk
        FROM material_metrics mm
        WHERE mm.material_id = v_rec.material_id
          AND mm.warehouse_id = v_rec.warehouse_id
          AND mm.period_type = 'daily'
          AND mm.period_start = v_prev_period;

        SELECT COALESCE(AVG(mm2.stockout_risk), 0) INTO v_avg7_risk
        FROM material_metrics mm2
        WHERE mm2.material_id = v_rec.material_id
          AND mm2.warehouse_id = v_rec.warehouse_id
          AND mm2.period_type = 'daily'
          AND mm2.period_start >= TO_CHAR(NOW() - INTERVAL '7 days', 'YYYY-MM-DD')
          AND mm2.period_start <= v_period;

        IF v_yesterday_risk IS NULL THEN v_yesterday_risk := v_risk; END IF;
        IF v_avg7_risk = 0 THEN v_avg7_risk := v_risk; END IF;

        -- Trend
        IF v_yesterday_risk < v_risk - 2 THEN
            v_trend := '▲';
        ELSIF v_yesterday_risk > v_risk + 2 THEN
            v_trend := '▼';
        ELSE
            v_trend := '→';
        END IF;

        -- ============================================================
        -- 3. is_dead_stock: no tx in 90+ days AND stock > 0
        -- ============================================================
        v_is_dead := (v_current_qty > 0 AND v_days_since_tx >= 90);

        -- ============================================================
        -- 4. is_slow_moving: turnover < 0.5 per bulan
        -- ============================================================
        IF v_avg_daily > 0 AND v_current_qty > 0 THEN
            v_turnover := (v_avg_daily * 30) / NULLIF(v_current_qty, 0);
            v_is_slow := (v_turnover < 0.5);
        ELSE
            v_turnover := 0;
            v_is_slow := (v_current_qty > 0);
        END IF;

        -- ============================================================
        -- 5. inventory_value
        -- ============================================================
        SELECT m.unit_price INTO v_unit_price
        FROM material_metrics m
        WHERE m.material_id = v_rec.material_id
          AND m.warehouse_id = v_rec.warehouse_id
          AND m.period_type = 'daily'
        ORDER BY m.period_start DESC LIMIT 1;
        IF v_unit_price IS NULL THEN v_unit_price := 0; END IF;
        v_inventory_value := v_current_qty * v_unit_price;

        -- ============================================================
        -- UPDATE material_metrics
        -- ============================================================
        UPDATE material_metrics mm3
        SET
            days_cover = v_days_cover,
            stockout_risk = v_risk,
            yesterday_stockout_risk = COALESCE(v_yesterday_risk, v_risk),
            avg_7days_stockout_risk = COALESCE(v_avg7_risk, v_risk),
            risk_trend = v_trend,
            is_dead_stock = v_is_dead,
            is_slow_moving = v_is_slow,
            turnover_ratio = v_turnover,
            inventory_value = v_inventory_value,
            updated_at = v_now
        WHERE mm3.material_id = v_rec.material_id
          AND mm3.warehouse_id = v_rec.warehouse_id
          AND mm3.period_type = 'daily'
          AND mm3.period_start = v_period;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count > 0 THEN
            v_action := 'updated';
            v_detail := format('risk=%s trend=%s dead=%s slow=%s cover=%s',
                ROUND(v_risk::numeric, 1)::TEXT, v_trend,
                v_is_dead::TEXT, v_is_slow::TEXT,
                ROUND(v_days_cover::numeric, 1)::TEXT);
        END IF;

        -- Return row untuk response
        out_material_id := v_rec.material_id;
        out_warehouse_id := v_rec.warehouse_id;
        out_action := v_action;
        out_detail := v_detail;
        RETURN NEXT;

    END LOOP;

    -- Logging
    PERFORM log_integration(
        'batch_nightly_recalc', 'material_metrics',
        '', '', 'success', 1,
        format('selesai: %s material diproses (durasi=%sms)',
            (SELECT COUNT(*) FROM material_metrics WHERE period_type='daily' AND period_start=v_period)::TEXT,
            (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts)) * 1000)::INT::TEXT)
    );

    -- ============================================================
    -- Generate forecast untuk semua material
    -- ============================================================
    PERFORM batch_generate_forecasts();

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'batch_nightly_recalc', 'material_metrics',
        '', '', 'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Fungsi: batch_generate_forecasts()
-- Generate forecast sederhana berdasarkan consumption_metrics
-- Model: simple moving average (SMA) dari data bulanan
-- ============================================================
CREATE OR REPLACE FUNCTION batch_generate_forecasts()
RETURNS TABLE (
    out_material_id TEXT,
    out_forecast_1mo DOUBLE PRECISION,
    out_action TEXT
) AS $$
DECLARE
    v_rec RECORD;
    v_now TEXT;
    v_period TEXT;
    v_month_start TEXT;
    v_avg_monthly DOUBLE PRECISION;
    v_f1 DOUBLE PRECISION;
    v_f3 DOUBLE PRECISION;
    v_f6 DOUBLE PRECISION;
    v_trend TEXT;
    v_recommendations TEXT;
    v_current_qty DOUBLE PRECISION;
    v_forecast_id TEXT;
    v_start_ts TIMESTAMP;
    v_row_count INT := 0;
BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_period := TO_CHAR(NOW(), 'YYYY-MM-DD');
    v_month_start := TO_CHAR(DATE_TRUNC('month', NOW()), 'YYYY-MM-DD');

    FOR v_rec IN
        SELECT DISTINCT mm.material_id, mm.warehouse_id,
               mm.current_qty, mm.consumption_12mo
        FROM material_metrics mm
        WHERE mm.period_type = 'daily'
          AND mm.period_start = v_period
    LOOP
        v_current_qty := v_rec.current_qty;

        -- Hitung average monthly consumption dari consumption_metrics (3 bulan)
        SELECT COALESCE(AVG(c.consumption_1mo), 0)
        INTO v_avg_monthly
        FROM consumption_metrics c
        WHERE c.material_id = v_rec.material_id
          AND c.warehouse_id = v_rec.warehouse_id
          AND c.period_type = 'daily'
          AND c.period_start >= TO_CHAR(NOW() - INTERVAL '90 days', 'YYYY-MM-DD')
          AND c.period_start <= v_period;

        IF v_avg_monthly <= 0 THEN
            v_avg_monthly := 1.0;
        END IF;

        v_f1 := v_avg_monthly;
        v_f3 := v_avg_monthly * 3;
        v_f6 := v_avg_monthly * 6;

        -- Trend: bandingkan dengan consumption 6 bulan lalu
        DECLARE
            v_old_avg DOUBLE PRECISION;
        BEGIN
            SELECT COALESCE(AVG(c2.consumption_1mo), 0)
            INTO v_old_avg
            FROM consumption_metrics c2
            WHERE c2.material_id = v_rec.material_id
              AND c2.warehouse_id = v_rec.warehouse_id
              AND c2.period_type = 'daily'
              AND c2.period_start >= TO_CHAR(NOW() - INTERVAL '180 days', 'YYYY-MM-DD')
              AND c2.period_start <= TO_CHAR(NOW() - INTERVAL '91 days', 'YYYY-MM-DD');

            IF v_old_avg > 0 AND v_avg_monthly > v_old_avg * 1.1 THEN
                v_trend := '▲';
            ELSIF v_old_avg > 0 AND v_avg_monthly < v_old_avg * 0.9 THEN
                v_trend := '▼';
            ELSE
                v_trend := '→';
            END IF;
        END;

        -- Recommendations
        IF v_f1 > v_current_qty THEN
            v_recommendations := format('Reorder needed: current %s < forecast %s/mo.',
                ROUND(v_current_qty::numeric, 0)::TEXT,
                ROUND(v_f1::numeric, 0)::TEXT);
        ELSE
            v_recommendations := format('Stock adequate: %s covers %s/mo forecast.',
                ROUND(v_current_qty::numeric, 0)::TEXT,
                ROUND(v_f1::numeric, 0)::TEXT);
        END IF;

        -- Insert/update forecast_metrics
        v_forecast_id := gen_random_uuid()::TEXT;
        INSERT INTO forecast_metrics (
            id, material_id, warehouse_id, period, forecast_model,
            forecast_1mo, forecast_3mo, forecast_6mo,
            confidence_lower_1mo, confidence_upper_1mo,
            confidence_lower_3mo, confidence_upper_3mo,
            confidence_lower_6mo, confidence_upper_6mo,
            mape, mae, rmse, seasonal_index,
            trend, is_seasonal, recommendations,
            created_at, updated_at
        ) VALUES (
            v_forecast_id, v_rec.material_id, v_rec.warehouse_id,             v_period, 'best',
            ROUND(v_f1::numeric, 2), ROUND(v_f3::numeric, 2), ROUND(v_f6::numeric, 2),
            ROUND((v_f1 * 0.7)::numeric, 2), ROUND((v_f1 * 1.3)::numeric, 2),
            ROUND((v_f3 * 0.7)::numeric, 2), ROUND((v_f3 * 1.3)::numeric, 2),
            ROUND((v_f6 * 0.7)::numeric, 2), ROUND((v_f6 * 1.3)::numeric, 2),
            0, 0, 0, '[1.0,1.0,1.0,1.0]'::jsonb,
            v_trend, false, v_recommendations,
            v_now, v_now
        ) ON CONFLICT (material_id, warehouse_id, period, forecast_model) DO UPDATE SET
            forecast_1mo = EXCLUDED.forecast_1mo,
            forecast_3mo = EXCLUDED.forecast_3mo,
            forecast_6mo = EXCLUDED.forecast_6mo,
            confidence_lower_1mo = EXCLUDED.confidence_lower_1mo,
            confidence_upper_1mo = EXCLUDED.confidence_upper_1mo,
            confidence_lower_3mo = EXCLUDED.confidence_lower_3mo,
            confidence_upper_3mo = EXCLUDED.confidence_upper_3mo,
            confidence_lower_6mo = EXCLUDED.confidence_lower_6mo,
            confidence_upper_6mo = EXCLUDED.confidence_upper_6mo,
            trend = EXCLUDED.trend,
            recommendations = EXCLUDED.recommendations,
            updated_at = EXCLUDED.updated_at;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;

        out_material_id := v_rec.material_id;
        out_forecast_1mo := v_f1;
        out_action := CASE WHEN v_row_count > 0 THEN 'generated' ELSE 'noop' END;
        RETURN NEXT;
    END LOOP;

    PERFORM log_integration(
        'batch_generate_forecasts', 'forecast_metrics',
        '', '', 'success', 1,
        format('selesai: %s material di-forecast (durasi=%sms)',
            (SELECT COUNT(*) FROM forecast_metrics WHERE period=v_period AND forecast_model='best')::TEXT,
            (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts)) * 1000)::INT::TEXT)
    );

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'batch_generate_forecasts', 'forecast_metrics',
        '', '', 'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE;
END;
$$ LANGUAGE plpgsql;
