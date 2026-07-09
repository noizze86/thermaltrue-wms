-- Seed roles (static data, no dynamic content)
INSERT INTO roles (id, name, description, permissions, is_system)
SELECT gen_random_uuid()::text, 'admin', 'Full system access', '["*"]', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'admin');

INSERT INTO roles (id, name, description, permissions, is_system)
SELECT gen_random_uuid()::text, 'manager', 'Operational management', '["manage_warehouse","manage_materials","view_reports","manage_transactions"]', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'manager');

INSERT INTO roles (id, name, description, permissions, is_system)
SELECT gen_random_uuid()::text, 'operator', 'Daily operations', '["manage_transactions","view_materials"]', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'operator');

INSERT INTO roles (id, name, description, permissions, is_system)
SELECT gen_random_uuid()::text, 'viewer', 'Read-only access', '["view_dashboard","view_reports","view_materials","view_transactions","view_warehouse"]', true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'viewer');
