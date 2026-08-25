// Cliente de la API de Tiendanube (Nuvemshop). Solo server-side.
// API versionada por fecha: https://api.tiendanube.com/2025-03/{store_id}
// Auth: header "Authorization: Bearer TOKEN" + "User-Agent" obligatorio.
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

async function tnFetch(creds: TNCreds, path: string, init?: RequestInit) {
  return fetch(`${API}/${creds.storeId}${path}`, {
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
    const res: Response = await fetch(url, {
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
