import Link from "next/link";
import { ImageOff } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { CatalogItem } from "@/lib/portal-catalog";

export function PortalProductCard({ p }: { p: CatalogItem }) {
  return (
    <Link href={`/portal/producto/${p.id}`} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-card transition-shadow hover:shadow-md">
      <div className="relative aspect-square w-full overflow-hidden bg-canvas">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt={p.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-faint"><ImageOff className="h-8 w-8" /></span>
        )}
        {p.stock <= 5 && <span className="absolute left-2 top-2 rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">Últimas {p.stock}</span>}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="line-clamp-2 text-sm font-medium text-ink">{p.name}</div>
        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-2">
          <span className="text-base font-semibold tabular-nums text-accent">{formatMoney(p.price)}</span>
          {p.publicPrice != null && p.publicPrice > p.price && (
            <span className="text-xs tabular-nums text-faint" title="Precio público de referencia">Público {formatMoney(p.publicPrice)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
