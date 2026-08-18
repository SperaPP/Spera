import Link from "next/link";
import { Boxes, ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPermissions } from "@/lib/auth";
import { canView, canEdit } from "@/lib/permissions";
import { ProductSearch } from "@/components/product-search";
import { StockTable } from "@/components/stock-table";

const PAGE_SIZE = 60;

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  const { data: warehouses } = await sb.from("warehouses").select("id, name").eq("active", true).order("name");
  const whs = warehouses ?? [];
  const perms = await getPermissions();
  const canControl = canView(perms, "control_stock");
  const canEditStock = canEdit(perms, "stock");

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

  const tableRows = rows.map((p) => {
    const m = byProdWh.get(p.id);
    const perWh: Record<string, number> = {};
    let total = 0;
    for (const w of whs) { const qy = m?.get(w.id) ?? 0; perWh[w.id] = qy; total += qy; }
    return { id: p.id, name: p.name, perWh, total };
  });

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
        <StockTable rows={tableRows} warehouses={whs} canEdit={canEditStock} />
      )}
    </div>
  );
}
