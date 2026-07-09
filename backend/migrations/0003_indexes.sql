-- Migration 0003: Add indexes for foreign key columns and commonly filtered columns

-- Materials FK
CREATE INDEX IF NOT EXISTS idx_materials_category_id ON materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_unit_id ON materials(unit_id);
CREATE INDEX IF NOT EXISTS idx_materials_supplier_id ON materials(supplier_id);
CREATE INDEX IF NOT EXISTS idx_materials_warehouse_id ON materials(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_materials_rack_id ON materials(rack_id);
CREATE INDEX IF NOT EXISTS idx_materials_name ON materials(name);
CREATE INDEX IF NOT EXISTS idx_materials_is_active ON materials(is_active);

-- Material batches
CREATE INDEX IF NOT EXISTS idx_material_batches_material_id ON material_batches(material_id);

-- Supplier prices
CREATE INDEX IF NOT EXISTS idx_supplier_prices_supplier_id ON supplier_prices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_material_id ON supplier_prices(material_id);

-- Material images
CREATE INDEX IF NOT EXISTS idx_material_images_material_id ON material_images(material_id);

-- Transactions
CREATE INDEX IF NOT EXISTS idx_transactions_material_id ON transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_transactions_warehouse_id ON transactions(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transactions_rack_id ON transactions(rack_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_approved_by ON transactions(approved_by);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- Transaction items
CREATE INDEX IF NOT EXISTS idx_transaction_items_tx_id ON transaction_items(tx_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_material_id ON transaction_items(material_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_batch_id ON transaction_items(batch_id);

-- Transaction attachments
CREATE INDEX IF NOT EXISTS idx_transaction_attachments_tx_id ON transaction_attachments(tx_id);

-- Quality inspections
CREATE INDEX IF NOT EXISTS idx_quality_inspections_tx_id ON quality_inspections(tx_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_material_id ON quality_inspections(material_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_inspected_by ON quality_inspections(inspected_by);

-- Purchase orders
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by ON purchase_orders(created_by);

-- PO items
CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON po_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_material_id ON po_items(material_id);

-- Sales orders
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_by ON sales_orders(created_by);

-- SO items
CREATE INDEX IF NOT EXISTS idx_so_items_so_id ON so_items(so_id);
CREATE INDEX IF NOT EXISTS idx_so_items_material_id ON so_items(material_id);

-- Stock opname
CREATE INDEX IF NOT EXISTS idx_stock_opname_warehouse_id ON stock_opname(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_opname_created_by ON stock_opname(created_by);

-- Stock opname items
CREATE INDEX IF NOT EXISTS idx_stock_opname_items_opname_id ON stock_opname_items(opname_id);
CREATE INDEX IF NOT EXISTS idx_stock_opname_items_material_id ON stock_opname_items(material_id);

-- Transfer orders
CREATE INDEX IF NOT EXISTS idx_transfer_orders_from_warehouse_id ON transfer_orders(from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfer_orders_to_warehouse_id ON transfer_orders(to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfer_orders_created_by ON transfer_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_transfer_orders_approved_by ON transfer_orders(approved_by);

-- Transfer items
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer_id ON transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_material_id ON transfer_items(material_id);

-- Stock opname items (unique constraint)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_stock_opname_items_opname_material' AND conrelid = 'stock_opname_items'::regclass) THEN
    ALTER TABLE stock_opname_items ADD CONSTRAINT uq_stock_opname_items_opname_material UNIQUE (opname_id, material_id);
  END IF;
END $$;

-- Unit conversions (unique constraint)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_unit_conversions_from_to' AND conrelid = 'unit_conversions'::regclass) THEN
    ALTER TABLE unit_conversions ADD CONSTRAINT uq_unit_conversions_from_to UNIQUE (from_unit_id, to_unit_id);
  END IF;
END $$;

-- Rack utilization logs
CREATE INDEX IF NOT EXISTS idx_rack_utilization_log_rack_id ON rack_utilization_log(rack_id);

-- Audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity);

-- User activity log
CREATE INDEX IF NOT EXISTS idx_user_activity_log_user_id ON user_activity_log(user_id);

-- Login history
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created_at ON login_history(created_at);

-- Forecast cache
CREATE INDEX IF NOT EXISTS idx_forecast_cache_material_id ON forecast_cache(material_id);

-- Supplier ratings
CREATE INDEX IF NOT EXISTS idx_supplier_ratings_supplier_id ON supplier_ratings(supplier_id);

-- Budgets
CREATE INDEX IF NOT EXISTS idx_budgets_category_id ON budgets(category_id);

-- Cycle schedules
CREATE INDEX IF NOT EXISTS idx_cycle_schedules_warehouse_id ON cycle_schedules(warehouse_id);

-- Add CHECK constraint for users.role (IF NOT EXISTS not supported for CHECK)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'operator', 'viewer'));
  END IF;
END $$;

-- Note: warehouse/rack capacity columns remain DOUBLE PRECISION for now
-- to maintain compatibility with existing data. Cast to INTEGER in query layer.
