import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getStoreScope } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { ControlPedido } from "@/components/control-pedido";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function ControlPedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: sale }, { data: methods }] = await Promise.all([
    sb.from("sales")
      .select("id, number, channel, status, store_id, fulfillment_status, created_at, tracking, dispatch_notes, dispatched_at, stores(name), customers(name), shipping_methods(name), sale_items(id, product_name, variant_label, quantity, product_variants(sku, barcode))")
      .eq("id", id).single(),
    sb.from("shipping_methods").select("id, name").eq("active", true).order("position"),
  ]);
  if (!sale) notFound();
  const { storeId: scopeStore } = await getStoreScope();
  if (scopeStore && sale.store_id !== scopeStore) notFound();

  const items = ((sale.sale_items ?? []) as { id: string; product_name: string; variant_label: string | null; quantity: number; product_variants: unknown }[]).map((it) => {
    const v = (Array.isArray(it.product_variants) ? it.product_variants[0] : it.product_variants) as { sku: string | null; barcode: string | null } | null;
    return { id: it.id, name: it.product_name, label: it.variant_label, qty: it.quantity, sku: v?.sku ?? null, barcode: v?.barcode ?? null };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/logistica" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a logística
      </Link>

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Pedido #{sale.number}{sale.channel === "cambio" && <span className="ml-2 text-sm font-normal text-muted">(cambio)</span>}</h1>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span>{formatDateTime(sale.created_at)}</span>
          <span>{relName(sale.stores) ?? "—"}</span>
          <span>{relName(sale.customers) ?? "Consumidor final"}</span>
        </div>
      </div>

      <ControlPedido
        saleId={sale.id}
        status={sale.fulfillment_status}
        items={items}
        shippingMethods={methods ?? []}
        dispatch={{ method: relName(sale.shipping_methods), tracking: sale.tracking, notes: sale.dispatch_notes, at: sale.dispatched_at }}
      />
    </div>
  );
}
