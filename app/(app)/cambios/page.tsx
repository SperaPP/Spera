import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NuevoCambioForm } from "@/components/nuevo-cambio-form";

export default async function CambiosPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store: storeParam } = await searchParams;
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();

  const [{ data: profile }, { data: isAdmin }, { data: stores }, { data: sessions }, { data: priceLists }, { data: methods }] = await Promise.all([
    auth?.user ? sb.from("profiles").select("store_id").eq("id", auth.user.id).maybeSingle() : Promise.resolve({ data: null }),
    sb.rpc("is_admin"),
    sb.from("stores").select("id, name").eq("has_cash_register", true).eq("active", true).order("name"),
    sb.from("cash_sessions").select("id, store_id").eq("status", "abierta"),
    sb.from("price_lists").select("id, name").eq("active", true),
    sb.from("payment_methods").select("id, name, kind").eq("active", true).order("position"),
  ]);

  const myStoreId = (profile?.store_id as string | null) ?? null;
  let operable = stores ?? [];
  if (myStoreId) operable = operable.filter((s) => s.id === myStoreId);
  else if (isAdmin !== true) operable = [];

  const sessionByStore = new Map((sessions ?? []).map((s) => [s.store_id, s.id]));
  let openStores = operable
    .filter((s) => sessionByStore.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, sessionId: sessionByStore.get(s.id)! }));

  // Anclar a la sucursal del usuario (o a la que viene del POS). No seleccionable.
  const anchor = myStoreId ?? (storeParam && openStores.some((s) => s.id === storeParam) ? storeParam : null);
  let locked = false;
  if (anchor) {
    openStores = openStores.filter((s) => s.id === anchor);
    locked = true;
  }

  const retailPriceListId = (priceLists ?? []).find((l) => l.name === "Publico")?.id ?? null;

  if (openStores.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Cambios</h1>
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><RefreshCw className="h-5 w-5" /></span>
          <p className="mt-3 font-medium text-ink">No hay una caja abierta</p>
          <p className="mt-1 text-sm text-muted">Abrí la caja de tu sucursal en el POS para poder registrar cambios.</p>
          <Link href="/pos" className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Ir al POS</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-ink">Cambios</h1>
      <p className="mb-5 text-sm text-muted">Elegí el alcance (cliente mayorista o ticket), escaneá las prendas a devolver y con qué se cambian. Dentro de los 30 días.</p>
      <NuevoCambioForm openStores={openStores} locked={locked} retailPriceListId={retailPriceListId} paymentMethods={methods ?? []} />
    </div>
  );
}
