-- limpieza_categorias_sale.sql
-- Operación de datos (Bodysculpt / Spera). Correr en el SQL Editor de Supabase.
-- Orden: (A) precios de los Sale → (B) unificar plural/singular + y/& → (C) recategorizar Sale.
-- Idempotente: la parte de precios tiene guarda (promo_price is null) para no multiplicar si se corre dos veces.
--
-- Recomendado: correr primero la sección PREVIEW (al final, comentada) para ver el impacto.

begin;

-- ─────────────────────────────────────────────────────────────
-- (A) PRECIOS — solo lista Mayorista, productos en subcategoría "Sale, *"
--     promo = precio mayorista actual ; precio de lista (tachado) = actual × 1.40
--     Guarda: solo donde todavía no hay promo (idempotente).
-- ─────────────────────────────────────────────────────────────
update public.price_list_items pli
set promo_price = pli.price,
    price       = round(pli.price * 1.40),
    updated_at  = now()
from public.products p
join public.categories c on c.id = p.category_id
join public.price_lists l on l.name = 'Mayorista'
where pli.product_id = p.id
  and pli.price_list_id = l.id
  and pli.variant_id is null
  and c.name like 'Sale, %'
  and pli.promo_price is null;

-- ─────────────────────────────────────────────────────────────
-- (B) UNIFICAR subcategorías duplicadas (plural/singular + y/&)
--     Mueve los productos del nombre viejo al canónico. No fusiona compuestas.
-- ─────────────────────────────────────────────────────────────
do $$
declare m record;
begin
  for m in
    select * from (values
      ('Remera','Remeras'),
      ('Buzo','Buzos'),
      ('Short','Shorts'),
      ('Jean','Jeans'),
      ('Musculosa','Musculosas'),
      ('Saco','Sacos'),
      ('Body','Bodys'),
      ('Bermuda','Bermudas'),
      ('Acolchado','Acolchados'),
      ('Pijama','Pijamas'),
      ('Pantalones y Babuchas','Pantalones & Babuchas')
    ) as t(src, dst)
  loop
    update public.products
      set category_id = (select id from public.categories where name = m.dst)
      where category_id = (select id from public.categories where name = m.src);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- (C) RECATEGORIZAR los "Sale, *" → madre + subcategoría que corresponde
-- ─────────────────────────────────────────────────────────────
-- Crear subcategoría "Poleras" (Mujer) si no existe.
insert into public.categories (organization_id, name)
  select organization_id, 'Poleras' from public.main_categories where name = 'Mujer'
  on conflict (organization_id, name) do nothing;

do $$
declare
  v_mujer uuid := (select id from public.main_categories where name = 'Mujer');
  v_home  uuid := (select id from public.main_categories where name = 'Home');
  v_acc   uuid := (select id from public.main_categories where name = 'Accesorios');
  m record;
begin
  for m in
    select * from (values
      -- Sale, X              → subcategoría destino        → madre
      ('Sale, Remera',               'Remeras',               v_mujer),
      ('Sale, Musculosa',            'Musculosas',            v_mujer),
      ('Sale, Buzo',                 'Buzos',                 v_mujer),
      ('Sale, Short',                'Shorts',                v_mujer),
      ('Sale, Top',                  'Top',                   v_mujer),
      ('Sale, Ciclista',             'Ciclista',              v_mujer),
      ('Sale, Tapado',               'Tapados',               v_mujer),
      ('Sale, Saco',                 'Sacos',                 v_mujer),
      ('Sale, Enterito',             'Enterito',              v_mujer),
      ('Sale, Body',                 'Bodys',                 v_mujer),
      ('Sale, Camisa',               'Camisa',                v_mujer),
      ('Sale, Jean',                 'Jeans',                 v_mujer),
      ('Sale, Bermuda',              'Bermudas',              v_mujer),
      ('Sale, Calza',                'Calza',                 v_mujer),
      ('Sale, Campera',              'Campera',               v_mujer),
      ('Sale, Chaleco',              'Chaleco',               v_mujer),
      ('Sale, Pantalones & Babuchas','Pantalones & Babuchas', v_mujer),
      ('Sale, Vestido',              'Vestidos & Polleras',   v_mujer),
      ('Sale, Pollera',              'Vestidos & Polleras',   v_mujer),
      ('Sale, Polera',               'Poleras',               v_mujer),
      -- No son de Mujer → madre natural
      ('Sale, Acolchado',            'Acolchados',            v_home),
      ('Sale, Bolso',                'Bolso',                 v_acc),
      ('Sale, Gorra',                'Gorra',                 v_acc),
      ('Sale, Gorras',               'Gorra',                 v_acc),
      ('Sale, Visera',               'Gorra',                 v_acc),
      ('Sale, Sandalias',            'Sandalias',             v_acc),
      ('Sale, Zapatilla',            'Zapatilla',             v_acc)
    ) as t(src, dst, madre)
  loop
    update public.products
      set main_category_id = m.madre,
          category_id      = (select id from public.categories where name = m.dst)
      where category_id = (select id from public.categories where name = m.src);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- (D) Desactivar subcategorías que quedaron vacías (reversible: active=false, no borra)
-- ─────────────────────────────────────────────────────────────
update public.categories c
  set active = false
  where (c.name like 'Sale, %'
         or c.name in ('Remera','Buzo','Short','Jean','Musculosa','Saco','Body',
                       'Bermuda','Acolchado','Pijama','Pantalones y Babuchas'))
    and not exists (select 1 from public.products p where p.category_id = c.id);

commit;

-- avisar a PostgREST por si cambió algo de esquema
notify pgrst, 'reload schema';

/* ─────────────── PREVIEW (correr ANTES, sin el begin/commit de arriba) ───────────────
-- 1) Cuántos productos se recategorizan por cada Sale:
select c.name as origen, count(p.id) as productos
from public.categories c
left join public.products p on p.category_id = c.id
where c.name like 'Sale, %'
group by c.name order by productos desc;

-- 2) Muestra de cambios de precio (Mayorista):
select p.name, pli.price as precio_actual,
       round(pli.price * 1.40) as nuevo_precio_lista_tachado,
       pli.price as nueva_promo
from public.price_list_items pli
join public.products p on p.id = pli.product_id
join public.categories c on c.id = p.category_id
join public.price_lists l on l.id = pli.price_list_id
where c.name like 'Sale, %' and l.name = 'Mayorista'
  and pli.variant_id is null and pli.promo_price is null
limit 20;
*/
