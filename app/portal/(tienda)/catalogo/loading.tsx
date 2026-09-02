// Skeleton del catálogo: se muestra al instante en cada navegación (filtro, orden,
// página, búsqueda) mientras el servidor responde, para que la UI "reaccione" ya.
export default function LoadingCatalogo() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="h-12 w-full rounded-xl bg-line/60" />
      <div className="lg:grid lg:grid-cols-[210px_1fr] lg:gap-7">
        <div className="mb-4 hidden space-y-3 lg:block">
          {[...Array(3)].map((_, s) => (
            <div key={s} className="space-y-2">
              <div className="h-3 w-20 rounded bg-line/60" />
              {[...Array(4)].map((_, i) => <div key={i} className="h-7 w-full rounded-lg bg-line/40" />)}
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-4 w-28 rounded bg-line/60" />
            <div className="h-7 w-40 rounded-lg bg-line/40" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-line bg-card">
                <div className="aspect-square w-full bg-line/40" />
                <div className="space-y-2 p-3">
                  <div className="h-3 w-3/4 rounded bg-line/50" />
                  <div className="h-3 w-1/3 rounded bg-line/40" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
