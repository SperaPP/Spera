import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EditarProductoForm } from "@/components/editar-producto-form";

export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: product }, { data: categories }, { data: fabricTypes }] = await Promise.all([
    sb.from("products").select("id, name, description, category_id, fabric_type_id, tax_rate, active, lifecycle").eq("id", id).single(),
    sb.from("categories").select("id, name").eq("active", true).order("name"),
    sb.from("fabric_types").select("id, name").eq("active", true).order("name"),
  ]);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/productos/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Volver al producto
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Editar producto</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Las variantes, SKU y códigos de barra no cambian.</p>

      <EditarProductoForm
        product={{
          id: product.id,
          name: product.name,
          description: product.description ?? "",
          categoryId: product.category_id ?? "",
          fabricTypeId: product.fabric_type_id ?? "",
          taxRate: Number(product.tax_rate),
          active: product.active,
          lifecycle: (product.lifecycle ?? "actual") as "actual" | "discontinuo",
        }}
        categories={categories ?? []}
        fabricTypes={fabricTypes ?? []}
      />
    </div>
  );
}
