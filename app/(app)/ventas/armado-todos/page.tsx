import { createClient } from "@/lib/supabase/server";
import { ArmadoTodosPrint } from "@/components/armado-todos-print";
import type { ArmadoSale, ArmadoItem } from "@/components/armado-print";

function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }
const rank = (n: number | null) => (n == null ? Number.POSITIVE_INFINITY : n);
const AR_OFFSET = "-03:00";
const MAX = 100;

type Params = { q?: string; store?: string; desde?: string; hasta?: string; estado?: string };

export default async function ArmadoTodosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { q, store, desde, hasta, estado } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  // Disponibles = sin imprimir y no anuladas, según los filtros de la lista.
  let req = sb.from("sales")
    .select("id, number, created_at, customers(name), stores(name), organizations(name)")
    .is("armado_printed_at", null)
    .neq("status", "anulada")
    .order("created_at", { ascending: true })
    .limit(MAX);

  if (query) {
    const isNum = /^\d+$/.test(query);
    const { data: custs } = await sb.from("customers").select("id").ilike("name", `%${query}%`).limit(50);
    const custIds = (custs ?? []).map((c) => c.id);
    if (isNum && custIds.length) req = req.or(`number.eq.${Number(query)},customer_id.in.(${custIds.join(",")})`);
    else if (isNum) req = req.eq("number", Number(query));
    else if (custIds.length) req = req.in("customer_id", custIds);
    else req = req.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (store) req = req.eq("store_id", store);
  if (desde) req = req.gte("created_at", `${desde}T00:00:00${AR_OFFSET}`);
  if (hasta) req = req.lte("created_at", `${hasta}T23:59:59${AR_OFFSET}`);
  if (estado === "completado") req = req.in("fulfillment_status", ["entregado", "despachado"]);
  else if (estado === "pendiente" || estado === "controlado") req = req.eq("fulfillment_status", estado);
  // (estado "anulada" no aplica: las anuladas nunca están disponibles)

  const { data: sales } = await req;
  const list = sales ?? [];
  const ids = list.map((s) => s.id);

  // Ítems de todos los pedidos en un solo query, agrupados por venta.
  const itemsBySale = new Map<string, ArmadoItem[]>();
  if (ids.length) {
    const { data: items } = await sb.from("sale_items")
      .select("sale_id, product_name, variant_label, quantity, product_variants(sku, loc_fila, loc_estante, loc_cubiculo)")
      .in("sale_id", ids);
    for (const it of (items ?? []) as Array<{ sale_id: string; product_name: string; variant_label: string | null; quantity: number; product_variants: unknown }>) {
      const v = rel<{ sku: string | null; loc_fila: number | null; loc_estante: number | null; loc_cubiculo: number | null }>(it.product_variants);
      const arr = itemsBySale.get(it.sale_id) ?? [];
      arr.push({
        productName: it.product_name, variantLabel: it.variant_label, sku: v?.sku ?? null, quantity: it.quantity,
        fila: v?.loc_fila ?? null, estante: v?.loc_estante ?? null, cubiculo: v?.loc_cubiculo ?? null,
      });
      itemsBySale.set(it.sale_id, arr);
    }
    for (const arr of itemsBySale.values()) {
      arr.sort((a, b) => rank(a.fila) - rank(b.fila) || rank(a.estante) - rank(b.estante) || rank(a.cubiculo) - rank(b.cubiculo) || a.productName.localeCompare(b.productName));
    }
  }

  const shaped: ArmadoSale[] = list.map((s) => ({
    id: s.id,
    number: s.number,
    createdAt: s.created_at,
    orgName: rel<{ name: string }>(s.organizations)?.name ?? "Bodysculpt",
    storeName: rel<{ name: string }>(s.stores)?.name ?? null,
    customerName: rel<{ name: string }>(s.customers)?.name ?? null,
    items: itemsBySale.get(s.id) ?? [],
  }));

  return (
    <div>
      <ArmadoTodosPrint sales={shaped} />
      {list.length === MAX && (
        <p className="ar-toolbar mt-3 text-center text-xs text-warn">Se muestran los primeros {MAX} pedidos. Imprimí este lote y volvé a "Imprimir todos" para el resto.</p>
      )}
    </div>
  );
}
