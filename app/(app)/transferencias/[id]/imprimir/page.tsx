import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TransferenciaPrint, type TransferItem } from "@/components/transferencia-print";

function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }
const rank = (n: number | null) => (n == null ? Number.POSITIVE_INFINITY : n);

export default async function ImprimirTransferenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const { data: t } = await sb
    .from("stock_transfers")
    .select("id, notes, created_at, from_warehouse:warehouses!from_warehouse_id(name), to_warehouse:warehouses!to_warehouse_id(name), organizations(name), stock_transfer_items(quantity, product_variants(sku, size, color, loc_fila, loc_estante, loc_cubiculo, products(name)))")
    .eq("id", id)
    .single();
  if (!t) notFound();

  const items: TransferItem[] = ((t.stock_transfer_items ?? []) as { quantity: number; product_variants: unknown }[]).map((it) => {
    const v = rel<{ sku: string | null; size: string | null; color: string | null; loc_fila: number | null; loc_estante: number | null; loc_cubiculo: number | null; products: unknown }>(it.product_variants);
    return {
      name: rel<{ name: string }>(v?.products)?.name ?? "—",
      label: [v?.size, v?.color].filter(Boolean).join(" / ") || null,
      sku: v?.sku ?? null,
      quantity: it.quantity,
      fila: v?.loc_fila ?? null,
      estante: v?.loc_estante ?? null,
      cubiculo: v?.loc_cubiculo ?? null,
    };
  });

  items.sort((a, b) =>
    rank(a.fila) - rank(b.fila) || rank(a.estante) - rank(b.estante) || rank(a.cubiculo) - rank(b.cubiculo) ||
    a.name.localeCompare(b.name)
  );

  return (
    <div className="mx-auto max-w-4xl">
      <TransferenciaPrint
        t={{
          id: t.id,
          createdAt: t.created_at,
          orgName: rel<{ name: string }>(t.organizations)?.name ?? "",
          from: rel<{ name: string }>(t.from_warehouse)?.name ?? null,
          to: rel<{ name: string }>(t.to_warehouse)?.name ?? null,
          notes: t.notes,
          items,
        }}
      />
    </div>
  );
}
