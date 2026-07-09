-- Thermaltrue WMS — Initial PostgreSQL Schema
-- All date/time columns are TEXT for Rust model compatibility

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, full_name TEXT NOT NULL DEFAULT '',
    email TEXT DEFAULT '', role TEXT NOT NULL DEFAULT 'operator',
    is_active BOOLEAN NOT NULL DEFAULT true,
    photo TEXT DEFAULT '', last_login_at TEXT,
    last_login_ip TEXT DEFAULT '', password_changed_at TEXT,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '', parent_id TEXT REFERENCES categories(id),
    icon TEXT DEFAULT '', color TEXT DEFAULT '#6b7280',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL,
    symbol TEXT NOT NULL DEFAULT '', category TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS unit_conversions (
    id TEXT PRIMARY KEY, from_unit_id TEXT NOT NULL REFERENCES units(id),
    to_unit_id TEXT NOT NULL REFERENCES units(id),
    factor DOUBLE PRECISION NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    contact TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
    address TEXT DEFAULT '', contact_person TEXT DEFAULT '',
    pic_phone TEXT DEFAULT '', pic_email TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS supplier_ratings (
    id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    metric TEXT NOT NULL, score DOUBLE PRECISION NOT NULL DEFAULT 0,
    period TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
    notes TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
    location TEXT DEFAULT '', is_active BOOLEAN NOT NULL DEFAULT true,
    capacity DOUBLE PRECISION DEFAULT 0, layout_image TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    name TEXT NOT NULL, code TEXT DEFAULT '',
    capacity DOUBLE PRECISION DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY, parent_id TEXT REFERENCES locations(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    type TEXT NOT NULL DEFAULT 'bin', code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS racks (
    id TEXT PRIMARY KEY, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    area TEXT NOT NULL DEFAULT '', rack_name TEXT NOT NULL,
    bin_location TEXT NOT NULL DEFAULT '', max_capacity DOUBLE PRECISION DEFAULT 0,
    location_id TEXT REFERENCES locations(id),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS rack_utilization_log (
    id TEXT PRIMARY KEY, rack_id TEXT NOT NULL REFERENCES racks(id),
    date TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'),
    total_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    description TEXT DEFAULT '', category_id TEXT REFERENCES categories(id),
    unit_id TEXT REFERENCES units(id), supplier_id TEXT REFERENCES suppliers(id),
    warehouse_id TEXT REFERENCES warehouses(id), rack_id TEXT REFERENCES racks(id),
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0, min_stock DOUBLE PRECISION DEFAULT 0,
    max_stock DOUBLE PRECISION DEFAULT 0, price DOUBLE PRECISION DEFAULT 0,
    image TEXT DEFAULT '', expiry_date TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS material_batches (
    id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    batch_no TEXT NOT NULL DEFAULT '', qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    expiry_date TEXT DEFAULT '', received_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS supplier_prices (
    id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    material_id TEXT NOT NULL REFERENCES materials(id),
    price DOUBLE PRECISION NOT NULL DEFAULT 0,
    date TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS material_images (
    id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    url TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, transaction_number TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('in','out','transfer','opname')),
    material_id TEXT NOT NULL REFERENCES materials(id),
    warehouse_id TEXT REFERENCES warehouses(id),
    rack_id TEXT REFERENCES racks(id),
    quantity DOUBLE PRECISION NOT NULL, price DOUBLE PRECISION DEFAULT 0,
    reference TEXT DEFAULT '', notes TEXT DEFAULT '',
    user_id TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected')),
    approved_by TEXT REFERENCES users(id),
    po_number TEXT DEFAULT '', invoice_no TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS transaction_items (
    id TEXT PRIMARY KEY, tx_id TEXT NOT NULL REFERENCES transactions(id),
    material_id TEXT NOT NULL REFERENCES materials(id),
    batch_id TEXT REFERENCES material_batches(id),
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0, price DOUBLE PRECISION DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS transaction_attachments (
    id TEXT PRIMARY KEY, tx_id TEXT NOT NULL REFERENCES transactions(id),
    filename TEXT NOT NULL DEFAULT '', data_base64 TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS quality_inspections (
    id TEXT PRIMARY KEY, tx_id TEXT NOT NULL REFERENCES transactions(id),
    material_id TEXT NOT NULL REFERENCES materials(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','passed','failed')),
    notes TEXT DEFAULT '', inspected_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY, po_number TEXT UNIQUE NOT NULL,
    supplier_id TEXT REFERENCES suppliers(id), supplier_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','partial','received','cancelled')),
    notes TEXT DEFAULT '', created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS po_items (
    id TEXT PRIMARY KEY, po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES materials(id),
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0, price DOUBLE PRECISION DEFAULT 0,
    received_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS sales_orders (
    id TEXT PRIMARY KEY, so_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '', customer_address TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','partial','fulfilled','cancelled')),
    notes TEXT DEFAULT '', created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS so_items (
    id TEXT PRIMARY KEY, so_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES materials(id),
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0, price DOUBLE PRECISION DEFAULT 0,
    fulfilled_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS stock_opname (
    id TEXT PRIMARY KEY, opname_number TEXT UNIQUE NOT NULL,
    warehouse_id TEXT REFERENCES warehouses(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_progress','completed')),
    notes TEXT DEFAULT '', created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS stock_opname_items (
    id TEXT PRIMARY KEY, opname_id TEXT NOT NULL REFERENCES stock_opname(id),
    material_id TEXT NOT NULL REFERENCES materials(id),
    system_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    physical_qty DOUBLE PRECISION DEFAULT 0,
    difference DOUBLE PRECISION DEFAULT 0, notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS transfer_orders (
    id TEXT PRIMARY KEY, transfer_number TEXT UNIQUE NOT NULL,
    from_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    to_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','in_transit','received','completed','cancelled')),
    notes TEXT DEFAULT '', created_by TEXT REFERENCES users(id),
    approved_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS transfer_items (
    id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES transfer_orders(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES materials(id),
    batch_id TEXT REFERENCES material_batches(id),
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS cycle_schedules (
    id TEXT PRIMARY KEY, warehouse_id TEXT REFERENCES warehouses(id),
    class TEXT NOT NULL DEFAULT 'C' CHECK(class IN ('A','B','C')),
    frequency_days INTEGER NOT NULL DEFAULT 30,
    next_date TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'),
    last_date TEXT, created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
    details TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS user_activity_log (
    id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
    activity TEXT NOT NULL, details TEXT DEFAULT '', ip_address TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS company_profile (
    id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '',
    address TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
    logo TEXT DEFAULT '', npwp TEXT DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notification_config (
    id TEXT PRIMARY KEY, config_key TEXT NOT NULL UNIQUE,
    config_value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS report_schedules (
    id TEXT PRIMARY KEY, report_type TEXT NOT NULL,
    email_to TEXT NOT NULL DEFAULT '', frequency TEXT NOT NULL DEFAULT 'weekly',
    day_of_week INTEGER NOT NULL DEFAULT 1, hour INTEGER NOT NULL DEFAULT 8,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS email_config (
    id TEXT PRIMARY KEY, smtp_host TEXT NOT NULL DEFAULT '',
    smtp_port INTEGER NOT NULL DEFAULT 587, smtp_user TEXT NOT NULL DEFAULT '',
    smtp_pass TEXT NOT NULL DEFAULT '', sender_name TEXT NOT NULL DEFAULT '',
    sender_email TEXT NOT NULL DEFAULT '', use_tls BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '', permissions TEXT NOT NULL DEFAULT '[]',
    is_system BOOLEAN NOT NULL DEFAULT true,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY, category_id TEXT REFERENCES categories(id),
    period TEXT NOT NULL DEFAULT '', amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS abc_weights (
    key TEXT PRIMARY KEY, value DOUBLE PRECISION NOT NULL DEFAULT 0.33
);

CREATE TABLE IF NOT EXISTS forecast_cache (
    id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    model TEXT NOT NULL DEFAULT '', params TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '[]', horizon INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS login_history (
    id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
    username TEXT NOT NULL DEFAULT '', ip_address TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success','failed')),
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Default app config values
INSERT INTO app_config (key, value) VALUES ('password_min_length', '8') ON CONFLICT (key) DO NOTHING;
INSERT INTO app_config (key, value) VALUES ('password_expiry_days', '90') ON CONFLICT (key) DO NOTHING;
INSERT INTO app_config (key, value) VALUES ('blind_count_mode', 'false') ON CONFLICT (key) DO NOTHING;
INSERT INTO app_config (key, value) VALUES ('auto_adjust_threshold', '0') ON CONFLICT (key) DO NOTHING;
