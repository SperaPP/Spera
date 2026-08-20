-- ============================================================================
--  wipe-data.sql — BORRA TODOS LOS DATOS de prueba para arrancar limpio.
--  Correr UNA vez en el SQL Editor de Supabase. ⚠️ DESTRUCTIVO E IRREVERSIBLE.
--  NO es una migración (no lo pongas en supabase/migrations).
--
--  BORRA: productos, variantes, precios, stock, fotos, ventas, ítems, pagos,
--         cobranzas, devoluciones/cambios (si existen), cajas (turnos, chica,
--         fuerte, ajustes, entregas), movimientos de cuenta corriente,
--         transferencias de stock, clientes, categorías, talles, colores,
--         tipos de tela, y los archivos del bucket de fotos.
--  CONSERVA: usuarios/roles/permisos, locales, depósitos, medios de pago, las
--            2 listas de precios, tipos de cliente, métodos de despacho,
--            definiciones de cupones (se resetea su uso) y demás config.
--
--  Antes de correr: tené aplicadas las migraciones hasta la 0035.
-- ============================================================================

begin;

-- Trunca sólo las tablas que existan (algunas features pudieron darse de baja).
do $$
declare
  v_list text;
  v_tables text[] := array[
    'sale_payments', 'sale_items', 'sales',
    'receipt_payments', 'receipts',
    'return_items', 'returns', 'exchanges',
    'customer_movements',
    'cash_adjustments', 'central_deliveries', 'store_petty', 'store_safe', 'cash_sessions',
    'stock_movements', 'stock', 'stock_transfer_items', 'stock_transfers',
    'price_list_items',
    'product_images', 'product_variants', 'products',
    'customers',
    'categories', 'fabric_types', 'sizes', 'colors'
  ];
begin
  select string_agg(format('public.%I', t), ', ')
    into v_list
  from unnest(v_tables) as t
  where to_regclass(format('public.%I', t)) is not null;

  if v_list is not null then
    execute 'truncate table ' || v_list || ' restart identity cascade';
  end if;
end $$;

-- Reinicia la numeración de ventas y cobranzas (arrancan de 1).
do $$
begin
  if to_regclass('public.sale_number_seq')    is not null then perform setval('public.sale_number_seq', 1, false);    end if;
  if to_regclass('public.receipt_number_seq') is not null then perform setval('public.receipt_number_seq', 1, false); end if;
end $$;

-- Resetea el uso de cupones (mantiene las definiciones).
update public.coupons set used_count = 0;

-- Vacía las fotos del bucket de Storage.
delete from storage.objects where bucket_id = 'product-images';

commit;
