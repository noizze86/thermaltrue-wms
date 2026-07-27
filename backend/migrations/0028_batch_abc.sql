-- Migration 0028: Batch ABC Classification
-- Auto-classify all materials into A/B/C and persist to material_metrics + abc_classification

CREATE OR REPLACE FUNCTION batch_abc_classify()
RETURNS TABLE (
    out_material_id TEXT,
    out_class TEXT,
    out_action TEXT,
    out_detail TEXT
) AS $$
DECLARE
    v_rec RECORD;
    v_now TEXT;
    v_period TEXT;
    v_total_value DOUBLE PRECISION;
    v_cumulative DOUBLE PRECISION;
    v_composite DOUBLE PRECISION;
    v_value_pct DOUBLE PRECISION;
    v_abc_class TEXT;
    v_prev_class TEXT;
    v_action TEXT;
    v_detail TEXT;
    v_start_ts TIMESTAMP;
    v_max_inv_value DOUBLE PRECISION;
    v_max_turnover DOUBLE PRECISION;
    v_max_recency DOUBLE PRECISION;
    v_classification_id TEXT;
    v_xyz_class TEXT;
    v_monthly_std DOUBLE PRECISION;
    v_cv DOUBLE PRECISION;
    v_turnover DOUBLE PRECISION;
    v_days_since DOUBLE PRECISION;

BEGIN
    v_start_ts := clock_timestamp();
    v_now := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    v_period := TO_CHAR(NOW(), 'YYYY-MM-DD');

    -- Hitung total inventory value
    SELECT COALESCE(SUM(inventory_value), 0) INTO v_total_value
    FROM material_metrics
    WHERE period_type = 'daily'
      AND period_start = v_period;

    IF v_total_value = 0 THEN
        out_material_id := '';
        out_class := '';
        out_action := 'skipped';
        out_detail := 'No inventory data for today';
        RETURN NEXT;
        RETURN;
    END IF;

    -- Max values untuk normalisasi
