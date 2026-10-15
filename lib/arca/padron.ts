import "server-only";
import { getAuthTicket } from "@/lib/arca/wsaa";
import { arcaConfig } from "@/lib/arca/config";

// Padrón A5 de ARCA (constancia de inscripción por CUIT). Devuelve la condición real
// frente al IVA del contribuyente, más razón social y domicilio. Sirve para no depender
// de lo tipeado a mano (evita emitir el comprobante equivocado). Servicio WSAA:
// 'ws_sr_padron_a5' (hay que autorizarlo al certificado, igual que wsfe).

const SERVICE = "ws_sr_padron_a5";
const NS = "http://a5.soap.ws.server.puc.sr/";

const pick = (xml: string, tag: string): string | null =>
  xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"))?.[1]?.trim() ?? null;

export type CondicionIva = "responsable_inscripto" | "monotributo" | "exento" | "consumidor_final";

export type PadronResult =
  | { ok: true; condicion: CondicionIva; razonSocial: string | null; domicilio: string | null }
  | { ok: false; error: string };

/** Consulta el padrón de AFIP por CUIT. Best-effort: devuelve ok:false con el motivo. */
export async function consultarPadron(orgId: string, cuit: string): Promise<PadronResult> {
  const digits = (cuit ?? "").replace(/\D/g, "");
  if (digits.length !== 11) return { ok: false, error: "El CUIT debe tener 11 dígitos." };

  const cfg = arcaConfig();
  let token: string, sign: string;
  try {
    ({ token, sign } = await getAuthTicket(orgId, SERVICE));
  } catch (e) {
    return { ok: false, error: `No se pudo autenticar el padrón: ${e instanceof Error ? e.message : String(e)}` };
  }

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="' + NS + '">',
    "  <soap:Body><a5:getPersona>",
    `    <token>${token}</token><sign>${sign}</sign>`,
    `    <cuitRepresentada>${cfg.cuit}</cuitRepresentada><idPersona>${digits}</idPersona>`,
    "  </a5:getPersona></soap:Body>",
    "</soap:Envelope>",
  ].join("\n");

  let text: string;
  try {
    const res = await fetch(cfg.padronUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
      body,
      signal: AbortSignal.timeout(20000),
    });
    text = await res.text();
    const fault = pick(text, "faultstring");
    if (!res.ok || fault) return { ok: false, error: `Padrón ${res.status}: ${fault ?? text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: `No se pudo consultar el padrón: ${e instanceof Error ? e.message : String(e)}` };
  }

  // A veces el padrón responde un "errorConstancia" / persona no encontrada.
  const errConst = pick(text, "error") || pick(text, "errorConstancia");
  if (errConst && !pick(text, "idPersona")) return { ok: false, error: errConst };

  // Condición IVA: monotributo tiene su propio bloque; régimen general se mira por impuestos.
  let condicion: CondicionIva;
  if (/<datosMonotributo>/i.test(text)) {
    condicion = "monotributo";
  } else {
    // Impuestos del régimen general: 30 = IVA (RI), 32 = IVA Exento.
    const tieneIva = /<idImpuesto>\s*30\s*<\/idImpuesto>/i.test(text);
    const tieneExento = /<idImpuesto>\s*32\s*<\/idImpuesto>/i.test(text);
    condicion = tieneIva ? "responsable_inscripto" : tieneExento ? "exento" : "consumidor_final";
  }

  // Razón social: persona jurídica → razonSocial; física → apellido + nombre.
  const razonSocial = pick(text, "razonSocial") ||
    [pick(text, "apellido"), pick(text, "nombre")].filter(Boolean).join(" ") || null;

  // Domicilio fiscal (primer bloque).
  const dir = pick(text, "direccion");
  const loc = pick(text, "localidad");
  const prov = pick(text, "descripcionProvincia");
  const cp = pick(text, "codPostal");
  const domicilio = [dir, loc, prov, cp ? `CP ${cp}` : null].filter(Boolean).join(", ") || null;

  return { ok: true, condicion, razonSocial, domicilio };
}
