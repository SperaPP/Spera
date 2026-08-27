import Link from "next/link";
import { ChevronLeft, ChevronRight, PackageOpen, SlidersHorizontal } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, categoriasActivas, categoriasPrincipales, temporadasActivas, catalog } from "@/lib/portal-catalog";
import { PortalSearch } from "@/components/portal-search";
import { PortalProductCard } from "@/components/portal-product-card";
import { PortalCatalogSidebar, type CatalogFilters } from "@/components/portal-catalog-sidebar";

const PAGE_SIZE = 24;

type Params = { cat?: string; main?: string; season?: string; q?: string; page?: string };

export default async function PortalCatalogo({ searchParams }: { searchParams: Promise<Params> }) {
  const { cat, main, season, q, page: pageParam } = await searchParams;
  const query = (q ?? "").trim();
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { customer } = await getPortalCustomer();
  const list = customer?.priceListId ?? null;
  const org = customer?.organizationId ?? "";
  const wh = await centralWarehouseId();

  if (!list || !wh) {
    return <p className="rounded-xl border border-warn/40 bg-warn-bg/30 px-4 py-6 text-sm text-ink">No podemos mostrar el catálogo en este momento.</p>;
  }

  const [mains, cats, seasons, res] = await Promise.all([
    categoriasPrincipales(org),
    categoriasActivas(),
    temporadasActivas(org),
    catalog({ org, list, warehouse: wh, category: cat ?? null, mainCategory: main ?? null, season: season ?? null, search: query || null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  const base: CatalogFilters = { main, cat, season, q: query || undefined };
  const pageCount = Math.max(1, Math.ceil(res.total / PAGE_SIZE));

  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (main) sp.set("main", main);
    if (cat) sp.set("cat", cat);
    if (season) sp.set("season", season);
    if (query) sp.set("q", query);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/portal/catalogo?${s}` : "/portal/catalogo";
  };

  const sidebar = <PortalCatalogSidebar mains={mains} cats={cats} seasons={seasons} base={base} />;

  return (
    <div className="space-y-5">
      <PortalSearch defaultValue={query} />

      <div className="lg:grid lg:grid-cols-[210px_1fr] lg:gap-7">
        {/* Sidebar: colapsable en mobile, fijo en desktop */}
        <div className="mb-4 lg:mb-0">
          <details className="rounded-xl border border-line bg-card lg:hidden">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink">
              <SlidersHorizontal className="h-4 w-4" /> Filtrar por categoría
            </summary>
            <div className="border-t border-line px-3 pb-3 pt-2">{sidebar}</div>
          </details>
          <div className="sticky top-4 hidden lg:block">{sidebar}</div>
        </div>

        {/* Contenido */}
        <div className="space-y-4">
          <p className="text-sm text-muted">{res.total.toLocaleString("es-AR")} producto(s){query && <> para &quot;<span className="font-medium text-ink">{query}</span>&quot;</>}</p>

          {res.items.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent"><PackageOpen className="h-6 w-6" /></span>
              <p className="mt-3 font-medium text-ink">Sin productos</p>
              <p className="mt-1 text-sm text-muted">Probá con otra categoría o búsqueda.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {res.items.map((p) => <PortalProductCard key={p.id} p={p} />)}
              </div>

              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  {page > 1
                    ? <Link href={href(page - 1)} className="flex items-center gap-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas"><ChevronLeft className="h-4 w-4" /> Anterior</Link>
                    : <span className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-faint"><ChevronLeft className="h-4 w-4" /> Anterior</span>}
                  <span className="text-sm text-muted">Página {page} de {pageCount}</span>
                  {page < pageCount
                    ? <Link href={href(page + 1)} className="flex items-center gap-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas">Siguiente <ChevronRight className="h-4 w-4" /></Link>
                    : <span className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-faint">Siguiente <ChevronRight className="h-4 w-4" /></span>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