SELECT COALESCE(NULLIF(MAX(inventory_value), 0), 1),
       COALESCE(NULLIF(MAX(turnover_ratio), 0), 1),
       COALESCE(NULLIF(MAX(GREATEST(1, 90 - days_since_last_tx)), 0), 1)
    INTO v_max_inv_value, v_max_turnover, v_max_recency
    FROM material_metrics
    WHERE period_type = 'daily'
      AND period_start = v_period;

    v_cumulative := 0;

    FOR v_rec IN
        SELECT mm.material_id, mm.warehouse_id, mm.current_qty, mm.unit_price,
               mm.inventory_value, mm.turnover_ratio, mm.days_since_last_tx,
               mm.abc_class as current_class,
               COALESCE((SELECT consumption_12mo FROM material_metrics mm2
                WHERE mm2.material_id = mm.material_id
                  AND mm2.warehouse_id = mm.warehouse_id
                  AND mm2.period_type = 'daily'
                  AND mm2.period_start = v_period), 0) as consumption_12mo
        FROM material_metrics mm
        WHERE mm.period_type = 'daily'
          AND mm.period_start = v_period
        ORDER BY mm.inventory_value DESC
    LOOP
        v_prev_class := v_rec.current_class;

        -- Normalized scores (0-1)
        v_value_pct := CASE WHEN v_total_value > 0
            THEN v_rec.inventory_value / v_total_value * 100 ELSE 0 END;

        -- Composite: 40% value contribution + 30% turnover + 30% recency
        v_composite :=
            (v_rec.inventory_value / v_max_inv_value) * 0.40 +
            (v_rec.turnover_ratio / v_max_turnover) * 0.30 +
            (GREATEST(1, 90 - v_rec.days_since_last_tx) / v_max_recency) * 0.30;

        v_cumulative := v_cumulative + v_value_pct;

        -- ABC class by Pareto (cumulative %)
        IF v_cumulative <= 80 THEN
            v_abc_class := 'A';
        ELSIF v_cumulative <= 95 THEN
            v_abc_class := 'B';
        ELSE
            v_abc_class := 'C';
        END IF;

        -- XYZ class (variability of consumption)
        v_turnover := v_rec.turnover_ratio;
        v_days_since := GREATEST(1, v_rec.days_since_last_tx);
        v_monthly_std := ABS(v_turnover * 0.3);
        v_cv := CASE WHEN v_turnover > 0 THEN v_monthly_std / NULLIF(v_turnover, 0) ELSE 999 END;
        v_xyz_class := CASE
            WHEN v_cv < 0.5 THEN 'X'
            WHEN v_cv < 1.0 THEN 'Y'
            ELSE 'Z'
        END;

        -- Update material_metrics
        UPDATE material_metrics mm3
        SET abc_class = v_abc_class,
            abc_score = ROUND((v_composite * 100)::numeric, 2),
            updated_at = v_now
        WHERE mm3.material_id = v_rec.material_id
          AND mm3.warehouse_id = v_rec.warehouse_id
          AND mm3.period_type = 'daily'
          AND mm3.period_start = v_period;

        -- Insert/update abc_classification table
        v_classification_id := gen_random_uuid()::TEXT;
        INSERT INTO abc_classification (
            id, material_id, warehouse_id, period, analysis_mode,
            abc_class, xyz_class, composite_score,
            value_score, frequency_score, criticality_score,
            value_contribution_pct,
            consumption_12mo, turnover, current_qty, unit_price, inventory_value,
            previous_class, days_since_class_change,
            created_at, updated_at
        ) VALUES (
            v_classification_id, v_rec.material_id, v_rec.warehouse_id, v_period, 'batch_auto',
            v_abc_class, v_xyz_class, ROUND((v_composite * 100)::numeric, 2),
            ROUND((v_rec.inventory_value / v_max_inv_value)::numeric, 4),
            ROUND((v_rec.turnover_ratio / v_max_turnover)::numeric, 4),
            ROUND((GREATEST(1, 90 - v_rec.days_since_last_tx) / v_max_recency)::numeric, 4),
            ROUND(v_value_pct::numeric, 2),
            v_rec.consumption_12mo, v_rec.turnover_ratio,
            v_rec.current_qty, v_rec.unit_price, v_rec.inventory_value,
            COALESCE(v_prev_class, ''), 0,
            v_now, v_now
        ) ON CONFLICT (material_id, warehouse_id, analysis_mode, period) DO UPDATE SET
            abc_class = EXCLUDED.abc_class,
            xyz_class = EXCLUDED.xyz_class,
            composite_score = EXCLUDED.composite_score,
            value_score = EXCLUDED.value_score,
            frequency_score = EXCLUDED.frequency_score,
            criticality_score = EXCLUDED.criticality_score,
            value_contribution_pct = EXCLUDED.value_contribution_pct,
            consumption_12mo = EXCLUDED.consumption_12mo,
            turnover = EXCLUDED.turnover,
            current_qty = EXCLUDED.current_qty,
            unit_price = EXCLUDED.unit_price,
            inventory_value = EXCLUDED.inventory_value,
            updated_at = EXCLUDED.updated_at;

        -- Log jika class berubah
        IF v_prev_class != '' AND v_prev_class != v_abc_class THEN
            INSERT INTO abc_change_history (material_id, warehouse_id, period,
                previous_class, new_class, previous_score, new_score, reason, changed_by)
            VALUES (v_rec.material_id, v_rec.warehouse_id, v_period,
                v_prev_class, v_abc_class, 0, ROUND((v_composite * 100)::numeric, 2),
                'batch_auto', 'system');
        END IF;

        out_material_id := v_rec.material_id;
        out_class := v_abc_class;
        out_action := CASE WHEN v_prev_class != v_abc_class THEN 'reclassified' ELSE 'confirmed' END;
        out_detail := format('abc=%s xyz=%s score=%s value_pct=%s',
            v_abc_class, v_xyz_class, ROUND((v_composite * 100)::numeric, 1)::TEXT,
            ROUND(v_value_pct::numeric, 1)::TEXT);
        RETURN NEXT;
    END LOOP;

    PERFORM log_integration(
        'batch_abc_classify', 'material_metrics',
        '', '', 'success', 1,
        format('selesai: %s material diklasifikasi (durasi=%sms)',
            (SELECT COUNT(*) FROM material_metrics
             WHERE period_type='daily' AND period_start=v_period AND abc_class != '')::TEXT,
            (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts)) * 1000)::INT::TEXT)
    );

EXCEPTION WHEN OTHERS THEN
    PERFORM log_integration(
        'batch_abc_classify', 'material_metrics',
        '', '', 'failed', 0,
        LEFT(SQLERRM, 500)
    );
    RAISE;
END;
$$ LANGUAGE plpgsql;
