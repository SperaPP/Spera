import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EditarPedidoForm } from "@/components/editar-pedido-form";

function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }

export default async function EditarPedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: isAdmin }, { data: sale }] = await Promise.all([
    sb.rpc("is_admin"),
    sb.from("sales")
      .select("id, number, status, channel, fulfillment_status, paid_amount, price_list_id, customer_id, store_id, stores(name, warehouse_id), sale_items(variant_id, product_name, variant_label, quantity, unit_price)")
      .eq("id", id).single(),
  ]);
  if (!sale) notFound();

  const store = rel<{ name: string; warehouse_id: string | null }>(sale.stores);
  const warehouseId = store?.warehouse_id ?? null;

  const { count: allocCount } = await sb.from("receipt_allocations").select("*", { count: "exact", head: true }).eq("sale_id", id);

  const reason =
    isAdmin !== true ? "Solo un administrador puede editar pedidos."
    : sale.status !== "completada" ? "Este pedido no está activo."
    : sale.fulfillment_status !== "pendiente" ? "Solo se puede editar un pedido pendiente (todavía sin controlar)."
    : sale.channel === "cambio" || sale.channel === "tiendanube" ? "Este pedido no se puede editar (cambio o TiendaNube)."
    : Number(sale.paid_amount) !== 0 ? "El pedido ya tiene pagos cobrados; revertí la cobranza antes de editar."
    : (allocCount ?? 0) > 0 ? "El pedido ya tiene una cobranza imputada; revertila antes de editar."
    : null;

  if (reason) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link href={`/ventas/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver al pedido
        </Link>
        <div className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-ink">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <span>{reason}</span>
        </div>
      </div>
    );
  }

  // Disponible actual (físico − reservado) de los ítems del pedido. Como al guardar se
  // libera la reserva propia, el techo de cada línea = disponible + lo ya reservado acá.
  const items = (sale.sale_items ?? []) as { variant_id: string; product_name: string; variant_label: string | null; quantity: number; unit_price: number }[];
  const avail = new Map<string, number>();
  if (warehouseId && items.length) {
    const { data: st } = await sb.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", warehouseId).in("variant_id", items.map((i) => i.variant_id));
    for (const s of st ?? []) avail.set(s.variant_id, Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0)));
  }

  const initialItems = items.map((i) => ({
    variantId: i.variant_id,
    name: i.product_name,
    label: i.variant_label,
    quantity: i.quantity,
    unitPrice: Number(i.unit_price),
    ceiling: (avail.get(i.variant_id) ?? 0) + i.quantity,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/ventas/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver al pedido
      </Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-ink">Editar pedido #{sale.number}</h1>
      <p className="mb-5 text-sm text-muted">
        Cambiá cantidades o agregá/quitá productos. Al guardar se ajustan la reserva de stock y la cuenta corriente del cliente. {store?.name}
      </p>

      <EditarPedidoForm
        saleId={sale.id}
        priceListId={sale.price_list_id}
        warehouseId={warehouseId}
        initialItems={initialItems}
      />
    </div>
  );
}
