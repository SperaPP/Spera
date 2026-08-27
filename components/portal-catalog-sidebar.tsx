import Link from "next/link";

type Opt = { id: string; name: string };
export type CatalogFilters = { main?: string; cat?: string; season?: string; q?: string; all?: boolean };

/** Construye la URL del catálogo. `all` (ver todo) solo se emite si no hay ninguna
 *  dimensión seleccionada; elegir cualquier filtro lo descarta. */
export function catalogHref(f: CatalogFilters): string {
  const sp = new URLSearchParams();
  if (f.main) sp.set("main", f.main);
  if (f.cat) sp.set("cat", f.cat);
  if (f.season) sp.set("season", f.season);
  if (f.q) sp.set("q", f.q);
  if (f.all && !f.main && !f.cat && !f.season) sp.set("all", "1");
  const s = sp.toString();
  return s ? `/portal/catalogo?${s}` : "/portal/catalogo";
}

function Section({ title, options, param, current, base }: {
  title: string; options: Opt[]; param: "main" | "cat" | "season"; current?: string; base: CatalogFilters;
}) {
  if (!options.length) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <ul className="space-y-0.5">
        {options.map((o) => {
          const active = current === o.id;
          // Elegir un filtro descarta "all". Toggle: si ya está activo, se saca.
          const href = catalogHref({ ...base, all: false, [param]: active ? undefined : o.id });
          return (
            <li key={o.id}>
              <Link
                href={href}
                className={`block rounded-lg px-2.5 py-1.5 text-sm transition-colors ${active ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-canvas"}`}
              >
                {o.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Sidebar de navegación del catálogo (principales, tipos, temporadas disponibles). */
export function PortalCatalogSidebar({ mains, cats, seasons, base }: {
  mains: Opt[]; cats: Opt[]; seasons: Opt[]; base: CatalogFilters;
}) {
  const todoActive = Boolean(base.all) && !base.main && !base.cat && !base.season;
  return (
    <nav className="space-y-4">
      <Link
        href={catalogHref({ q: base.q, all: true })}
        className={`block rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${todoActive ? "bg-accent-soft text-accent" : "text-ink hover:bg-canvas"}`}
      >
        Todo el catálogo
      </Link>
      <Section title="Categorías" options={mains} param="main" current={base.main} base={base} />
      <Section title="Tipos" options={cats} param="cat" current={base.cat} base={base} />
      <Section title="Temporadas" options={seasons} param="season" current={base.season} base={base} />
    </nav>
  );
}
