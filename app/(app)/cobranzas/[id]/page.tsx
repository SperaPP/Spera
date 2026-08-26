import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";
import { AnularCobranzaButton } from "@/components/anular-cobranza-button";

function rel<T>(r: unknown): T | null {
  return (Array.isArray(r) ? r[0] : r) as T | null;
}

export default async function CobranzaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: receipt }, { data: isAdmin }] = await Promise.all([
    sb.from("receipts")
      .select("id, number, total, notes, status, created_at, customers(id, name), stores(name), receipt_payments(amount, payment_methods(name))")
      .eq("id", id).single(),
    sb.rpc("is_admin"),
  ]);
  if (!receipt) notFound();

  const customer = rel<{ id: string; name: string }>(receipt.customers);
  const payments = (receipt.receipt_payments ?? []) as { amount: number; payment_methods: unknown }[];
  const anulada = receipt.status === "anulada";

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cobranzas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a cobranzas
      </Link>

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Cobranza #{receipt.number}
            {anulada && <span className="ml-3 rounded-full bg-danger-bg px-2.5 py-0.5 align-middle text-xs font-medium text-danger">Anulada</span>}
          </h1>
          {isAdmin && !anulada && <AnularCobranzaButton receiptId={receipt.id} />}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span><span className="text-muted">Fecha: </span><span className="text-ink">{formatDateTime(receipt.created_at)}</span></span>
          {customer && <span><span className="text-muted">Cliente: </span><Link href={`/clientes/${customer.id}`} className="font-medium text-accent hover:underline">{customer.name}</Link></span>}
          {rel<{ name: string }>(receipt.stores)?.name && <span><span className="text-muted">Local: </span><span className="text-ink">{rel<{ name: string }>(receipt.stores)?.name}</span></span>}
          {receipt.notes && <span><span className="text-muted">Notas: </span><span className="text-ink">{receipt.notes}</span></span>}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-card p-5">
        <h2 className="mb-3 text-sm font-medium text-ink">Medios de cobro</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-muted">Sin detalle.</p>
        ) : payments.map((p, i) => (
          <div key={i} className="flex justify-between py-1 text-sm">
            <span className="text-muted">{rel<{ name: string }>(p.payment_methods)?.name ?? "—"}</span>
            <span className="tabular-nums text-ink">{formatMoney(Number(p.amount))}</span>
          </div>
        ))}
        <div className="mt-3 flex justify-between border-t border-line pt-3">
          <span className="font-medium text-ink">Total cobrado</span>
          <span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(Number(receipt.total))}</span>
        </div>
      </div>
    </div>
  );
}
