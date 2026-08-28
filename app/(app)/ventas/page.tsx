import Link from "next/link";
import { Receipt, Eye, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";
import { ProductSearch } from "@/components/product-search";
import { FacturarButton } from "@/components/facturar-button";
import { ImprimirArmadoButton } from "@/components/imprimir-armado-button";
import { VentasFilters } from "@/components/ventas-filters";
import { getStoreScope } from "@/lib/auth";

const AR_OFFSET = "-03:00";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

type VentasParams = { q?: string; store?: string; desde?: string; hasta?: string; impreso?: string; estado?: string };

export default async function VentasPage({ searchParams }: { searchParams: Promise<VentasParams> }) {
  const { q, store, desde, hasta, impreso, estado } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  const [{ data: isAdmin }, { data: storesAll }, { storeId: scopeStore }] = await Promise.all([
    sb.rpc("is_admin"),
    sb.from("stores").select("id, name").eq("active", true).order("name"),
    getStoreScope(),
  ]);
  // Gestión por mostradores: si está acotado, sólo su local (en query y en el filtro).
  const stores = scopeStore ? (storesAll ?? []).filter((s) => s.id === scopeStore) : storesAll;

  const sel = "id, number, status, fulfillment_status, created_at, total, paid_amount, channel, customer_name, tn_order_number, armado_printed_at, customers(name), stores(name), sale_items(count)";
  const FULFILL: Record<string, { label: string; cls: string }> = {
    entregado: { label: "Completado", cls: "bg-ok-bg text-ok" },
    despachado: { label: "Completado", cls: "bg-ok-bg text-ok" },
    controlado: { label: "Controlado", cls: "bg-accent-soft text-accent" },
    pendiente: { label: "En preparación", cls: "bg-warn-bg text-warn" },
  };
  let req = sb.from("sales").select(sel).order("created_at", { ascending: false }).limit(100);

  let custIds: string[] | null = null;
  const isNum = /^\d+$/.test(query);
  if (query) {
    const { data: custs } = await sb.from("customers").select("id").ilike("name", `%${query}%`).limit(50);
    custIds = (custs ?? []).map((c) => c.id);
    if (isNum && custIds.length) req = req.or(`number.eq.${Number(query)},customer_id.in.(${custIds.join(",")})`);
    else if (isNum) req = req.eq("number", Number(query));
    else if (custIds.length) req = req.in("customer_id", custIds);
    else req = req.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  // Filtros
  if (scopeStore) req = req.eq("store_id", scopeStore);
  if (store) req = req.eq("store_id", store);
  if (desde) req = req.gte("created_at", `${desde}T00:00:00${AR_OFFSET}`);
  if (hasta) req = req.lte("created_at", `${hasta}T23:59:59${AR_OFFSET}`);
  if (impreso === "si") req = req.not("armado_printed_at", "is", null);
  else if (impreso === "no") req = req.is("armado_printed_at", null);
  if (estado === "anulada") req = req.eq("status", "anulada");
  else if (estado === "completado") req = req.neq("status", "anulada").in("fulfillment_status", ["entregado", "despachado"]);
  else if (estado === "pendiente" || estado === "controlado") req = req.neq("status", "anulada").eq("fulfillment_status", estado);

  const { data: rows } = await req;

  // Disponibles para "Imprimir todos": sin imprimir y no anuladas, según filtros (menos "impreso").
  let availReq = sb.from("sales").select("id", { count: "exact", head: true }).is("armado_printed_at", null).neq("status", "anulada");
  if (scopeStore) availReq = availReq.eq("store_id", scopeStore);
  if (query) {
    if (isNum && custIds!.length) availReq = availReq.or(`number.eq.${Number(query)},customer_id.in.(${custIds!.join(",")})`);
    else if (isNum) availReq = availReq.eq("number", Number(query));
    else if (custIds!.length) availReq = availReq.in("customer_id", custIds!);
    else availReq = availReq.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (store) availReq = availReq.eq("store_id", store);
  if (desde) availReq = availReq.gte("created_at", `${desde}T00:00:00${AR_OFFSET}`);
  if (hasta) availReq = availReq.lte("created_at", `${hasta}T23:59:59${AR_OFFSET}`);
  if (estado === "completado") availReq = availReq.in("fulfillment_status", ["entregado", "despachado"]);
  else if (estado === "pendiente" || estado === "controlado") availReq = availReq.eq("fulfillment_status", estado);
  const { count: disponibles } = await availReq;

  const printAllQs = new URLSearchParams();
  if (query) printAllQs.set("q", query);
  if (store) printAllQs.set("store", store);
  if (desde) printAllQs.set("desde", desde);
  if (hasta) printAllQs.set("hasta", hasta);
  if (estado) printAllQs.set("estado", estado);
  const printAllHref = `/ventas/armado-todos${printAllQs.toString() ? `?${printAllQs}` : ""}`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Ventas</h1>
          <p className="mt-1 mb-4 text-sm text-muted">Historial de ventas del punto de venta.</p>
        </div>
        {(disponibles ?? 0) > 0 && (
          <Link href={printAllHref} target="_blank" className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover">
            <Printer className="h-4 w-4" /> Imprimir todos ({disponibles})
          </Link>
        )}
      </div>

      <div className="mb-3">
        <ProductSearch basePath="/ventas" placeholder="Buscar por N° de venta o cliente…" />
      </div>
      <div className="mb-4">
        <VentasFilters stores={stores ?? []} />
      </div>

      {(rows ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Receipt className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">{query ? `Sin resultados para "${query}"` : "Todavía no hay ventas"}</p>
          <p className="mt-1 text-sm text-muted">Las ventas del POS van a aparecer acá.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Local</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 text-right font-medium">Ítems</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/ventas/${s.id}`} className="text-ink transition-colors hover:text-accent">{s.number}</Link>
                    {s.channel === "tiendanube" && s.tn_order_number && <span className="ml-1.5 text-xs font-normal text-muted">(TN #{s.tn_order_number})</span>}
                    {s.status === "anulada" && <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-medium text-danger">Anulada</span>}
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(s.created_at)}</td>
                  <td className="px-4 py-3 text-muted">{relName(s.stores) ?? "—"}</td>
                  <td className="px-4 py-3 text-ink">{relName(s.customers) ?? s.customer_name ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{(s.sale_items as { count: number }[] | null)?.[0]?.count ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-ink">{formatMoney(Number(s.total))}</td>
                  <td className="px-4 py-3">
                    {s.status === "anulada" ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (() => {
                      const f = FULFILL[s.fulfillment_status] ?? { label: s.fulfillment_status, cls: "bg-canvas text-muted" };
                      const pagado = Number(s.paid_amount) >= Number(s.total) - 0.01;
                      return (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${f.cls}`}>{f.label}</span>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${pagado ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}>
                            {pagado ? "Pagado" : "Sin pagar"}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link href={`/ventas/${s.id}`} title="Ver venta" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-muted transition-colors hover:bg-canvas hover:text-ink">
                        <Eye className="h-4 w-4" />
                      </Link>
                      <ImprimirArmadoButton saleId={s.id} printed={s.armado_printed_at != null} isAdmin={isAdmin === true} />
                      <FacturarButton />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
