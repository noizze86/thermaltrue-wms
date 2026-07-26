-- Migration 0013: Cost metrics tables for Cost Analysis

CREATE TABLE IF NOT EXISTS cost_metrics (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL DEFAULT '',
    warehouse_id TEXT NOT NULL DEFAULT '',
    period_type TEXT NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('daily','monthly')),
    period_start TEXT NOT NULL DEFAULT '',
    period_end TEXT NOT NULL DEFAULT '',

    -- Cost Components
    purchase_price DOUBLE PRECISION DEFAULT 0,
    storage_cost DOUBLE PRECISION DEFAULT 0,
    picking_cost DOUBLE PRECISION DEFAULT 0,
    waste_cost DOUBLE PRECISION DEFAULT 0,

    -- Carrying Cost
    carrying_cost_rate DOUBLE PRECISION DEFAULT 0,
    carrying_cost_value DOUBLE PRECISION DEFAULT 0,
    carrying_cost_percent DOUBLE PRECISION DEFAULT 0,

    -- Derived Values
    total_cost DOUBLE PRECISION DEFAULT 0,
    total_units DOUBLE PRECISION DEFAULT 0,
    true_unit_cost DOUBLE PRECISION DEFAULT 0,
    cost_percentage_of_total DOUBLE PRECISION DEFAULT 0,

    -- Efficiency Penalty
    actual_labor_hours DOUBLE PRECISION DEFAULT 0,
    standard_labor_hours DOUBLE PRECISION DEFAULT 0,
    hourly_labor_rate DOUBLE PRECISION DEFAULT 0,
    efficiency_penalty_cost DOUBLE PRECISION DEFAULT 0,
    cost_to_serve_per_order DOUBLE PRECISION DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),

    UNIQUE(material_id, warehouse_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_cm_material ON cost_metrics(material_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_cm_warehouse ON cost_metrics(warehouse_id);

CREATE TABLE IF NOT EXISTS cost_per_order (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL DEFAULT '',
    material_id TEXT NOT NULL DEFAULT '',

    picking_cost DOUBLE PRECISION DEFAULT 0,
    packing_cost DOUBLE PRECISION DEFAULT 0,
    shipping_cost DOUBLE PRECISION DEFAULT 0,
    admin_cost DOUBLE PRECISION DEFAULT 0,

    total_cost DOUBLE PRECISION DEFAULT 0,
    order_margin DOUBLE PRECISION DEFAULT 0,
    is_profitable BOOLEAN DEFAULT true,

    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_cpo_tx ON cost_per_order(transaction_id);
CREATE INDEX IF NOT EXISTS idx_cpo_profit ON cost_per_order(is_profitable) WHERE is_profitable = false;
