import Link from "next/link";
import { Tag, Sparkles } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, categoriasActivas, catalog } from "@/lib/portal-catalog";
import { PortalSearch } from "@/components/portal-search";
import { PortalProductCard } from "@/components/portal-product-card";

export default async function PortalHome() {
  const { customer } = await getPortalCustomer();
  const list = customer?.priceListId ?? null;
  const org = customer?.organizationId ?? "";
  const wh = await centralWarehouseId();

  if (!list) {
    return <p className="rounded-xl border border-warn/40 bg-warn-bg/30 px-4 py-6 text-sm text-ink">Tu cuenta todavía no tiene una lista de precios asignada. Escribinos para habilitarte.</p>;
  }

  const [categorias, destacados] = await Promise.all([
    categoriasActivas(),
    wh ? catalog({ org, list, warehouse: wh, featured: true, limit: 12, offset: 0 }) : Promise.resolve({ items: [], total: 0 }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight text-ink">Hola, {customer!.name}</h1>
        <PortalSearch />
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-faint"><Tag className="h-4 w-4" /> Categorías</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {categorias.map((c) => (
            <Link key={c.id} href={`/portal/catalogo?cat=${c.id}`} className="rounded-xl border border-line bg-card px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent">
              {c.name}
            </Link>
          ))}
        </div>
      </section>

      {destacados.items.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-faint"><Sparkles className="h-4 w-4" /> Destacados</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {destacados.items.map((p) => <PortalProductCard key={p.id} p={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}
