-- Migration 0011: Create analysis_recommendations table and add carrying_cost_rate to company_profile

CREATE TABLE IF NOT EXISTS analysis_recommendations (
    id TEXT PRIMARY KEY,
    menu_source TEXT NOT NULL DEFAULT '',
    recommendation_type TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('critical','warning','info')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
    affected_sku TEXT DEFAULT '',
    impacted_cost DOUBLE PRECISION DEFAULT 0,
    estimated_impact TEXT DEFAULT '',
    root_cause TEXT DEFAULT '',
    solution TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(),'YYYY-MM-DD HH24:MI:SS'),
    acknowledged_by TEXT DEFAULT '',
    acknowledged_at TEXT DEFAULT ''
);

ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS carrying_cost_rate DOUBLE PRECISION DEFAULT 20.0;
