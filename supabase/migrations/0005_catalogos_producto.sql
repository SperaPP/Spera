-- 0005_catalogos_producto.sql — Catálogos (categorías, talles, colores, telas),
-- campos nuevos del producto, SKU correlativo y RPC actualizada.
-- Append-only e idempotente.
-- Categorías, colores y talles se seedean EXACTAMENTE como están en WooCommerce
-- (para que la importación matchee 1 a 1 sin mapear). Telas es catálogo nuevo.

-- ── Catálogos ────────────────────────────────────────────────
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.sizes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  active boolean not null default true,
  unique (organization_id, name)
);

create table if not exists public.colors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique (organization_id, name)
);

create table if not exists public.fabric_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique (organization_id, name)
);

alter table public.categories   enable row level security;
alter table public.sizes        enable row level security;
alter table public.colors       enable row level security;
alter table public.fabric_types enable row level security;

drop policy if exists categories_all on public.categories;
create policy categories_all on public.categories for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
drop policy if exists sizes_all on public.sizes;
create policy sizes_all on public.sizes for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
drop policy if exists colors_all on public.colors;
create policy colors_all on public.colors for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
drop policy if exists fabric_types_all on public.fabric_types;
create policy fabric_types_all on public.fabric_types for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

-- ── Campos nuevos del producto ───────────────────────────────
alter table public.products add column if not exists description    text;
alter table public.products add column if not exists category_id    uuid references public.categories(id);
alter table public.products add column if not exists fabric_type_id uuid references public.fabric_types(id);

alter table public.products drop constraint if exists products_variation_type_check;
alter table public.products add constraint products_variation_type_check
  check (variation_type in ('none','size','color','size_color'));

-- ── SKU correlativo (con esto se arma el código de barras CODE39) ──
create sequence if not exists public.sku_seq start 1000;
create unique index if not exists product_variants_sku_uq
  on public.product_variants (organization_id, sku) where sku is not null;

-- ── Semilla: valores EXACTOS de WooCommerce ──────────────────
insert into public.categories (organization_id, name)
select o.id, c.name from public.organizations o
cross join (values
  ('Accesorios'),('Accesorios Jean'),('Acolchados'),('Alfombras'),('Almohadones'),('Bodys'),
  ('Bolsas y Perchas'),('BsMen'),('Buzos'),('Calza Jean'),('Calzados'),('Calzas y Capris'),
  ('Caminitos'),('Camperas Jean-Cuero'),('Camperas y Sacos'),('Conjuntos'),('Cuadros'),('Difusor'),
  ('Dijes y Cadenas'),('Enteritos'),('Fragancias'),('Gorras'),('Home'),('INVIERNO'),
  ('Jeans Y Vestidos'),('Luxury'),('Mujer'),('Musculosa y Sudaderas'),('Musculosas'),
  ('Pantalones & Babuchas'),('Pantalones/Culturistas'),('Porta Servilletas'),('Porta Vaso'),
  ('Remera'),('Remeras y Camisas'),('sale'),('Sanitizantes/Fragancias'),('Short'),('Short Jean'),
  ('Shorts y Ciclistas'),('Temporada Otoño Invierno'),('Tops'),('Velas'),('Verano'),('Vestidos y Polleras')
) as c(name) where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

