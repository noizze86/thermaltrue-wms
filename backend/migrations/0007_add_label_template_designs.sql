-- Thermaltrue WMS — Label Template Design Fields
-- Adds layout_style + display options to support 6 label designs

ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS layout_style TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS show_category BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS show_supplier BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS show_location BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS show_expiry BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS show_batch BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS show_min_stock BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS show_logo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS show_border BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS qr_size TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS border_style TEXT NOT NULL DEFAULT 'solid';
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS font_scale REAL NOT NULL DEFAULT 1.0;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS label_width_mm REAL NOT NULL DEFAULT 52;
ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS label_height_mm REAL NOT NULL DEFAULT 37;

-- 6 New Design Seeds
INSERT INTO label_templates (id, name, layout_style, template_type, label_width_mm, label_height_mm, show_sku, show_name, show_company, show_qty, show_price, show_barcode, show_qr, show_category, show_supplier, show_location, show_expiry, show_batch, show_min_stock, show_logo, show_border, qr_size, border_style, font_scale)
VALUES
  ('asset_standard', 'Standard Asset Label', 'standard', '2x4', 60, 40, TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, TRUE, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, 'medium', 'solid', 1.0),
  ('branded', 'Branded Label', 'branded', '2x4', 70, 50, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, TRUE, TRUE, 'large', 'solid', 1.1),
  ('rack_label', 'Rack Label', 'rack', '2x4', 50, 50, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, 'medium', 'dashed', 1.2),
  ('full_card', 'Full Stock Card', 'full_card', '1x1', 80, 60, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, 'large', 'solid', 0.9),
  ('mini_thermal', 'Mini Thermal', 'mini', '4x6', 35, 20, TRUE, TRUE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'small', 'none', 0.7),
  ('qr_only', 'QR-Only Scan', 'qr_only', '1x1', 30, 30, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'large', 'none', 1.3)
ON CONFLICT (id) DO NOTHING;

-- Update existing default/company to have layout_style
UPDATE label_templates SET layout_style='standard', label_width_mm=52, label_height_mm=37, qr_size='medium', border_style='solid', font_scale=1.0, show_border=TRUE WHERE id='default';
UPDATE label_templates SET layout_style='standard', label_width_mm=52, label_height_mm=37, qr_size='medium', border_style='solid', font_scale=1.0, show_border=TRUE WHERE id='company';
