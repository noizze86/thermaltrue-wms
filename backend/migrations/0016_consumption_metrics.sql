CREATE TABLE IF NOT EXISTS consumption_metrics (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL DEFAULT '',
    warehouse_id TEXT NOT NULL DEFAULT '',
    period_type TEXT NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('daily','monthly')),
    period_start TEXT NOT NULL DEFAULT '',
    period_end TEXT NOT NULL DEFAULT '',

    consumption_1mo DOUBLE PRECISION DEFAULT 0,
    consumption_3mo DOUBLE PRECISION DEFAULT 0,
    consumption_6mo DOUBLE PRECISION DEFAULT 0,
    consumption_12mo DOUBLE PRECISION DEFAULT 0,

    avg_monthly_1mo DOUBLE PRECISION DEFAULT 0,
    avg_monthly_3mo DOUBLE PRECISION DEFAULT 0,
    avg_monthly_6mo DOUBLE PRECISION DEFAULT 0,
    avg_monthly_12mo DOUBLE PRECISION DEFAULT 0,

    seasonal_index DOUBLE PRECISION DEFAULT 1.0,
    is_seasonal_high BOOLEAN DEFAULT false,
    is_seasonal_low BOOLEAN DEFAULT false,

    std_dev_consumption DOUBLE PRECISION DEFAULT 0,
    lead_time_days DOUBLE PRECISION DEFAULT 0,
    safety_stock DOUBLE PRECISION DEFAULT 0,
    reorder_point DOUBLE PRECISION DEFAULT 0,

    yesterday_consumption_3mo DOUBLE PRECISION DEFAULT 0,
    avg_7days_consumption_3mo DOUBLE PRECISION DEFAULT 0,
    consumption_trend TEXT DEFAULT '→' CHECK (consumption_trend IN ('▲','▼','→')),

    current_qty DOUBLE PRECISION DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),

    UNIQUE(material_id, warehouse_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_cm_consumption_material ON consumption_metrics(material_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_cm_consumption_warehouse ON consumption_metrics(warehouse_id);
