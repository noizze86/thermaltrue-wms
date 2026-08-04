-- Migration 0036: Cycle Count Workflow
-- Extends stock_opname / stock_opname_items with cycle count task fields.
-- Adds cycle zone rotation and history logging tables.
-- Adds granular cycle count permissions to roles.

-- ---------------------------------------------------------------
-- stock_opname: task-oriented fields
-- ---------------------------------------------------------------
ALTER TABLE stock_opname ADD COLUMN IF NOT EXISTS cycle_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE stock_opname ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'opname';
ALTER TABLE stock_opname ADD COLUMN IF NOT EXISTS deadline TEXT DEFAULT '';
ALTER TABLE stock_opname ADD COLUMN IF NOT EXISTS blind_mode BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE stock_opname ADD COLUMN IF NOT EXISTS tolerance_pct DOUBLE PRECISION DEFAULT 5;
ALTER TABLE stock_opname ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT '';
ALTER TABLE stock_opname ADD COLUMN IF NOT EXISTS zone_id TEXT DEFAULT '';
ALTER TABLE stock_opname ADD COLUMN IF NOT EXISTS recount_of TEXT DEFAULT '';

-- ---------------------------------------------------------------
-- stock_opname_items: reconciliation fields
-- ---------------------------------------------------------------
ALTER TABLE stock_opname_items ADD COLUMN IF NOT EXISTS cycle_round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stock_opname_items ADD COLUMN IF NOT EXISTS approved_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE stock_opname_items ADD COLUMN IF NOT EXISTS reviewer_id TEXT DEFAULT '';
ALTER TABLE stock_opname_items ADD COLUMN IF NOT EXISTS reviewed_at TEXT DEFAULT '';
ALTER TABLE stock_opname_items ADD COLUMN IF NOT EXISTS remark TEXT DEFAULT '';

-- ---------------------------------------------------------------
-- cycle_count_zones: zone rotation scheduler support
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_count_zones (
    id          TEXT PRIMARY KEY,
    zone_id     TEXT NOT NULL,
    warehouse_id TEXT,
    assign_mode TEXT NOT NULL DEFAULT 'daily',   -- 'daily' | 'weekly'
    last_date   TEXT DEFAULT '',
    next_date   TEXT NOT NULL DEFAULT to_char(CURRENT_DATE::timestamp with time zone, 'YYYY-MM-DD'),
    created_at  TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ---------------------------------------------------------------
-- cycle_count_history: stock change audit trail per task
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_count_history (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    material_id TEXT DEFAULT '',
    action      TEXT NOT NULL,                 -- 'count_submit' | 'approve' | 'reject' | 'recount' | 'adjust_manual'
    before_qty  DOUBLE PRECISION DEFAULT 0,
    after_qty   DOUBLE PRECISION DEFAULT 0,
    changed_by  TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ---------------------------------------------------------------
-- Permissions (granular cycle count)
--   assign   -> create/assign/schedule tasks (manager, operator)
--   approve  -> approve/reject reconciliation (manager only)
-- ---------------------------------------------------------------
UPDATE roles SET permissions = (
    (CASE WHEN permissions::jsonb ? 'cycle_count_assign' THEN permissions::jsonb
          ELSE permissions::jsonb || '["cycle_count_assign"]'::jsonb END))::text
WHERE name IN ('manager','operator') AND is_system = true;

UPDATE roles SET permissions = (
    (CASE WHEN permissions::jsonb ? 'cycle_count_approve' THEN permissions::jsonb
          ELSE permissions::jsonb || '["cycle_count_approve"]'::jsonb END))::text
WHERE name = 'manager' AND is_system = true;