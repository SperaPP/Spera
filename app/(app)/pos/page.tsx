import { createClient } from "@/lib/supabase/server";
import { PosTerminal } from "@/components/pos-terminal";

function rel<T>(r: unknown): T | null {
  return (Array.isArray(r) ? r[0] : r) as T | null;
}

export type PosSummary = {
  sales: number;
  sold: number;
  cash: number;
  expectedCash: number;
  byMethod: { name: string; amount: number }[];
};

export type PosStore = {
  id: string;
  name: string;
  warehouseId: string | null;
  isWholesale: boolean;
  sessionId: string | null;
  role: "titular" | "apoyo" | null;
  openingAmount: number;
  openedAt: string | null;
  stale: boolean;
  titularOpen: boolean;    // ya hay una caja titular abierta en el local (si abro, sería de apoyo)
  iAmTitular: boolean;     // el usuario puede abrir la caja titular
  openApoyoCount: number;  // cajas de apoyo abiertas (el titular no puede cerrar con apoyos abiertas)
  pettyCash: number;       // caja chica del local (arrastre; fondo de la caja titular)
  safeBalance: number;     // caja fuerte del local
  summary: PosSummary | null; // titular: consolidado local; apoyo: propio
};

const AR_TZ = "America/Argentina/Buenos_Aires";
const arDay = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: AR_TZ });

/** Arqueo sobre uno o varios turnos (el titular consolida su turno + las cajas de apoyo). */
async function computeSummary(
  sb: Awaited<ReturnType<typeof createClient>>,
  sessionIds: string[],
  openingAmount: number
): Promise<PosSummary> {
  if (sessionIds.length === 0) return { sales: 0, sold: 0, cash: 0, expectedCash: openingAmount, byMethod: [] };
  const { data: sales } = await sb.from("sales").select("id, total").in("cash_session_id", sessionIds).eq("status", "completada");
  const ids = (sales ?? []).map((x) => x.id);
  const grossSold = (sales ?? []).reduce((a, x) => a + Number(x.total), 0);

  let cash = 0;
  let cambio = 0; // crédito de cambios reusado: no es venta nueva
  const byMethod = new Map<string, number>();
  if (ids.length) {
    const { data: pays } = await sb.from("sale_payments").select("amount, payment_methods(name, affects_cash, kind)").in("sale_id", ids);
    for (const p of pays ?? []) {
      const m = rel<{ name: string; affects_cash: boolean; kind: string }>(p.payment_methods);
      const amt = Number(p.amount);
      if (m) {
        byMethod.set(m.name, (byMethod.get(m.name) ?? 0) + amt);
        if (m.affects_cash) cash += amt;
        if (m.kind === "cambio") cambio += amt;
      }
    }
  }
  const sold = grossSold - cambio;

  // Cobranzas en efectivo de estos turnos entran al arqueo.
  const { data: receipts } = await sb.from("receipts").select("id").in("cash_session_id", sessionIds).neq("status", "anulada");
  const rids = (receipts ?? []).map((r) => r.id);
  if (rids.length) {
    const { data: rpays } = await sb.from("receipt_payments").select("amount, payment_methods(name, affects_cash)").in("receipt_id", rids);
    for (const p of rpays ?? []) {
      const m = rel<{ name: string; affects_cash: boolean }>(p.payment_methods);
      if (m?.affects_cash) cash += Number(p.amount);
    }
  }

  return {
    sales: ids.length,
    sold,
    cash,
    expectedCash: openingAmount + cash,
    byMethod: [...byMethod].map(([name, amount]) => ({ name, amount })),
  };
}

