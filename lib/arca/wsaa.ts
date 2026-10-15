import "server-only";
import forge from "node-forge";
import { createAdminClient } from "@/lib/supabase/admin";
import { arcaConfig, arcaConfigured } from "@/lib/arca/config";

// WSAA — Web Service de Autenticación y Autorización de ARCA/AFIP.
// Flujo: armamos un TRA (ticket de requerimiento), lo firmamos como CMS/PKCS#7 con el
// certificado + clave (firma LOCAL, la clave no sale del server), lo mandamos a WSAA por
// SOAP y recibimos un TA (token + sign) válido ~12h. El TA se cachea en Supabase y se
// reusa hasta cerca del vencimiento (WSAA no deja pedir otro mientras uno siga vigente).

/** TRA: XML del pedido de acceso para un servicio (wsfe). */
function buildTRA(service: string): string {
  const now = Date.now();
  const gen = new Date(now - 60_000); // 1 min atrás (tolerancia de reloj)
  const exp = new Date(now + 10 * 60_000); // vence en 10 min (el TA que devuelve dura ~12h)
  const uniqueId = Math.floor(now / 1000);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    "  <header>",
    `    <uniqueId>${uniqueId}</uniqueId>`,
    `    <generationTime>${gen.toISOString()}</generationTime>`,
    `    <expirationTime>${exp.toISOString()}</expirationTime>`,
    "  </header>",
    `  <service>${service}</service>`,
    "</loginTicketRequest>",
  ].join("\n");
}

/** Firma el TRA como CMS/PKCS#7 (contenido embebido) y lo devuelve en base64 (DER). */
function signTRA(tra: string, certPem: string, keyPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key: key as forge.pki.rsa.PrivateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toString() },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
const pick = (xml: string, tag: string): string | null =>
  xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? null;

type TA = { token: string; sign: string; generationTime: string; expirationTime: string };

/** Manda el CMS firmado a WSAA (SOAP) y parsea el token/sign del TA. */
async function callLoginCms(cmsB64: string, url: string): Promise<TA> {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
    "  <soapenv:Header/>",
    "  <soapenv:Body>",
    "    <wsaa:loginCms>",
    `      <wsaa:in0>${cmsB64}</wsaa:in0>`,
    "    </wsaa:loginCms>",
    "  </soapenv:Body>",
    "</soapenv:Envelope>",
  ].join("\n");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const fault = pick(text, "faultstring");
  if (!res.ok || fault) throw new Error(`WSAA ${res.status}: ${fault ?? text.slice(0, 300)}`);

  const ret = pick(text, "loginCmsReturn");
  if (!ret) throw new Error(`WSAA: respuesta sin loginCmsReturn (${text.slice(0, 300)})`);
  const xml = unescapeXml(ret);
  const token = pick(xml, "token");
  const sign = pick(xml, "sign");
  const expirationTime = pick(xml, "expirationTime");
  const generationTime = pick(xml, "generationTime");
  if (!token || !sign || !expirationTime) throw new Error("WSAA: TA sin token/sign/expiración");
  return { token, sign, generationTime: generationTime ?? new Date().toISOString(), expirationTime };
}

/**
 * Devuelve un TA válido (token + sign) para WSFE, reusando el cacheado si todavía no
 * vence (margen de 10 min). Si no hay o venció, pide uno nuevo a WSAA y lo guarda.
 */
export async function getAuthTicket(orgId: string, service = "wsfe"): Promise<{ token: string; sign: string }> {
  if (!arcaConfigured()) throw new Error("ARCA no está configurado (faltan certificado, clave, CUIT o punto de venta).");
  const cfg = arcaConfig();
  const admin = createAdminClient();

  const { data: cached } = await admin
    .from("arca_auth_tickets")
    .select("token, sign, expiration_time")
    .eq("organization_id", orgId).eq("service", service).eq("environment", cfg.env)
    .maybeSingle();

  if (cached && new Date(cached.expiration_time as string).getTime() - Date.now() > 10 * 60_000) {
    return { token: cached.token as string, sign: cached.sign as string };
  }

  const cms = signTRA(buildTRA(service), cfg.cert, cfg.key);
  const ta = await callLoginCms(cms, cfg.wsaaUrl);

  await admin.from("arca_auth_tickets").upsert(
    {
      organization_id: orgId, service, environment: cfg.env,
      token: ta.token, sign: ta.sign,
      generation_time: ta.generationTime, expiration_time: ta.expirationTime,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,service,environment" }
  );
  return { token: ta.token, sign: ta.sign };
}

/** Prueba de conexión: fuerza obtener un TA y devuelve hasta cuándo es válido. */
export async function probeWSAA(orgId: string): Promise<{ ok: boolean; env: string; expira?: string; error?: string }> {
  const cfg = arcaConfig();
  try {
    await getAuthTicket(orgId);
    const admin = createAdminClient();
    const { data } = await admin.from("arca_auth_tickets")
      .select("expiration_time").eq("organization_id", orgId).eq("service", "wsfe").eq("environment", cfg.env).maybeSingle();
    return { ok: true, env: cfg.env, expira: data?.expiration_time as string | undefined };
  } catch (e) {
    return { ok: false, env: cfg.env, error: e instanceof Error ? e.message : String(e) };
  }
}
