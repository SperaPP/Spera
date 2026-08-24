import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ImageOff } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, portalProduct } from "@/lib/portal-catalog";
import { formatMoney } from "@/lib/format";

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
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          <div className="aspect-square w-full bg-canvas">
            {p.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.images[0]} alt={p.name} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-faint"><ImageOff className="h-10 w-10" /></span>
            )}
          </div>
          {p.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto p-2">
              {p.images.slice(0, 6).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{p.name}</h1>
          <div className="mt-2 text-2xl font-bold tabular-nums text-accent">{formatMoney(p.price)}</div>
          {p.description && <p className="mt-3 text-sm text-muted">{p.description}</p>}

          <div className="mt-5">
            <h2 className="mb-2 text-sm font-medium text-ink">Disponible</h2>
            {p.variants.length === 0 ? (
              <p className="text-sm text-muted">Sin stock por el momento.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {p.variants.map((v) => (
                  <span key={v.id} className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink">
                    {v.label ?? "Único"} <span className="ml-1 text-xs text-muted">({v.stock})</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-canvas px-4 py-3 text-sm text-muted">
            Muy pronto vas a poder armar tu pedido desde acá.
          </div>
        </div>
      </div>
    </div>
  );
}
