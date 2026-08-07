-- ============================================================
-- Sesi 1 — Foundation: Testing Script
-- ============================================================

-- 1. Cek tabel sudah dibuat
SELECT 'TABLE_CHECK' as test_name, table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('integration_log', 'abc_change_history', 'sku_mapping')
ORDER BY table_name;

-- 2. Test log_integration function
SELECT log_integration(
    'test_process',
    'test_table',
    'mat-001',
    'wh-01',
    'success',
    5,
    'test ok',
    0,
    12
) as log_id;

-- 3. Cek log terbaru
SELECT id, process_name, source_table, status, error_message
FROM integration_log
ORDER BY created_at DESC
LIMIT 5;

-- 4. Test error handling di log_integration (status invalid)
SELECT log_integration(
    'test_error',
    'test_table',
    'mat-001', 'wh-01',
    'invalid_status'
) as error_log_id;

-- 5. Cek bahwa error tidak mengganggu (warning saja, bukan error)
SELECT 'ERROR_TEST' as test_name, COUNT(*) as total_invalid
FROM integration_log
WHERE status = 'failed';

-- 6. Test get_or_create_sku_id (existing material)
SELECT get_or_create_sku_id(
    (SELECT id FROM materials LIMIT 1),
    '',
    (SELECT sku FROM materials LIMIT 1),
    (SELECT name FROM materials LIMIT 1)
) as sku_id;

-- 7. Test get_or_create_sku_id (new material - harus auto-create)
SELECT get_or_create_sku_id(
    'test-integration-new',
    'wh-99',
    'TEST-SKU-001',
    'Test Material Integration'
) as new_sku_id;

-- 8. Test get_material_id (reverse lookup)
SELECT get_material_id(1) as material_id;

-- 9. Cek total data di sku_mapping
SELECT 'SKU_MAPPING_COUNT' as test_name, COUNT(*) as total_rows
FROM sku_mapping;

-- 10. Cek seed data dari materials
SELECT 'SEED_CHECK' as test_name,
       (SELECT COUNT(*) FROM materials WHERE is_active = true) as active_materials,
       (SELECT COUNT(*) FROM sku_mapping WHERE is_active = true) as mapped_skus;

-- 11. Cek abc_change_history (masih kosong, akan diisi sesi 7)
SELECT 'ABC_HISTORY_COUNT' as test_name, COUNT(*) as total_rows
FROM abc_change_history;

-- ============================================================
-- RESUME
-- ============================================================
SELECT 'SESI 1 COMPLETE' as status,
       '4 tabel + 3 function siap' as result;
