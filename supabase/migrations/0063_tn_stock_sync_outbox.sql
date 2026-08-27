-- 0063_tn_stock_sync_outbox.sql — sync continuo de stock hacia Tiendanube.
--
-- No se puede llamar a la API de TN desde un trigger (haría HTTP dentro de la
-- transacción de la venta). Patrón outbox: cuando cambia el DISPONIBLE
-- (físico − reservado) de una variante sincronizada en el depósito de la tienda
-- (Mayorista-Central), se ENCOLA la variante. Un proceso externo (endpoint
-- /api/tiendanube/sync-stock, disparado por el webhook y por un cron) drena la
-- cola y empuja el disponible a TN. Encolar es idempotente (una fila por variante).
-- Append-only e idempotente.

create table if not exists public.tn_stock_sync_queue (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  enqueued_at     timestamptz not null default now(),
  primary key (organization_id, variant_id)
);
alter table public.tn_stock_sync_queue enable row level security;
-- Sin políticas: solo el service-role (server) la lee/escribe.

-- Encola la variante si (a) está sincronizada (tiene link) y (b) el depósito que
-- cambió es el de la tienda Tiendanube de esa organización, y (c) cambió el disponible.
create or replace function public.tg_enqueue_tn_stock() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(new.quantity,0) - coalesce(new.reserved,0)
       = coalesce(old.quantity,0) - coalesce(old.reserved,0) then
    return new; -- el disponible no cambió
  end if;

  if exists (select 1 from public.tiendanube_links l
              where l.organization_id = new.organization_id and l.variant_id = new.variant_id)
     and exists (select 1 from public.stores s
                  where s.organization_id = new.organization_id
                    and s.warehouse_id = new.warehouse_id and s.name = 'Tiendanube') then
    insert into public.tn_stock_sync_queue (organization_id, variant_id, enqueued_at)
    values (new.organization_id, new.variant_id, now())
    on conflict (organization_id, variant_id) do update set enqueued_at = now();
  end if;
  return new;
end; $$;

drop trigger if exists stock_enqueue_tn on public.stock;
create trigger stock_enqueue_tn after insert or update on public.stock
  for each row execute function public.tg_enqueue_tn_stock();
