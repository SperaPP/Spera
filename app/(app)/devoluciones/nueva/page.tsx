import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NuevaDevolucionForm } from "@/components/nueva-devolucion-form";

export default async function NuevaDevolucionPage() {
  const sb = await createClient();
  const [{ data: customers }, { data: stores }] = await Promise.all([
    sb.from("customers").select("id, name").eq("active", true).order("name"),
    sb.from("stores").select("id, name").eq("has_cash_register", true).eq("active", true).order("name"),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/devoluciones"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a devoluciones
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Nueva devolución</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Solo se pueden devolver prendas compradas por el cliente en los últimos 30 días.
      </p>

      <NuevaDevolucionForm customers={customers ?? []} stores={stores ?? []} />
    </div>
  );
}
