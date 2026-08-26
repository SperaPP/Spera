import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProductosImport } from "@/components/productos-import";

export default async function ImportarDatosPage() {
  const sb = await createClient();
  const { data: warehouses } = await sb.from("warehouses").select("id, name").eq("active", true).order("name");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/productos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a productos
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Importar datos por Excel</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Alta masiva de productos, y actualización de stock y ubicaciones por Excel.</p>
      <ProductosImport warehouses={warehouses ?? []} />
    </div>
  );
}
