import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NuevoProductoForm } from "@/components/nuevo-producto-form";

export default async function NuevoProductoPage() {
  const sb = await createClient();
  const [
    { data: categories },
    { data: sizes },
    { data: colors },
    { data: fabricTypes },
    { data: priceLists },
    { data: warehouses },
  ] = await Promise.all([
    sb.from("categories").select("id, name").eq("active", true).order("name"),
    sb.from("sizes").select("id, name").eq("active", true).order("position"),
    sb.from("colors").select("id, name").eq("active", true).order("name"),
    sb.from("fabric_types").select("id, name").eq("active", true).order("name"),
    sb.from("price_lists").select("id, name").eq("active", true).order("name"),
    sb.from("warehouses").select("id, name").eq("active", true),
  ]);

  const central = (warehouses ?? []).find((w) => w.name === "Mayorista - Central");

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/productos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a productos
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Nuevo producto</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Cargá el producto, generá sus variantes y su stock inicial.
      </p>

      <NuevoProductoForm
        categories={categories ?? []}
        sizes={sizes ?? []}
        colors={colors ?? []}
        fabricTypes={fabricTypes ?? []}
        priceLists={priceLists ?? []}
        warehouseId={central?.id ?? null}
        warehouseName={central?.name ?? "Mayorista - Central"}
      />
    </div>
  );
}
