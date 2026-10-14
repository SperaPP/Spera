-- 0116_fix_enqueue_tn_definer.sql — el stock del POS/portal no se empujaba a Tiendanube.
--
-- Bug: tg_enqueue_tn_stock (0063) es SECURITY INVOKER y encola en tn_stock_sync_queue
-- (tabla con RLS sin policies: solo service-role). Cuando el cambio de `reserved` viene
-- de una venta de MOSTRADOR mayorista o de un pedido de PORTAL (contexto del empleado,
-- no service-role), la inserción en la cola no prospera → la variante NUNCA se encola →
-- Tiendanube no refleja esas reservas. Solo andaba para los pedidos que entran de TN
-- (service-role) y para "Reparar vínculos". Por eso un pantalón vendido en POS mayorista
-- quedaba con stock más alto en la web.
--
-- Fix: la función de encolado pasa a SECURITY DEFINER + set search_path=public (igual que
-- tg_log_reservation de 0106), así puede escribir en la cola venga de donde venga el
-- cambio. La lógica es idéntica a 0063. Además se reencola todo lo vinculado del depósito
-- de Tiendanube para corregir el desfasaje acumulado (el cron empuja el disponible actual).
-- Append-only e idempotente.

create or replace function public.tg_enqueue_tn_stock() returns trigger
language plpgsql security definer set search_path = public as $$
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

-- Backfill: reencolar todas las variantes vinculadas que tengan stock en el depósito de
-- Tiendanube, para que el cron empuje el disponible ACTUAL y se corrija el desfasaje
-- que quedó mientras el encolado no andaba (ej. Pantalon Isda 300113).
insert into public.tn_stock_sync_queue (organization_id, variant_id, enqueued_at)
select l.organization_id, l.variant_id, now()
from public.tiendanube_links l
join public.stores s on s.organization_id = l.organization_id and s.name = 'Tiendanube'
join public.stock st on st.variant_id = l.variant_id and st.warehouse_id = s.warehouse_id
on conflict (organization_id, variant_id) do update set enqueued_at = now();

notify pgrst, 'reload schema';
