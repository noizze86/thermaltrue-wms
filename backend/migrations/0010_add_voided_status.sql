-- Migration 0010: Add 'voided' status to transactions CHECK constraint

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'reversed', 'voided'));
