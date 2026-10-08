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

// Encabezado de sección editorial: guiones + título en mayúscula + subtítulo en itálica.
function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <div className="flex items-center gap-3">
        <span className="h-px w-8 bg-ink/25" />
        <h2 className="text-lg font-bold uppercase tracking-[0.14em] text-ink sm:text-2xl">{title}</h2>
        <span className="h-px w-8 bg-ink/25" />
      </div>
      {subtitle && <p className="mt-1.5 font-serif text-sm italic text-muted">{subtitle}</p>}
    </div>
  );
}

// Tile de categoría con foto, degradé y etiqueta tipo pill.
function CategoryTile({ id, name, image, index, big = false }: { id: string; name: string; image: string | null; index: number; big?: boolean }) {
  return (
    <Link
      href={`/portal/catalogo?main=${id}`}
      className={`group relative overflow-hidden rounded-2xl ${big ? "col-span-2 aspect-[16/11] sm:row-span-2 sm:aspect-auto" : "aspect-square"}`}
      style={image ? undefined : { background: GRADS[index % GRADS.length] }}
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      )}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 flex justify-center p-3 sm:p-4">
        <span className={`rounded-full bg-card/95 font-semibold text-ink shadow-sm backdrop-blur-sm transition-colors group-hover:bg-card ${big ? "px-5 py-2 text-base" : "px-4 py-1.5 text-sm"}`}>
          {name}
        </span>
      </span>
    </Link>
  );
}

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

  // Mujer va de tile grande (es el rubro principal); el resto, chicos.
  const big = tiles.find((t) => /mujer/i.test(t.name)) ?? tiles[0];
  const rest = tiles.filter((t) => t.id !== big?.id);

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className="relative aspect-[16/9] w-full bg-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/portal/banner.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
          <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/55 to-transparent p-5 sm:p-7">
            <Link href="/portal/catalogo?all=1" className="inline-flex items-center gap-2 rounded-full bg-card px-6 py-3 text-sm font-semibold text-ink shadow-lg transition-transform hover:scale-[1.03]">
              Ver todo el catálogo <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Saludo + buscador */}
      <section className="flex flex-col items-center gap-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Hola, {customer!.name}</p>
        <h1 className="font-serif text-2xl italic text-ink sm:text-3xl">¿Qué estás buscando hoy?</h1>
        <div className="mt-1 w-full max-w-xl"><PortalSearch /></div>
      </section>

      {/* Categorías (mosaico) */}
      {tiles.length > 0 && big && (
        <section>
          <SectionHeading title="Categorías" subtitle="Comprá por rubro" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:grid-rows-2">
            <CategoryTile id={big.id} name={big.name} image={big.image} index={0} big />
            {rest.map((t, i) => (
              <CategoryTile key={t.id} id={t.id} name={t.name} image={t.image} index={i + 1} />
            ))}
          </div>
        </section>
      )}

      {/* Novedades */}
      {destacados.items.length > 0 && (
        <section>
          <SectionHeading title="Novedades" subtitle="Lo nuevo de la semana" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {destacados.items.map((p) => <PortalProductCard key={p.id} p={p} />)}
          </div>
          <div className="mt-8 flex justify-center">
            <Link href="/portal/catalogo?all=1" className="inline-flex items-center gap-2 rounded-full border border-ink px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-canvas">
              Ver todo el catálogo <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
