CREATE TABLE IF NOT EXISTS material_metrics (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL DEFAULT '',
    warehouse_id TEXT NOT NULL DEFAULT '',
    period_type TEXT NOT NULL DEFAULT 'daily' CHECK (period_type IN ('daily','monthly')),
    period_start TEXT NOT NULL DEFAULT '',
    period_end TEXT NOT NULL DEFAULT '',

    current_qty DOUBLE PRECISION DEFAULT 0,
    min_stock DOUBLE PRECISION DEFAULT 0,
    max_stock DOUBLE PRECISION DEFAULT 0,
    stockout_risk DOUBLE PRECISION DEFAULT 0,
    days_cover DOUBLE PRECISION DEFAULT 0,
    is_dead_stock BOOLEAN DEFAULT false,
    is_slow_moving BOOLEAN DEFAULT false,

    turnover_ratio DOUBLE PRECISION DEFAULT 0,
    consumption_3mo DOUBLE PRECISION DEFAULT 0,
    consumption_6mo DOUBLE PRECISION DEFAULT 0,
    consumption_12mo DOUBLE PRECISION DEFAULT 0,
    inbound_30d DOUBLE PRECISION DEFAULT 0,
    outbound_30d DOUBLE PRECISION DEFAULT 0,

    unit_price DOUBLE PRECISION DEFAULT 0,
    inventory_value DOUBLE PRECISION DEFAULT 0,

    yesterday_stockout_risk DOUBLE PRECISION DEFAULT 0,
    avg_7days_stockout_risk DOUBLE PRECISION DEFAULT 0,
    risk_trend TEXT DEFAULT '→' CHECK (risk_trend IN ('▲','▼','→')),

    abc_class TEXT DEFAULT '',
    abc_score DOUBLE PRECISION DEFAULT 0,

    days_since_last_tx INT DEFAULT 0,
    last_tx_date TEXT DEFAULT '',

    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),

    UNIQUE(material_id, warehouse_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_mm_material ON material_metrics(material_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_mm_warehouse ON material_metrics(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_mm_risk ON material_metrics(stockout_risk) WHERE stockout_risk > 70;
CREATE INDEX IF NOT EXISTS idx_mm_dead ON material_metrics(is_dead_stock) WHERE is_dead_stock = true;
