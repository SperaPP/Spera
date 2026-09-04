-- 0091_transfer_numero.sql — numeración correlativa para transferencias.
--
-- Agrega stock_transfers.number (correlativo). Cubre también las reposiciones, que
-- al aceptarse generan una transferencia. Se numeran las existentes por orden de
-- creación y las nuevas toman el siguiente por default (la RPC create_transfer no
-- setea number, así que el default alcanza). Append-only e idempotente.

create sequence if not exists public.transfer_number_seq;

alter table public.stock_transfers add column if not exists number bigint;

-- Backfill de las existentes sin número, por orden de creación.
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.stock_transfers where number is null
)
update public.stock_transfers t set number = o.rn from ordered o where t.id = o.id;

-- Dejar la secuencia adelante del máximo asignado.
select setval('public.transfer_number_seq', greatest(coalesce((select max(number) from public.stock_transfers), 0), 1),
              (select count(*) from public.stock_transfers) > 0);

-- Las nuevas toman el siguiente automáticamente.
alter table public.stock_transfers alter column number set default nextval('public.transfer_number_seq');
