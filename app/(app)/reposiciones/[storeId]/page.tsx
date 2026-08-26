import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getStoreScope } from "@/lib/auth";
import { ReposicionForm, type RepoItem } from "@/components/reposicion-form";

function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }

export default async function ReposicionDetallePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const sb = await createClient();

  const { data: store } = await sb.from("stores").select("id, name, is_wholesale").eq("id", storeId).single();
  if (!store || store.is_wholesale) notFound();
  const { storeId: scopeStore } = await getStoreScope();
  if (scopeStore && storeId !== scopeStore) notFound();

  const { data: pend } = await sb.from("replenishment_pending").select("variant_id, qty").eq("store_id", storeId).gt("qty", 0);
  const pendMap = new Map((pend ?? []).map((p) => [p.variant_id, Number(p.qty)]));
  const variantIds = [...pendMap.keys()];

  let items: RepoItem[] = [];
  if (variantIds.length) {
    const [{ data: variants }, { data: central }] = await Promise.all([
      sb.from("product_variants").select("id, size, color, sku, products(name)").in("id", variantIds),
      sb.from("warehouses").select("id").eq("name", "Mayorista - Central").maybeSingle(),
    ]);
    const availMap = new Map<string, number>();
    if (central?.id) {
      const { data: st } = await sb.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", central.id).in("variant_id", variantIds);
      for (const s of st ?? []) availMap.set(s.variant_id, Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0)));
    }
    items = (variants ?? []).map((v) => {
      const pending = pendMap.get(v.id) ?? 0;
      const avail = availMap.get(v.id) ?? 0;
      return {
        variantId: v.id,
        name: rel<{ name: string }>(v.products)?.name ?? "—",
        label: [v.size, v.color].filter(Boolean).join(" / ") || null,
        sku: v.sku,
        pending,
        avail,
        max: Math.min(pending, avail),
      };
    }).sort((a, b) => a.name.localeCompare(b.name) || (a.label ?? "").localeCompare(b.label ?? ""));
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/reposiciones" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a reposiciones
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Reposición · {store.name}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Elegí cuánto reponer de cada prenda (tope: disponible en Mayorista-Central). Al aceptar se crea la transferencia y <strong>se descarta el resto</strong>.</p>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-card py-14 text-center text-sm text-muted">Este mostrador no tiene prendas pendientes de reposición.</div>
      ) : (
        <ReposicionForm storeId={storeId} items={items} />
      )}
    </div>
  );
}
