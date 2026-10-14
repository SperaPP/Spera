import "server-only";
import { getAuthTicket } from "@/lib/arca/wsaa";
import { arcaConfig } from "@/lib/arca/config";

// WSFEv1 — Facturación Electrónica de ARCA/AFIP.
// Dos llamadas: FECompUltimoAutorizado (último número para PV+tipo) y FECAESolicitar
// (pide el CAE del comprobante). Todo con el TA de WSAA (getAuthTicket). SOAP sobre el
// endpoint del entorno (homologación/producción).

const NS = "http://ar.gov.afip.dif.FEV1/";

// pick/all toleran prefijo de namespace en la respuesta (<CbteNro> o <ns:CbteNro>).
const pick = (xml: string, tag: string): string | null =>
  xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`))?.[1]?.trim() ?? null;
function all(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g");
  const out: string[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

async function wsfeCall(method: string, innerXml: string): Promise<string> {
  const cfg = arcaConfig();
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="' + NS + '">',
    "  <soap:Body>",
    `    <ar:${method}>${innerXml}</ar:${method}>`,
    "  </soap:Body>",
    "</soap:Envelope>",
  ].join("\n");
  const res = await fetch(cfg.wsfeUrl, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${NS}${method}` },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const fault = pick(text, "faultstring");
  if (!res.ok || fault) throw new Error(`WSFE ${method} ${res.status}: ${fault ?? text.slice(0, 300)}`);
  return text;
}

function authXml(token: string, sign: string, cuit: string): string {
  return `<ar:Auth><ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
}

/** Mensajes de <Errors><Err><Code/><Msg/></Err></Errors> (errores de la solicitud). */
function requestErrors(xml: string): string[] {
  const errBlock = xml.match(/<(?:\w+:)?Errors>([\s\S]*?)<\/(?:\w+:)?Errors>/)?.[1];
  if (!errBlock) return [];
  return all(errBlock, "Msg").map((m) => m).filter(Boolean);
}
/** Observaciones del comprobante (<Observaciones><Obs><Code/><Msg/>). */
function obsMessages(xml: string): string[] {
  const obsBlock = xml.match(/<(?:\w+:)?Observaciones>([\s\S]*?)<\/(?:\w+:)?Observaciones>/)?.[1];
  if (!obsBlock) return [];
  return all(obsBlock, "Msg").filter(Boolean);
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
function yyyymmdd(d: Date): string {
  // Fecha local AR (UTC-3) para que CbteFch no se corra de día.
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 10).replace(/-/g, "");
}

export type EmitParams = {
  cbteTipo: number;   // 1=Factura A, 6=Factura B
  docTipo: number;    // 80=CUIT, 96=DNI, 99=consumidor final
  docNro: string;
  neto: number;       // sin IVA
  iva: number;        // importe de IVA
  total: number;      // neto + iva (lo que se cobró)
  ivaId: number;      // 5 = 21%
};
export type EmitResult =
  | { ok: true; cbteNro: number; cae: string; caeVto: string; cbteFch: string }
  | { ok: false; error: string; cbteNro?: number };

/** Pide el CAE de un comprobante. Reintenta una vez si el número ya estaba usado. */
export async function emitInvoice(orgId: string, p: EmitParams): Promise<EmitResult> {
  const cfg = arcaConfig();
  const { token, sign } = await getAuthTicket(orgId);
  const auth = authXml(token, sign, cfg.cuit);

  for (let attempt = 0; attempt < 2; attempt++) {
    const lastXml = await wsfeCall(
      "FECompUltimoAutorizado",
      `${auth}<ar:PtoVta>${cfg.ptoVenta}</ar:PtoVta><ar:CbteTipo>${p.cbteTipo}</ar:CbteTipo>`
    );
    const lastErr = requestErrors(lastXml);
    if (lastErr.length) return { ok: false, error: lastErr.join(" | ") };
    const nro = Number(pick(lastXml, "CbteNro") ?? "0") + 1;
    const fch = yyyymmdd(new Date());

    const det =
      `<ar:FeCAEReq>` +
      `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${cfg.ptoVenta}</ar:PtoVta><ar:CbteTipo>${p.cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
      `<ar:FeDetReq><ar:FECAEDetRequest>` +
      `<ar:Concepto>1</ar:Concepto>` +
      `<ar:DocTipo>${p.docTipo}</ar:DocTipo><ar:DocNro>${p.docNro}</ar:DocNro>` +
      `<ar:CbteDesde>${nro}</ar:CbteDesde><ar:CbteHasta>${nro}</ar:CbteHasta>` +
      `<ar:CbteFch>${fch}</ar:CbteFch>` +
      `<ar:ImpTotal>${f2(p.total)}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc>` +
      `<ar:ImpNeto>${f2(p.neto)}</ar:ImpNeto><ar:ImpOpEx>0</ar:ImpOpEx>` +
      `<ar:ImpIVA>${f2(p.iva)}</ar:ImpIVA><ar:ImpTrib>0</ar:ImpTrib>` +
      `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>` +
      `<ar:Iva><ar:AlicIva><ar:Id>${p.ivaId}</ar:Id><ar:BaseImp>${f2(p.neto)}</ar:BaseImp><ar:Importe>${f2(p.iva)}</ar:Importe></ar:AlicIva></ar:Iva>` +
      `</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`;

    const caeXml = await wsfeCall("FECAESolicitar", `${auth}${det}`);
    const reqErr = requestErrors(caeXml);
    if (reqErr.length) return { ok: false, error: reqErr.join(" | "), cbteNro: nro };

    const resultado = pick(caeXml, "Resultado"); // FeCabResp.Resultado (A/R/P)
    const cae = pick(caeXml, "CAE");
    const caeVto = pick(caeXml, "CAEFchVto");
    if (resultado === "A" && cae && caeVto) {
      return { ok: true, cbteNro: nro, cae, caeVto, cbteFch: fch };
    }

    const obs = obsMessages(caeXml);
    const yaUsado = obs.some((m) => /ya.*registrad|existe|10016/i.test(m));
    if (yaUsado && attempt === 0) continue; // otro comprobante tomó el número → reintentar
    return { ok: false, error: obs.length ? obs.join(" | ") : "ARCA rechazó el comprobante", cbteNro: nro };
  }
  return { ok: false, error: "No se pudo emitir (número en conflicto)" };
}
