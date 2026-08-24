import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getStoreScope } from "@/lib/auth";
import { StockMatrix } from "@/components/stock-matrix";

export default async function StockDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: product }, { data: warehouses }] = await Promise.all([
    sb.from("products").select("id, name, product_variants(id, size, color, sku)").eq("id", id).single(),
    sb.from("warehouses").select("id, name").eq("active", true).order("name"),
  ]);
  if (!product) notFound();

  // Gestión por mostradores: mostrar sólo el depósito del local del usuario.
  const { storeId: scopeStore } = await getStoreScope();
  let whs = warehouses ?? [];
  if (scopeStore) {
    const { data: st } = await sb.from("stores").select("warehouse_id").eq("id", scopeStore).maybeSingle();
    whs = whs.filter((w) => w.id === st?.warehouse_id);
  }

  const variants = (product.product_variants ?? []) as { id: string; size: string | null; color: string | null; sku: string | null }[];
  const variantIds = variants.map((v) => v.id);

  const stockMap: Record<string, number> = {};
  const reservedMap: Record<string, number> = {};
  if (variantIds.length) {
    const { data: st } = await sb.from("stock").select("variant_id, warehouse_id, quantity, reserved").in("variant_id", variantIds);
    for (const s of st ?? []) {
      stockMap[`${s.variant_id}|${s.warehouse_id}`] = Number(s.quantity);
      reservedMap[`${s.variant_id}|${s.warehouse_id}`] = Number(s.reserved ?? 0);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/stock" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Volver a stock
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{product.name}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Editás el stock <strong>físico</strong> de cada variante por depósito (se registra como ajuste). Si hay unidades reservadas por pedidos sin despachar, se muestran debajo.</p>

      <StockMatrix
        productId={product.id}
        variants={variants.map((v) => ({ id: v.id, label: [v.size, v.color].filter(Boolean).join(" / ") || "Única", sku: v.sku }))}
        warehouses={whs}
        stockMap={stockMap}
        reservedMap={reservedMap}
      />
    </div>
  );
}
