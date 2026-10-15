import "server-only";

// Configuración del conector ARCA/AFIP. Todo sale de variables de entorno; el
// certificado y la clave NUNCA se commitean ni se loguean (son secrets de Vercel).
//
// Variables esperadas:
//   ARCA_ENV        'homologacion' (default) | 'produccion'
//   ARCA_CUIT       CUIT del emisor (con o sin guiones; se normaliza a dígitos)
//   ARCA_PTO_VENTA  Punto de venta habilitado para Web Services (ej. 45)
//   ARCA_CERT       Certificado .pem (contenido completo, multilínea)
//   ARCA_KEY        Clave privada .pem (contenido completo, multilínea) — SECRETO
//
// Entorno de HOMOLOGACIÓN hasta validar; recién ahí se cambia el cert y ARCA_ENV.

export type ArcaEnv = "homologacion" | "produccion";

export function arcaEnv(): ArcaEnv {
  return process.env.ARCA_ENV === "produccion" ? "produccion" : "homologacion";
}

// Normaliza un PEM que viene de una env var: tolera \r\n y \n literales (algunos
// paneles escapan los saltos de línea al pegar).
function normalizePem(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  return s.includes("\\n") && !s.includes("\n") ? s.replace(/\\n/g, "\n") : s;
}

// Padrón: el servicio disponible varía por contribuyente (a4, a5, a13...). Se configura
// con ARCA_PADRON_SERVICE (ej. 'ws_sr_padron_a5'). Vacío = padrón DESHABILITADO (la
// facturación no depende de él; la condición del cliente se usa de lo cargado a mano).
function padronAlcance(service: string): string {
  return service.match(/_a(\d+)$/)?.[1] ?? "";
}

export function arcaConfig() {
  const env = arcaEnv();
  const padronService = (process.env.ARCA_PADRON_SERVICE ?? "").trim();
  const alc = padronAlcance(padronService);
  return {
    env,
    cuit: (process.env.ARCA_CUIT ?? "").replace(/\D/g, ""),
    ptoVenta: Number(process.env.ARCA_PTO_VENTA ?? "0"),
    cert: normalizePem(process.env.ARCA_CERT ?? ""),
    key: normalizePem(process.env.ARCA_KEY ?? ""),
    wsaaUrl:
      env === "produccion"
        ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
        : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfeUrl:
      env === "produccion"
        ? "https://servicios1.afip.gov.ar/wsfev1/service.asmx"
        : "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
    // Padrón (consulta de condición por CUIT). Servicio y endpoint se derivan del alcance.
    padronService,
    padronAlcance: alc,
    padronUrl: alc
      ? `https://${env === "produccion" ? "aws" : "awshomo"}.afip.gov.ar/sr-padron/webservices/personaServiceA${alc}`
      : "",
  };
}

export function arcaConfigured(): boolean {
  const c = arcaConfig();
  return Boolean(c.cuit && c.ptoVenta > 0 && c.cert && c.key);
}

/** El padrón está habilitado solo si se configuró ARCA_PADRON_SERVICE. */
export function arcaPadronConfigured(): boolean {
  return Boolean(arcaConfig().padronAlcance);
}

// Datos fiscales del emisor para el comprobante impreso. Lo conocido (constancia) va
// por default; IIBB e inicio de actividades son opcionales por env hasta tenerlos.
export function arcaEmisor() {
  return {
    razonSocial: process.env.ARCA_RAZON_SOCIAL || "MASTRONARDI NICOLAS",
    nombreFantasia: process.env.ARCA_NOMBRE_FANTASIA || "BODY SCULPT",
    cuit: arcaConfig().cuit,
    domicilio: process.env.ARCA_DOMICILIO || "Saladillo 2527 - CP 1440 - CABA",
    condicionIva: process.env.ARCA_COND_IVA || "IVA Responsable Inscripto",
    iibb: process.env.ARCA_IIBB || "20-37808641-9",
    inicioActividades: process.env.ARCA_INICIO_ACT || "27/01/2012",
  };
}
