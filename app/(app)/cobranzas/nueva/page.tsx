import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NuevaCobranzaForm } from "@/components/nueva-cobranza-form";

export default async function NuevaCobranzaPage() {
  const sb = await createClient();
  const [{ data: customers }, { data: stores }, { data: sessions }, { data: methods }] = await Promise.all([
    sb.from("customers").select("id, name, balance").eq("active", true).order("name"),
    sb.from("stores").select("id, name").eq("has_cash_register", true).eq("active", true).order("name"),
    sb.from("cash_sessions").select("id, store_id").eq("status", "abierta"),
    sb.from("payment_methods").select("id, name").eq("active", true).neq("kind", "cuenta_corriente").order("position"),
  ]);

  const sessionByStore = new Map((sessions ?? []).map((s) => [s.store_id, s.id]));
  const openCajas = (stores ?? [])
    .filter((s) => sessionByStore.has(s.id))
    .map((s) => ({ storeId: s.id, name: s.name, sessionId: sessionByStore.get(s.id)! }));

  const shapedCustomers = (customers ?? []).map((c) => ({ id: c.id, name: c.name, balance: Number(c.balance) }));

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cobranzas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Volver a cobranzas
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Nueva cobranza</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Registrá un cobro a cuenta corriente. Baja el saldo del cliente.</p>

      <NuevaCobranzaForm customers={shapedCustomers} openCajas={openCajas} paymentMethods={methods ?? []} />
    </div>
  );
}
