import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
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

  const [{ data: sale }, { data: methods }, { data: isAdmin }] = await Promise.all([
    sb.from("sales")
      .select("id, number, channel, status, store_id, customer_id, total, paid_amount, fulfillment_status, created_at, tracking, dispatch_notes, dispatched_at, tn_order_number, customer_name, customer_doc, customer_phone, customer_email, customer_address, stores(name), customers(name), shipping_methods(name), sale_items(id, product_name, variant_label, quantity, product_variants(sku, barcode))")
      .eq("id", id).single(),
    sb.from("shipping_methods").select("id, name").eq("active", true).order("position"),
    sb.rpc("is_admin"),
  ]);
  if (!sale) notFound();

  const canEditPedido = isAdmin === true && sale.status === "completada"
    && sale.fulfillment_status === "pendiente" && sale.channel !== "cambio" && sale.channel !== "tiendanube";
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
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Pedido #{sale.number}
            {sale.channel === "cambio" && <span className="ml-2 text-sm font-normal text-muted">(cambio)</span>}
            {sale.channel === "tiendanube" && sale.tn_order_number ? <span className="ml-2 text-lg font-normal text-muted">(TN #{sale.tn_order_number})</span> : null}
          </h1>
          {canEditPedido && (
            <Link href={`/ventas/${sale.id}/editar`} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
              <Pencil className="h-3.5 w-3.5" /> Editar pedido
            </Link>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span>{formatDateTime(sale.created_at)}</span>
          <span>{relName(sale.stores) ?? "—"}</span>
          <span className="text-ink">{relName(sale.customers) ?? sale.customer_name ?? "Consumidor final"}</span>
        </div>
        {(sale.customer_doc || sale.customer_phone || sale.customer_email || sale.customer_address) && (
          <div className="mt-3 grid gap-1 border-t border-line pt-3 text-sm sm:grid-cols-2">
            {sale.customer_doc && <div><span className="text-muted">DNI/CUIT: </span><span className="text-ink">{sale.customer_doc}</span></div>}
            {sale.customer_phone && <div><span className="text-muted">Teléfono: </span><span className="text-ink">{sale.customer_phone}</span></div>}
            {sale.customer_email && <div><span className="text-muted">Email: </span><span className="text-ink">{sale.customer_email}</span></div>}
            {sale.customer_address && <div className="sm:col-span-2"><span className="text-muted">Dirección: </span><span className="text-ink">{sale.customer_address}</span></div>}
          </div>
        )}
      </div>

      <ControlPedido
        saleId={sale.id}
        status={sale.fulfillment_status}
        items={items}
        shippingMethods={methods ?? []}
        total={Number(sale.total)}
        paid={Number(sale.paid_amount)}
        customerId={sale.customer_id}
        dispatch={{ method: relName(sale.shipping_methods), tracking: sale.tracking, notes: sale.dispatch_notes, at: sale.dispatched_at }}
      />
    </div>
  );
}
