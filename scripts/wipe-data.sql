-- ============================================================================
--  wipe-data.sql — BORRA TODOS LOS DATOS de prueba para arrancar limpio.
--  Correr UNA vez en el SQL Editor de Supabase. ⚠️ DESTRUCTIVO E IRREVERSIBLE.
--  NO es una migración (no lo pongas en supabase/migrations).
--
--  BORRA: productos, variantes, precios, stock, fotos, ventas, ítems, pagos,
--         cobranzas, devoluciones/cambios, cajas (turnos, chica, fuerte, ajustes,
--         entregas), movimientos de cuenta corriente, transferencias de stock,
--         clientes, categorías, talles, colores, tipos de tela, y los archivos
--         del bucket de fotos.
--  CONSERVA: usuarios/roles/permisos, locales, depósitos, medios de pago, las
--            2 listas de precios, tipos de cliente, métodos de despacho,
--            definiciones de cupones (se resetea su uso) y demás config.
--
--  Antes de correr: tené aplicadas las migraciones hasta la 0035.
-- ============================================================================

begin;

truncate table
  public.sale_payments,
  public.sale_items,
  public.sales,
  public.receipt_payments,
  public.receipts,
  public.return_items,
  public.returns,
  public.exchanges,
  public.customer_movements,
  public.cash_adjustments,
  public.central_deliveries,
  public.store_petty,
  public.store_safe,
  public.cash_sessions,
  public.stock_movements,
  public.stock,
  public.stock_transfer_items,
  public.stock_transfers,
  public.price_list_items,
  public.product_images,
  public.product_variants,
  public.products,
  public.customers,
  public.categories,
  public.fabric_types,
  public.sizes,
  public.colors
restart identity cascade;

-- Reinicia la numeración de ventas y cobranzas (arrancan de 1).
select setval('public.sale_number_seq', 1, false);
select setval('public.receipt_number_seq', 1, false);

-- Resetea el uso de cupones (mantiene las definiciones).
update public.coupons set used_count = 0;

-- Vacía las fotos del bucket de Storage.
delete from storage.objects where bucket_id = 'product-images';

commit;
