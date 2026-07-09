-- Thermaltrue WMS — Label Templates
-- Each template controls which fields appear on printed labels

CREATE TABLE IF NOT EXISTS label_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    show_sku BOOLEAN NOT NULL DEFAULT TRUE,
    show_name BOOLEAN NOT NULL DEFAULT TRUE,
    show_company BOOLEAN NOT NULL DEFAULT FALSE,
    show_qty BOOLEAN NOT NULL DEFAULT FALSE,
    show_price BOOLEAN NOT NULL DEFAULT FALSE,
    show_barcode BOOLEAN NOT NULL DEFAULT TRUE,
    show_qr BOOLEAN NOT NULL DEFAULT TRUE,
    template_type TEXT NOT NULL DEFAULT '2x4',
    created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

INSERT INTO label_templates (id, name, show_sku, show_name, show_company, show_qty, show_price, template_type) VALUES
  ('default', 'Default (QTY & Price)', TRUE, TRUE, FALSE, TRUE, TRUE, '2x4'),
  ('company', 'PT. Udara Jadi Bersih', TRUE, TRUE, TRUE, FALSE, FALSE, '2x4');
