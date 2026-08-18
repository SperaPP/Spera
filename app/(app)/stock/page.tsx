import Link from "next/link";
import { Boxes, ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPermissions } from "@/lib/auth";
import { canView } from "@/lib/permissions";
import { ProductSearch } from "@/components/product-search";

const PAGE_SIZE = 60;

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  const { data: warehouses } = await sb.from("warehouses").select("id, name").eq("active", true).order("name");
  const whs = warehouses ?? [];
  const canControl = canView(await getPermissions(), "control_stock");

  type Row = { id: string; name: string };
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
      const { data } = await sb.from("products").select("id, name").in("id", idList).order("name");
      rows = (data ?? []) as Row[];
    }
  } else {
    const { data } = await sb.from("products").select("id, name").order("created_at", { ascending: false }).limit(PAGE_SIZE);
    rows = (data ?? []) as Row[];
  }

  // Stock por (producto, depósito).
  const byProdWh = new Map<string, Map<string, number>>();
  if (rows.length) {
    const { data: st } = await sb
      .from("stock")
      .select("quantity, warehouse_id, product_variants!inner(product_id)")
      .in("product_variants.product_id", rows.map((r) => r.id));
    for (const s of st ?? []) {
      const pv = s.product_variants as unknown;
      const pid = (Array.isArray(pv) ? pv[0]?.product_id : (pv as { product_id: string } | null)?.product_id) as string | undefined;
      if (!pid) continue;
      if (!byProdWh.has(pid)) byProdWh.set(pid, new Map());
      const m = byProdWh.get(pid)!;
      m.set(s.warehouse_id, (m.get(s.warehouse_id) ?? 0) + Number(s.quantity));
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Stock</h1>
          <p className="mt-1 text-sm text-muted">Existencias por depósito. Clic en un producto para ajustar.</p>
        </div>
        {canControl && (
          <Link href="/stock/control" className="flex shrink-0 items-center gap-2 rounded-lg border border-line-strong px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
            <ClipboardCheck className="h-4 w-4" /> Control de stock
          </Link>
        )}
      </div>

      <div className="mb-4">
        <ProductSearch basePath="/stock" placeholder="Buscar por nombre o código…" />
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
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Producto</th>
                {whs.map((w) => <th key={w.id} className="px-3 py-3 text-right font-medium">{w.name}</th>)}
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const m = byProdWh.get(p.id);
                const total = whs.reduce((a, w) => a + (m?.get(w.id) ?? 0), 0);
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/stock/${p.id}`} className="text-ink transition-colors hover:text-accent">{p.name}</Link>
                    </td>
                    {whs.map((w) => {
                      const qty = m?.get(w.id) ?? 0;
                      return (
                        <td key={w.id} className="px-3 py-3 text-right tabular-nums">
                          <span className={qty > 0 ? "text-ink" : qty < 0 ? "text-danger" : "text-faint"}>{qty}</span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      <span className={total > 0 ? "text-ink" : total < 0 ? "text-danger" : "text-faint"}>{total}</span>
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
