"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { arcaConfig, arcaConfigured } from "@/lib/arca/config";
import { emitInvoice } from "@/lib/arca/wsfe";

const round2 = (n: number) => Math.round(n * 100) / 100;
// AFIP devuelve fechas YYYYMMDD → ISO YYYY-MM-DD para columnas date.
const toISO = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

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

  // Idempotencia: ¿ya tiene CAE en este entorno?
  const { data: prev } = await admin.from("arca_invoices")
    .select("cbte_nro, cae, cbte_tipo").eq("organization_id", org).eq("sale_id", saleId).eq("environment", cfg.env).maybeSingle();
  if (prev) return { ok: true, cae: prev.cae as string, nro: prev.cbte_nro as number, yaExistia: true };

  // Tipo de comprobante y documento del receptor.
  const cust = (Array.isArray(sale.customers) ? sale.customers[0] : sale.customers) as
    { fiscal_condition?: string; doc_type?: string | null; doc_digits?: string | null } | null;
  const cond = cust?.fiscal_condition ?? "consumidor_final";
  const docDigits = (cust?.doc_digits ?? (sale.customer_doc ?? "").replace(/\D/g, "")) || "";

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

  const r = await emitInvoice(org as string, { cbteTipo, docTipo, docNro, neto, iva, total, ivaId: 5 });
  if (!r.ok) return { ok: false, error: r.error };

  const { data: auth } = await sb.auth.getUser();
  const { error: insErr } = await admin.from("arca_invoices").insert({
    organization_id: org, sale_id: saleId, environment: cfg.env,
    cbte_tipo: cbteTipo, pto_vta: cfg.ptoVenta, cbte_nro: r.cbteNro,
    doc_tipo: docTipo, doc_nro: docNro, imp_neto: neto, imp_iva: iva, imp_total: total,
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
