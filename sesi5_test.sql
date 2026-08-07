-- Sesi 5 — Trigger Shipping: Testing Script

-- 1. Cek cost_per_order SEBELUM shipping (dari sesi 3)
SELECT 'BEFORE' as test, transaction_id, material_id,
       picking_cost, shipping_cost, admin_cost,
       total_cost, order_margin, is_profitable
FROM cost_per_order
WHERE transaction_id = '2001';

-- 2. Insert shipping untuk order_id=2001 (sesuai picking sesi 3)
INSERT INTO shipping_transactions (order_id, shipping_cost, carrier, is_on_time)
VALUES (2001, 50000, 'JNE YES', true);

-- 3. Cek cost_per_order SETELAH shipping
SELECT 'AFTER' as test, transaction_id, material_id,
       picking_cost, shipping_cost, admin_cost,
       total_cost, order_margin, is_profitable
FROM cost_per_order
WHERE transaction_id = '2001';

-- 4. Cek integration_log
SELECT 'LOG_CHECK' as test,
       process_name, source_table, status, affected_rows, error_message
FROM integration_log
WHERE process_name LIKE 'trg_shipping%'
ORDER BY created_at DESC
LIMIT 5;

-- 5. Test dengan shipping 0 (guard clause, harus skip)
INSERT INTO shipping_transactions (order_id, shipping_cost, carrier, is_on_time)
VALUES (9999, 0, 'TEST', true);

-- 6. Test dengan order tanpa picking (guard clause, harus skip)
INSERT INTO shipping_transactions (order_id, shipping_cost, carrier, is_on_time)
VALUES (7777, 25000, 'TEST', true);

-- 7. Cek log: harus ada 2 skipped + 1 success
SELECT 'SKIP_CHECK' as test,
       status, COUNT(*) as cnt
FROM integration_log
WHERE process_name LIKE 'trg_shipping%'
GROUP BY status
ORDER BY status;

SELECT 'SESI 5 COMPLETE' as status, 'Trigger shipping → cost_per_order siap' as result;
