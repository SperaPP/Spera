import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStoreScope } from "@/lib/auth";
import { ArmadoPrint, type ArmadoSale, type ArmadoItem } from "@/components/armado-print";

function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }
const rank = (n: number | null) => (n == null ? Number.POSITIVE_INFINITY : n);

export default async function ArmadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const { data: sale } = await sb
    .from("sales")
    .select("id, number, store_id, created_at, customers(name), stores(name), organizations(name), sale_items(product_name, variant_label, quantity, product_variants(sku, loc_fila, loc_estante, loc_cubiculo))")
    .eq("id", id)
    .single();
  if (!sale) notFound();
  const { storeId: scopeStore } = await getStoreScope();
  if (scopeStore && sale.store_id !== scopeStore) notFound();

  const items: ArmadoItem[] = ((sale.sale_items ?? []) as Array<{
    product_name: string; variant_label: string | null; quantity: number; product_variants: unknown;
  }>).map((it) => {
    const variant = rel<{ sku: string | null; loc_fila: number | null; loc_estante: number | null; loc_cubiculo: number | null }>(it.product_variants);
    return {
      productName: it.product_name,
      variantLabel: it.variant_label,
      sku: variant?.sku ?? null,
      quantity: it.quantity,
      fila: variant?.loc_fila ?? null,
      estante: variant?.loc_estante ?? null,
      cubiculo: variant?.loc_cubiculo ?? null,
    };
  });

  // Recorrido de armado: fila → estante → cubículo ascendente, sin ubicar al final.
  items.sort((a, b) =>
    rank(a.fila) - rank(b.fila) || rank(a.estante) - rank(b.estante) || rank(a.cubiculo) - rank(b.cubiculo) ||
    a.productName.localeCompare(b.productName)
  );

  const shaped: ArmadoSale = {
    id: sale.id,
    number: sale.number,
    createdAt: sale.created_at,
    orgName: rel<{ name: string }>(sale.organizations)?.name ?? "Bodysculpt",
    storeName: rel<{ name: string }>(sale.stores)?.name ?? null,
    customerName: rel<{ name: string }>(sale.customers)?.name ?? null,
    items,
  };

  return <ArmadoPrint sale={shaped} />;
}
