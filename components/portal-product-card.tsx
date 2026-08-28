import Link from "next/link";
import { ImageOff } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { CatalogItem } from "@/lib/portal-catalog";
import { PortalQuickAdd } from "@/components/portal-quick-add";
import { sizeCmp } from "@/lib/sizes";

export function PortalProductCard({ p }: { p: CatalogItem }) {
  const sizes = [...p.sizes].sort(sizeCmp);
  const href = `/portal/producto/${p.id}`;
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-line bg-card transition-shadow hover:shadow-md">
      <Link href={href} className="block">
        <div className="relative aspect-square w-full overflow-hidden bg-canvas">
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt={p.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-faint"><ImageOff className="h-8 w-8" /></span>
          )}
          {p.stock <= 5 && <span className="absolute left-2 top-2 rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">Últimas {p.stock}</span>}
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Link href={href} className="line-clamp-2 text-sm font-medium text-ink transition-colors hover:text-accent">{p.name}</Link>

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
              <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">Oferta</span>
            </>
          ) : (
            p.publicPrice != null && p.publicPrice > p.price && (
              <span className="text-xs tabular-nums text-faint" title="Precio público de referencia">Público {formatMoney(p.publicPrice)}</span>
            )
          )}
        </div>

        <PortalQuickAdd productId={p.id} />
      </div>
    </div>
  );
}
