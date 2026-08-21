import Link from "next/link";
import { Truck, ScanLine, ChevronRight, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getStoreScope } from "@/lib/auth";
import { formatMoney, formatDateTime } from "@/lib/format";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-warn-bg text-warn" },
  controlado: { label: "Controlado", cls: "bg-accent-soft text-accent" },
  despachado: { label: "Despachado", cls: "bg-ok-bg text-ok" },
  entregado: { label: "Entregado", cls: "bg-canvas text-muted" },
  enviada: { label: "Enviada", cls: "bg-warn-bg text-warn" },
  recibida: { label: "Recibida", cls: "bg-ok-bg text-ok" },
  cancelada: { label: "Cancelada", cls: "bg-danger-bg text-danger" },
};

const TABS = [
  { key: "pendiente", label: "Por controlar" },
  { key: "controlado", label: "Por despachar" },
  { key: "despachado", label: "Despachados" },
  { key: "entregado", label: "Entregados" },
  { key: "transferencias", label: "Transferencias" },
  { key: "todos", label: "Todas las ventas" },
];

export default async function LogisticaPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const { estado } = await searchParams;
  const filter = estado && TABS.some((t) => t.key === estado) ? estado : "pendiente";
  const sb = await createClient();
  const isTransfers = filter === "transferencias";
  const { storeId: scopeStore } = await getStoreScope();

  const pendReq = sb.from("sales").select("*", { count: "exact", head: true }).eq("status", "completada").eq("fulfillment_status", "pendiente");
  const ctrlReq = sb.from("sales").select("*", { count: "exact", head: true }).eq("status", "completada").eq("fulfillment_status", "controlado");
  const [{ count: pend }, { count: ctrl }, { count: envs }] = await Promise.all([
    scopeStore ? pendReq.eq("store_id", scopeStore) : pendReq,
    scopeStore ? ctrlReq.eq("store_id", scopeStore) : ctrlReq,
    sb.from("stock_transfers").select("*", { count: "exact", head: true }).eq("status", "enviada"),
  ]);
  const counts: Record<string, number> = { pendiente: pend ?? 0, controlado: ctrl ?? 0, transferencias: envs ?? 0 };

  let sales: Record<string, unknown>[] = [];
  let transfers: Record<string, unknown>[] = [];
  if (isTransfers) {
    const { data } = await sb
      .from("stock_transfers")
      .select("id, status, created_at, from_warehouse:warehouses!from_warehouse_id(name), to_warehouse:warehouses!to_warehouse_id(name), stock_transfer_items(count)")
      .order("created_at", { ascending: false }).limit(100);
    transfers = data ?? [];
  } else {
    let req = sb
      .from("sales")
      .select("id, number, created_at, total, channel, fulfillment_status, stores(name), customers(name), shipping_methods(name)")
      .eq("status", "completada").order("created_at", { ascending: false }).limit(100);
    if (scopeStore) req = req.eq("store_id", scopeStore);
    if (filter !== "todos") req = req.eq("fulfillment_status", filter);
    const { data } = await req;
    sales = data ?? [];
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Logística</h1>
        <p className="text-sm text-muted">Control de picking, despacho y recepción de transferencias.</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/logistica?estado=${t.key}`}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${filter === t.key ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-canvas"}`}>
            {t.label}
            {counts[t.key] > 0 && <span className="rounded-full bg-warn-bg px-1.5 text-xs font-semibold text-warn">{counts[t.key]}</span>}
          </Link>
        ))}
      </div>

      {isTransfers ? (
        transfers.length === 0 ? (
          <Empty label="No hay transferencias." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Transferencia</th>
                  <th className="px-4 py-3 text-right font-medium">Ítems</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => {
                  const st = STATUS[t.status as string] ?? { label: t.status as string, cls: "bg-canvas text-muted" };
                  return (
                    <tr key={t.id as string} className="border-b border-line last:border-0 hover:bg-canvas">
                      <td className="px-4 py-3 text-muted">{formatDateTime(t.created_at as string)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 text-ink">
                          <span className="rounded-md bg-canvas px-1.5 py-0.5 text-xs font-medium text-muted">Transferencia</span>
                          {relName(t.from_warehouse)} <ArrowRight className="h-3.5 w-3.5 text-faint" /> {relName(t.to_warehouse)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">{(t.stock_transfer_items as { count: number }[] | null)?.[0]?.count ?? 0}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/transferencias/${t.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
                          {t.status === "enviada" ? "Recibir" : "Ver"} <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : sales.length === 0 ? (
        <Empty label="No hay pedidos en este estado." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Venta</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Local</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const st = STATUS[s.fulfillment_status as string] ?? { label: s.fulfillment_status as string, cls: "bg-canvas text-muted" };
                const actionable = s.fulfillment_status === "pendiente" || s.fulfillment_status === "controlado";
                return (
                  <tr key={s.id as string} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3 font-medium text-ink">#{s.number as number}{s.channel === "cambio" && <span className="ml-1.5 text-xs text-muted">(cambio)</span>}</td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(s.created_at as string)}</td>
                    <td className="px-4 py-3 text-muted">{relName(s.stores) ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{relName(s.customers) ?? "Consumidor final"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{formatMoney(Number(s.total))}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      {s.fulfillment_status === "despachado" && relName(s.shipping_methods) && <span className="ml-2 text-xs text-muted">{relName(s.shipping_methods)}</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {actionable && (
                        <Link href={`/logistica/${s.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
                          {s.fulfillment_status === "pendiente" ? "Controlar" : "Despachar"} <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><ScanLine className="h-3.5 w-3.5" /> Mostrador y cambios quedan entregados automáticamente. Mayoristas pasan por control y despacho; las transferencias por recepción.</p>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><Truck className="h-5 w-5" /></span>
      <p className="mt-3 font-medium text-ink">{label}</p>
    </div>
  );
}
