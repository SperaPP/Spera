-- 0035_precios_dos_listas.sql — Precios simplificados a DOS listas, sin excepciones.
--   Mayorista = base, se carga a mano.
--   Publico   = Mayorista * 2 (derivado).
-- Se elimina la lista/perfil Platinum y el motor de reglas por categoría.
-- NO recalcula los precios de los productos existentes (se reconfiguran aparte):
-- sólo cambia el motor y limpia lo obsoleto. Append-only e idempotente.

-- ── 1. Bajar Platinum ────────────────────────────────────────
-- Reasigno los clientes Platinum al perfil Mayorista.
update public.customers c
set customer_type_id = m.id
from public.customer_types p
join public.customer_types m on m.organization_id = p.organization_id and m.name = 'Mayorista'
where p.name = 'Platinum' and c.customer_type_id = p.id;

delete from public.customer_types where name = 'Platinum';

-- Borro la lista Platinum y sus precios.
delete from public.price_list_items pli
using public.price_lists pl
where pli.price_list_id = pl.id and pl.name = 'Platinum';
delete from public.price_lists where name = 'Platinum';

-- ── 2. Sacar el motor de reglas por categoría ────────────────
drop function if exists public.seed_pricing_from_current();
drop function if exists public.recalc_all_pricing();
drop function if exists public.apply_product_pricing(uuid, numeric);
drop function if exists public._pricing_rule(uuid, uuid);
drop table if exists public.pricing_rules;

-- ── 3. Nuevo motor: Publico = Mayorista * 2 ──────────────────
-- Guarda la base Mayorista (si viene) y deriva Publico = round(base * 2).
-- Si p_base es null, usa el Mayorista ya guardado del producto.
create or replace function public.apply_product_pricing(p_product_id uuid, p_base numeric default null)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_base numeric; v_lmay uuid; v_lpub uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select id into v_lmay from public.price_lists where organization_id = v_org and name = 'Mayorista';
  select id into v_lpub from public.price_lists where organization_id = v_org and name = 'Publico';
  if v_lmay is null or v_lpub is null then raise exception 'Faltan listas de precios (Mayorista/Publico)'; end if;

  v_base := p_base;
  if v_base is null then
    select price into v_base from public.price_list_items
      where price_list_id = v_lmay and product_id = p_product_id and variant_id is null;
  end if;
  if v_base is null then return; end if;  -- sin base, nada que derivar

  v_base := round(v_base);
  perform public._store_price(v_org, v_lmay, p_product_id, v_base);
  perform public._store_price(v_org, v_lpub, p_product_id, round(v_base * 2));
end $$;

-- Recalcula Publico (= Mayorista * 2) para todos los productos con Mayorista cargado.
create or replace function public.recalc_all_pricing()
returns integer language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_lmay uuid; r record; n int := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select id into v_lmay from public.price_lists where organization_id = v_org and name = 'Mayorista';
  if v_lmay is null then raise exception 'Falta la lista Mayorista'; end if;
  for r in select product_id from public.price_list_items where price_list_id = v_lmay and variant_id is null loop
    perform public.apply_product_pricing(r.product_id, null);
    n := n + 1;
  end loop;
  return n;
end $$;
