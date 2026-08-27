import Link from "next/link";

type Opt = { id: string; name: string };
export type CatalogFilters = { main?: string; cat?: string; season?: string; q?: string };

function hrefWith(base: CatalogFilters, patch: Partial<CatalogFilters>): string {
  const merged = { ...base, ...patch };
  const sp = new URLSearchParams();
  if (merged.main) sp.set("main", merged.main);
  if (merged.cat) sp.set("cat", merged.cat);
  if (merged.season) sp.set("season", merged.season);
  if (merged.q) sp.set("q", merged.q);
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
          return (
            <li key={o.id}>
              <Link
                href={hrefWith(base, { [param]: active ? undefined : o.id })}
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

/** Contenido del sidebar de navegación del catálogo (principales, tipos, temporadas). */
export function PortalCatalogSidebar({ mains, cats, seasons, base }: {
  mains: Opt[]; cats: Opt[]; seasons: Opt[]; base: CatalogFilters;
}) {
  const hasFilter = Boolean(base.main || base.cat || base.season);
  return (
    <nav className="space-y-4">
      <Link
        href={hrefWith({ q: base.q }, {})}
        className={`block rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${!hasFilter ? "bg-accent-soft text-accent" : "text-ink hover:bg-canvas"}`}
      >
        Todo el catálogo
      </Link>
      <Section title="Categorías" options={mains} param="main" current={base.main} base={base} />
      <Section title="Tipos" options={cats} param="cat" current={base.cat} base={base} />
      <Section title="Temporadas" options={seasons} param="season" current={base.season} base={base} />
    </nav>
  );
}
