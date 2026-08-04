-- Thermaltrue WMS — Align system role permissions with application requirements (Option A)
-- Ensures every assigned role can fully use the UI without 403 errors.

UPDATE roles SET permissions = '["manage_warehouse","manage_materials","manage_transactions","manage_settings","view_dashboard","view_reports","view_materials","view_transactions","view_warehouse","delete_any","view_cost","approve_transfer","adjust_opname","cycle_count","export_data","purge_logs","restore_database"]'
WHERE name = 'manager' AND is_system = true;

UPDATE roles SET permissions = '["manage_transactions","manage_materials","view_dashboard","view_reports","view_materials","view_transactions","view_warehouse","cycle_count","export_data"]'
WHERE name = 'operator' AND is_system = true;

UPDATE roles SET permissions = '["view_dashboard","view_reports","view_materials","view_transactions","view_warehouse"]'
WHERE name = 'viewer' AND is_system = true;

UPDATE roles SET permissions = '["*"]'
WHERE name = 'admin' AND is_system = true;
