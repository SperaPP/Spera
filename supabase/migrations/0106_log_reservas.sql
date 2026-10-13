-- 0106_log_reservas.sql — registrar en el log los movimientos de RESERVA.
--
-- Problema: el registro de inventario (stock_movements) solo anotaba cambios de
-- FÍSICO. Las reservas (armar un pedido mayorista/portal/TN, anular, despachar,
-- transferir) cambian el "reservado" y NO dejaban rastro → el disponible "aparecía
-- y desaparecía" sin verse por qué.
--
-- Solución: un trigger sobre public.stock que, cuando cambia `reserved`, inserta una
-- fila en stock_movements con reason 'reserva' (al reservar) o 'liberacion' (al liberar).
-- Estas filas NO afectan ningún cálculo de físico (el stock sale de la columna, no de
-- la suma de movimientos); son solo para que el usuario VEA todo el circuito.
-- Append-only e idempotente.

create or replace function public.tg_log_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_delta integer;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  v_delta := coalesce(new.reserved, 0) - coalesce(old.reserved, 0);
  if v_delta = 0 then return new; end if;
  insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
  values (new.organization_id, new.warehouse_id, new.variant_id, v_delta,
          case when v_delta > 0 then 'reserva' else 'liberacion' end,
          'reservation', null, auth.uid());
  return new;
end; $$;

drop trigger if exists stock_log_reservation on public.stock;
create trigger stock_log_reservation after update on public.stock
  for each row execute function public.tg_log_reservation();

-- El trigger de auditoría (0073) auditaba todo reason "no rutinario". Excluimos las
-- reservas/liberaciones para no inundar el audit_log (pasan en cada venta/pedido).
drop trigger if exists audit_stock_adjust on public.stock_movements;
create trigger audit_stock_adjust after insert on public.stock_movements for each row
  when (new.reason not in ('venta','despacho','cambio','anulacion','transferencia','reserva','liberacion'))
  execute function public.tg_audit();

notify pgrst, 'reload schema';
