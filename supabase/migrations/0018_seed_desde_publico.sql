-- 0018_seed_desde_publico.sql — "Inicializar" re-ejecutable.
--
-- Antes: seed tomaba el ancla de la lista Mayorista y tenía candado (solo sin
-- Platinum), así que no se podía re-correr para corregir categorías excepción.
-- Ahora: toma SIEMPRE el precio Publico como ancla (es el precio "real/conocido")
-- y recalcula Platinum y Mayorista según la regla vigente de cada categoría.
-- Idempotente y re-ejecutable: si cambiás qué categorías son excepción, volvés a
-- correr Inicializar y quedan bien. No toca productos sin Publico.
--   Publico   = round(ancla)                              (se mantiene)
--   Platinum  = round(ancla / (1 + publico_markup_pct/100))
--   Mayorista = round(ancla * (1 - mayorista_discount_pct/100))
-- Append-only e idempotente.

create or replace function public.seed_pricing_from_current()
returns integer language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_lp uuid; v_lpub uuid; v_lmay uuid;
  v_markup numeric; v_discount numeric;
  v_publico numeric; v_platinum numeric; v_mayorista numeric;
  r record; n int := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select id into v_lp   from public.price_lists where organization_id = v_org and name = 'Platinum';
  select id into v_lpub from public.price_lists where organization_id = v_org and name = 'Publico';
  select id into v_lmay from public.price_lists where organization_id = v_org and name = 'Mayorista';
  if v_lp is null or v_lpub is null or v_lmay is null then raise exception 'Faltan listas'; end if;

  for r in
    select pli.product_id, pli.price as v, p.category_id
    from public.price_list_items pli
    join public.products p on p.id = pli.product_id
    where pli.price_list_id = v_lpub and pli.variant_id is null
  loop
    select markup, discount into v_markup, v_discount from public._pricing_rule(v_org, r.category_id);
    v_publico   := round(r.v);                               -- ancla = publico (se mantiene)
    v_platinum  := round(r.v / (1 + v_markup / 100));
    v_mayorista := round(v_publico * (1 - v_discount / 100));

    perform public._store_price(v_org, v_lpub, r.product_id, v_publico);
    perform public._store_price(v_org, v_lp,   r.product_id, v_platinum);
    perform public._store_price(v_org, v_lmay, r.product_id, v_mayorista);
    n := n + 1;
  end loop;
  return n;
end $$;
