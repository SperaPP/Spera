"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { getTNCreds, fetchTNProducts, fetchStoreName } from "@/lib/tiendanube";

export type Analisis = {
  storeName: string | null;
  tn: { productos: number; variantes: number; conSku: number; sinSku: number; publicados: number; ocultos: number; skuDuplicados: number };
  cruce: { enAmbos: number; soloTN: number; soloSpera: number };
  publicables: { total: number; yaEnTN: number; nuevos: number };
  precios: { conDiferencia: number; ejemplos: { sku: string; tn: number; spera: number }[] };
};

type Resp = { ok: true; data: Analisis } | { ok: false; error: string };

export async function analizarTiendanube(): Promise<Resp> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied.error ?? "No autorizado" };

  const sb = await createClient();
  const { data: org } = await sb.rpc("current_org_id");
  if (!org) return { ok: false, error: "Sin organización" };

  const creds = await getTNCreds(org as string);
  if (!creds) return { ok: false, error: "Tiendanube no está conectado todavía." };

  let tnProducts;
  try {
    tnProducts = await fetchTNProducts(creds);
  } catch (e) {
    return { ok: false, error: `Error leyendo Tiendanube: ${e instanceof Error ? e.message : String(e)}` };
  }
  const storeName = await fetchStoreName(creds).catch(() => null);

  // ── Lado Tiendanube ────────────────────────────────────────
  const tnVars = tnProducts.flatMap((p) => p.variants);
  const tnWithSku = tnVars.filter((v) => v.sku);
  const tnBySku = new Map<string, (typeof tnVars)[number]>();
  const skuSeen = new Map<string, number>();
  for (const v of tnWithSku) {
    const k = v.sku!.toLowerCase();
    skuSeen.set(k, (skuSeen.get(k) ?? 0) + 1);
    if (!tnBySku.has(k)) tnBySku.set(k, v);
  }
  const skuDuplicados = [...skuSeen.values()].filter((n) => n > 1).length;

  // ── Lado Spera (service-role, scopeo manual por org) ───────
  const admin = createAdminClient();

  const { data: pl } = await admin.from("price_lists").select("id").eq("organization_id", org).eq("name", "Publico").maybeSingle();
  const publicoId = pl?.id ?? null;

  const precioByProduct = new Map<string, number>();
  if (publicoId) {
    for (let from = 0; ; from += 1000) {
      const { data } = await admin.from("price_list_items").select("product_id, price").eq("price_list_id", publicoId).is("variant_id", null).range(from, from + 999);
      if (!data || !data.length) break;
      for (const r of data) precioByProduct.set(r.product_id as string, Number(r.price));
      if (data.length < 1000) break;
    }
  }

  const prodInfo = new Map<string, { actual: boolean; active: boolean }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("products").select("id, lifecycle, active").eq("organization_id", org).range(from, from + 999);
    if (!data || !data.length) break;
    for (const r of data) prodInfo.set(r.id as string, { actual: r.lifecycle === "actual", active: !!r.active });
    if (data.length < 1000) break;
  }

  const speraVars: { id: string; sku: string | null; productId: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("product_variants").select("id, sku, product_id").eq("organization_id", org).range(from, from + 999);
    if (!data || !data.length) break;
    for (const r of data) {
      if (!prodInfo.has(r.product_id as string)) continue; // otra org
      speraVars.push({ id: r.id as string, sku: r.sku ? String(r.sku).trim() : null, productId: r.product_id as string });
    }
    if (data.length < 1000) break;
  }

  const speraBySku = new Map<string, (typeof speraVars)[number]>();
  for (const v of speraVars) {
    if (v.sku) { const k = v.sku.toLowerCase(); if (!speraBySku.has(k)) speraBySku.set(k, v); }
  }

  // ── Cruce por SKU ──────────────────────────────────────────
  const matched = tnWithSku.filter((v) => speraBySku.has(v.sku!.toLowerCase()));
  const enAmbos = matched.length;
  const soloTN = tnVars.length - enAmbos; // incluye variantes de TN sin SKU
  const speraConSkuEnTN = speraVars.filter((v) => v.sku && tnBySku.has(v.sku.toLowerCase())).length;
  const soloSpera = speraVars.filter((v) => v.sku).length - speraConSkuEnTN;

  // Publicables por Spera: producto actual + activo + con precio Publico.
  const publicables = speraVars.filter((v) => {
    const pi = prodInfo.get(v.productId);
    return pi?.actual && pi?.active && precioByProduct.has(v.productId);
  });
  const pubYaEnTN = publicables.filter((v) => v.sku && tnBySku.has(v.sku.toLowerCase())).length;

  // ── Diferencias de precio en los que cruzan ────────────────
  let conDiferencia = 0;
  const ejemplos: { sku: string; tn: number; spera: number }[] = [];
  for (const v of matched) {
    const sv = speraBySku.get(v.sku!.toLowerCase())!;
    const pub = precioByProduct.get(sv.productId);
    if (pub != null && v.price != null && Math.abs(pub - v.price) > 0.5) {
      conDiferencia++;
      if (ejemplos.length < 10) ejemplos.push({ sku: v.sku!, tn: v.price, spera: pub });
    }
  }

  return {
    ok: true,
    data: {
      storeName,
      tn: {
        productos: tnProducts.length,
        variantes: tnVars.length,
        conSku: tnWithSku.length,
        sinSku: tnVars.length - tnWithSku.length,
        publicados: tnProducts.filter((p) => p.published).length,
        ocultos: tnProducts.filter((p) => !p.published).length,
        skuDuplicados,
      },
      cruce: { enAmbos, soloTN, soloSpera },
      publicables: { total: publicables.length, yaEnTN: pubYaEnTN, nuevos: publicables.length - pubYaEnTN },
      precios: { conDiferencia, ejemplos },
    },
  };
}