insert into public.colors (organization_id, name)
select o.id, c.name from public.organizations o
cross join (values
  ('AMARILLO'),('Amarillo con marron'),('Amarillo Fluo'),('ANIMAL PRINT'),('ANIMAL PRINT CON DORADO'),('AZUL'),('AZUL BRILLOSO'),('Azul c/blanco'),('Azul c/Celeste'),('Azul Claro'),('AZUL CON AMARILLO'),('AZUL CON BEIGE'),('Azul Con blanco'),('AZUL CON CELESTE'),('AZUL CON CRUDO'),('AZUL CON GRIS'),('Azul Con Negro'),('AZUL CON ROJO'),('AZUL CON VIOLETA'),('AZUL CON VISON'),('AZUL FLOREADO'),('AZUL FRANCIA'),('AZUL MARINO'),('Azul Oscuro'),('AZUL PASTEL'),('AZUL RAYADO'),('Azul/Rojo'),('BEIGE'),('beige c/camel'),('BEIGE CON AZUL'),('BEIGE CON BLANCO'),('BEIGE CON BORDO'),('BEIGE CON DORADO'),('BEIGE CON GRIS'),('Beige con Marron'),('Beige Con Negro'),('BEIGE CON PLATA'),('Beige con rojo'),('Beige con Rosa'),('Black'),('BLANCO'),('BLANCO ANIMAL PRINT'),('BLANCO CON AMARILLO'),('BLANCO CON AZUL'),('BLANCO CON BEIGE'),('BLANCO CON celeste'),('BLANCO CON DORADO'),('BLANCO CON FUCSIA'),('BLANCO CON GLITTER'),('BLANCO CON GRIS'),('BLANCO CON NEGRO'),('BLANCO CON PLATA'),('BLANCO CON ROJO'),('BLANCO CON ROSA'),('BLANCO CON VERDE'),('BLANCO CON VIOLETA'),('BLANCO MOD 1 PIEDRAS'),('BLANCO MOD 2 SIMPLE'),('BLANCO MOD 2 SIMPLES'),('BLANCO RAYADO'),('Blanco/ Gris Topo'),('BLANCO/GRIS TOPO'),('Blanco/Tul'),('Blue'),('BORDO'),('BORDO /MODELO 1'),('Bordo con Blanco'),('BORDO MOD 1'),('Bordo/rojo'),('BORRAVINO'),('BORRAVINO /MODELO 2'),('BORRAVINO MOD 2'),('BRONCE'),('Camel'),('CAMUFLADO'),('CARMIN'),('Cebra'),('CELESTE'),('CELESTE BRILLOSO'),('CELESTE C/MARRON'),('CELESTE CON AZUL'),('CELESTE CON BLANCO'),('CELESTE CON ROSA'),('CELESTE CON VERDE'),('Celeste Rayado'),('COBRE'),('COBRE CON BLANCO'),('CORAL'),('Coral c/ Azul'),('Coral c/ Gris'),('Coral c/ Gris Tul'),('Coral c/Azul Tul'),('coral c/gris'),('CORAL CON GRIS'),('CORAL RAYADO'),('Coralc/blanco'),('Coralc/Negro'),('Corderito Negro'),('CREMA'),('Crudo'),('Crudo c/ Negro'),('Crudo c/Gliter'),('CRUDO CON BEIGE'),('CRUDO CON BLANCO'),('Crudo con rojo'),('CRUDO CON ROSA'),('CRUDO CON VISON'),('Crudo Rayado'),('Crudo/AZUL'),('Crudo/Rosa'),('Dark Blue'),('Dark Green'),('Dark Grey'),('DORADO'),('DORADO ANIMAL PRINT'),('DORADO CON FLORES'),('Dorado con Plata'),('DORADO CON ROJO'),('FLOREADO'),('FUCSIA'),('Fucsia c/ Azul'),('Fucsia c/ Gris'),('Fucsia con Blanco'),('FUCSIA CON NEGRO'),('Fucsia con Plata'),('Fucsia con Rosa'),('FUCSIA CON TURQUESA'),('Fucsia con Verde'),('Fucsisa/Blanco'),('GLITTER'),('Grey'),('GRIS'),('GRIS CLARO'),('GRIS CLARO CON DORADO'),('Gris Claro Rayado'),('GRIS Con AMARILLO'),('GRIS CON AZUL'),('GRIS CON BLANCO'),('GRIS CON CELESTE'),('GRIS CON FUCSIA'),('GRIS CON GLITTER'),('GRIS CON NARANJA'),('GRIS CON NEGRO'),('GRIS CON ROJO'),('Gris con Rosa'),('GRIS CON VERDE'),('GRIS CON VIOLETA'),('Gris Frizado'),('GRIS MELANGE'),('GRIS MOD 1 PIEDRAS'),('GRIS MOD 2 SIMPLE'),('GRIS OSCURO'),('GRIS OSCURO CON DORADO'),('Gris Oscuro Rayado'),('Gris Peltre'),('GRIS RAYADO'),('Gris Rustico'),('GRIS TOPO'),('Gris/plateado'),('GrisPeltre/Negro'),('Griz Gamuzado'),('LAVANDA'),('Light Blue'),('Light Green'),('Light Pink'),('Light Purple'),('Light Yellow'),('LILA'),('LILA CON DORADO'),('Lunares'),('Magenta'),('MANO'),('MARRON'),('Marron Claro'),('Marron con Blanco'),('Modelo 1'),('Modelo 2'),('Modelo 3'),('Modelo 4'),('MOSTAZA'),('MULTICOLOR'),('MULTICOLOR GEOMETRICO'),('NARANJA'),('NARANJA CON AMARILLO'),('NARANJA CON NEGRO'),('NARANJA CON VERDE'),('NEGRO'),('NEGRO 1'),('NEGRO 10'),('NEGRO 2'),('NEGRO 3'),('NEGRO 4'),('NEGRO 5'),('NEGRO 6'),('NEGRO 7'),('NEGRO 8'),('NEGRO 9'),('NEGRO ALGODON'),('NEGRO ANIMAL PRINT'),('negro brillo'),('NEGRO BRILLOSO'),('Negro brilloso lunar'),('Negro brilloso panal'),('Negro brilloso rayado'),('Negro brilloso trenza'),('Negro c/ Red'),('NEGRO CEBRA'),('NEGRO CON AMARILLO'),('NEGRO CON AZUL'),('NEGRO CON BEIGE'),('NEGRO CON BLANCO'),('NEGRO CON BORDO'),('NEGRO CON CEBRA'),('NEGRO CON CELESTE'),('NEGRO CON COBRE'),('Negro Con Crudo'),('NEGRO CON DORADO'),('Negro Con Fucsia'),('NEGRO CON GLITTER'),('NEGRO CON GRIS'),('Negro con Gris con Glitter'),('NEGRO CON GRIS TOPO'),('NEGRO CON LILA'),('NEGRO CON LUNARES'),('NEGRO CON MARRON'),('NEGRO CON NARANJA'),('NEGRO CON PLATA'),('NEGRO CON REFLEX'),('NEGRO CON ROJO'),('NEGRO CON ROSA'),('NEGRO CON VERDE'),('NEGRO CON VIOLETA'),('NEGRO CON VISON'),('Negro Croco'),('Negro Crudo'),('Negro Cuero'),('NEGRO DRIFIT'),('Negro Gamuza'),('NEGRO GLITTER'),('NEGRO LUNAR'),('NEGRO LUNAR DORADO'),('Negro Mate'),('NEGRO MOD 1'),('NEGRO MOD 1 PIEDRAS'),('NEGRO MOD 2'),('NEGRO MOD 2 SIMPLE'),('NEGRO MOD 2 SIMPLES'),('Negro Opaco'),('Negro opaco lunar'),('Negro opaco panal'),('Negro opaco rayado'),('Negro opaco trenza'),('NEGRO PANAL'),('NEGRO RAYADO'),('NEGRO TORNASOLADO'),('NEGRO TUL'),('Negro VL'),('NUDE'),('NUDE CON AZUL'),('Orange'),('OXIDO'),('PETROLEO'),('Piel Negro'),('PLATEADO'),('Plateado c/Negro'),('PLATEADO PIEDRA'),('Plush Negro'),('Polar Negro'),('queen/king azul'),('queen/king beige'),('queen/king blanco'),('queen/king crudo'),('queen/king gris'),('queen/king rosa'),('queen/king verde'),('queen/king vison'),('Rayado'),('ROJO'),('ROJO CON AMARILLO'),('ROJO CON AZUL'),('Rojo con Celeste'),('ROJO CON DORADO'),('Rojo Con Negro'),('ROJO CON PLATA'),('ROJO RAYADO'),('ROSA'),('Rosa c/ Azul'),('Rosa C/ Azul Tul'),('Rosa C/Gris Tul'),('ROSA CHICLE'),('Rosa Claro'),('ROSA CON BLANCO'),('ROSA CON DORADO'),('ROSA CON GRIS'),('ROSA CON NARANJA'),('ROSA CON NEGRO'),('ROSA CON PLATEADO'),('ROSA CON VERDE'),('ROSA FLUO'),('ROSA FLUOR'),('Rosa Metalizado'),('ROSA MOD 1'),('ROSA MOD 2'),('ROSA MOD 3'),('ROSA MOD 4'),('ROSA MOD 5'),('ROSA PASTEL'),('ROSA RAYADO'),('ROSA VIEJO'),('SALMON'),('Taupe'),('Terracota'),('TORNASOL'),('TURQUESA'),('V1'),('V2'),('V3'),('VERDE'),('VERDE AGUA'),('verde agua c/gris'),('VERDE AGUA CON GRIS'),('Verde Azulado'),('VERDE CEMENTO'),('VERDE CLARO'),('Verde con Blanco'),('VERDE CON CELESTE'),('VERDE CON GLITTER'),('VERDE CON GRIS'),('VERDE CON NARANJA'),('Verde con Naranja Mod 1'),('Verde con Naranja Mod 2'),('Verde con Negro'),('VERDE CON PLATEADO'),('Verde con Rosa'),('VERDE FLUO'),('Verde Lima'),('Verde Manzana'),('Verde Militar'),('VERDE MUSGO'),('VERDE OSCURO'),('VERDE RAYADO'),('VIOLETA'),('VIOLETA C/ AZUL'),('VIOLETA CON CELESTE'),('VIOLETA CON GRIS'),('VIOLETA CON NEGRO'),('VIOLETA CON ROSA'),('VIOLETA CON VERDE'),('vison'),('White')
) as c(name) where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

