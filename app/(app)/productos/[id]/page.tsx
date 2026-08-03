import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { ProductPhotos } from "@/components/product-photos";

const VARIATION_LABEL: Record<string, string> = {
  none: "Sin variantes",
  size: "Talle",
  color: "Color",
  size_color: "Talle y color",
};

type Rel = { name: string } | { name: string }[] | null;
const relName = (r: Rel) => (Array.isArray(r) ? r[0]?.name : r?.name) ?? null;

export default async function ProductoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createClient();

  const { data: product } = await sb
    .from("products")
    .select(
      "id, name, description, variation_type, tax_rate, active, external_id, categories(name), fabric_types(name), product_variants(id, size, color, sku, barcode, active)"
    )
    .eq("id", id)
    .single();

  if (!product) notFound();

  const variants = (product.product_variants ?? []) as {
    id: string; size: string | null; color: string | null; sku: string | null; barcode: string | null;
  }[];
  const variantIds = variants.map((v) => v.id);

  const [{ data: stock }, { data: prices }, { data: images }] = await Promise.all([
    variantIds.length
      ? sb.from("stock").select("variant_id, quantity").in("variant_id", variantIds)
      : Promise.resolve({ data: [] as { variant_id: string; quantity: number }[] }),
    sb.from("price_list_items").select("price, price_lists(name)").eq("product_id", id).is("variant_id", null),
    sb.from("product_images").select("id, path, color, is_primary").eq("product_id", id).order("is_primary", { ascending: false }).order("created_at"),
  ]);

  const stockByVariant = new Map<string, number>();
  for (const s of stock ?? []) {
    stockByVariant.set(s.variant_id, (stockByVariant.get(s.variant_id) ?? 0) + s.quantity);
  }

  const bucketUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images`;
  const photos = (images ?? []).map((im) => ({
    id: im.id, path: im.path, url: `${bucketUrl}/${im.path}`, color: im.color as string | null, isPrimary: im.is_primary as boolean,
  }));
  const productColors = [...new Set(variants.map((v) => v.color).filter(Boolean))] as string[];

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/productos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a productos
      </Link>

      {/* Cabecera */}
      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{product.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span>{relName(product.categories) ?? "Sin categoría"}</span>
              <span>·</span>
              <span>{VARIATION_LABEL[product.variation_type] ?? product.variation_type}</span>
              {relName(product.fabric_types) && (
                <>
                  <span>·</span>
                  <span>{relName(product.fabric_types)}</span>
                </>
              )}
              <span>·</span>
              <span>IVA {product.tax_rate}%</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {product.active ? (
              <span className="rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-medium text-ok">Activo</span>
            ) : (
              <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium text-muted">Inactivo</span>
            )}
            <Link href={`/productos/${product.id}/editar`} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Link>
          </div>
        </div>

        {product.description && (
          <p className="mt-4 border-t border-line pt-4 text-sm text-ink">{product.description}</p>
        )}

        {(prices ?? []).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-4">
            {(prices ?? []).map((p, i) => (
              <div key={i} className="text-sm">
                <span className="text-muted">{relName(p.price_lists)}: </span>
                <span className="font-medium text-ink">{formatMoney(p.price)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fotos */}
      <ProductPhotos productId={product.id} photos={photos} colors={productColors} />

      {/* Variantes */}
      <div className="rounded-xl border border-line bg-card">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium text-ink">Variantes</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">{variants.length} en total</span>
            <Link href={`/etiquetas/${product.id}`} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
              <Printer className="h-3.5 w-3.5" /> Imprimir etiquetas
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-medium">Variante</th>
                <th className="px-5 py-2.5 font-medium">SKU</th>
                <th className="px-5 py-2.5 font-medium">Código de barras</th>
                <th className="px-5 py-2.5 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5">
                    {v.size || v.color ? (
                      <div className="flex flex-wrap gap-1">
                        {v.size && <span className="rounded-md bg-canvas px-2 py-0.5 text-xs font-medium text-ink">{v.size}</span>}
                        {v.color && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{v.color}</span>}
                      </div>
                    ) : (
                      <span className="text-muted">Única</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-ink">{v.sku ?? "—"}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-muted">{v.barcode ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-ink">{stockByVariant.get(v.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
