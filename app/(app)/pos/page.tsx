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
  isWholesale: boolean;
  sessionId: string | null;
  openingAmount: number;
  openedAt: string | null;
  stale: boolean;
  summary: PosSummary | null;
};

const AR_TZ = "America/Argentina/Buenos_Aires";
const arDay = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: AR_TZ });

async function computeSummary(
  sb: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  openingAmount: number
): Promise<PosSummary> {
  const { data: sales } = await sb.from("sales").select("id, total").eq("cash_session_id", sessionId).eq("status", "completada");
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

  // Cobranzas en efectivo de este turno entran al arqueo.
  const { data: receipts } = await sb.from("receipts").select("id").eq("cash_session_id", sessionId);
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
    auth?.user ? sb.from("profiles").select("store_id").eq("id", auth.user.id).maybeSingle() : Promise.resolve({ data: null }),
    sb.rpc("is_admin"),
    sb.from("stores").select("id, name, is_wholesale").eq("has_cash_register", true).eq("active", true).order("name"),
    auth?.user
      ? sb.from("cash_sessions").select("id, store_id, opening_amount, opened_at").eq("status", "abierta").eq("opened_by", auth.user.id)
      : Promise.resolve({ data: [] as { id: string; store_id: string; opening_amount: number; opened_at: string }[] }),
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

  // Caja del usuario actual (una sola abierta por usuario).
  const mySession = (sessions ?? [])[0] ?? null;
  const todayAR = new Date().toLocaleDateString("en-CA", { timeZone: AR_TZ });

  const posStores: PosStore[] = [];
  for (const s of operable) {
    const sess = mySession && mySession.store_id === s.id ? mySession : null;
    posStores.push({
      id: s.id,
      name: s.name,
      isWholesale: s.is_wholesale ?? false,
      sessionId: sess?.id ?? null,
      openingAmount: sess ? Number(sess.opening_amount) : 0,
      openedAt: sess?.opened_at ?? null,
      stale: sess ? arDay(sess.opened_at) !== todayAR : false,
      summary: sess ? await computeSummary(sb, sess.id, Number(sess.opening_amount)) : null,
    });
  }

  // Lista Publico para mostrador; perfiles Mayorista/Platinum para el flujo mayorista.
  const retailPriceListId = (priceLists ?? []).find((l) => l.name === "Publico")?.id ?? null;
  const wholesaleProfiles = (profiles ?? [])
    .filter((p) => p.name === "Mayorista" || p.name === "Platinum")
    .map((p) => ({ customerTypeId: p.id, name: p.name, priceListId: p.price_list_id as string | null }));

  return (
    <PosTerminal
      stores={posStores}
      lockedToStore={!!myStoreId}
      isAdmin={isAdmin === true}
      retailPriceListId={retailPriceListId}
      wholesaleProfiles={wholesaleProfiles}
      paymentMethods={methods ?? []}
    />
  );
}
