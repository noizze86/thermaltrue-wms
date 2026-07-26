CREATE TABLE IF NOT EXISTS abc_classification (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL DEFAULT '',
    warehouse_id TEXT NOT NULL DEFAULT '',
    period TEXT NOT NULL DEFAULT '',
    analysis_mode TEXT NOT NULL DEFAULT 'single' CHECK (analysis_mode IN ('single','multi')),

    abc_class TEXT NOT NULL DEFAULT 'C' CHECK (abc_class IN ('A','B','C')),
    xyz_class TEXT DEFAULT 'Z' CHECK (xyz_class IN ('X','Y','Z')),

    composite_score DOUBLE PRECISION DEFAULT 0,
    value_score DOUBLE PRECISION DEFAULT 0,
    frequency_score DOUBLE PRECISION DEFAULT 0,
    criticality_score DOUBLE PRECISION DEFAULT 0,
    value_contribution_pct DOUBLE PRECISION DEFAULT 0,

    consumption_12mo DOUBLE PRECISION DEFAULT 0,
    turnover DOUBLE PRECISION DEFAULT 0,
    current_qty DOUBLE PRECISION DEFAULT 0,
    unit_price DOUBLE PRECISION DEFAULT 0,
    inventory_value DOUBLE PRECISION DEFAULT 0,

    previous_class TEXT DEFAULT '',
    days_since_class_change INT DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),

    UNIQUE(material_id, warehouse_id, analysis_mode, period)
);

CREATE INDEX IF NOT EXISTS idx_abc_material ON abc_classification(material_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_abc_class ON abc_classification(abc_class);
CREATE INDEX IF NOT EXISTS idx_abc_period ON abc_classification(period DESC);
