-- Migration 0037: Allow 'adjustment' transaction type for cycle count reconciliation
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check CHECK (type = ANY (ARRAY['in'::text, 'out'::text, 'transfer'::text, 'opname'::text, 'adjustment'::text]));