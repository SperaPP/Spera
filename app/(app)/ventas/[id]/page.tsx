import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";
import { AnularVentaButton } from "@/components/anular-venta-button";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function VentaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const { data: sale } = await sb
    .from("sales")
    .select("id, number, status, created_at, subtotal, discount, total, stores(name), customers(name), price_lists(name), sale_items(product_name, variant_label, quantity, unit_price, line_total), sale_payments(amount, surcharge, payment_methods(name))")
    .eq("id", id)
    .single();

  if (!sale) notFound();

  const items = (sale.sale_items ?? []) as { product_name: string; variant_label: string | null; quantity: number; unit_price: number; line_total: number }[];
  const payments = (sale.sale_payments ?? []) as { amount: number; surcharge: number; payment_methods: unknown }[];

  const field = (label: string, value: string | null) =>
    value ? <div className="text-sm"><span className="text-muted">{label}: </span><span className="text-ink">{value}</span></div> : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/ventas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Volver a ventas
      </Link>

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Venta #{sale.number}</h1>
          {sale.status === "anulada" ? (
            <span className="rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-medium text-danger">Anulada</span>
          ) : (
            <AnularVentaButton saleId={sale.id} />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {field("Fecha", formatDateTime(sale.created_at))}
          {field("Local", relName(sale.stores))}
          {field("Cliente", relName(sale.customers))}
          {field("Lista", relName(sale.price_lists))}
        </div>
      </div>

      <div className="mb-5 overflow-hidden rounded-xl border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium text-ink">Ítems</h2></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-medium">Producto</th>
              <th className="px-5 py-2.5 text-right font-medium">Cant.</th>
              <th className="px-5 py-2.5 text-right font-medium">Precio</th>
              <th className="px-5 py-2.5 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-5 py-2.5">
                  <span className="font-medium text-ink">{it.product_name}</span>
                  {it.variant_label && <span className="ml-2 text-xs text-muted">{it.variant_label}</span>}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums text-ink">{it.quantity}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-muted">{formatMoney(Number(it.unit_price))}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-ink">{formatMoney(Number(it.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="mb-3 text-sm font-medium text-ink">Cobros</h2>
          {payments.length === 0 ? (
            <p className="text-sm text-muted">Sin cobros registrados.</p>
          ) : payments.map((p, i) => (
            <div key={i} className="flex justify-between py-1 text-sm">
              <span className="text-muted">{relName(p.payment_methods) ?? "—"}</span>
              <span className="tabular-nums text-ink">{formatMoney(Number(p.amount))}</span>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-line bg-card p-5">
          <div className="flex justify-between py-1 text-sm"><span className="text-muted">Subtotal</span><span className="tabular-nums text-ink">{formatMoney(Number(sale.subtotal))}</span></div>
          {Number(sale.discount) > 0 && <div className="flex justify-between py-1 text-sm"><span className="text-muted">Descuento</span><span className="tabular-nums text-ink">− {formatMoney(Number(sale.discount))}</span></div>}
          <div className="mt-2 flex justify-between border-t border-line pt-2"><span className="font-medium text-ink">Total</span><span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(Number(sale.total))}</span></div>
        </div>
      </div>
    </div>
  );
}
