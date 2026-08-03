import Link from "next/link";
import { Plus, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProductSearch } from "@/components/product-search";

const VARIATION_LABEL: Record<string, string> = {
  none: "Sin variantes",
  size: "Talle",
  color: "Color",
  size_color: "Talle y color",
};

const PAGE_SIZE = 100;

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  const sel = "id, name, variation_type, active, categories(name), product_variants(count)";
  type Row = { id: string; name: string; variation_type: string; active: boolean; categories: unknown; product_variants: unknown };
  let rows: Row[] = [];

  if (!query) {
    const { data } = await sb.from("products").select(sel).order("created_at", { ascending: false }).limit(PAGE_SIZE);
    rows = (data ?? []) as Row[];
  } else {
    // Por nombre (parcial) + por código de barras / SKU (exacto).
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
      const { data } = await sb.from("products").select(sel).in("id", idList).order("name");
      rows = (data ?? []) as Row[];
    }
  }

  const { count: total } = await sb.from("products").select("*", { count: "exact", head: true });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Productos</h1>
          <p className="mt-1 text-sm text-muted">{(total ?? 0).toLocaleString("es-AR")} productos en el catálogo.</p>
        </div>
        <Link
          href="/productos/nuevo"
          className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          Nuevo producto
        </Link>
      </div>

      <div className="mb-4">
        <ProductSearch />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Package className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">
            {query ? `Sin resultados para "${query}"` : "Todavía no hay productos"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {query ? "Probá con otro nombre." : "Creá el primero para empezar."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-4 py-3 font-medium">Producto</th>
                  <th className="px-4 py-3 font-medium">Categoría</th>
                  <th className="px-4 py-3 font-medium">Variación</th>
                  <th className="px-4 py-3 text-right font-medium">Variantes</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const count = (p.product_variants as { count: number }[] | null)?.[0]?.count ?? 0;
                  const cat = p.categories as { name: string } | { name: string }[] | null;
                  const catName = Array.isArray(cat) ? cat[0]?.name : cat?.name;
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas">
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/productos/${p.id}`} className="text-ink transition-colors hover:text-accent">
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted">{catName ?? "—"}</td>
                      <td className="px-4 py-3 text-muted">{VARIATION_LABEL[p.variation_type] ?? p.variation_type}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">{count}</td>
                      <td className="px-4 py-3">
                        {p.active ? (
                          <span className="rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-medium text-ok">Activo</span>
                        ) : (
                          <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium text-muted">Inactivo</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            {query
              ? `Mostrando ${rows.length}${rows.length === PAGE_SIZE ? "+" : ""} resultado(s) para "${query}".`
              : `Mostrando los ${rows.length} más recientes. Usá el buscador para encontrar cualquiera de los ${(total ?? 0).toLocaleString("es-AR")}.`}
          </p>
        </>
      )}
    </div>
  );
}
