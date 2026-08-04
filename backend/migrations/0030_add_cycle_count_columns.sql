-- Migration 0030: Add Cycle Count Columns to material_metrics
-- Tracking last cycle count result per material

ALTER TABLE material_metrics ADD COLUMN IF NOT EXISTS last_cycle_count_qty DOUBLE PRECISION DEFAULT 0;
ALTER TABLE material_metrics ADD COLUMN IF NOT EXISTS last_cycle_count_date TEXT DEFAULT '';
ALTER TABLE material_metrics ADD COLUMN IF NOT EXISTS accuracy_pct DOUBLE PRECISION DEFAULT 0;
