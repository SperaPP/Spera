"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ImageOff, X, Heart, Expand } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { CatalogItem } from "@/lib/portal-catalog";
import { PortalQuickAdd } from "@/components/portal-quick-add";
import { sizeCmp } from "@/lib/sizes";
import { colorHex, isPrint } from "@/lib/colors";

const FAV_KEY = "spera_fav";
function readFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); } catch { return new Set(); }
}
function writeFavs(s: Set<string>) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

function Swatch({ name }: { name: string }) {
  const hex = colorHex(name);
  const print = isPrint(name);
  const style = print
    ? { backgroundImage: "conic-gradient(#d9a441,#b05b3b,#6f4e37,#d9a441)" }
    : hex ? { background: hex } : undefined;
  return (
    <span
      title={name}
      className="h-4 w-4 rounded-full border border-line-strong ring-1 ring-inset ring-black/5"
      style={style}
    />
  );
}

export function PortalProductCard({ p }: { p: CatalogItem }) {
  const sizes = [...p.sizes].sort(sizeCmp);
  const href = `/portal/producto/${p.id}`;
  const [zoom, setZoom] = useState(false);
  const [fav, setFav] = useState(false);

  useEffect(() => { setFav(readFavs().has(p.id)); }, [p.id]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  function toggleFav(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const favs = readFavs();
    if (favs.has(p.id)) favs.delete(p.id); else favs.add(p.id);
    writeFavs(favs);
    setFav(favs.has(p.id));
  }

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-line bg-card transition-shadow hover:shadow-md">
      <div className="relative aspect-square w-full overflow-hidden bg-canvas">
        {/* Tocar la foto la agranda (no navega); el nombre lleva al producto. */}
        <button
          type="button"
          onClick={() => p.image && setZoom(true)}
          aria-label={p.image ? `Ampliar foto de ${p.name}` : p.name}
          className="block h-full w-full cursor-zoom-in"
        >
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt={p.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-faint"><ImageOff className="h-8 w-8" /></span>
          )}
        </button>

        {p.stock <= 5 && <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">Últimas {p.stock}</span>}

        {/* Acciones al pasar el mouse (en celular quedan siempre visibles). */}
        <div className="absolute right-2 top-2 flex flex-col gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <button
            type="button" onClick={toggleFav}
            aria-label={fav ? "Quitar de favoritos" : "Agregar a favoritos"} aria-pressed={fav}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-card/95 text-ink shadow-sm backdrop-blur-sm transition-colors hover:bg-card"
          >
            <Heart className={`h-4 w-4 ${fav ? "fill-danger text-danger" : ""}`} />
          </button>
          {p.image && (
            <button
              type="button" onClick={(e) => { e.preventDefault(); setZoom(true); }}
              aria-label={`Ampliar foto de ${p.name}`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-card/95 text-ink shadow-sm backdrop-blur-sm transition-colors hover:bg-card"
            >
              <Expand className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <Link href={href} className="line-clamp-2 text-sm font-medium text-ink transition-colors hover:text-accent">{p.name}</Link>

        {p.colors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {p.colors.slice(0, 6).map((c) => <Swatch key={c} name={c} />)}
            {p.colors.length > 6 && <span className="text-[10px] text-faint">+{p.colors.length - 6}</span>}
          </div>
        )}

        {sizes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sizes.slice(0, 7).map((s) => (
              <span key={s} className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted">{s}</span>
            ))}
            {sizes.length > 7 && <span className="px-1 py-0.5 text-[10px] text-faint">+{sizes.length - 7}</span>}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-0.5">
          <span className={`text-base font-semibold tabular-nums ${p.compareAt != null ? "text-danger" : "text-accent"}`}>{formatMoney(p.price)}</span>
          {p.compareAt != null ? (
            <>
              <span className="text-xs tabular-nums text-faint line-through">{formatMoney(p.compareAt)}</span>
              <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">Sale</span>
            </>
          ) : (
            p.publicPrice != null && p.publicPrice > p.price && (
              <span className="text-xs tabular-nums text-faint" title="Precio público de referencia">Público {formatMoney(p.publicPrice)}</span>
            )
          )}
        </div>

        <PortalQuickAdd productId={p.id} />
      </div>

      {/* Lightbox: foto grande, tocar afuera o la ✕ para cerrar */}
      {zoom && p.image && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4" onClick={() => setZoom(false)}>
          <button type="button" onClick={() => setZoom(false)} aria-label="Cerrar" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.image} alt={p.name} className="max-h-[82vh] max-w-[92vw] rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <div className="mt-4 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm font-medium text-white">{p.name}</span>
            <Link href={href} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-black hover:bg-white/90">Ver producto</Link>
          </div>
        </div>
      )}
    </div>
  );
}
