"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { arcaConfig, arcaConfigured, arcaPadronConfigured } from "@/lib/arca/config";
import { emitInvoice } from "@/lib/arca/wsfe";
import { consultarPadron } from "@/lib/arca/padron";

const round2 = (n: number) => Math.round(n * 100) / 100;
// AFIP devuelve fechas YYYYMMDD → ISO YYYY-MM-DD para columnas date.
const toISO = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

const FACTURA_TIPOS = [1, 6, 11]; // A, B, C
const NC_DE: Record<number, number> = { 1: 3, 6: 8, 11: 13 }; // factura → su nota de crédito

/**
 * Factura una venta en ARCA: pide el CAE y lo guarda. Solo admin. Idempotente: si la
 * venta ya tiene CAE en este entorno, no vuelve a emitir. NO se dispara solo: únicamente
 * desde el botón "Facturar".
 */
export async function facturarVenta(saleId: string): Promise<{ ok: boolean; cae?: string; nro?: number; tipo?: string; error?: string; yaExistia?: boolean }> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied.error };
  if (!arcaConfigured()) return { ok: false, error: "ARCA no está configurado (certificado, clave, CUIT o punto de venta)." };

  const sb = await createClient();
  const { data: org } = await sb.rpc("current_org_id");
  if (!org) return { ok: false, error: "Sin organización." };
  const cfg = arcaConfig();
  const admin = createAdminClient();

  const { data: sale } = await admin
    .from("sales")
    .select("id, total, status, channel, customer_doc, customers(fiscal_condition, doc_type, doc_digits)")
    .eq("id", saleId).eq("organization_id", org).maybeSingle();
  if (!sale) return { ok: false, error: "Venta no encontrada." };
  if (sale.status !== "completada") return { ok: false, error: "La venta está anulada; no se puede facturar." };
  if (sale.channel === "cambio") return { ok: false, error: "Un cambio no se factura directamente." };
  const total = round2(Number(sale.total));
  if (total <= 0) return { ok: false, error: "La venta no tiene importe para facturar." };

  // Idempotencia: ¿ya tiene FACTURA en este entorno? (puede existir además una NC)
  const { data: prev } = await admin.from("arca_invoices")
    .select("cbte_nro, cae").eq("organization_id", org).eq("sale_id", saleId).eq("environment", cfg.env)
    .in("cbte_tipo", FACTURA_TIPOS).maybeSingle();
  if (prev) return { ok: true, cae: prev.cae as string, nro: prev.cbte_nro as number, yaExistia: true };

  // Tipo de comprobante y documento del receptor.
  const cust = (Array.isArray(sale.customers) ? sale.customers[0] : sale.customers) as
    { fiscal_condition?: string; doc_type?: string | null; doc_digits?: string | null } | null;
  let cond = cust?.fiscal_condition ?? "consumidor_final";
  const docDigits = (cust?.doc_digits ?? (sale.customer_doc ?? "").replace(/\D/g, "")) || "";

  // Si el padrón está habilitado y hay CUIT, confirmar la condición REAL contra AFIP (no
  // confiar en lo tipeado). Best-effort: si falla, se usa lo guardado. Si el padrón no
  // está configurado (ej. aún no se autorizó el servicio), se saltea sin costo.
  if (docDigits.length === 11 && arcaPadronConfigured()) {
    const p = await consultarPadron(org as string, docDigits);
    if (p.ok) cond = p.condicion;
  }

  // Condición IVA del receptor (RG 5616): 1 RI, 4 Exento, 5 Consumidor Final, 6 Monotributo.
  const IVA_RECEPTOR: Record<string, number> = {
    responsable_inscripto: 1, exento: 4, consumidor_final: 5, monotributo: 6,
  };
  const ivaReceptorId = IVA_RECEPTOR[cond] ?? 5;

  let cbteTipo: number, docTipo: number, docNro: string, tipoLabel: string;
  if (cond === "responsable_inscripto" && docDigits.length >= 11) {
    cbteTipo = 1; docTipo = 80; docNro = docDigits; tipoLabel = "Factura A"; // a RI, con CUIT
  } else {
    cbteTipo = 6; tipoLabel = "Factura B";
    if (docDigits.length === 11) { docTipo = 80; docNro = docDigits; }          // CUIT
    else if (docDigits.length >= 7) { docTipo = 96; docNro = docDigits; }       // DNI
    else { docTipo = 99; docNro = "0"; }                                        // consumidor final
  }

  // Precios con IVA incluido (21%): se separa neto + IVA. iva = total - neto → neto+iva = total exacto.
  const neto = round2(total / 1.21);
  const iva = round2(total - neto);

  let r;
  try {
    r = await emitInvoice(org as string, { cbteTipo, docTipo, docNro, neto, iva, total, ivaId: 5, ivaReceptorId });
  } catch (e) {
    return { ok: false, error: `ARCA no respondió o dio un error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!r.ok) return { ok: false, error: r.error };

  const { data: auth } = await sb.auth.getUser();
  const { error: insErr } = await admin.from("arca_invoices").insert({
    organization_id: org, sale_id: saleId, environment: cfg.env,
    cbte_tipo: cbteTipo, pto_vta: cfg.ptoVenta, cbte_nro: r.cbteNro,
    doc_tipo: docTipo, doc_nro: docNro, imp_neto: neto, imp_iva: iva, imp_total: total,
    iva_receptor_id: ivaReceptorId,
    cae: r.cae, cae_vto: toISO(r.caeVto), cbte_fch: toISO(r.cbteFch),
    created_by: auth?.user?.id ?? null,
  });
  if (insErr) {
    // El CAE SÍ se emitió en ARCA; avisamos para registrarlo a mano si hizo falta.
    return { ok: false, error: `Se emitió el CAE ${r.cae} (comprobante ${r.cbteNro}) pero falló el guardado local: ${insErr.message}` };
  }

  revalidatePath(`/ventas/${saleId}`);
  return { ok: true, cae: r.cae, nro: r.cbteNro, tipo: tipoLabel };
}

/**
 * Emite una NOTA DE CRÉDITO que anula por completo la factura de una venta (tipo 3 si
 * era Factura A, 8 si era B), asociada al comprobante original. Solo admin, idempotente
 * (si ya hay NC, la devuelve). Nunca automática. NO toca stock ni cuenta corriente: es
 * solo el comprobante fiscal que revierte la factura.
 */
export async function emitirNotaCredito(saleId: string): Promise<{ ok: boolean; cae?: string; nro?: number; tipo?: string; error?: string; yaExistia?: boolean }> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied.error };
  if (!arcaConfigured()) return { ok: false, error: "ARCA no está configurado." };

  const sb = await createClient();
  const { data: org } = await sb.rpc("current_org_id");
  if (!org) return { ok: false, error: "Sin organización." };
  const cfg = arcaConfig();
  const admin = createAdminClient();

  // Factura original de la venta (en este entorno).
  const { data: factura } = await admin.from("arca_invoices")
    .select("id, cbte_tipo, doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, iva_receptor_id, pto_vta, cbte_nro")
    .eq("organization_id", org).eq("sale_id", saleId).eq("environment", cfg.env)
    .in("cbte_tipo", FACTURA_TIPOS).maybeSingle();
  if (!factura) return { ok: false, error: "La venta no tiene factura emitida para anular." };

  const ncTipo = NC_DE[factura.cbte_tipo as number];
  if (!ncTipo) return { ok: false, error: "Tipo de comprobante sin nota de crédito definida." };

  // Idempotencia: ¿ya hay una NC asociada a esta factura?
  const { data: prevNc } = await admin.from("arca_invoices")
    .select("cbte_nro, cae").eq("organization_id", org).eq("environment", cfg.env)
    .eq("asociado_a", factura.id as string).maybeSingle();
  if (prevNc) return { ok: true, cae: prevNc.cae as string, nro: prevNc.cbte_nro as number, yaExistia: true };

  const neto = Number(factura.imp_neto), iva = Number(factura.imp_iva), total = Number(factura.imp_total);
  let r;
  try {
    r = await emitInvoice(org as string, {
      cbteTipo: ncTipo,
      docTipo: factura.doc_tipo as number,
      docNro: factura.doc_nro as string,
      neto, iva, total, ivaId: 5,
      ivaReceptorId: (factura.iva_receptor_id as number) ?? 5,
      asociados: [{ tipo: factura.cbte_tipo as number, ptoVta: factura.pto_vta as number, nro: factura.cbte_nro as number }],
    });
  } catch (e) {
    return { ok: false, error: `ARCA no respondió o dio un error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!r.ok) return { ok: false, error: r.error };

  const { data: auth } = await sb.auth.getUser();
  const { error: insErr } = await admin.from("arca_invoices").insert({
    organization_id: org, sale_id: saleId, environment: cfg.env,
    cbte_tipo: ncTipo, pto_vta: cfg.ptoVenta, cbte_nro: r.cbteNro,
    doc_tipo: factura.doc_tipo, doc_nro: factura.doc_nro, imp_neto: neto, imp_iva: iva, imp_total: total,
    iva_receptor_id: factura.iva_receptor_id, asociado_a: factura.id,
    cae: r.cae, cae_vto: toISO(r.caeVto), cbte_fch: toISO(r.cbteFch),
    created_by: auth?.user?.id ?? null,
  });
  if (insErr) return { ok: false, error: `Se emitió el CAE ${r.cae} (NC ${r.cbteNro}) pero falló el guardado local: ${insErr.message}` };

  revalidatePath(`/ventas/${saleId}`);
  return { ok: true, cae: r.cae, nro: r.cbteNro, tipo: ncTipo === 3 ? "Nota de Crédito A" : "Nota de Crédito B" };
}
