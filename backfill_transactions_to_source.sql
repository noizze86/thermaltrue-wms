-- Backfill: Historical transactions → source tables
-- Jalankan SATU KALI untuk mengisi data transaksi lama
-- Gunakan fungsi yang sama dengan trigger agar konsisten

DO $$
DECLARE
    v_rec RECORD;
    v_sku_id INT;
    v_warehouse_int INT;
    v_count INT := 0;
BEGIN
    FOR v_rec IN
        SELECT t.id, t.type, t.material_id, COALESCE(t.warehouse_id, '') as warehouse_id,
               t.quantity, t.price, t.created_at
        FROM transactions t
        WHERE t.type IN ('in', 'out')
          AND t.status IN ('approved', '')
          -- Skip jika sudah ada di source table
          AND NOT EXISTS (
              SELECT 1 FROM receiving_transactions rt
              WHERE rt.warehouse_text_id = t.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM picking_transactions pt
              WHERE pt.warehouse_text_id = t.id
          )
    LOOP
        -- Resolve or create sku_mapping
        SELECT sku_id INTO v_sku_id
        FROM sku_mapping
        WHERE material_id = v_rec.material_id
        LIMIT 1;

        IF v_sku_id IS NULL THEN
            INSERT INTO sku_mapping (material_id, warehouse_id, sku_code, sku_name, is_active)
            VALUES (v_rec.material_id, v_rec.warehouse_id, '', '', true)
            RETURNING sku_id INTO v_sku_id;
        END IF;

        -- Warehouse hash (sama dengan trigger)
        SELECT ('x' || SUBSTRING(MD5(v_rec.warehouse_id), 1, 8))::BIT(32)::INT
        INTO v_warehouse_int;

        IF v_rec.type = 'in' THEN
            INSERT INTO receiving_transactions (
                sku_id, warehouse_id, warehouse_text_id,
                qty_received, purchase_price, receipt_date, created_at
            ) VALUES (
                v_sku_id, v_warehouse_int, v_rec.id,
                GREATEST(v_rec.quantity, 1)::INT, COALESCE(v_rec.price, 0),
                COALESCE(v_rec.created_at::TIMESTAMP, NOW()), NOW()
            );
            RAISE NOTICE 'Backfill: tx=% type=in → receiving (sku=%, qty=%)', v_rec.id, v_sku_id, v_rec.quantity;
        ELSIF v_rec.type = 'out' THEN
            INSERT INTO picking_transactions (
                sku_id, warehouse_id, warehouse_text_id,
                qty_picked, order_id, pick_date, created_at
            ) VALUES (
                v_sku_id, v_warehouse_int, v_rec.id,
                GREATEST(v_rec.quantity, 1)::INT, 0,
                COALESCE(v_rec.created_at::TIMESTAMP, NOW()), NOW()
            );
            RAISE NOTICE 'Backfill: tx=% type=out → picking (sku=%, qty=%)', v_rec.id, v_sku_id, v_rec.quantity;
        END IF;
        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE 'Backfill selesai: % transaksi diproses', v_count;
END $$;
