-- 0077_cliente_doc_digits.sql — búsqueda de cliente robusta por documento.
--
-- Antes se buscaba por doc_number EXACTO (con puntos): "22502172" no matcheaba
-- "22.502.172" → se generaban clientes duplicados. Se agrega una columna calculada
-- doc_digits = solo los dígitos, para buscar/comparar sin importar el formato. Además
-- permite detectar DNI ⊂ CUIT (un CUIT 20-22502172-3 contiene el DNI 22502172).
-- Append-only e idempotente.

alter table public.customers add column if not exists doc_digits text
  generated always as (nullif(regexp_replace(coalesce(doc_number, ''), '[^0-9]', '', 'g'), '')) stored;

create index if not exists customers_doc_digits_idx on public.customers (organization_id, doc_digits);
