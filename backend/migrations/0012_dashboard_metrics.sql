-- Migration 0012: Dashboard metrics table for persisted analytics + trend tracking

CREATE TABLE IF NOT EXISTS dashboard_metrics (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL DEFAULT '',
    metric_date TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'),
    metric_hour TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:00:00'),

    -- Health Index Components
    health_index DOUBLE PRECISION DEFAULT 0 CHECK (health_index >= 0 AND health_index <= 100),
    accuracy_rate DOUBLE PRECISION DEFAULT 0,
    productivity_rate DOUBLE PRECISION DEFAULT 0,
    on_time_shipping_rate DOUBLE PRECISION DEFAULT 0,
    utilization_rate DOUBLE PRECISION DEFAULT 0,
    stock_availability_rate DOUBLE PRECISION DEFAULT 0,

    -- Trends
    yesterday_health_index DOUBLE PRECISION DEFAULT 0,
    avg_7days_health_index DOUBLE PRECISION DEFAULT 0,
    trend_direction TEXT DEFAULT '→' CHECK (trend_direction IN ('▲','▼','→')),

    -- Capacity Prediction
    capacity_pressure_score INT DEFAULT 0 CHECK (capacity_pressure_score >= 0 AND capacity_pressure_score <= 100),
    predicted_full_date TEXT DEFAULT '',

    -- Top Losses (JSONB)
    top_losses JSONB DEFAULT '[]'::jsonb,

    -- Biggest Losses (separate columns for quick access)
    biggest_loss_item_1 TEXT DEFAULT '',
    biggest_loss_item_2 TEXT DEFAULT '',
    biggest_loss_item_3 TEXT DEFAULT '',
    biggest_loss_item_4 TEXT DEFAULT '',
    biggest_loss_item_5 TEXT DEFAULT '',

    -- Capacity raw data
    total_capacity DOUBLE PRECISION DEFAULT 0,
    used_capacity DOUBLE PRECISION DEFAULT 0,
    available_capacity DOUBLE PRECISION DEFAULT 0,
    utilization_pct DOUBLE PRECISION DEFAULT 0,
    avg_daily_inbound DOUBLE PRECISION DEFAULT 0,
    avg_daily_outbound DOUBLE PRECISION DEFAULT 0,
    days_to_full DOUBLE PRECISION DEFAULT -1,
    capacity_status TEXT DEFAULT 'normal' CHECK (capacity_status IN ('normal','warning','critical')),

    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),

    UNIQUE(warehouse_id, metric_date, metric_hour)
);

CREATE INDEX IF NOT EXISTS idx_dm_warehouse_date ON dashboard_metrics(warehouse_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_dm_health ON dashboard_metrics(health_index) WHERE health_index < 80;
CREATE INDEX IF NOT EXISTS idx_dm_hour ON dashboard_metrics(metric_hour DESC);
