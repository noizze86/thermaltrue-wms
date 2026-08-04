-- Migration 0020: Source Tables Operasional
-- 6 tabel sumber data untuk integrasi ke analysis tables
-- Semua menggunakan INT ID + sku_mapping untuk bridging ke TEXT material_id

-- ============================================================
-- 1. receiving_transactions — Penerimaan barang
-- ============================================================
CREATE TABLE IF NOT EXISTS receiving_transactions (
    id SERIAL PRIMARY KEY,
    sku_id INT NOT NULL REFERENCES sku_mapping(sku_id),
    warehouse_id INT NOT NULL DEFAULT 0,
    receipt_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    qty_received INT NOT NULL CHECK (qty_received > 0),
    purchase_price NUMERIC(15,2) DEFAULT 0,
    batch_id INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rt_sku ON receiving_transactions(sku_id, receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_rt_date ON receiving_transactions(receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_rt_wh ON receiving_transactions(warehouse_id);

-- ============================================================
-- 2. picking_transactions — Pengeluaran/picking barang
-- ============================================================
CREATE TABLE IF NOT EXISTS picking_transactions (
    id SERIAL PRIMARY KEY,
    sku_id INT NOT NULL REFERENCES sku_mapping(sku_id),
    warehouse_id INT NOT NULL DEFAULT 0,
    order_id INT NOT NULL DEFAULT 0,
    pick_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    qty_picked INT NOT NULL CHECK (qty_picked > 0),
    picker_id INT DEFAULT 0,
    pick_time_seconds INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pt_sku ON picking_transactions(sku_id, pick_date DESC);
CREATE INDEX IF NOT EXISTS idx_pt_date ON picking_transactions(pick_date DESC);
CREATE INDEX IF NOT EXISTS idx_pt_order ON picking_transactions(order_id);

-- ============================================================
-- 3. shipping_transactions — Pengiriman
-- ============================================================
CREATE TABLE IF NOT EXISTS shipping_transactions (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL DEFAULT 0,
    shipping_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    shipping_cost NUMERIC(10,2) DEFAULT 0,
    carrier VARCHAR(50) DEFAULT '',
    is_on_time BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_st_date ON shipping_transactions(shipping_date DESC);
CREATE INDEX IF NOT EXISTS idx_st_ontime ON shipping_transactions(is_on_time) WHERE is_on_time = FALSE;

-- ============================================================
-- 4. cycle_count_transactions — Stok opname
-- ============================================================
CREATE TABLE IF NOT EXISTS cycle_count_transactions (
    id SERIAL PRIMARY KEY,
    sku_id INT NOT NULL REFERENCES sku_mapping(sku_id),
    warehouse_id INT NOT NULL DEFAULT 0,
    count_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    system_qty INT DEFAULT 0,
    physical_qty INT DEFAULT 0,
    variance_qty INT GENERATED ALWAYS AS (physical_qty - system_qty) STORED,
    accuracy_pct DOUBLE PRECISION GENERATED ALWAYS AS (
        CASE WHEN system_qty > 0
             THEN GREATEST(0, (1.0 - ABS(physical_qty - system_qty)::DOUBLE PRECISION / GREATEST(system_qty, 1)) * 100.0)
             ELSE 100.0
        END
    ) STORED,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cct_sku ON cycle_count_transactions(sku_id, count_date DESC);
CREATE INDEX IF NOT EXISTS idx_cct_unresolved ON cycle_count_transactions(is_resolved) WHERE is_resolved = FALSE;

-- ============================================================
-- 5. production_batch — Batch produksi
-- ============================================================
CREATE TABLE IF NOT EXISTS production_batch (
    id SERIAL PRIMARY KEY,
    batch_code VARCHAR(50) UNIQUE NOT NULL,
    product_sku_id INT NOT NULL REFERENCES sku_mapping(sku_id),
    planned_qty INT DEFAULT 0,
    actual_qty INT DEFAULT 0,
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    status VARCHAR(20) DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pb_status ON production_batch(status);
CREATE INDEX IF NOT EXISTS idx_pb_product ON production_batch(product_sku_id);

-- ============================================================
-- 6. batch_material_usage — Konsumsi material per batch
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_material_usage (
    id SERIAL PRIMARY KEY,
    batch_id INT NOT NULL REFERENCES production_batch(id) ON DELETE CASCADE,
    sku_id INT NOT NULL REFERENCES sku_mapping(sku_id),
    warehouse_id INT NOT NULL DEFAULT 0,
    planned_qty INT DEFAULT 0,
    actual_qty INT DEFAULT 0,
    reject_qty INT DEFAULT 0,
    consumption_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bmu_batch ON batch_material_usage(batch_id);
CREATE INDEX IF NOT EXISTS idx_bmu_sku ON batch_material_usage(sku_id);
CREATE INDEX IF NOT EXISTS idx_bmu_date ON batch_material_usage(consumption_date DESC);

-- ============================================================
-- Log: migration selesai
-- ============================================================
SELECT 'Migration 0020: 6 source tables created' as info;
