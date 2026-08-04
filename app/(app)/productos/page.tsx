import Link from "next/link";
import { Plus, Package, ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProductosFilters } from "@/components/productos-filters";

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
  searchParams: Promise<{ q?: string; cat?: string; foto?: string; estado?: string }>;
}) {
  const { q, cat, foto, estado } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  const sel = "id, name, variation_type, active, has_image, categories(name), product_variants(count)";
  type Row = { id: string; name: string; variation_type: string; active: boolean; has_image: boolean; categories: unknown; product_variants: unknown };

  // Si hay búsqueda, primero resolvemos los ids por nombre/código.
  let idList: string[] | null = null;
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
    idList = [...ids].slice(0, PAGE_SIZE);
  }

  let rows: Row[] = [];
  if (!query || (idList && idList.length)) {
    let req = sb.from("products").select(sel);
    if (idList) req = req.in("id", idList);
    if (cat) req = req.eq("category_id", cat);
    if (foto === "sin") req = req.eq("has_image", false);
    else if (foto === "con") req = req.eq("has_image", true);
    if (estado === "activo") req = req.eq("active", true);
    else if (estado === "inactivo") req = req.eq("active", false);
    const { data } = query
      ? await req.order("name").limit(PAGE_SIZE)
      : await req.order("created_at", { ascending: false }).limit(PAGE_SIZE);
    rows = (data ?? []) as Row[];
  }

  const [{ count: total }, { count: sinFoto }, { data: categories }] = await Promise.all([
    sb.from("products").select("*", { count: "exact", head: true }),
    sb.from("products").select("*", { count: "exact", head: true }).eq("has_image", false),
    sb.from("categories").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Productos</h1>
          <p className="mt-1 text-sm text-muted">
            {(total ?? 0).toLocaleString("es-AR")} productos
            {(sinFoto ?? 0) > 0 && (
              <>
                {" · "}
                <Link href="/productos?foto=sin" className="text-danger hover:underline">{(sinFoto ?? 0).toLocaleString("es-AR")} sin foto</Link>
              </>
            )}
          </p>
        </div>
        <Link href="/productos/nuevo" className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover">
          <Plus className="h-4 w-4" />
          Nuevo producto
        </Link>
      </div>

      <div className="mb-4">
        <ProductosFilters categories={categories ?? []} />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Package className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">Sin resultados</p>
          <p className="mt-1 text-sm text-muted">Probá con otros filtros o búsqueda.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 font-medium">Categoría</th>
                <th className="px-4 py-3 font-medium">Variación</th>
                <th className="px-4 py-3 text-center font-medium">Foto</th>
                <th className="px-4 py-3 text-right font-medium">Variantes</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const count = (p.product_variants as { count: number }[] | null)?.[0]?.count ?? 0;
                const c = p.categories as { name: string } | { name: string }[] | null;
                const catName = Array.isArray(c) ? c[0]?.name : c?.name;
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/productos/${p.id}`} className="text-ink transition-colors hover:text-accent">{p.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{catName ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{VARIATION_LABEL[p.variation_type] ?? p.variation_type}</td>
                    <td className="px-4 py-3 text-center">
                      {p.has_image ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-medium text-danger">
                          <ImageOff className="h-3 w-3" /> Sin foto
                        </span>
                      )}
                    </td>
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
      )}
    </div>
  );
}
