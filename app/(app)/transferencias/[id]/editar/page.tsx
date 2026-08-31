import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EditarTransferenciaForm } from "@/components/editar-transferencia-form";

function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }
function relName(r: unknown): string | null { return rel<{ name: string }>(r)?.name ?? null; }

export default async function EditarTransferenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: isAdmin }, { data: t }] = await Promise.all([
    sb.rpc("is_admin"),
    sb.from("stock_transfers")
      .select("id, status, from_warehouse_id, from_warehouse:warehouses!from_warehouse_id(name), to_warehouse:warehouses!to_warehouse_id(name), stock_transfer_items(variant_id, quantity, product_variants(size, color, products(name)))")
      .eq("id", id).single(),
  ]);
  if (!t) notFound();

  const reason =
    isAdmin !== true ? "Solo un administrador puede editar transferencias."
    : t.status !== "creada" ? "Solo se puede editar una transferencia creada (todavía sin enviar). Una vez enviada, cancelala y rehacela."
    : null;

  if (reason) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link href={`/transferencias/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver a la transferencia
        </Link>
        <div className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-ink">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <span>{reason}</span>
        </div>
      </div>
    );
  }

  const rawItems = (t.stock_transfer_items ?? []) as { variant_id: string; quantity: number; product_variants: unknown }[];

  // Disponible actual (físico − reservado) en el origen. Al guardar se libera la
  // reserva propia, así que el techo de cada línea = disponible + lo ya reservado acá.
  const avail = new Map<string, number>();
  if (rawItems.length) {
    const { data: st } = await sb.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", t.from_warehouse_id).in("variant_id", rawItems.map((i) => i.variant_id));
    for (const s of st ?? []) avail.set(s.variant_id, Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0)));
  }

  const initialItems = rawItems.map((it) => {
    const v = rel<{ size: string | null; color: string | null; products: unknown }>(it.product_variants);
    return {
      variantId: it.variant_id,
      name: relName(v?.products) ?? "—",
      label: [v?.size, v?.color].filter(Boolean).join(" / ") || null,
      quantity: it.quantity,
      ceiling: (avail.get(it.variant_id) ?? 0) + it.quantity,
    };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/transferencias/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a la transferencia
      </Link>
      <h1 className="mb-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
        Editar transferencia
      </h1>
      <p className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {relName(t.from_warehouse) ?? "—"} <ArrowRight className="h-4 w-4 text-faint" /> {relName(t.to_warehouse) ?? "—"} · al guardar se ajusta la reserva de stock en el origen.
      </p>

      <EditarTransferenciaForm
        transferId={t.id}
        fromWarehouseId={t.from_warehouse_id as string}
        initialItems={initialItems}
      />
    </div>
  );
}
