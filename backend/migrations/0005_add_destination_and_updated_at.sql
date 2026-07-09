-- Migration 0005: Add destination and updated_at columns to transactions

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS destination TEXT DEFAULT '';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TEXT;
