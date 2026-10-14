import Link from "next/link";
import { ArrowLeft, Clock, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPermissions } from "@/lib/auth";
import { canView } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";

const CHANNEL: Record<string, string> = { pos: "Mostrador", portal: "Portal mayorista", tiendanube: "Tiendanube", cambio: "Cambio" };
const FILTERS = [{ d: 0, label: "Todas" }, { d: 7, label: "+7 días" }, { d: 15, label: "+15 días" }, { d: 30, label: "+30 días" }, { d: 60, label: "+60 días" }];

export default async function ReservasPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const { dias } = await searchParams;
  const minDias = Math.max(0, parseInt(dias ?? "0", 10) || 0);
  const sb = await createClient();
  const perms = await getPermissions();
  if (!(canView(perms, "logistica") || canView(perms, "ventas"))) {
    return <p className="rounded-xl border border-warn/40 bg-warn-bg/30 px-4 py-6 text-sm text-ink">No tenés permiso para ver las reservas.</p>;
  }

  // Pedidos que retienen stock: completados y sin despachar (pendiente o controlado).
  const { data: sales } = await sb.from("sales")
    .select("id, number, channel, customer_id, customer_name, fulfillment_status, created_at, store_id")
    .eq("status", "completada").in("fulfillment_status", ["pendiente", "controlado"])
    .order("created_at", { ascending: true }).limit(1000);
  const list = sales ?? [];

  // Unidades reservadas por pedido (ítems con variante, sin lo ya devuelto).
  const unidadesBySale = new Map<string, number>();
  if (list.length) {
    const { data: items } = await sb.from("sale_items").select("sale_id, quantity, returned_qty")
      .in("sale_id", list.map((s) => s.id)).not("variant_id", "is", null);
    for (const it of items ?? []) {
      const u = Number(it.quantity) - Number(it.returned_qty ?? 0);
      if (u > 0) unidadesBySale.set(it.sale_id as string, (unidadesBySale.get(it.sale_id as string) ?? 0) + u);
    }
  }
  // Nombres de cliente y depósitos.
  const custIds = [...new Set(list.map((s) => s.customer_id).filter(Boolean))] as string[];
  const custName = new Map<string, string>();
  if (custIds.length) {
    const { data: cs } = await sb.from("customers").select("id, name").in("id", custIds);
    for (const c of cs ?? []) custName.set(c.id, c.name);
  }
  const { data: stores } = await sb.from("stores").select("id, name");
  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));

  const now = Date.now();
  const rows = list.map((s) => {
    const dias = Math.floor((now - new Date(s.created_at as string).getTime()) / 86400000);
    return {
      id: s.id as string, number: s.number as number, channel: s.channel as string,
      cliente: (s.customer_id ? custName.get(s.customer_id as string) : null) ?? (s.customer_name as string | null) ?? "—",
      deposito: storeName.get(s.store_id as string) ?? "—",
      estado: s.fulfillment_status as string, fecha: s.created_at as string, dias,
      unidades: unidadesBySale.get(s.id as string) ?? 0,
    };
  }).filter((r) => r.dias >= minDias && r.unidades > 0);

  const totalUnidades = rows.reduce((a, r) => a + r.unidades, 0);

  return (
    <div>
      <Link href="/stock" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a stock
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Reservas sin despachar</h1>
      <p className="mt-1 mb-4 text-sm text-muted">
        Pedidos completados que <strong>todavía no se despacharon</strong> y retienen stock (bajan el disponible). Despachalos o anulalos para liberar el stock.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.d} href={`/stock/reservas${f.d ? `?dias=${f.d}` : ""}`}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${minDias === f.d ? "bg-accent text-accent-fg" : "border border-line-strong text-ink hover:bg-card"}`}>
            {f.label}
          </Link>
        ))}
        <span className="ml-auto text-sm text-muted">{rows.length} pedido(s) · <strong className="text-ink">{totalUnidades}</strong> unidad(es) reservada(s)</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ok-bg text-ok"><Clock className="h-5 w-5" /></span>
          <p className="mt-3 font-medium text-ink">No hay reservas {minDias ? `de más de ${minDias} días` : "pendientes"}</p>
          <p className="mt-1 text-sm text-muted">Todo lo reservado está al día.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Pedido</th>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Depósito</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Antigüedad</th>
                <th className="px-4 py-3 text-right font-medium">Unid. reservadas</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-medium text-ink">#{r.number}</td>
                  <td className="px-4 py-2.5 text-muted">{CHANNEL[r.channel] ?? r.channel}</td>
                  <td className="px-4 py-2.5 text-ink">{r.cliente}</td>
                  <td className="px-4 py-2.5 text-muted">{r.deposito}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.estado === "controlado" ? "bg-accent-soft text-accent" : "bg-warn-bg text-warn"}`}>
                      {r.estado === "controlado" ? "Controlado" : "Pendiente"}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${r.dias >= 30 ? "font-semibold text-danger" : r.dias >= 15 ? "text-warn" : "text-muted"}`}>
                    {r.dias >= 30 && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}{r.dias} día{r.dias === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{r.unidades}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Link href={`/ventas/${r.id}`} className="text-sm font-medium text-accent hover:underline">Ver</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted">Tip: filtrá por +30 días para encontrar las reservas más viejas (marcadas en rojo) y liberá ese stock despachando o anulando el pedido.</p>
    </div>
  );
}
