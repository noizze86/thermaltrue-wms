-- Thermaltrue WMS — Standard Inventory Management label template with QR code
INSERT INTO label_templates (id, name, layout_style, template_type, label_width_mm, label_height_mm, show_sku, show_name, show_company, show_qty, show_price, show_barcode, show_qr, show_category, show_supplier, show_location, show_expiry, show_batch, show_min_stock, show_logo, show_border, qr_size, border_style, font_scale)
VALUES
  ('standard_inventory', 'Standard Inventory Management', 'standard', '2x4', 52, 37, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, TRUE, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, 'large', 'solid', 1.0)
ON CONFLICT (id) DO NOTHING;
