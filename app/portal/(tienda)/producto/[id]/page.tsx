import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, portalProduct } from "@/lib/portal-catalog";
import { formatMoney } from "@/lib/format";
import { PortalVariantMatrix } from "@/components/portal-variant-matrix";
import { PortalGallery } from "@/components/portal-gallery";

export default async function PortalProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { customer } = await getPortalCustomer();
  const list = customer?.priceListId ?? null;
  const org = customer?.organizationId ?? "";
  const wh = await centralWarehouseId();
  if (!list || !wh) notFound();

  const p = await portalProduct(id, org, list, wh);
  if (!p) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/portal/catalogo" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver al catálogo
      </Link>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <PortalGallery images={p.images} alt={p.name} />

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{p.name}</h1>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
            <span className={`text-2xl font-bold tabular-nums ${p.compareAt != null ? "text-danger" : "text-accent"}`}>{formatMoney(p.price)}</span>
            {p.compareAt != null ? (
              <>
                <span className="text-base tabular-nums text-faint line-through">{formatMoney(p.compareAt)}</span>
                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-danger">Oferta</span>
              </>
            ) : (
              p.publicPrice != null && p.publicPrice > p.price && (
                <span className="text-sm tabular-nums text-faint" title="Precio público de referencia">Público {formatMoney(p.publicPrice)}</span>
              )
            )}
          </div>
          {p.description && <p className="mt-3 text-sm text-muted">{p.description}</p>}

          <div className="mt-5">
            <h2 className="mb-2 text-sm font-medium text-ink">Cargá tu pedido por talle y color</h2>
            <PortalVariantMatrix productId={p.id} name={p.name} price={p.price} image={p.images[0] ?? null} variants={p.variants} />
          </div>
        </div>
      </div>
    </div>
  );
}
