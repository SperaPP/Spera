import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Paginación reutilizable para listados. Construye los hrefs preservando los
 * parámetros actuales (búsqueda/filtros) y setea ?page. No se muestra si hay una
 * sola página. `basePath` es la ruta del listado; `params` los query params a
 * conservar (los vacíos se ignoran).
 */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  basePath,
  params = {},
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;

  const href = (n: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (n > 1) sp.set("page", String(n));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const linkCls = "flex items-center gap-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas";
  const disabledCls = "flex cursor-not-allowed items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-faint";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        {from.toLocaleString("es-AR")}–{to.toLocaleString("es-AR")} de {total.toLocaleString("es-AR")}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkCls}><ChevronLeft className="h-4 w-4" /> Anterior</Link>
        ) : (
          <span className={disabledCls}><ChevronLeft className="h-4 w-4" /> Anterior</span>
        )}
        <span className="text-sm text-muted">Página {page} de {pageCount.toLocaleString("es-AR")}</span>
        {page < pageCount ? (
          <Link href={href(page + 1)} className={linkCls}>Siguiente <ChevronRight className="h-4 w-4" /></Link>
        ) : (
          <span className={disabledCls}>Siguiente <ChevronRight className="h-4 w-4" /></span>
        )}
      </div>
    </div>
  );
}
