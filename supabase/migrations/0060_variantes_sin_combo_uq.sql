-- 0060_variantes_sin_combo_uq.sql — La identidad de la variante es el SKU.
--
-- product_variants_combo_uq (0002) exigía una sola combinación talle/color por
-- producto. El catálogo real tiene productos con varias variantes que comparten
-- (o no tienen) talle/color y se diferencian solo por SKU (ej: "pantalon arteles"
-- con 11 códigos sin talle/color). La unicidad ya la garantizan el SKU y el barcode
-- (ambos únicos por organización), así que se elimina el combo.
-- Append-only e idempotente.

drop index if exists public.product_variants_combo_uq;
