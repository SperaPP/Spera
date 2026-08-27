import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, mainCategoryTiles, catalog } from "@/lib/portal-catalog";
import { PortalSearch } from "@/components/portal-search";
import { PortalProductCard } from "@/components/portal-product-card";

// Degradés de respaldo cuando una categoría no tiene foto.
const GRADS = [
  "linear-gradient(135deg,#e0cdd3,#c7a3b0)",
  "linear-gradient(135deg,#c3c7d0,#9da3b0)",
  "linear-gradient(135deg,#c9d2cb,#a9b7ac)",
  "linear-gradient(135deg,#d9cfc4,#beb0a2)",
  "linear-gradient(135deg,#d8c3be,#be9b93)",
];

export default async function PortalHome() {
  const { customer } = await getPortalCustomer();
  const list = customer?.priceListId ?? null;
  const org = customer?.organizationId ?? "";
  const wh = await centralWarehouseId();

  if (!list) {
    return <p className="rounded-xl border border-warn/40 bg-warn-bg/30 px-4 py-6 text-sm text-ink">Tu cuenta todavía no tiene una lista de precios asignada. Escribinos para habilitarte.</p>;
  }

  const [tiles, destacados] = await Promise.all([
    mainCategoryTiles(org),
    wh ? catalog({ org, list, warehouse: wh, featured: true, limit: 8, offset: 0 }) : Promise.resolve({ items: [], total: 0 }),
  ]);
  const heroImg = tiles.find((t) => t.image)?.image ?? destacados.items.find((i) => i.image)?.image ?? null;

  return (
    <div className="space-y-10">
      {/* Portada */}
      <section className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className="grid sm:grid-cols-2">
          <div className="flex flex-col justify-center gap-4 p-7 sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Hola, {customer!.name}</p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-[2.4rem]">Reponé lo que más rota.</h1>
            <div className="max-w-md"><PortalSearch /></div>
            <Link href="/portal/catalogo?all=1" className="inline-flex w-fit items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90">
              Ver todo el catálogo <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="relative hidden min-h-[240px] bg-canvas sm:block" style={heroImg ? undefined : { background: GRADS[0] }}>
            {heroImg && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroImg} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
          </div>
        </div>
      </section>

      {/* Categorías madre */}
      {tiles.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-faint">Comprá por categoría</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {tiles.map((t, i) => (
              <Link key={t.id} href={`/portal/catalogo?main=${t.id}`} className="group relative flex aspect-[3/4] items-end overflow-hidden rounded-xl p-4" style={t.image ? undefined : { background: GRADS[i % GRADS.length] }}>
                {t.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                )}
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
                <span className="relative text-lg font-semibold text-white drop-shadow-sm">{t.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Novedades */}
      {destacados.items.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-faint">Novedades</h2>
            <Link href="/portal/catalogo?all=1" className="flex items-center gap-1 text-sm font-medium text-accent hover:underline">Ver más <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {destacados.items.map((p) => <PortalProductCard key={p.id} p={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}
