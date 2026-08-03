import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EtiquetasPrint } from "@/components/etiquetas-print";

export default async function EtiquetasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const { data: product } = await sb
    .from("products")
    .select("id, name, product_variants(id, size, color, sku)")
    .eq("id", id)
    .single();
  if (!product) notFound();

  const variants = ((product.product_variants ?? []) as { id: string; size: string | null; color: string | null; sku: string | null }[]).map((v) => ({
    id: v.id, sku: v.sku, label: [v.size, v.color].filter(Boolean).join(" / ") || null,
  }));

  return (
    <div>
      <h1 className="etq-toolbar text-2xl font-semibold tracking-tight text-ink">Etiquetas · {product.name}</h1>
      <p className="etq-toolbar mt-1 mb-6 text-sm text-muted">Elegí el tamaño de tu etiqueta y la cantidad de copias, y mandá a imprimir.</p>
      <EtiquetasPrint productName={product.name} variants={variants} />
    </div>
  );
}
