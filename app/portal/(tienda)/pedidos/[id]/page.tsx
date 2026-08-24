import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, formatDateTime } from "@/lib/format";

const ESTADO: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "En preparación", cls: "bg-warn-bg text-warn" },
  controlado: { label: "Preparado", cls: "bg-accent-soft text-accent" },
  despachado: { label: "Despachado", cls: "bg-ok-bg text-ok" },
  entregado: { label: "Entregado", cls: "bg-ok-bg text-ok" },
};

export default async function PortalPedidoDetalle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { customer } = await getPortalCustomer();
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("sales")
    .select("id, number, created_at, total, status, fulfillment_status, customer_id, sale_items(product_name, variant_label, quantity, unit_price, line_total)")
    .eq("id", id)
    .maybeSingle();
  // Solo el dueño del pedido puede verlo.
  if (!s || s.customer_id !== customer!.id) notFound();

  const items = (s.sale_items ?? []) as { product_name: string; variant_label: string | null; quantity: number; unit_price: number; line_total: number }[];
  const anulada = s.status === "anulada";
  const est = ESTADO[s.fulfillment_status] ?? { label: s.fulfillment_status, cls: "bg-canvas text-muted" };

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/portal/pedidos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a mis pedidos
      </Link>

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Pedido #{s.number}</h1>
            <p className="mt-1 text-sm text-muted">{formatDateTime(s.created_at)}</p>
          </div>
          {anulada
            ? <span className="rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-medium text-danger">Cancelado</span>
            : <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${est.cls}`}>{est.label}</span>}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <div className="divide-y divide-line">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{it.product_name}</div>
                <div className="text-xs text-muted">{it.variant_label ?? "Único"} · {it.quantity} × {formatMoney(Number(it.unit_price))}</div>
              </div>
              <div className="text-sm font-semibold tabular-nums text-ink">{formatMoney(Number(it.line_total))}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <span className="text-sm font-medium text-muted">Total</span>
          <span className="text-lg font-bold tabular-nums text-ink">{formatMoney(Number(s.total))}</span>
        </div>
      </div>

      {!anulada && <p className="mt-4 text-center text-xs text-muted">El total de este pedido está cargado en tu cuenta corriente.</p>}
    </div>
  );
}
