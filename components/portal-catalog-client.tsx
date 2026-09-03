"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PackageOpen, Search, X, Tag } from "lucide-react";
import type { CatalogFullItem } from "@/lib/portal-catalog";
import { PortalProductCard } from "@/components/portal-product-card";

type Opt = { id: string; name: string };
const STEP = 24;
// "Nuevos" = mayor a menor SKU (lo último cargado aparece primero). Es el orden por defecto.
const SORTS: Record<string, string> = { sku_desc: "Nuevos", name: "Nombre", price_asc: "Precio ↑", price_desc: "Precio ↓" };
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
  const [sort, setSort] = useState<string>("sku_desc");
  const [visible, setVisible] = useState(STEP);

  useEffect(() => { setVisible(STEP); }, [main, cat, season, q, sort, onlyOffers]);

  const qn = norm(q.trim());
  const matchesQ = useMemo(() => (p: CatalogFullItem) => !qn || norm(p.name).includes(qn), [qn]);

  const base = useMemo(() => (o: { ignoreMain?: boolean; ignoreCat?: boolean; ignoreSeason?: boolean; ignoreOffer?: boolean } = {}) =>
    products.filter((p) =>
      (o.ignoreMain || !main || p.mainCategoryId === main) &&
      (o.ignoreCat || !cat || p.categoryId === cat) &&
      (o.ignoreSeason || !season || p.seasonId === season) &&
      (o.ignoreOffer || !onlyOffers || p.compareAt != null) &&
      matchesQ(p)),
    [products, main, cat, season, onlyOffers, matchesQ]);

  const countBy = (arr: CatalogFullItem[], key: (p: CatalogFullItem) => string | null) => {
    const m = new Map<string, number>();
    for (const p of arr) { const k = key(p); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const mainsCount = useMemo(() => countBy(base({ ignoreMain: true, ignoreCat: true }), (p) => p.mainCategoryId), [base]);
  const catsCount = useMemo(() => countBy(base({ ignoreCat: true }), (p) => p.categoryId), [base]);
  const seasonsCount = useMemo(() => countBy(base({ ignoreSeason: true }), (p) => p.seasonId), [base]);
  const offersCount = useMemo(() => base({ ignoreOffer: true }).filter((p) => p.compareAt != null).length, [base]);

  const filtered = useMemo(() => {
    const list = base();
    list.sort((a, b) =>
      sort === "price_asc" ? a.price - b.price
      : sort === "price_desc" ? b.price - a.price
      : sort === "name" ? a.name.localeCompare(b.name, "es")
      : (b.sku ?? -1) - (a.sku ?? -1)); // sku_desc: más nuevo primero
    return list;
  }, [base, sort]);

  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinel.current; if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) setVisible((v) => v + STEP); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, filtered.length]);

  const chips: { label: string; clear: () => void }[] = [];
  const mainName = mains.find((m) => m.id === main)?.name;
  const catName = cats.find((c) => c.id === cat)?.name;
  const seasonName = seasons.find((s) => s.id === season)?.name;
  if (main && mainName) chips.push({ label: mainName, clear: () => { setMain(null); setCat(null); } });
  if (cat && catName) chips.push({ label: catName, clear: () => setCat(null) });
  if (season && seasonName) chips.push({ label: seasonName, clear: () => setSeason(null) });
  if (onlyOffers) chips.push({ label: "En oferta", clear: () => setOnlyOffers(false) });

  const mainPills = mains.filter((m) => (mainsCount.get(m.id) ?? 0) > 0 || m.id === main);
  const catOpts = cats.filter((c) => (catsCount.get(c.id) ?? 0) > 0 || c.id === cat);
  const seasonOpts = seasons.filter((s) => (seasonsCount.get(s.id) ?? 0) > 0 || s.id === season);
  const selectCls = "rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent";

  return (
    <div className="space-y-4">
      {/* Barra pegajosa: búsqueda + categorías + filtros, siempre accesibles */}
      <div className="sticky top-14 z-10 -mx-4 border-b border-line bg-canvas px-4 pb-3 pt-2 sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar productos…"
            className="h-11 w-full rounded-xl border border-line-strong bg-card pl-11 pr-3 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15" />
        </div>

        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button onClick={() => { setMain(null); setCat(null); setSeason(null); }}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${!main && !cat && !season ? "bg-accent text-accent-fg" : "border border-line-strong text-ink hover:bg-card"}`}>
            Todo
          </button>
          {mainPills.map((m) => (
            <button key={m.id} onClick={() => { setMain(main === m.id ? null : m.id); setCat(null); }}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${main === m.id ? "bg-accent text-accent-fg" : "border border-line-strong text-ink hover:bg-card"}`}>
              {m.name} <span className={main === m.id ? "opacity-70" : "text-faint"}>{mainsCount.get(m.id) ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button onClick={() => setOnlyOffers((v) => !v)} disabled={offersCount === 0 && !onlyOffers}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${onlyOffers ? "bg-danger text-white" : "border border-line-strong text-ink hover:bg-card"}`}>
            <Tag className="h-3.5 w-3.5" /> En oferta{offersCount > 0 && <span className={onlyOffers ? "text-white/80" : "text-faint"}>{offersCount}</span>}
          </button>

          {catOpts.length > 0 && (
            <select value={cat ?? ""} onChange={(e) => setCat(e.target.value || null)} className={selectCls}>
              <option value="">Tipo: todos</option>
              {catOpts.map((c) => <option key={c.id} value={c.id}>{c.name} ({catsCount.get(c.id) ?? 0})</option>)}
            </select>
          )}
          {seasonOpts.length > 0 && (
            <select value={season ?? ""} onChange={(e) => setSeason(e.target.value || null)} className={selectCls}>
              <option value="">Temporada: todas</option>
              {seasonOpts.map((s) => <option key={s.id} value={s.id}>{s.name} ({seasonsCount.get(s.id) ?? 0})</option>)}
            </select>
          )}

          <div className="ml-auto flex items-center gap-1 rounded-lg border border-line-strong p-0.5 text-xs">
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
              <button onClick={() => setVisible((v) => v + STEP)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-card">
                Cargar más ({(filtered.length - visible).toLocaleString("es-AR")} restantes)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
