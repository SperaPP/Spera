import Link from "next/link";
import { ChevronLeft, ChevronRight, PackageOpen, SlidersHorizontal, X } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, categoriasActivas, categoriasPrincipales, temporadasActivas, portalFacets, catalog } from "@/lib/portal-catalog";
import { PortalSearch } from "@/components/portal-search";
import { PortalProductCard } from "@/components/portal-product-card";
import { PortalCatalogSidebar, catalogHref, type CatalogFilters } from "@/components/portal-catalog-sidebar";

const PAGE_SIZE = 24;

type Params = { cat?: string; main?: string; season?: string; q?: string; all?: string; page?: string; sort?: string };
const SORTS: Record<string, string> = { name: "Nombre", price_asc: "Precio ↑", price_desc: "Precio ↓" };

export default async function PortalCatalogo({ searchParams }: { searchParams: Promise<Params> }) {
  const { cat, main, season, q, all, page: pageParam, sort: sortParam } = await searchParams;
  const query = (q ?? "").trim();
  const sort = sortParam && SORTS[sortParam] ? sortParam : "name";
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { customer } = await getPortalCustomer();
  const list = customer?.priceListId ?? null;
  const org = customer?.organizationId ?? "";
  const wh = await centralWarehouseId();

  if (!list || !wh) {
    return <p className="rounded-xl border border-warn/40 bg-warn-bg/30 px-4 py-6 text-sm text-ink">No podemos mostrar el catálogo en este momento.</p>;
  }

  const [mainsAll, catsAll, seasonsAll] = await Promise.all([
    categoriasPrincipales(org),
    categoriasActivas(),
    temporadasActivas(org),
  ]);

  // Arranca en "Mujer" salvo que haya otro filtro/búsqueda o el cliente pidió ver todo.
  const mujerId = mainsAll.find((m) => m.name.toLowerCase() === "mujer")?.id ?? null;
  const noExplicit = !main && !cat && !season && !query && all !== "1";
  const effMain = main ?? (noExplicit ? mujerId : null);

  const [facets, res] = await Promise.all([
    portalFacets({ org, list, warehouse: wh, main: effMain, season: season ?? null, search: query || null }),
    catalog({ org, list, warehouse: wh, category: cat ?? null, mainCategory: effMain, season: season ?? null, search: query || null, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  // Sidebar: solo opciones con productos (más la seleccionada, para poder quitarla), con conteo.
  const mains = mainsAll.filter((m) => facets.mains.has(m.id) || m.id === effMain).map((m) => ({ ...m, count: facets.mains.get(m.id) }));
  const cats = catsAll.filter((c) => facets.cats.has(c.id) || c.id === cat).map((c) => ({ ...c, count: facets.cats.get(c.id) }));
  const seasons = seasonsAll.filter((s) => facets.seasons.has(s.id) || s.id === season).map((s) => ({ ...s, count: facets.seasons.get(s.id) }));

  const base: CatalogFilters = { main: effMain ?? undefined, cat, season, q: query || undefined, all: all === "1" };
  const pageCount = Math.max(1, Math.ceil(res.total / PAGE_SIZE));

  // Chips de filtros activos (con link para quitarlos).
  const chips: { label: string; href: string }[] = [];
  const mainName = mainsAll.find((m) => m.id === effMain)?.name;
  const catName = catsAll.find((c) => c.id === cat)?.name;
  const seasonName = seasonsAll.find((s) => s.id === season)?.name;
  if (effMain && mainName) chips.push({ label: mainName, href: catalogHref({ q: query || undefined, all: true }) });
  if (cat && catName) chips.push({ label: catName, href: catalogHref({ main: effMain ?? undefined, season, q: query || undefined }) });
  if (season && seasonName) chips.push({ label: seasonName, href: catalogHref({ main: effMain ?? undefined, cat, q: query || undefined }) });

  const params = (extra: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (effMain) sp.set("main", effMain);
    if (cat) sp.set("cat", cat);
    if (season) sp.set("season", season);
    if (query) sp.set("q", query);
    if (all === "1") sp.set("all", "1");
    if (sort !== "name") sp.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) { if (v) sp.set(k, v); else sp.delete(k); }
    return sp;
  };
  const sortHref = (s: string) => { const sp = params({ sort: s === "name" ? "" : s }); const q2 = sp.toString(); return q2 ? `/portal/catalogo?${q2}` : "/portal/catalogo"; };
  const href = (p: number) => {
    const sp = params({ page: p > 1 ? String(p) : "" });
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
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <Link key={c.label} href={c.href} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/15">
                  {c.label} <X className="h-3 w-3" />
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{res.total.toLocaleString("es-AR")} producto(s){query && <> para &quot;<span className="font-medium text-ink">{query}</span>&quot;</>}</p>
            <div className="flex items-center gap-1 rounded-lg border border-line-strong p-0.5 text-xs">
              {Object.entries(SORTS).map(([k, label]) => (
                <Link key={k} href={sortHref(k)} className={`rounded-md px-2.5 py-1 font-medium transition-colors ${sort === k ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}>{label}</Link>
              ))}
            </div>
          </div>

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
