import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getStoreScope } from "@/lib/auth";
import { arcaConfig, arcaEmisor } from "@/lib/arca/config";
import { ComprobanteArca, type ComprobanteData } from "@/components/comprobante-arca";

const LETRA: Record<number, string> = { 1: "A", 2: "A", 3: "A", 6: "B", 7: "B", 8: "B" };
const COND_RECEPTOR: Record<string, string> = {
  responsable_inscripto: "IVA Responsable Inscripto",
  monotributo: "Responsable Monotributo",
  exento: "IVA Sujeto Exento",
  consumidor_final: "Consumidor Final",
};
const DOC_LABEL: Record<number, string> = { 80: "CUIT", 86: "CUIL", 96: "DNI", 99: "Doc." };
const TITULO: Record<number, string> = { 1: "FACTURA", 6: "FACTURA", 2: "NOTA DE DÉBITO", 7: "NOTA DE DÉBITO", 3: "NOTA DE CRÉDITO", 8: "NOTA DE CRÉDITO" };

function relFiscal(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { fiscal_condition: string } | null)?.fiscal_condition ?? null;
}

export default async function ComprobantePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc } = await searchParams;
  const sb = await createClient();

  const { data: sale } = await sb
    .from("sales")
    .select("id, store_id, customer_name, customer_doc, customer_address, customers(fiscal_condition), sale_items(product_name, variant_label, quantity, unit_price, line_total)")
    .eq("id", id).single();
  if (!sale) notFound();

  const { storeId: scopeStore } = await getStoreScope();
  if (scopeStore && sale.store_id !== scopeStore) notFound();

  const env = arcaConfig().env;
  const cols = "cbte_tipo, pto_vta, cbte_nro, doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cae, cae_vto, cbte_fch";
  const base = sb.from("arca_invoices").select(cols).eq("sale_id", id).eq("environment", env);
  // ?doc=<id> elige un comprobante puntual (ej. la nota de crédito); por defecto, la factura.
  const { data: inv } = doc
    ? await base.eq("id", doc).maybeSingle()
    : await base.in("cbte_tipo", [1, 6, 11]).maybeSingle();
  if (!inv) notFound(); // la venta todavía no se facturó en este entorno

  const emisor = arcaEmisor();

  // Payload del QR de ARCA (base64 de un JSON) → URL oficial de verificación.
  const qrPayload = {
    ver: 1,
    fecha: inv.cbte_fch as string,
    cuit: Number(emisor.cuit),
    ptoVta: inv.pto_vta as number,
    tipoCmp: inv.cbte_tipo as number,
    nroCmp: inv.cbte_nro as number,
    importe: Number(inv.imp_total),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: inv.doc_tipo as number,
    nroDocRec: Number(inv.doc_nro) || 0,
    tipoCodAut: "E",
    codAut: Number(inv.cae),
  };
  const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(qrPayload)).toString("base64")}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 256 });

  const cond = relFiscal(sale.customers);
  const data: ComprobanteData = {
    saleId: sale.id,
    emisor,
    receptor: {
      nombre: sale.customer_name ?? "",
      docLabel: DOC_LABEL[inv.doc_tipo as number] ?? "Doc.",
      doc: (inv.doc_tipo as number) === 99 ? "" : (sale.customer_doc ?? String(inv.doc_nro)),
      condicionIva: COND_RECEPTOR[cond ?? ""] ?? ((inv.cbte_tipo as number) === 1 ? "IVA Responsable Inscripto" : "Consumidor Final"),
      domicilio: sale.customer_address ?? "",
    },
    letra: LETRA[inv.cbte_tipo as number] ?? "B",
    codigo: String(inv.cbte_tipo).padStart(2, "0"),
    titulo: TITULO[inv.cbte_tipo as number] ?? "FACTURA",
    ptoVta: inv.pto_vta as number,
    nro: inv.cbte_nro as number,
    fecha: inv.cbte_fch as string,
    items: (sale.sale_items ?? []) as ComprobanteData["items"],
    neto: Number(inv.imp_neto),
    iva: Number(inv.imp_iva),
    total: Number(inv.imp_total),
    cae: inv.cae as string,
    caeVto: inv.cae_vto as string,
    qrDataUrl,
    homologacion: env !== "produccion",
  };

  return <ComprobanteArca c={data} />;
}
