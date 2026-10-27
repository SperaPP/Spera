"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { fetchTNProducts, repairTNLinks, type TNProductLite } from "@/lib/tiendanube";
import { centralWarehouseId } from "@/lib/portal-catalog";
import { buildCtx, createInTN, reconcileExisting, matchCatalog, pageAll, type ItemResult } from "@/lib/tiendanube-sync";

// Sincronización masiva Spera → Tiendanube, en dos pasos:
//  1) "preparar": arma la lista de trabajo (qué producto de Spera va con qué producto de TN)
//     leyendo el catálogo vivo de TN. Solo lectura (salvo la reparación por SKU en Conciliar).
//  2) "lote": procesa de a pocos productos por llamada (el navegador va llamando en loop),
//     para no pasar el tiempo máximo de una función en Vercel.

export type WorkItem = { productId: string; name: string; tnProductId: string | null; how: "sku" | "nombre" | "nuevo" };
const BATCH = 3;
// Con menos de esto de presupuesto no se arranca otro producto (crear + fotos tarda).
const MIN_LEFT_MS = 18_000;
const UUID = /^[0-9a-f-]{36}$/i;

async function orgOrError(): Promise<{ org: string } | { error: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied.error ?? "No autorizado" };
  const sb = await createClient();
  const { data: org } = await sb.rpc("current_org_id");
  if (!org) return { error: "Sin organización" };
  return { org: org as string };
}

// ── SALE: los productos en oferta del portal → Tiendanube ───────────────────────

/** Lista de trabajo SALE: exactamente los productos que el portal muestra como "Sale"
 *  (activos, visibles en el portal, con stock en Central y promo Mayorista < precio). */
export async function prepararSaleTN(): Promise<{ ok: true; items: WorkItem[] } | { ok: false; error: string }> {
  const o = await orgOrError();
  if ("error" in o) return { ok: false, error: o.error };
  const admin = createAdminClient();
  const { data: may } = await admin.from("price_lists").select("id").eq("organization_id", o.org).eq("name", "Mayorista").maybeSingle();
  const wh = await centralWarehouseId();
  if (!may || !wh) return { ok: false, error: "Falta la lista Mayorista o el depósito Central" };

  const rows = await pageAll<{ id: string; name: string; price: number; promo: number | null }>((f) =>
    admin.rpc("portal_catalog_all", { p_org: o.org, p_list: may.id, p_warehouse: wh }).range(f, f + 999));
  const sale = rows.filter((r) => r.promo != null && Number(r.promo) < Number(r.price));

  const ctx = await buildCtx(o.org);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  let catalog: TNProductLite[];
  try { catalog = await fetchTNProducts(ctx.creds); } catch { return { ok: false, error: "No se pudo leer el catálogo de Tiendanube" }; }
  const { tnToSp } = await matchCatalog(admin, o.org, catalog);
  const spToTn = new Map<string, { tn: string; how: "sku" | "nombre" }>();
  for (const [tn, m] of tnToSp) if (!spToTn.has(m.sp)) spToTn.set(m.sp, { tn, how: m.how });

  return {
    ok: true,
    items: sale.map((r) => {
      const m = spToTn.get(r.id);
      return { productId: r.id, name: r.name, tnProductId: m?.tn ?? null, how: m ? m.how : "nuevo" };
    }),
  };
}

/** Procesa un lote SALE: los que existen se concilian con precio SALE (sin tocar su
 *  visibilidad); los que no existen se crean OCULTOS en la categoría SALE. */
export async function syncSaleTNLote(items: WorkItem[]): Promise<{ ok: true; results: ItemResult[] } | { ok: false; error: string }> {
  const o = await orgOrError();
  if ("error" in o) return { ok: false, error: o.error };
  const lote = (items ?? []).slice(0, BATCH);
  const ctx = await buildCtx(o.org);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  // Devuelve SOLO los que procesó (el navegador avanza según results.length): si se acaba el
  // tiempo, los que faltan van en la próxima llamada en vez de cortarse a la mitad.
  const results: ItemResult[] = [];
  for (const it of lote) {
    if (results.length > 0 && ctx.deadline - Date.now() < MIN_LEFT_MS) break;
    if (!UUID.test(it.productId) || (it.tnProductId != null && !/^\d+$/.test(it.tnProductId))) {
      results.push({ productId: it.productId, name: it.name, action: "error", notas: ["Dato inválido"] }); continue;
    }
    try {
      results.push(it.tnProductId
        ? await reconcileExisting(ctx, it.productId, it.tnProductId, { sale: true })
        : await createInTN(ctx, it.productId, { published: false, sale: true }));
    } catch (e) {
      results.push({ productId: it.productId, name: it.name, action: "error", notas: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return { ok: true, results };
}

// ── Conciliar el catálogo completo (productos que ya están en TN) ───────────────

/** Lista de trabajo de Conciliación: primero repara vínculos por SKU, después empareja
 *  cada producto de TN con su producto de Spera (SKU o nombre único). Devuelve también
 *  los productos de TN sin pareja, para revisarlos a mano. */
export async function prepararConciliacionTN(): Promise<{ ok: true; items: WorkItem[]; sinPareja: string[] } | { ok: false; error: string }> {
  const o = await orgOrError();
  if ("error" in o) return { ok: false, error: o.error };
  const rep = await repairTNLinks(o.org);
  if (!rep.ok) return { ok: false, error: rep.error ?? "No se pudieron reparar los vínculos" };
  const ctx = await buildCtx(o.org);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  let catalog: TNProductLite[];
  try { catalog = await fetchTNProducts(ctx.creds); } catch { return { ok: false, error: "No se pudo leer el catálogo de Tiendanube" }; }
  const admin = createAdminClient();
  const { tnToSp, nameById } = await matchCatalog(admin, o.org, catalog);
  const items: WorkItem[] = [];
  const sinPareja: string[] = [];
  for (const t of catalog) {
    const m = tnToSp.get(t.id);
    if (m) items.push({ productId: m.sp, name: nameById.get(m.sp) ?? t.name, tnProductId: t.id, how: m.how });
    else sinPareja.push(t.name);
  }
  return { ok: true, items, sinPareja };
}

/** Procesa un lote de Conciliación: vincula, completa talles/colores, escribe SKU y agrega
 *  fotos faltantes. NO toca precios ni visibilidad. */
export async function conciliarTNLote(items: WorkItem[], crearSinStock = false): Promise<{ ok: true; results: ItemResult[] } | { ok: false; error: string }> {
  const o = await orgOrError();
  if ("error" in o) return { ok: false, error: o.error };
  const lote = (items ?? []).slice(0, BATCH);
  const ctx = await buildCtx(o.org);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const results: ItemResult[] = [];
  for (const it of lote) {
    if (results.length > 0 && ctx.deadline - Date.now() < MIN_LEFT_MS) break;
    if (!UUID.test(it.productId) || !it.tnProductId || !/^\d+$/.test(it.tnProductId)) {
      results.push({ productId: it.productId, name: it.name, action: "error", notas: ["Dato inválido"] }); continue;
    }
    try {
      results.push(await reconcileExisting(ctx, it.productId, it.tnProductId!, { sale: false, crearSinStock: crearSinStock === true }));
    } catch (e) {
      results.push({ productId: it.productId, name: it.name, action: "error", notas: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return { ok: true, results };
}
