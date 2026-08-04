-- Migration 0027: Batch Dashboard Refresh
-- Compute & persist health_index, capacity_pressure, top_losses to dashboard_metrics

CREATE OR REPLACE FUNCTION batch_dashboard_refresh()
RETURNS TABLE (
    out_action TEXT,
    out_detail TEXT
) AS $$
DECLARE
    v_id TEXT;
    v_now TEXT;
    v_date TEXT;
    v_hour TEXT;
    v_wh_id TEXT;

    v_accuracy_rate DOUBLE PRECISION;
    v_productivity_rate DOUBLE PRECISION;
    v_on_time_shipping_rate DOUBLE PRECISION;
    v_utilization_rate DOUBLE PRECISION;
    v_stock_availability_rate DOUBLE PRECISION;
    v_health_index DOUBLE PRECISION;

    v_yesterday_health DOUBLE PRECISION;
    v_avg7_health DOUBLE PRECISION;
    v_trend TEXT;

    v_total_capacity DOUBLE PRECISION;
    v_used_capacity DOUBLE PRECISION;
    v_available_capacity DOUBLE PRECISION;
    v_utilization_pct DOUBLE PRECISION;
    v_avg_daily_inbound DOUBLE PRECISION;
    v_avg_daily_outbound DOUBLE PRECISION;
    v_days_to_full DOUBLE PRECISION;
    v_capacity_status TEXT;
    v_capacity_pressure_score INT;
    v_predicted_full_date TEXT;

    v_top_losses JSONB;
    v_loss_item1 TEXT;
    v_loss_item2 TEXT;
    v_loss_item3 TEXT;
    v_loss_item4 TEXT;
    v_loss_item5 TEXT;

    v_row_count INT;
    v_start_ts TIMESTAMP;
BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_date := TO_CHAR(NOW(), 'YYYY-MM-DD');
    v_hour := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:00:00');
    v_wh_id := '';

    SELECT COALESCE(AVG(accuracy_pct), 0) INTO v_accuracy_rate
    FROM cycle_count_transactions
    WHERE is_resolved = true
      AND created_at >= CURRENT_DATE::TIMESTAMP;

    SELECT COALESCE(COUNT(*)::DOUBLE PRECISION / 30.0 * 100, 0)
    INTO v_productivity_rate
    FROM picking_transactions
    WHERE created_at >= CURRENT_DATE::TIMESTAMP;

    SELECT CASE
        WHEN COUNT(*) > 0 THEN 95.0
        ELSE 100.0
    END INTO v_on_time_shipping_rate
    FROM shipping_transactions
    WHERE created_at >= CURRENT_DATE::TIMESTAMP;

    SELECT
        COALESCE((SELECT SUM(r.max_capacity) FROM racks r), 0),
        COALESCE((SELECT SUM(m.quantity) FROM materials m WHERE m.rack_id IS NOT NULL AND m.rack_id != ''), 0),
        0
    INTO v_total_capacity, v_used_capacity, v_available_capacity;

    v_utilization_rate := CASE
        WHEN v_total_capacity > 0 THEN (v_used_capacity / v_total_capacity) * 100
        ELSE 0
    END;

    WITH stock_status AS (
        SELECT mm.current_qty, mm.min_stock
        FROM material_metrics mm
        WHERE mm.period_type = 'daily'
          AND mm.period_start = v_date
    )
    SELECT CASE
        WHEN COUNT(*) > 0 THEN
            COUNT(*) FILTER (WHERE current_qty >= min_stock OR min_stock = 0)::DOUBLE PRECISION
            / COUNT(*)::DOUBLE PRECISION * 100
        ELSE 100.0
    END INTO v_stock_availability_rate
    FROM stock_status;

    v_health_index := GREATEST(0, LEAST(100,
        v_accuracy_rate * 0.20 +
        v_productivity_rate * 0.20 +
        v_on_time_shipping_rate * 0.20 +
        (100.0 - v_utilization_rate) * 0.20 +
        v_stock_availability_rate * 0.20
    ));

    SELECT COALESCE(health_index, 0) INTO v_yesterday_health
    FROM dashboard_metrics
    WHERE warehouse_id = v_wh_id
      AND metric_date = TO_CHAR(NOW() - INTERVAL '1 day', 'YYYY-MM-DD')
    ORDER BY metric_hour DESC LIMIT 1;

    SELECT COALESCE(AVG(health_index), 0) INTO v_avg7_health
    FROM dashboard_metrics
    WHERE warehouse_id = v_wh_id
      AND metric_date >= TO_CHAR(NOW() - INTERVAL '7 days', 'YYYY-MM-DD');

    IF v_yesterday_health < v_health_index - 1 THEN
        v_trend := '▲';
    ELSIF v_yesterday_health > v_health_index + 1 THEN
        v_trend := '▼';
    ELSE
        v_trend := '→';
    END IF;

    v_utilization_pct := v_utilization_rate;

    SELECT COALESCE(AVG(qty_received), 0)
    INTO v_avg_daily_inbound
    FROM receiving_transactions
    WHERE created_at >= NOW() - INTERVAL '30 days';

    SELECT COALESCE(AVG(pt.qty_picked), 0)
    INTO v_avg_daily_outbound
    FROM picking_transactions pt
    WHERE pt.created_at >= NOW() - INTERVAL '30 days';

    v_available_capacity := GREATEST(0, v_total_capacity - v_used_capacity);
    v_days_to_full := CASE
        WHEN (v_avg_daily_inbound + v_avg_daily_outbound) > 0
            THEN v_available_capacity / (v_avg_daily_inbound + v_avg_daily_outbound)
        ELSE -1
    END;

    v_capacity_pressure_score := CASE
        WHEN v_utilization_pct >= 95 THEN 100
        WHEN v_utilization_pct >= 80 THEN ((v_utilization_pct - 80) / 15.0 * 100)::INT
        WHEN v_utilization_pct >= 60 THEN ((v_utilization_pct - 60) / 20.0 * 50)::INT
        ELSE 0
    END;
    v_capacity_pressure_score := GREATEST(0, LEAST(100, v_capacity_pressure_score));

    v_capacity_status := CASE
        WHEN v_capacity_pressure_score >= 80 THEN 'critical'
        WHEN v_capacity_pressure_score >= 50 THEN 'warning'
        ELSE 'normal'
    END;

    v_predicted_full_date := CASE
        WHEN v_days_to_full >= 0 AND v_days_to_full < 365
            THEN TO_CHAR(NOW() + (v_days_to_full || ' days')::INTERVAL, 'YYYY-MM-DD')
        ELSE ''
    END;

    SELECT JSONB_AGG(jsonb_build_object(
        'material_id', x.material_id,
        'penalty', ROUND(x.efficiency_penalty_cost::numeric, 0)::TEXT
    ) ORDER BY x.efficiency_penalty_cost DESC)
    INTO v_top_losses
    FROM (
        SELECT cm.material_id, cm.efficiency_penalty_cost
        FROM cost_metrics cm
        WHERE cm.period_start = v_date
          AND cm.efficiency_penalty_cost > 0
        ORDER BY cm.efficiency_penalty_cost DESC
        LIMIT 5
    ) x;

    IF v_top_losses IS NULL THEN
        v_top_losses := '[]'::jsonb;
    END IF;

    SELECT COALESCE(v_top_losses->>0, ''),
           COALESCE(v_top_losses->>1, ''),
           COALESCE(v_top_losses->>2, ''),
           COALESCE(v_top_losses->>3, ''),
           COALESCE(v_top_losses->>4, '')
    INTO v_loss_item1, v_loss_item2, v_loss_item3, v_loss_item4, v_loss_item5;

    v_id := gen_random_uuid()::TEXT;

    INSERT INTO dashboard_metrics (
        id, warehouse_id, metric_date, metric_hour,
        health_index, accuracy_rate, productivity_rate,
        on_time_shipping_rate, utilization_rate, stock_availability_rate,
        yesterday_health_index, avg_7days_health_index, trend_direction,
        capacity_pressure_score, predicted_full_date,
        total_capacity, used_capacity, available_capacity,
        utilization_pct, avg_daily_inbound, avg_daily_outbound,
        days_to_full, capacity_status,
        top_losses,
        biggest_loss_item_1, biggest_loss_item_2, biggest_loss_item_3,
        biggest_loss_item_4, biggest_loss_item_5,
        created_at, updated_at
    ) VALUES (
        v_id, v_wh_id, v_date, v_hour,
        v_health_index, v_accuracy_rate, v_productivity_rate,
        v_on_time_shipping_rate, v_utilization_rate, v_stock_availability_rate,
        v_yesterday_health, v_avg7_health, v_trend,
        v_capacity_pressure_score, v_predicted_full_date,
        v_total_capacity, v_used_capacity, v_available_capacity,
        v_utilization_pct, v_avg_daily_inbound, v_avg_daily_outbound,
        v_days_to_full, v_capacity_status,
        v_top_losses,
        v_loss_item1, v_loss_item2, v_loss_item3,
        v_loss_item4, v_loss_item5,
        v_now, v_now
    ) ON CONFLICT (warehouse_id, metric_date, metric_hour) DO UPDATE SET
        health_index = EXCLUDED.health_index,
        accuracy_rate = EXCLUDED.accuracy_rate,
        productivity_rate = EXCLUDED.productivity_rate,
        on_time_shipping_rate = EXCLUDED.on_time_shipping_rate,
        utilization_rate = EXCLUDED.utilization_rate,
        stock_availability_rate = EXCLUDED.stock_availability_rate,
        yesterday_health_index = EXCLUDED.yesterday_health_index,
        avg_7days_health_index = EXCLUDED.avg_7days_health_index,
        trend_direction = EXCLUDED.trend_direction,
        capacity_pressure_score = EXCLUDED.capacity_pressure_score,
        predicted_full_date = EXCLUDED.predicted_full_date,
        total_capacity = EXCLUDED.total_capacity,
        used_capacity = EXCLUDED.used_capacity,
        available_capacity = EXCLUDED.available_capacity,
        utilization_pct = EXCLUDED.utilization_pct,
        avg_daily_inbound = EXCLUDED.avg_daily_inbound,
        avg_daily_outbound = EXCLUDED.avg_daily_outbound,
        days_to_full = EXCLUDED.days_to_full,
        capacity_status = EXCLUDED.capacity_status,
        top_losses = EXCLUDED.top_losses,
        biggest_loss_item_1 = EXCLUDED.biggest_loss_item_1,
        biggest_loss_item_2 = EXCLUDED.biggest_loss_item_2,
        biggest_loss_item_3 = EXCLUDED.biggest_loss_item_3,
        biggest_loss_item_4 = EXCLUDED.biggest_loss_item_4,
        biggest_loss_item_5 = EXCLUDED.biggest_loss_item_5,
        updated_at = EXCLUDED.updated_at;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    out_action := CASE WHEN v_row_count > 0 THEN 'upserted' ELSE 'noop' END;
    out_detail := format('health=%s trend=%s capacity=%s losses=%s',
        ROUND(v_health_index::numeric, 1)::TEXT, v_trend,
        v_capacity_pressure_score::TEXT, (SELECT jsonb_array_length(v_top_losses))::TEXT);
    RETURN NEXT;

    PERFORM log_integration(
        'batch_dashboard_refresh', 'dashboard_metrics',
        '', '', 'success', 1,
        format('selesai: health=%s trend=%s (durasi=%sms)',
            ROUND(v_health_index::numeric, 1)::TEXT,
            v_trend,
            (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts)) * 1000)::INT::TEXT)
    );

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'batch_dashboard_refresh', 'dashboard_metrics',
        '', '', 'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE;
END;
$$ LANGUAGE plpgsql;
