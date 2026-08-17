-- 0017_precios_perfiles.sql — Listas/perfiles Publico·Mayorista·Platinum + motor de precios derivados.
--
-- Modelo: la base es PLATINUM (lo único que se carga). Publico y Mayorista se
-- derivan según la categoría del producto:
--   Publico   = round( Platinum * (1 + publico_markup_pct/100) )
--   Mayorista = round( Publico  * (1 - mayorista_discount_pct/100) )
-- Regla general (default): markup 110%, descuento 50%.  Excepciones por categoría.
-- Redondeo a peso entero. Sin override manual: tocar Platinum recalcula el resto.
-- Append-only e idempotente.

-- ── 1. Reestructura de listas y perfiles ─────────────────────
-- La lista "Minorista" (vacía) pasa a ser "Publico".
update public.price_lists    set name = 'Publico' where name = 'Minorista';
update public.customer_types set name = 'Publico' where name = 'Minorista';

-- Lista + perfil Platinum.
insert into public.price_lists (organization_id, name)
select o.id, 'Platinum' from public.organizations o where o.name = 'Bodysculpt'
  on conflict (organization_id, name) do nothing;

insert into public.customer_types (organization_id, name, price_list_id, default_fiscal_condition)
select o.id, 'Platinum', pl.id, 'responsable_inscripto'
from public.organizations o
join public.price_lists pl on pl.organization_id = o.id and pl.name = 'Platinum'
where o.name = 'Bodysculpt'
  on conflict (organization_id, name) do nothing;

-- ── 2. Reglas de precios (default + overrides por categoría) ──
create table if not exists public.pricing_rules (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  category_id           uuid references public.categories(id) on delete cascade,  -- null = regla general
  publico_markup_pct    numeric(6,2) not null default 110,
  mayorista_discount_pct numeric(6,2) not null default 50,
  updated_at            timestamptz not null default now()
);
create unique index if not exists pricing_rules_cat_uq
  on public.pricing_rules (organization_id, category_id) where category_id is not null;
create unique index if not exists pricing_rules_default_uq
  on public.pricing_rules (organization_id) where category_id is null;

alter table public.pricing_rules enable row level security;
drop policy if exists pricing_rules_all on public.pricing_rules;
create policy pricing_rules_all on public.pricing_rules for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- Regla general por defecto.
insert into public.pricing_rules (organization_id, category_id, publico_markup_pct, mayorista_discount_pct)
select o.id, null, 110, 50 from public.organizations o
where o.name = 'Bodysculpt'
  and not exists (
    select 1 from public.pricing_rules r where r.organization_id = o.id and r.category_id is null
  );

-- ── 3. Motor de derivación ───────────────────────────────────
-- Escribe (o actualiza) un precio a nivel producto en una lista.
create or replace function public._store_price(p_org uuid, p_list uuid, p_product uuid, p_price numeric)
returns void language plpgsql as $$
begin
  update public.price_list_items set price = p_price, updated_at = now()
    where price_list_id = p_list and product_id = p_product and variant_id is null;
  if not found then
    insert into public.price_list_items (organization_id, price_list_id, product_id, variant_id, price)
    values (p_org, p_list, p_product, null, p_price);
  end if;
end $$;

-- Devuelve la regla (markup, discount) aplicable a una categoría.
create or replace function public._pricing_rule(p_org uuid, p_cat uuid, out markup numeric, out discount numeric)
language plpgsql as $$
begin
  select publico_markup_pct, mayorista_discount_pct into markup, discount
    from public.pricing_rules where organization_id = p_org and category_id = p_cat;
  if not found then
    select publico_markup_pct, mayorista_discount_pct into markup, discount
      from public.pricing_rules where organization_id = p_org and category_id is null;
  end if;
  markup := coalesce(markup, 110);
  discount := coalesce(discount, 50);
end $$;

-- Deriva y guarda Publico y Mayorista a partir de Platinum (base).
-- Si p_platinum es null, usa el Platinum ya guardado del producto.
create or replace function public.apply_product_pricing(p_product_id uuid, p_platinum numeric default null)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_cat uuid; v_markup numeric; v_discount numeric;
  v_platinum numeric; v_publico numeric; v_mayorista numeric;
  v_lp uuid; v_lpub uuid; v_lmay uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select category_id into v_cat from public.products where id = p_product_id and organization_id = v_org;

  select id into v_lp   from public.price_lists where organization_id = v_org and name = 'Platinum';
  select id into v_lpub from public.price_lists where organization_id = v_org and name = 'Publico';
  select id into v_lmay from public.price_lists where organization_id = v_org and name = 'Mayorista';
  if v_lp is null or v_lpub is null or v_lmay is null then
    raise exception 'Faltan listas de precios (Platinum/Publico/Mayorista)';
  end if;

  select markup, discount into v_markup, v_discount from public._pricing_rule(v_org, v_cat);

  v_platinum := p_platinum;
  if v_platinum is null then
    select price into v_platinum from public.price_list_items
      where price_list_id = v_lp and product_id = p_product_id and variant_id is null;
  end if;
  if v_platinum is null then return; end if;  -- sin base, nada que derivar

  v_platinum  := round(v_platinum);
  v_publico   := round(v_platinum * (1 + v_markup / 100));
  v_mayorista := round(v_publico  * (1 - v_discount / 100));

  perform public._store_price(v_org, v_lp,   p_product_id, v_platinum);
  perform public._store_price(v_org, v_lpub, p_product_id, v_publico);
  perform public._store_price(v_org, v_lmay, p_product_id, v_mayorista);
end $$;

-- Recalcula todos los productos que ya tienen Platinum (tras cambiar reglas).
create or replace function public.recalc_all_pricing()
returns integer language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_lp uuid; r record; n int := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select id into v_lp from public.price_lists where organization_id = v_org and name = 'Platinum';
  if v_lp is null then raise exception 'Falta la lista Platinum'; end if;
  for r in select product_id from public.price_list_items where price_list_id = v_lp and variant_id is null loop
    perform public.apply_product_pricing(r.product_id, null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Seed único: los precios actuales (lista Mayorista) son PUBLICO. Back-calcula
-- Platinum y Mayorista según la regla de cada categoría. Idempotente: sólo toca
-- productos que aún no tienen Platinum.
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
    where pli.price_list_id = v_lmay and pli.variant_id is null
      and not exists (
        select 1 from public.price_list_items x
        where x.price_list_id = v_lp and x.product_id = pli.product_id and x.variant_id is null
      )
  loop
    select markup, discount into v_markup, v_discount from public._pricing_rule(v_org, r.category_id);
    v_publico   := round(r.v);                               -- ancla = publico
    v_platinum  := round(r.v / (1 + v_markup / 100));
    v_mayorista := round(v_publico * (1 - v_discount / 100));

    perform public._store_price(v_org, v_lpub, r.product_id, v_publico);
    perform public._store_price(v_org, v_lp,   r.product_id, v_platinum);
    perform public._store_price(v_org, v_lmay, r.product_id, v_mayorista);
    n := n + 1;
  end loop;
  return n;
end $$;
