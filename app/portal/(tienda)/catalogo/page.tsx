import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, categoriasActivas, categoriasPrincipales, temporadasActivas, catalogAll } from "@/lib/portal-catalog";
import { PortalCatalogClient } from "@/components/portal-catalog-client";

type Params = { cat?: string; main?: string; season?: string; q?: string };

export default async function PortalCatalogo({ searchParams }: { searchParams: Promise<Params> }) {
  const { cat, main, season, q } = await searchParams;

  const { customer } = await getPortalCustomer();
  const list = customer?.priceListId ?? null;
  const org = customer?.organizationId ?? "";
  const wh = await centralWarehouseId();

  if (!list || !wh) {
    return <p className="rounded-xl border border-warn/40 bg-warn-bg/30 px-4 py-6 text-sm text-ink">No podemos mostrar el catálogo en este momento.</p>;
  }

  // Una sola carga: todo el catálogo + las taxonomías. El filtrado/búsqueda/orden
  // se hace en el navegador (instantáneo, sin volver al servidor por cada clic).
  const [products, mains, cats, seasons] = await Promise.all([
    catalogAll({ org, list, warehouse: wh }),
    categoriasPrincipales(org),
    categoriasActivas(),
    temporadasActivas(org),
  ]);

  const mujerId = mains.find((m) => m.name.toLowerCase() === "mujer")?.id ?? null;

  return (
    <PortalCatalogClient
      products={products}
      mains={mains}
      cats={cats}
      seasons={seasons}
      defaultMainId={mujerId}
      initial={{ main, cat, season, q }}
    />
  );
}
