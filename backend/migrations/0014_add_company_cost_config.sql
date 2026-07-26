-- Migration 0014: Add cost config columns + make efficiency fields nullable
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS storage_cost_monthly DOUBLE PRECISION DEFAULT 500000;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS hourly_labor_rate DOUBLE PRECISION DEFAULT 5000;
ALTER TABLE cost_metrics ALTER COLUMN actual_labor_hours DROP NOT NULL;
ALTER TABLE cost_metrics ALTER COLUMN standard_labor_hours DROP NOT NULL;
ALTER TABLE cost_metrics ALTER COLUMN hourly_labor_rate DROP NOT NULL;
ALTER TABLE cost_metrics ALTER COLUMN efficiency_penalty_cost DROP NOT NULL;
ALTER TABLE cost_metrics ALTER COLUMN cost_to_serve_per_order DROP NOT NULL;
