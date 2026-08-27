// Cliente de la API de Tiendanube (Nuvemshop). Solo server-side.
// IMPORTANTE: se usa la API v1 (https://api.tiendanube.com/v1/{store_id}) con header
// "Authentication: bearer TOKEN" (NO "Authorization: Bearer") + "User-Agent" obligatorio.
// Es intencional y está verificado contra la tienda real; no cambiar el header.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const API = "https://api.tiendanube.com/v1";
const APP_ID = process.env.TIENDANUBE_APP_ID ?? "";
const CLIENT_SECRET = process.env.TIENDANUBE_CLIENT_SECRET ?? "";
const USER_AGENT = process.env.TIENDANUBE_USER_AGENT || "Spera (sistemabody@gmail.com)";

export function tnConfigured() {
  return Boolean(APP_ID && CLIENT_SECRET);
}

/** URL de autorización para instalar la app en la tienda del dueño. */
export function authorizeUrl(state: string) {
  return `https://www.tiendanube.com/apps/${APP_ID}/authorize?state=${encodeURIComponent(state)}`;
}

/** Canjea el ?code del callback por el access_token + store_id. */
export async function exchangeCode(code: string): Promise<{ access_token: string; user_id: number; scope: string }> {
  const res = await fetch("https://www.tiendanube.com/apps/authorize/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: APP_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token exchange ${res.status}: ${text}`);
  return JSON.parse(text);
}

export type TNCreds = { storeId: string; token: string };

/** Lee el token guardado de la organización (o null si no está conectada). */
export async function getTNCreds(org: string): Promise<TNCreds | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("tiendanube_credentials")
    .select("store_id, access_token").eq("organization_id", org).maybeSingle();
  if (!data) return null;
  return { storeId: data.store_id, token: data.access_token };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch con timeout (20s) y reintento con espera ante 429/5xx o error de red. */
async function tnRequest(url: string, init: RequestInit, tries = 4): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      if (attempt >= tries) throw e;
      await sleep(500 * attempt);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(ra > 0 ? ra * 1000 : 500 * attempt);
      continue;
    }
    return res;
  }
}

