import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Printer, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { ControlTransferencia } from "@/components/control-transferencia";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function TransferenciaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: t }, { data: isAdmin }] = await Promise.all([
    sb.from("stock_transfers")
      .select("id, status, notes, created_at, sent_at, received_at, from_warehouse:warehouses!from_warehouse_id(name), to_warehouse:warehouses!to_warehouse_id(name), stock_transfer_items(quantity, product_variants(sku, barcode, size, color, products(name)))")
      .eq("id", id)
      .single(),
    sb.rpc("is_admin"),
  ]);
  if (!t) notFound();
  const canEdit = isAdmin === true && t.status === "creada";

  const items = ((t.stock_transfer_items ?? []) as { quantity: number; product_variants: unknown }[]).map((it, i) => {
    const v = (Array.isArray(it.product_variants) ? it.product_variants[0] : it.product_variants) as { sku: string | null; barcode: string | null; size: string | null; color: string | null; products: unknown } | null;
    return {
      id: `${i}`,
      name: relName(v?.products) ?? "—",
      label: [v?.size, v?.color].filter(Boolean).join(" / ") || null,
      qty: it.quantity,
      sku: v?.sku ?? null,
      barcode: v?.barcode ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/transferencias" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a transferencias
      </Link>

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
            {relName(t.from_warehouse) ?? "—"} <ArrowRight className="h-5 w-5 text-faint" /> {relName(t.to_warehouse) ?? "—"}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {canEdit && (
              <Link href={`/transferencias/${t.id}/editar`} className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
                <Pencil className="h-4 w-4" /> Editar
              </Link>
            )}
            <Link href={`/transferencias/${t.id}/imprimir`} className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
              <Printer className="h-4 w-4" /> Imprimir pedido
            </Link>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span>Creada {formatDateTime(t.created_at)}</span>
          {t.sent_at && <span>Enviada {formatDateTime(t.sent_at)}</span>}
          {t.received_at && <span>Recibida {formatDateTime(t.received_at)}</span>}
          {t.notes && <span>{t.notes}</span>}
        </div>
      </div>

      <ControlTransferencia transferId={t.id} status={t.status} items={items} />
    </div>
  );
}
