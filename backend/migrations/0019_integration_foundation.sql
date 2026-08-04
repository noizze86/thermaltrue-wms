-- Migration 0019: Integration System Foundation
-- Tabel pendukung untuk integrasi data real-time dan batch
-- Dibuat: 2026-07-26

-- ============================================================
-- 1. integration_log — Logging semua proses integrasi
-- ============================================================
CREATE TABLE IF NOT EXISTS integration_log (
    id SERIAL PRIMARY KEY,
    process_name VARCHAR(100) NOT NULL DEFAULT '',
    source_table VARCHAR(100) NOT NULL DEFAULT '',
    material_id TEXT DEFAULT '',
    warehouse_id TEXT DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'success'
        CHECK (status IN ('success', 'failed', 'partial')),
    affected_rows INT DEFAULT 0,
    error_message TEXT DEFAULT '',
    retry_count INT DEFAULT 0,
    execution_time_ms INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ilog_status ON integration_log(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ilog_process ON integration_log(process_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ilog_created ON integration_log(created_at DESC);

-- ============================================================
-- 2. abc_change_history — Riwayat perubahan klasifikasi ABC
-- ============================================================
CREATE TABLE IF NOT EXISTS abc_change_history (
    id SERIAL PRIMARY KEY,
    material_id TEXT NOT NULL DEFAULT '',
    warehouse_id TEXT NOT NULL DEFAULT '',
    period TEXT NOT NULL DEFAULT '',
    previous_class TEXT NOT NULL DEFAULT '',
    new_class TEXT NOT NULL DEFAULT '',
    previous_score DOUBLE PRECISION DEFAULT 0,
    new_score DOUBLE PRECISION DEFAULT 0,
    reason TEXT DEFAULT '',
    changed_by TEXT DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_abc_history_material ON abc_change_history(material_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abc_history_period ON abc_change_history(period DESC);

-- ============================================================
-- 3. sku_mapping — Mapping INT sku_id → TEXT material_id
--    Menjembatani source tables (INT) dengan analysis tables (TEXT)
-- ============================================================
CREATE TABLE IF NOT EXISTS sku_mapping (
    sku_id SERIAL PRIMARY KEY,
    material_id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL DEFAULT '',
    sku_code TEXT NOT NULL DEFAULT '',
    sku_name TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(material_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_sku_map_material ON sku_mapping(material_id);
CREATE INDEX IF NOT EXISTS idx_sku_map_active ON sku_mapping(is_active) WHERE is_active = TRUE;

-- ============================================================
-- 4. log_integration() — Helper function untuk insert log
-- ============================================================
CREATE OR REPLACE FUNCTION log_integration(
    p_process_name VARCHAR,
    p_source_table VARCHAR,
    p_material_id TEXT DEFAULT '',
    p_warehouse_id TEXT DEFAULT '',
    p_status VARCHAR DEFAULT 'success',
    p_affected_rows INT DEFAULT 0,
    p_error_message TEXT DEFAULT '',
    p_retry_count INT DEFAULT 0,
    p_execution_time_ms INT DEFAULT 0
) RETURNS INT AS $$
DECLARE
    v_log_id INT;
BEGIN
    INSERT INTO integration_log (
        process_name, source_table, material_id, warehouse_id,
        status, affected_rows, error_message, retry_count, execution_time_ms
    ) VALUES (
        p_process_name, p_source_table, p_material_id, p_warehouse_id,
        p_status, p_affected_rows, p_error_message, p_retry_count, p_execution_time_ms
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
EXCEPTION WHEN OTHERS THEN
    -- Jangan biarkan logging gagal mengganggu proses utama
    RAISE WARNING 'log_integration gagal: %', SQLERRM;
    RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. get_or_create_sku_id() — Helper ambil sku_id dari material_id
-- ============================================================
CREATE OR REPLACE FUNCTION get_or_create_sku_id(
    p_material_id TEXT,
    p_warehouse_id TEXT DEFAULT '',
    p_sku_code TEXT DEFAULT '',
    p_sku_name TEXT DEFAULT ''
) RETURNS INT AS $$
DECLARE
    v_sku_id INT;
BEGIN
    SELECT sku_id INTO v_sku_id
    FROM sku_mapping
    WHERE material_id = p_material_id
      AND warehouse_id = p_warehouse_id;

    IF v_sku_id IS NULL THEN
        INSERT INTO sku_mapping (material_id, warehouse_id, sku_code, sku_name)
        VALUES (p_material_id, p_warehouse_id, p_sku_code, p_sku_name)
        RETURNING sku_id INTO v_sku_id;
    END IF;

    RETURN v_sku_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. get_material_id() — Helper ambil material_id dari sku_id
-- ============================================================
CREATE OR REPLACE FUNCTION get_material_id(p_sku_id INT)
RETURNS TEXT AS $$
DECLARE
    v_material_id TEXT;
BEGIN
    SELECT material_id INTO v_material_id
    FROM sku_mapping
    WHERE sku_id = p_sku_id;

    RETURN v_material_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Seed data: isi sku_mapping dari materials yang sudah ada
-- ============================================================
INSERT INTO sku_mapping (material_id, warehouse_id, sku_code, sku_name, is_active)
SELECT m.id, '', m.sku, m.name, m.is_active
FROM materials m
WHERE NOT EXISTS (
    SELECT 1 FROM sku_mapping s WHERE s.material_id = m.id
);
