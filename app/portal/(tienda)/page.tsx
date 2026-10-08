import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, mainCategoryTiles, catalogAll, categoriasActivas } from "@/lib/portal-catalog";
import { PortalSearch } from "@/components/portal-search";
import { PortalProductCard } from "@/components/portal-product-card";

// Configuración del hero (editable). `aspectClass` controla el alto; el texto
// editorial es opcional: si el banner ya trae texto quemado, dejá los campos vacíos.
const HERO = {
  image: "/portal/banner.jpg",
  aspectClass: "aspect-[16/9]", // más alto: "aspect-[2/1]" o "aspect-[21/9]"
  eyebrow: "",   // ej. "Primavera-Verano"
  title: "",     // ej. "Vestite diferente"
  subtitle: "",  // ej. "Destacá siempre"
  cta: { label: "Ver todo el catálogo", href: "/portal/catalogo?all=1" },
};

// Override por categoría madre: foto fija, etiqueta y/o link. La clave es el nombre
// exacto de la categoría. Si no está acá: foto del primer producto, el nombre y link a esa madre.
const TILE_CFG: Record<string, { image?: string; label?: string; href?: string }> = {
  Mujer: { image: "/portal/cat-mujer.jpg" },
  Home: { image: "/portal/cat-home.webp" },
  // La tile de Outlet pasa a ser "Sale" y lleva a las ofertas.
  Outlet: { image: "/portal/cat-sale.png", label: "Sale", href: "/portal/catalogo?sale=1" },
};

function resolveTile(t: { id: string; name: string; image: string | null }) {
  const cfg = TILE_CFG[t.name] ?? {};
  return {
    href: cfg.href ?? `/portal/catalogo?main=${t.id}`,
    label: cfg.label ?? t.name,
    image: cfg.image ?? t.image,
  };
}

// Subcategorías de accesorios/bolsos/calzado que NO son ropa (se excluyen de Novedades).
const normName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
const ACCESSORY_SUBCATS = new Set([
  "accesorios", "anillo", "bag", "bandana", "bandolera", "boina", "bolso", "bolsos", "broche",
  "bufanda", "bufandon", "cadena", "cartera", "carteras", "correa", "cuello", "dije", "gorra", "gorras",
  "gorro", "gorros", "guantes", "llavero", "mochila", "mochilas", "morral", "neceser", "piluso",
  "portacelular", "rinonera", "tapaboca", "vincha", "medias", "sandalias", "zapatilla", "zapatillas",
  "calzados", "calzado", "bijou", "billetera", "monedero", "pulsera", "aros", "collar", "cinto",
  "cinturon", "panuelo", "visera", "pashmina",
]);

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
function CategoryTile({ href, label, image, index, big = false }: { href: string; label: string; image: string | null; index: number; big?: boolean }) {
  return (
    <Link
      href={href}
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
          {label}
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

  const tiles = await mainCategoryTiles(org);

  // Mujer va de tile grande (es el rubro principal); el resto, chicos.
  const big = tiles.find((t) => /mujer/i.test(t.name)) ?? tiles[0];
  const rest = tiles.filter((t) => t.id !== big?.id);

  // Novedades: la ropa más nueva. Excluye la categoría madre Home/Accesorios Y las
  // subcategorías de accesorios/bolsos/calzado. Ordena por SKU desc (lo último cargado
  // primero) y toma 8. "featured" no sirve acá: casi todo lo destacado son cuadros (Home).
  const excludeMains = new Set(tiles.filter((t) => /^(home|accesorios)$/i.test(t.name)).map((t) => t.id));
  const [allItems, cats] = await Promise.all([
    wh ? catalogAll({ org, list, warehouse: wh }) : Promise.resolve([]),
    categoriasActivas(),
  ]);
  const accSubcatIds = new Set(cats.filter((c) => ACCESSORY_SUBCATS.has(normName(c.name))).map((c) => c.id));
  const novedades = allItems
    .filter((p) => p.stock > 0 && !excludeMains.has(p.mainCategoryId ?? "") && !accSubcatIds.has(p.categoryId ?? ""))
    .sort((a, b) => (b.sku ?? -1) - (a.sku ?? -1))
    .slice(0, 8);

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className={`relative w-full bg-canvas ${HERO.aspectClass}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HERO.image} alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
          {(() => {
            const hasText = !!(HERO.eyebrow || HERO.title || HERO.subtitle);
            return (
              <div className={`absolute inset-0 flex flex-col gap-4 bg-gradient-to-t from-black/60 to-transparent p-5 sm:p-8 ${hasText ? "items-start justify-end text-left" : "items-center justify-end"}`}>
                {hasText && (
                  <div className="max-w-lg">
                    {HERO.eyebrow && <p className="font-serif text-sm italic text-white/90 sm:text-base">{HERO.eyebrow}</p>}
                    {HERO.title && <h2 className="text-3xl font-bold uppercase leading-none tracking-tight text-white sm:text-5xl">{HERO.title}</h2>}
                    {HERO.subtitle && <p className="mt-2 text-sm text-white/90 sm:text-lg">{HERO.subtitle}</p>}
                  </div>
                )}
                <Link href={HERO.cta.href} className="inline-flex items-center gap-2 rounded-full bg-card px-6 py-3 text-sm font-semibold text-ink shadow-lg transition-transform hover:scale-[1.03]">
                  {HERO.cta.label} <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            );
          })()}
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
            {(() => { const r = resolveTile(big); return <CategoryTile href={r.href} label={r.label} image={r.image} index={0} big />; })()}
            {rest.map((t, i) => {
              const r = resolveTile(t);
              return <CategoryTile key={t.id} href={r.href} label={r.label} image={r.image} index={i + 1} />;
            })}
          </div>
        </section>
      )}

      {/* Novedades (solo ropa) */}
      {novedades.length > 0 && (
        <section>
          <SectionHeading title="Novedades" subtitle="Lo nuevo de la semana" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {novedades.map((p) => <PortalProductCard key={p.id} p={p} />)}
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
