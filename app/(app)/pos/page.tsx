import Link from "next/link";
import { Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PosTerminal } from "@/components/pos-terminal";

function rel<T>(r: unknown): T | null {
  return (Array.isArray(r) ? r[0] : r) as T | null;
}

export default async function PosPage() {
  const sb = await createClient();

  const [{ data: stores }, { data: sessions }, { data: customers }, { data: methods }] = await Promise.all([
    sb.from("stores").select("id, name").eq("has_cash_register", true).eq("active", true).order("name"),
    sb.from("cash_sessions").select("id, store_id").eq("status", "abierta"),
    sb.from("customers").select("id, name, customer_types(price_list_id, price_lists(name))").eq("active", true).order("name"),
    sb.from("payment_methods").select("id, name, kind").eq("active", true).order("position"),
  ]);

  const sessionByStore = new Map((sessions ?? []).map((s) => [s.store_id, s.id]));
  const openStores = (stores ?? [])
    .filter((s) => sessionByStore.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, sessionId: sessionByStore.get(s.id)! }));

  const shapedCustomers = (customers ?? []).map((c) => {
    const ct = rel<{ price_list_id: string | null; price_lists: unknown }>(c.customer_types);
    const pl = ct ? rel<{ name: string }>(ct.price_lists) : null;
    return { id: c.id, name: c.name, priceListId: ct?.price_list_id ?? null, priceListName: pl?.name ?? null };
  });
  const defaultCustomer =
    shapedCustomers.find((c) => c.name === "Consumidor Final")?.id ?? shapedCustomers[0]?.id ?? null;

  if (openStores.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Wallet className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">No hay ninguna caja abierta</p>
          <p className="mt-1 text-sm text-muted">Abrí un turno de caja para poder vender.</p>
          <Link
            href="/caja"
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Ir a Caja
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PosTerminal
      openStores={openStores}
      customers={shapedCustomers}
      defaultCustomerId={defaultCustomer}
      paymentMethods={methods ?? []}
    />
  );
}
