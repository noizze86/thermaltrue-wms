-- Thermaltrue WMS — Two-Side QR Label Template seed
INSERT INTO label_templates (id, name, layout_style, template_type, label_width_mm, label_height_mm, show_sku, show_name, show_company, show_qty, show_price, show_barcode, show_qr, show_category, show_supplier, show_location, show_expiry, show_batch, show_min_stock, show_logo, show_border, qr_size, border_style, font_scale)
VALUES
  ('two_side', 'Two-Side QR Label', 'two_side', '2x4', 52, 37, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, 'large', 'solid', 0.85)
ON CONFLICT (id) DO NOTHING;