async function tnFetch(creds: TNCreds, path: string, init?: RequestInit) {
  return tnRequest(`${API}/${creds.storeId}${path}`, {
    ...init,
    headers: {
      Authentication: `bearer ${creds.token}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** GET de un recurso paginado; sigue el header Link rel="next". Solo lectura. */
async function tnGetAll(creds: TNCreds, resourcePath: string): Promise<unknown[]> {
  const out: unknown[] = [];
  const sep = resourcePath.includes("?") ? "&" : "?";
  let url: string | null = `${API}/${creds.storeId}${resourcePath}${sep}per_page=200&page=1`;
  let guard = 0;
  while (url && guard < 200) {
    guard++;
    const res: Response = await tnRequest(url, {
      headers: { Authentication: `bearer ${creds.token}`, "User-Agent": USER_AGENT, "Content-Type": "application/json" },
    });
    if (res.status === 404) break; // sin resultados
    if (!res.ok) throw new Error(`TN ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as unknown[];
    if (Array.isArray(page)) out.push(...page);
    // Próxima página: header Link rel="next".
    const link = res.headers.get("link") || res.headers.get("Link");
    const next = link?.split(",").find((p) => /rel="next"/.test(p));
    const m = next?.match(/<([^>]+)>/);
    url = m ? m[1] : null;
  }
  return out;
}

export type TNVariant = { tnProductId: string; tnVariantId: string; sku: string | null; price: number | null; stock: number | null };
export type TNProductLite = { id: string; name: string; published: boolean; variants: TNVariant[] };

/** Trae todos los productos de TN con sus variantes (id, sku, precio, stock). Solo lectura. */
export async function fetchTNProducts(creds: TNCreds): Promise<TNProductLite[]> {
  const raw = await tnGetAll(creds, "/products?fields=id,name,published,variants");
  return (raw as Record<string, unknown>[]).map((p) => {
    const name = typeof p.name === "object" ? Object.values(p.name as Record<string, string>)[0] ?? "" : String(p.name ?? "");
    const variants = ((p.variants ?? []) as Record<string, unknown>[]).map((v) => ({
      tnProductId: String(p.id),
      tnVariantId: String(v.id),
      sku: v.sku != null && String(v.sku).trim() !== "" ? String(v.sku).trim() : null,
      price: v.price != null ? Number(v.price) : null,
      stock: v.stock != null ? Number(v.stock) : null,
    }));
    return { id: String(p.id), name, published: Boolean(p.published), variants };
  });
}

/** Sanity-check de la conexión: nombre de la tienda. */
export async function fetchStoreName(creds: TNCreds): Promise<string | null> {
  const res = await tnFetch(creds, "/store");
  if (!res.ok) return null;
  const s = (await res.json()) as { name?: Record<string, string> | string };
  return typeof s.name === "object" ? Object.values(s.name)[0] ?? null : (s.name ?? null);
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_FAILS = 10; // tras N fallos consecutivos, se descarta (dead-letter)

/** Drena la cola de sync de stock de una organización: empuja el disponible de cada
 *  variante encolada a TN. Un solo drenador por org a la vez (lease). Borra la fila
 *  solo si no fue re-encolada durante el PUT (no pierde updates). Las fallidas van al
 *  fondo (no starvan a las buenas) y se descartan tras MAX_FAILS. */
export async function syncTNStockOnce(orgId: string, limit = 100): Promise<{ processed: number; failed: number; remaining: number; skipped?: boolean }> {
  const admin = createAdminClient();
  const creds = await getTNCreds(orgId);
  if (!creds) return { processed: 0, failed: 0, remaining: 0 };

  const { data: store } = await admin.from("stores")
    .select("warehouse_id").eq("organization_id", orgId).eq("name", "Tiendanube").maybeSingle();
  if (!store?.warehouse_id) return { processed: 0, failed: 0, remaining: 0 };
  const wh = store.warehouse_id as string;

  // Lease: un solo drenador por org a la vez (se auto-libera a los 90s si el drenado muere).
  await admin.from("tn_sync_lock").upsert({ organization_id: orgId, locked_until: new Date(0).toISOString() }, { onConflict: "organization_id", ignoreDuplicates: true });
  const { data: lease } = await admin.from("tn_sync_lock")
    .update({ locked_until: new Date(Date.now() + 90_000).toISOString() })
    .eq("organization_id", orgId).lt("locked_until", new Date().toISOString()).select("organization_id");
  if (!lease || lease.length === 0) return { processed: 0, failed: 0, remaining: 0, skipped: true };

  let processed = 0, failed = 0;
  try {
    const { data: queue } = await admin.from("tn_stock_sync_queue")
      .select("variant_id, enqueued_at, fail_count").eq("organization_id", orgId)
      .order("enqueued_at", { ascending: true }).limit(limit);
    if (queue && queue.length) {
      const varIds = queue.map((q) => q.variant_id as string);
      const { data: links } = await admin.from("tiendanube_links")
        .select("variant_id, tn_product_id, tn_variant_id").eq("organization_id", orgId).in("variant_id", varIds);
      const linkByVar = new Map((links ?? []).map((l) => [l.variant_id as string, l]));

      for (const q of queue) {
        const vId = q.variant_id as string;
        const enq = q.enqueued_at as string; // token de versión de la fila
        const link = linkByVar.get(vId);
        if (!link) { // sin link: no se sincroniza, sacar de la cola (condicionado)
          await admin.from("tn_stock_sync_queue").delete().eq("organization_id", orgId).eq("variant_id", vId).eq("enqueued_at", enq);
          continue;
        }
        // Disponible leído lo más tarde posible (justo antes del PUT).
        const { data: s } = await admin.from("stock").select("quantity, reserved").eq("warehouse_id", wh).eq("variant_id", vId).maybeSingle();
        const disp = Math.max(0, (s?.quantity ?? 0) - (s?.reserved ?? 0));
        const res = await tnFetch(creds, `/products/${link.tn_product_id}/variants/${link.tn_variant_id}`,
          { method: "PUT", body: JSON.stringify({ stock: disp }) });
        if (res.ok) {
          // Borrado condicionado por enqueued_at: si el trigger re-encoló durante el PUT
          // (venta física en el medio), este delete NO matchea y la variante se reprocesa.
          await admin.from("tn_stock_sync_queue").delete().eq("organization_id", orgId).eq("variant_id", vId).eq("enqueued_at", enq);
          processed++;
        } else {
          failed++;
          const fc = (q.fail_count as number) ?? 0;
          if (fc + 1 >= MAX_FAILS) { // poison message: descartar y avisar
            await admin.from("tn_stock_sync_queue").delete().eq("organization_id", orgId).eq("variant_id", vId).eq("enqueued_at", enq);
            console.error(`tn-sync: descarto variante ${vId} tras ${fc + 1} fallos (PUT ${res.status})`);
          } else { // al fondo, para no starvar a las buenas
            await admin.from("tn_stock_sync_queue").update({ enqueued_at: new Date().toISOString(), fail_count: fc + 1 })
              .eq("organization_id", orgId).eq("variant_id", vId).eq("enqueued_at", enq);
          }
        }
        await sleepMs(250); // respeta el rate limit de TN
      }
    }
  } finally {
    await admin.from("tn_sync_lock").update({ locked_until: new Date().toISOString() }).eq("organization_id", orgId);
  }
  const { count } = await admin.from("tn_stock_sync_queue")
    .select("*", { count: "exact", head: true }).eq("organization_id", orgId);
  return { processed, failed, remaining: count ?? 0 };
}

/** Drena la cola de todas las organizaciones conectadas a TN. */
export async function syncTNStockAll(limit = 100): Promise<Array<{ org: string; processed: number; failed: number; remaining: number; skipped?: boolean }>> {
  const admin = createAdminClient();
  const { data: creds } = await admin.from("tiendanube_credentials").select("organization_id");
  const out: Array<{ org: string; processed: number; failed: number; remaining: number; skipped?: boolean }> = [];
  for (const c of creds ?? []) out.push({ org: c.organization_id as string, ...(await syncTNStockOnce(c.organization_id as string, limit)) });
  return out;
}

/** Trae un pedido completo por id (para la ingesta por webhook). null si no existe. */
export async function fetchTNOrder(creds: TNCreds, orderId: string | number): Promise<Record<string, unknown> | null> {
  const res = await tnFetch(creds, `/orders/${orderId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TN order ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Normaliza un pedido de TN al payload que consume ingest_tn_order(). */
export function normalizeTNOrder(o: Record<string, unknown>): {
  tn_order_id: string; tn_number: string; status: string; paid: boolean;
  total: number; subtotal: number; discount: number;
  buyer: { name: string; doc: string; phone: string; email: string; address: string };
  items: Array<{ tn_variant_id: string; sku: string; product_name: string; variant_label: string; quantity: number; unit_price: number }>;
} {
  const g = (k: string) => o[k];
  const ship = (g("shipping_address") ?? {}) as Record<string, unknown>;
  const cust = (g("customer") ?? {}) as Record<string, unknown>;
  const addressParts = [ship.address, ship.number, ship.floor, ship.locality, ship.city, ship.province, ship.zipcode]
    .map((x) => (x == null ? "" : String(x).trim())).filter(Boolean);
  const products = (Array.isArray(g("products")) ? (g("products") as Record<string, unknown>[]) : []).map((p) => {
    const vv = Array.isArray(p.variant_values) ? (p.variant_values as unknown[]).map(String).join(" / ") : "";
    const name = typeof p.name === "object" ? Object.values(p.name as Record<string, string>)[0] ?? "" : String(p.name ?? "");
    return {
      tn_variant_id: p.variant_id != null ? String(p.variant_id) : "",
      sku: p.sku != null ? String(p.sku).trim() : "",
      product_name: name,
      variant_label: vv,
      quantity: Number(p.quantity ?? 0),
      unit_price: p.price != null ? Number(p.price) : 0,
    };
  });
  return {
    tn_order_id: String(g("id")),
    tn_number: g("number") != null ? String(g("number")) : "",
    status: String(g("status") ?? "open") === "cancelled" ? "cancelled" : "open",
    paid: String(g("payment_status") ?? "") === "paid",
    total: Number(g("total") ?? 0),
    subtotal: Number(g("subtotal") ?? g("total") ?? 0),
    discount: Number(g("discount") ?? 0),
    buyer: {
      name: String((g("contact_name") as string) || (cust.name as string) || "").trim(),
      doc: String((g("contact_identification") as string) || "").trim(),
      phone: String((g("contact_phone") as string) || (ship.phone as string) || "").trim(),
      email: String((g("contact_email") as string) || (cust.email as string) || "").trim(),
      address: addressParts.join(", "),
    },
    items: products,
  };
}