insert into public.sizes (organization_id, name, position)
select o.id, s.name, s.pos from public.organizations o
cross join (values
  ('XS',1),('S',2),('M',3),('L',4),('XL',5),('XXL',6),('XXXL',7),('TU',8),
  ('S/M',9),('M/L',10),('L/XL',11),('XL/XXL',12),
  ('35',50),('35/36',51),('36',52),('37',53),('38',54),('39',55),('39/40',56),('40',57),('41',58),
  ('85/1',60),('90/2',61),('95/3',62),('100/4',63),('105/5',64),('110/6',65),('T.40',66),('T.85',67),
  ('chico',70),('CHICA',71),('Mediano',72),('GRANDE',73),('Alto',74),
  ('1',80),('2',81),('3',82),('2003',83)
) as s(name,pos) where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

insert into public.fabric_types (organization_id, name)
select o.id, f.name from public.organizations o
cross join (values
  ('Algodón'),('Modal'),('Lycra'),('Poliéster'),('Morley'),('Frisa'),('Rústico'),
  ('Jean'),('Lino'),('Bengalina'),('Gabardina'),('Piqué'),('Rib'),('Microfibra'),('Encaje')
) as f(name) where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

-- ── RPC actualizada: sin marca, con descripción/categoría/tela, SKU auto ──
drop function if exists public.create_product(text,text,text,text,numeric,jsonb,uuid,jsonb);

