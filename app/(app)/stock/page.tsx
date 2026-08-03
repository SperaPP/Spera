import Link from "next/link";
import { Boxes } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProductSearch } from "@/components/product-search";

const PAGE_SIZE = 60;

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  type Row = { id: string; name: string; product_variants: unknown };
  let rows: Row[] = [];

  if (query) {
    const ids = new Set<string>();
    const { data: nameHits } = await sb.from("products").select("id").ilike("name", `%${query}%`).limit(PAGE_SIZE);
    nameHits?.forEach((p) => ids.add(p.id));
    if (/^[A-Za-z0-9._-]+$/.test(query)) {
      const [{ data: bc }, { data: sk }] = await Promise.all([
        sb.from("product_variants").select("product_id").eq("barcode", query).limit(20),
        sb.from("product_variants").select("product_id").eq("sku", query).limit(20),
      ]);
      bc?.forEach((v) => ids.add(v.product_id));
      sk?.forEach((v) => ids.add(v.product_id));
    }
    const idList = [...ids].slice(0, PAGE_SIZE);
    if (idList.length) {
      const { data } = await sb.from("products").select("id, name, product_variants(count)").in("id", idList).order("name");
      rows = (data ?? []) as Row[];
    }
  } else {
    const { data } = await sb.from("products").select("id, name, product_variants(count)").order("created_at", { ascending: false }).limit(PAGE_SIZE);
    rows = (data ?? []) as Row[];
  }

  // Total de stock por producto (para los mostrados).
  const totals = new Map<string, number>();
  if (rows.length) {
    const { data: st } = await sb
      .from("stock")
      .select("quantity, product_variants!inner(product_id)")
      .in("product_variants.product_id", rows.map((r) => r.id));
    for (const s of st ?? []) {
      const pv = s.product_variants as unknown;
      const pid = (Array.isArray(pv) ? pv[0]?.product_id : (pv as { product_id: string } | null)?.product_id) as string | undefined;
      if (pid) totals.set(pid, (totals.get(pid) ?? 0) + Number(s.quantity));
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Stock</h1>
      <p className="mt-1 mb-4 text-sm text-muted">Buscá un producto para ver y ajustar sus existencias por depósito.</p>

      <div className="mb-4">
        <ProductSearch basePath="/stock" />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Boxes className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">{query ? `Sin resultados para "${query}"` : "Buscá un producto"}</p>
          <p className="mt-1 text-sm text-muted">Por nombre o código de barras.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 text-right font-medium">Variantes</th>
                <th className="px-4 py-3 text-right font-medium">Stock total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const count = (p.product_variants as { count: number }[] | null)?.[0]?.count ?? 0;
                const tot = totals.get(p.id) ?? 0;
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/stock/${p.id}`} className="text-ink transition-colors hover:text-accent">{p.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={tot > 0 ? "text-ink" : tot < 0 ? "text-danger" : "text-muted"}>{tot}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
