"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PackageOpen, SlidersHorizontal, Search, X, Tag, ArrowUpDown } from "lucide-react";
import type { CatalogFullItem } from "@/lib/portal-catalog";
import { PortalProductCard } from "@/components/portal-product-card";

type Opt = { id: string; name: string };
const STEP = 24; // cuántos productos se suman por tanda (scroll infinito)
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
  const [onlyOffers, setOnlyOffers] = useState(false);
  const [sort, setSort] = useState<string>("name");
  const [visible, setVisible] = useState(STEP);

  // Al cambiar cualquier filtro/orden, vuelvo a la primera tanda.
  useEffect(() => { setVisible(STEP); }, [main, cat, season, q, sort, onlyOffers]);

  const qn = norm(q.trim());
  const matchesQ = useMemo(() => (p: CatalogFullItem) => !qn || norm(p.name).includes(qn), [qn]);

  const count = (arr: CatalogFullItem[], key: (p: CatalogFullItem) => string | null) => {
    const m = new Map<string, number>();
    for (const p of arr) { const k = key(p); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  // Conteos por dimensión respetando el contexto de las otras (como las facetas).
  const ctx = (p: CatalogFullItem) => matchesQ(p) && (!onlyOffers || p.compareAt != null);
  const mainsCount = useMemo(() => count(products.filter((p) => (!season || p.seasonId === season) && ctx(p)), (p) => p.mainCategoryId), [products, season, matchesQ, onlyOffers]);
  const catsCount = useMemo(() => count(products.filter((p) => (!main || p.mainCategoryId === main) && (!season || p.seasonId === season) && ctx(p)), (p) => p.categoryId), [products, main, season, matchesQ, onlyOffers]);
  const seasonsCount = useMemo(() => count(products.filter((p) => (!main || p.mainCategoryId === main) && ctx(p)), (p) => p.seasonId), [products, main, matchesQ, onlyOffers]);
  const offersCount = useMemo(() => products.filter((p) => (!main || p.mainCategoryId === main) && (!cat || p.categoryId === cat) && (!season || p.seasonId === season) && matchesQ(p) && p.compareAt != null).length, [products, main, cat, season, matchesQ]);

  const filtered = useMemo(() => {
    const list = products.filter((p) =>
      (!main || p.mainCategoryId === main) &&
      (!cat || p.categoryId === cat) &&
      (!season || p.seasonId === season) &&
      (!onlyOffers || p.compareAt != null) &&
      matchesQ(p));
    list.sort((a, b) => sort === "price_asc" ? a.price - b.price : sort === "price_desc" ? b.price - a.price : a.name.localeCompare(b.name, "es"));
    return list;
  }, [products, main, cat, season, onlyOffers, matchesQ, sort]);

  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  // Scroll infinito: cuando el "sentinel" entra en pantalla, cargo otra tanda.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisible((v) => v + STEP);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, filtered.length]);

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
  if (onlyOffers) chips.push({ label: "En oferta", clear: () => setOnlyOffers(false) });

  return (
    <div className="space-y-5">
      {/* Buscador (grande, arriba de todo) */}
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
          {/* Barra de acciones: oferta + orden + conteo */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOnlyOffers((v) => !v)}
              disabled={offersCount === 0 && !onlyOffers}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${onlyOffers ? "bg-danger text-white" : "border border-line-strong text-ink hover:bg-canvas"}`}
            >
              <Tag className="h-3.5 w-3.5" /> En oferta{offersCount > 0 && <span className={`tabular-nums ${onlyOffers ? "text-white/80" : "text-faint"}`}>{offersCount}</span>}
            </button>

            <div className="ml-auto flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-faint" />
              <div className="flex items-center gap-1 rounded-lg border border-line-strong p-0.5 text-xs">
                {Object.entries(SORTS).map(([k, label]) => (
                  <button key={k} onClick={() => setSort(k)} className={`rounded-md px-2.5 py-1 font-medium transition-colors ${sort === k ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}>{label}</button>
                ))}
              </div>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <button key={c.label} onClick={c.clear} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/15">
                  {c.label} <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          <p className="text-sm text-muted">{filtered.length.toLocaleString("es-AR")} producto(s){q.trim() && <> para &quot;<span className="font-medium text-ink">{q.trim()}</span>&quot;</>}</p>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent"><PackageOpen className="h-6 w-6" /></span>
              <p className="mt-3 font-medium text-ink">Sin productos</p>
              <p className="mt-1 text-sm text-muted">Probá con otra categoría o búsqueda.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((p) => <PortalProductCard key={p.id} p={p} />)}
              </div>

              {hasMore && (
                <div ref={sentinel} className="flex justify-center pt-4">
                  <button onClick={() => setVisible((v) => v + STEP)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
                    Cargar más ({(filtered.length - visible).toLocaleString("es-AR")} restantes)
                  </button>
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
