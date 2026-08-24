import Link from "next/link";
import { ChevronLeft, ChevronRight, PackageOpen } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, categoriasActivas, catalog } from "@/lib/portal-catalog";
import { PortalSearch } from "@/components/portal-search";
import { PortalProductCard } from "@/components/portal-product-card";

const PAGE_SIZE = 24;

export default async function PortalCatalogo({ searchParams }: { searchParams: Promise<{ cat?: string; q?: string; page?: string }> }) {
  const { cat, q, page: pageParam } = await searchParams;
  const query = (q ?? "").trim();
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { customer } = await getPortalCustomer();
  const list = customer?.priceListId ?? null;
  const org = customer?.organizationId ?? "";
  const wh = await centralWarehouseId();

  if (!list || !wh) {
    return <p className="rounded-xl border border-warn/40 bg-warn-bg/30 px-4 py-6 text-sm text-ink">No podemos mostrar el catálogo en este momento.</p>;
  }

  const [cats, res] = await Promise.all([
    categoriasActivas(),
    catalog({ org, list, warehouse: wh, category: cat ?? null, search: query || null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);
  const catName = cat ? cats.find((c) => c.id === cat)?.name ?? null : null;
  const pageCount = Math.max(1, Math.ceil(res.total / PAGE_SIZE));

  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (cat) sp.set("cat", cat);
    if (query) sp.set("q", query);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/portal/catalogo?${s}` : "/portal/catalogo";
  };

  return (
    <div className="space-y-5">
      <PortalSearch defaultValue={query} />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/portal/catalogo" className={`rounded-full border px-3 py-1 font-medium transition-colors ${!cat && !query ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-canvas"}`}>Todo</Link>
        {cats.map((c) => (
          <Link key={c.id} href={`/portal/catalogo?cat=${c.id}`} className={`rounded-full border px-3 py-1 font-medium transition-colors ${cat === c.id ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-canvas"}`}>{c.name}</Link>
        ))}
      </div>

      <p className="text-sm text-muted">
        {res.total.toLocaleString("es-AR")} producto(s)
        {catName && <> en <span className="font-medium text-ink">{catName}</span></>}
        {query && <> para "<span className="font-medium text-ink">{query}</span>"</>}
      </p>

      {res.items.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent"><PackageOpen className="h-6 w-6" /></span>
          <p className="mt-3 font-medium text-ink">Sin productos</p>
          <p className="mt-1 text-sm text-muted">Probá con otra categoría o búsqueda.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
  );
}
