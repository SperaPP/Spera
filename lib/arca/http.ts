import "server-only";
import { Agent } from "undici";

// Algunos servidores de AFIP (ej. servicios1.afip.gov.ar / WSFE producción) negocian
// claves Diffie-Hellman de 1024 bits, que OpenSSL 3 (Node moderno, como el de Vercel)
// rechaza por defecto → ERR_SSL_DH_KEY_TOO_SMALL. Este dispatcher baja el nivel de
// seguridad TLS (@SECLEVEL=1) SOLO para las llamadas a AFIP: la conexión sigue cifrada
// por TLS; solo se admite su clave DH más corta. No afecta ninguna otra conexión del
// sistema (Supabase, Tiendanube, etc.), que siguen con la seguridad por defecto.
export const afipDispatcher = new Agent({ connect: { ciphers: "DEFAULT:@SECLEVEL=1" } });

// Para pasar `dispatcher` a fetch sin pelear con los tipos del DOM (undici lo lee en runtime).
export type AfipFetchInit = RequestInit & { dispatcher: Agent };