export default async function PosPage() {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();

  const [{ data: profile }, { data: isAdmin }, { data: stores }, { data: sessions }, { data: priceLists }, { data: profiles }, { data: methods }] = await Promise.all([
    auth?.user ? sb.from("profiles").select("store_id, is_cash_titular").eq("id", auth.user.id).maybeSingle() : Promise.resolve({ data: null }),
    sb.rpc("is_admin"),
    sb.from("stores").select("id, name, is_wholesale, warehouse_id").eq("has_cash_register", true).eq("active", true).order("name"),
    sb.from("cash_sessions").select("id, store_id, role, opening_amount, opened_at, opened_by").eq("status", "abierta"),
    sb.from("price_lists").select("id, name").eq("active", true),
    sb.from("customer_types").select("id, name, price_list_id").eq("active", true).order("name"),
    sb.from("payment_methods").select("id, name, kind").eq("active", true).order("position"),
  ]);

  // La sucursal del usuario ancla el POS. Admin sin sucursal → puede operar todas.
  // Vendedor sin sucursal asignada → no puede operar (lista vacía).
  const myStoreId = (profile?.store_id as string | null) ?? null;
  let operable = stores ?? [];
  if (myStoreId) operable = operable.filter((s) => s.id === myStoreId);
  else if (isAdmin !== true) operable = [];

  const allOpen = sessions ?? [];
  const myId = auth?.user?.id ?? null;
  const iAmTitular = (profile as { is_cash_titular?: boolean } | null)?.is_cash_titular === true;
  // Caja del usuario actual (una sola abierta por usuario).
  const mySession = myId ? allOpen.find((s) => s.opened_by === myId) ?? null : null;
  const todayAR = new Date().toLocaleDateString("en-CA", { timeZone: AR_TZ });

  // Caja chica (arrastre) + caja fuerte, ambas por local.
  const [{ data: petty }, { data: safes }] = await Promise.all([
    sb.from("store_petty").select("store_id, balance"),
    sb.from("store_safe").select("store_id, balance"),
  ]);
  const pettyByStore = new Map((petty ?? []).map((p) => [p.store_id, Number(p.balance)]));
  const safeByStore = new Map((safes ?? []).map((s) => [s.store_id, Number(s.balance)]));

  const posStores: PosStore[] = [];
  for (const s of operable) {
    const openHere = allOpen.filter((o) => o.store_id === s.id);
    const sess = mySession && mySession.store_id === s.id ? mySession : null;
    const role = (sess?.role as "titular" | "apoyo" | undefined) ?? null;

    // Cajas de apoyo abiertas (el titular no puede cerrar mientras haya alguna).
    const openApoyoCount = openHere.filter((o) => o.role === "apoyo" && o.id !== sess?.id).length;

    let summary: PosSummary | null = null;
    if (sess) {
      if (role === "titular") {
        // Consolida el turno del titular con las cajas de apoyo de este período (abiertas o cerradas).
        const { data: apoyos } = await sb.from("cash_sessions")
          .select("id").eq("store_id", s.id).eq("role", "apoyo").gte("opened_at", sess.opened_at).neq("id", sess.id);
        const ids = [sess.id, ...(apoyos ?? []).map((a) => a.id)];
        summary = await computeSummary(sb, ids, Number(sess.opening_amount));
      } else {
        summary = await computeSummary(sb, [sess.id], Number(sess.opening_amount));
      }
    }

    posStores.push({
      id: s.id,
      name: s.name,
      warehouseId: (s.warehouse_id as string | null) ?? null,
      isWholesale: s.is_wholesale ?? false,
      sessionId: sess?.id ?? null,
      role,
      openingAmount: sess ? Number(sess.opening_amount) : 0,
      openedAt: sess?.opened_at ?? null,
      stale: sess ? arDay(sess.opened_at) !== todayAR : false,
      titularOpen: openHere.some((o) => o.role === "titular"),
      iAmTitular,
      openApoyoCount,
      pettyCash: pettyByStore.get(s.id) ?? 0,
      safeBalance: safeByStore.get(s.id) ?? 0,
      summary,
    });
  }

  // Lista Publico para mostrador; perfil Mayorista para el flujo mayorista.
  const retailPriceListId = (priceLists ?? []).find((l) => l.name === "Publico")?.id ?? null;
  const asProfiles = (name: string) => (profiles ?? [])
    .filter((p) => p.name === name)
    .map((p) => ({ customerTypeId: p.id, name: p.name, priceListId: p.price_list_id as string | null }));
  const wholesaleProfiles = asProfiles("Mayorista");
  const retailProfiles = asProfiles("Publico"); // tipo de cliente para mostrador (minorista)

  return (
    <PosTerminal
      stores={posStores}
      lockedToStore={!!myStoreId}
      isAdmin={isAdmin === true}
      retailPriceListId={retailPriceListId}
      wholesaleProfiles={wholesaleProfiles}
      retailProfiles={retailProfiles}
      paymentMethods={methods ?? []}
    />
  );
}
