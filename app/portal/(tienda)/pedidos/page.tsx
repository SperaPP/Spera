import Link from "next/link";
import { Receipt, ChevronRight } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, formatDateTime } from "@/lib/format";

const ESTADO: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "En preparación", cls: "bg-warn-bg text-warn" },
  controlado: { label: "Preparado", cls: "bg-accent-soft text-accent" },
  despachado: { label: "Despachado", cls: "bg-ok-bg text-ok" },
  entregado: { label: "Entregado", cls: "bg-ok-bg text-ok" },
};

export default async function PortalPedidos() {
  const { customer } = await getPortalCustomer();
  const admin = createAdminClient();
  const { data: pedidos } = await admin
    .from("sales")
    .select("id, number, created_at, total, status, fulfillment_status, sale_items(count)")
    .eq("customer_id", customer!.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = pedidos ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-ink">Mis pedidos</h1>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent"><Receipt className="h-6 w-6" /></span>
          <p className="mt-3 font-medium text-ink">Todavía no hiciste pedidos</p>
          <Link href="/portal/catalogo" className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Ver catálogo</Link>
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
          {rows.map((s) => {
            const anulada = s.status === "anulada";
            const est = ESTADO[s.fulfillment_status] ?? { label: s.fulfillment_status, cls: "bg-canvas text-muted" };
            const items = (s.sale_items as { count: number }[] | null)?.[0]?.count ?? 0;
            return (
              <Link key={s.id} href={`/portal/pedidos/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">Pedido #{s.number}</div>
                  <div className="text-xs text-muted">{formatDateTime(s.created_at)} · {items} ítem(s)</div>
                </div>
                {anulada
                  ? <span className="rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-medium text-danger">Cancelado</span>
                  : <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${est.cls}`}>{est.label}</span>}
                <span className="w-24 text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(Number(s.total))}</span>
                <ChevronRight className="h-4 w-4 text-faint" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
