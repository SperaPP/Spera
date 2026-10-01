import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { ProductSearch } from "@/components/product-search";

const REASON: Record<string, { label: string; cls: string }> = {
  venta: { label: "Venta", cls: "text-danger" },
  despacho: { label: "Despacho", cls: "text-danger" },
  transferencia: { label: "Transferencia (salida)", cls: "text-danger" },
  transferencia_cancel: { label: "Transferencia cancelada", cls: "text-ok" },
  ajuste: { label: "Ajuste", cls: "text-muted" },
  conteo: { label: "Control de stock", cls: "text-muted" },
  stock_inicial: { label: "Stock inicial", cls: "text-ok" },
  correccion_stock_inicial: { label: "Corrección de carga", cls: "text-muted" },
  devolucion: { label: "Devolución", cls: "text-ok" },
  anulacion: { label: "Anulación", cls: "text-ok" },
  ingreso: { label: "Ingreso", cls: "text-ok" },
};

const lbl = (s: string | null, c: string | null) => [s, c].filter(Boolean).join(" / ") || "Única";
function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }

export default async function MovimientosStockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  type Mov = { created_at: string; delta: number; reason: string; warehouse: string; producto: string; variante: string; sku: string | null; quien: string | null };
  let movs: Mov[] = [];

  if (query) {
    // Resolver variantes: por SKU/código exacto o por nombre de producto.
    const ids = new Set<string>();
    if (/^[A-Za-z0-9._-]+$/.test(query)) {
      const [{ data: bySku }, { data: byBc }] = await Promise.all([
        sb.from("product_variants").select("id").eq("sku", query).limit(50),
        sb.from("product_variants").select("id").eq("barcode", query).limit(50),
      ]);
      bySku?.forEach((v) => ids.add(v.id));
      byBc?.forEach((v) => ids.add(v.id));
    }
    const { data: prods } = await sb.from("products").select("id, product_variants(id)").ilike("name", `%${query}%`).limit(60);
    for (const p of prods ?? []) for (const v of (p.product_variants as { id: string }[] ?? [])) ids.add(v.id);

    const variantIds = [...ids].slice(0, 300);
    if (variantIds.length) {
      const [{ data: raw }, { data: whs }] = await Promise.all([
        sb.from("stock_movements")
          .select("created_at, delta, reason, warehouse_id, created_by, product_variants(sku, size, color, products(name))")
          .in("variant_id", variantIds).order("created_at", { ascending: false }).limit(300),
        sb.from("warehouses").select("id, name"),
      ]);
      const whName = new Map((whs ?? []).map((w) => [w.id, w.name]));
      const byIds = [...new Set((raw ?? []).map((m) => m.created_by).filter(Boolean))] as string[];
      const email = new Map<string, string>();
      if (byIds.length) {
        const { data: profs } = await sb.from("profiles").select("id, email").in("id", byIds);
        for (const p of profs ?? []) email.set(p.id, p.email ?? "");
      }
      movs = (raw ?? []).map((m) => {
        const v = rel<{ sku: string | null; size: string | null; color: string | null; products: unknown }>(m.product_variants);
        return {
          created_at: m.created_at as string, delta: Number(m.delta), reason: m.reason as string,
          warehouse: whName.get(m.warehouse_id as string) ?? "—",
          producto: rel<{ name: string }>(v?.products)?.name ?? "—",
          variante: lbl(v?.size ?? null, v?.color ?? null), sku: v?.sku ?? null,
          quien: m.created_by ? (email.get(m.created_by as string) ?? null) : null,
        };
      });
    }
  }

  return (
    <div>
      <Link href="/stock" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a stock
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Registro de inventario</h1>
      <p className="mt-1 mb-4 text-sm text-muted">Buscá una prenda (por nombre o SKU) y mirá todos sus movimientos de stock: ventas, despachos, transferencias, ajustes, cargas.</p>

      <div className="mb-4">
        <ProductSearch basePath="/stock/movimientos" placeholder="Buscar por nombre o SKU…" />
      </div>

      {!query ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><History className="h-5 w-5" /></span>
          <p className="mt-3 font-medium text-ink">Buscá una prenda o un SKU</p>
          <p className="mt-1 text-sm text-muted">Te muestro su historial de movimientos.</p>
        </div>
      ) : movs.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
          <p className="font-medium text-ink">Sin movimientos para &quot;{query}&quot;</p>
          <p className="mt-1 text-sm text-muted">Probá con otro nombre o SKU.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 font-medium">Variante</th>
                <th className="px-4 py-3 font-medium">Depósito</th>
                <th className="px-4 py-3 font-medium">Motivo</th>
                <th className="px-4 py-3 text-right font-medium">Cantidad</th>
                <th className="px-4 py-3 font-medium">Quién</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m, i) => {
                const r = REASON[m.reason] ?? { label: m.reason, cls: "text-muted" };
                return (
                  <tr key={i} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-2.5 text-ink">{m.producto}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-ink">{m.variante}</span>
                      {m.sku && <span className="ml-2 font-mono text-xs text-muted">{m.sku}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{m.warehouse}</td>
                    <td className={`px-4 py-2.5 font-medium ${r.cls}`}>{r.label}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${m.delta > 0 ? "text-ok" : m.delta < 0 ? "text-danger" : "text-muted"}`}>
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{m.quien ?? "—"}</td>
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
