"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PackageOpen, SlidersHorizontal, Search, X } from "lucide-react";
import type { CatalogFullItem } from "@/lib/portal-catalog";
import { PortalProductCard } from "@/components/portal-product-card";

type Opt = { id: string; name: string };
const PAGE_SIZE = 24;
const SORTS: Record<string, string> = { name: "Nombre", price_asc: "Precio ↑", price_desc: "Precio ↓" };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

export function PortalCatalogClient({
  products, mains, cats, seasons, defaultMainId, initial,
}: {
  products: CatalogFullItem[];
  mains: Opt[]; cats: Opt[]; seasons: Opt[];
  defaultMainId: string | null;
  initial: { main?: string; cat?: string; season?: string; q?: string };
}) {
  const noExplicit = !initial.main && !initial.cat && !initial.season && !initial.q;
  const [main, setMain] = useState<string | null>(initial.main ?? (noExplicit ? defaultMainId : null));
  const [cat, setCat] = useState<string | null>(initial.cat ?? null);
  const [season, setSeason] = useState<string | null>(initial.season ?? null);
  const [q, setQ] = useState(initial.q ?? "");
  const [sort, setSort] = useState<string>("name");
  const [page, setPage] = useState(1);

  // Al cambiar filtros/búsqueda/orden, vuelvo a la primera página.
  useEffect(() => { setPage(1); }, [main, cat, season, q, sort]);

  const qn = norm(q.trim());
  const matchesQ = useMemo(() => (p: CatalogFullItem) => !qn || norm(p.name).includes(qn), [qn]);

  // Conteos por dimensión (respetando el contexto de las otras, como las facetas del server).
  const count = (arr: CatalogFullItem[], key: (p: CatalogFullItem) => string | null) => {
    const m = new Map<string, number>();
    for (const p of arr) { const k = key(p); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const mainsCount = useMemo(() => count(products.filter((p) => (!season || p.seasonId === season) && matchesQ(p)), (p) => p.mainCategoryId), [products, season, matchesQ]);
  const catsCount = useMemo(() => count(products.filter((p) => (!main || p.mainCategoryId === main) && (!season || p.seasonId === season) && matchesQ(p)), (p) => p.categoryId), [products, main, season, matchesQ]);
  const seasonsCount = useMemo(() => count(products.filter((p) => (!main || p.mainCategoryId === main) && matchesQ(p)), (p) => p.seasonId), [products, main, matchesQ]);

  const filtered = useMemo(() => {
    const list = products.filter((p) =>
      (!main || p.mainCategoryId === main) &&
      (!cat || p.categoryId === cat) &&
      (!season || p.seasonId === season) &&
      matchesQ(p));
    list.sort((a, b) => sort === "price_asc" ? a.price - b.price : sort === "price_desc" ? b.price - a.price : a.name.localeCompare(b.name, "es"));
    return list;
  }, [products, main, cat, season, matchesQ, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const mainName = mains.find((m) => m.id === main)?.name;
  const catName = cats.find((c) => c.id === cat)?.name;
  const seasonName = seasons.find((s) => s.id === season)?.name;

  const sidebar = (
    <nav className="space-y-4">
      <button
        onClick={() => { setMain(null); setCat(null); setSeason(null); }}
        className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors ${!main && !cat && !season ? "bg-accent-soft text-accent" : "text-ink hover:bg-canvas"}`}
      >
        Todo el catálogo
      </button>
      <FilterSection title="Categorías" options={mains} counts={mainsCount} current={main} onPick={(id) => { setMain(main === id ? null : id); setCat(null); }} />
      <FilterSection title="Tipos" options={cats} counts={catsCount} current={cat} onPick={(id) => setCat(cat === id ? null : id)} />
      <FilterSection title="Temporadas" options={seasons} counts={seasonsCount} current={season} onPick={(id) => setSeason(season === id ? null : id)} />
    </nav>
  );

  const chips: { label: string; clear: () => void }[] = [];
  if (main && mainName) chips.push({ label: mainName, clear: () => { setMain(null); setCat(null); } });
  if (cat && catName) chips.push({ label: catName, clear: () => setCat(null) });
  if (season && seasonName) chips.push({ label: seasonName, clear: () => setSeason(null) });

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar productos…"
          className="h-12 w-full rounded-xl border border-line-strong bg-card pl-11 pr-3 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
      </div>

      <div className="lg:grid lg:grid-cols-[210px_1fr] lg:gap-7">
        <div className="mb-4 lg:mb-0">
          <details className="rounded-xl border border-line bg-card lg:hidden">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink">
              <SlidersHorizontal className="h-4 w-4" /> Filtrar por categoría
            </summary>
            <div className="border-t border-line px-3 pb-3 pt-2">{sidebar}</div>
          </details>
          <div className="sticky top-4 hidden lg:block">{sidebar}</div>
        </div>

        <div className="space-y-4">
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <button key={c.label} onClick={c.clear} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/15">
                  {c.label} <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{filtered.length.toLocaleString("es-AR")} producto(s){q.trim() && <> para &quot;<span className="font-medium text-ink">{q.trim()}</span>&quot;</>}</p>
            <div className="flex items-center gap-1 rounded-lg border border-line-strong p-0.5 text-xs">
              {Object.entries(SORTS).map(([k, label]) => (
                <button key={k} onClick={() => setSort(k)} className={`rounded-md px-2.5 py-1 font-medium transition-colors ${sort === k ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}>{label}</button>
              ))}
            </div>
          </div>

          {pageItems.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent"><PackageOpen className="h-6 w-6" /></span>
              <p className="mt-3 font-medium text-ink">Sin productos</p>
              <p className="mt-1 text-sm text-muted">Probá con otra categoría o búsqueda.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {pageItems.map((p) => <PortalProductCard key={p.id} p={p} />)}
              </div>

              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1} className="flex items-center gap-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Anterior</button>
                  <span className="text-sm text-muted">Página {page} de {pageCount}</span>
                  <button onClick={() => setPage((n) => Math.min(pageCount, n + 1))} disabled={page >= pageCount} className="flex items-center gap-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-40">Siguiente <ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSection({ title, options, counts, current, onPick }: {
  title: string; options: Opt[]; counts: Map<string, number>; current: string | null; onPick: (id: string) => void;
}) {
  const visible = options.filter((o) => (counts.get(o.id) ?? 0) > 0 || o.id === current);
  if (!visible.length) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <ul className="space-y-0.5">
        {visible.map((o) => {
          const active = current === o.id;
          return (
            <li key={o.id}>
              <button
                onClick={() => onPick(o.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${active ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-canvas"}`}
              >
                <span className="truncate">{o.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-faint">{counts.get(o.id) ?? 0}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