create or replace function public.create_product(
  p_name           text,
  p_description    text,
  p_category_id    uuid,
  p_fabric_type_id uuid,
  p_variation_type text,
  p_tax_rate       numeric,
  p_variants       jsonb,   -- [{ size, color, stock }]  (sku/barcode son automáticos)
  p_warehouse_id   uuid,
  p_prices         jsonb    -- [{ price_list_id, price }]
) returns uuid
language plpgsql
as $$
declare
  v_org     uuid := public.current_org_id();
  v_product uuid;
  v_variant uuid;
  v_el      jsonb;
  v_sku     text;
  v_stock   integer;
begin
  if v_org is null then raise exception 'Sin organización en el contexto'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'El nombre es obligatorio'; end if;

  insert into public.products
    (organization_id, name, description, category_id, fabric_type_id, brand, variation_type, tax_rate)
  values
    (v_org, trim(p_name), nullif(trim(coalesce(p_description,'')),''), p_category_id, p_fabric_type_id,
     'Bodysculpt', coalesce(nullif(p_variation_type,''),'none'), coalesce(p_tax_rate,21))
  returning id into v_product;

  for v_el in select e from jsonb_array_elements(coalesce(p_variants,'[]'::jsonb)) as e
  loop
    v_sku := lpad(nextval('public.sku_seq')::text, 7, '0');

    insert into public.product_variants (organization_id, product_id, size, color, sku, barcode)
    values (v_org, v_product,
            nullif(trim(coalesce(v_el->>'size','')),''),
            nullif(trim(coalesce(v_el->>'color','')),''),
            v_sku, v_sku)
    returning id into v_variant;

    v_stock := coalesce(nullif(v_el->>'stock','')::integer, 0);
    if v_stock <> 0 and p_warehouse_id is not null then
      insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, p_warehouse_id, v_variant, v_stock)
      on conflict (warehouse_id, variant_id)
        do update set quantity = stock.quantity + excluded.quantity, updated_at = now();

      insert into public.stock_movements
        (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_warehouse_id, v_variant, v_stock, 'ingreso', 'product_create', v_product, auth.uid());
    end if;
  end loop;

  for v_el in select e from jsonb_array_elements(coalesce(p_prices,'[]'::jsonb)) as e
  loop
    if nullif(trim(coalesce(v_el->>'price','')),'') is not null then
      insert into public.price_list_items (organization_id, price_list_id, product_id, variant_id, price)
      values (v_org, (v_el->>'price_list_id')::uuid, v_product, null, (v_el->>'price')::numeric);
    end if;
  end loop;

  return v_product;
end;
$$;
