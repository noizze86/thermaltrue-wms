CREATE TABLE IF NOT EXISTS forecast_metrics (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL DEFAULT '',
    warehouse_id TEXT NOT NULL DEFAULT '',
    period TEXT NOT NULL DEFAULT '',

    forecast_model TEXT NOT NULL DEFAULT 'best',
    forecast_1mo DOUBLE PRECISION DEFAULT 0,
    forecast_3mo DOUBLE PRECISION DEFAULT 0,
    forecast_6mo DOUBLE PRECISION DEFAULT 0,

    confidence_lower_1mo DOUBLE PRECISION DEFAULT 0,
    confidence_upper_1mo DOUBLE PRECISION DEFAULT 0,
    confidence_lower_3mo DOUBLE PRECISION DEFAULT 0,
    confidence_upper_3mo DOUBLE PRECISION DEFAULT 0,
    confidence_lower_6mo DOUBLE PRECISION DEFAULT 0,
    confidence_upper_6mo DOUBLE PRECISION DEFAULT 0,

    mape DOUBLE PRECISION DEFAULT 0,
    mae DOUBLE PRECISION DEFAULT 0,
    rmse DOUBLE PRECISION DEFAULT 0,

    seasonal_index JSONB DEFAULT '[]',
    trend TEXT DEFAULT '→' CHECK (trend IN ('▲','▼','→')),
    is_seasonal BOOLEAN DEFAULT FALSE,

    recommendations TEXT DEFAULT '',

    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),

    UNIQUE(material_id, warehouse_id, period, forecast_model)
);

CREATE INDEX IF NOT EXISTS idx_forecast_material ON forecast_metrics(material_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_period ON forecast_metrics(period DESC);
