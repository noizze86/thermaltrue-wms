-- Migration 0038: Extend stock_opname status check for cycle count workflow
ALTER TABLE stock_opname DROP CONSTRAINT IF EXISTS stock_opname_status_check;
ALTER TABLE stock_opname ADD CONSTRAINT stock_opname_status_check CHECK (status = ANY (ARRAY['draft'::text, 'in_progress'::text, 'completed'::text, 'open'::text, 'pending_review'::text, 'expired'::text, 'rejected'::text, 'voided'::text]));