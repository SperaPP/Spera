import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Webhooks de privacidad obligatorios de Tiendanube (cumplimiento de datos):
//   store-redact / customers-redact / customers-data-request
// TN firma el body con HMAC-SHA256 usando el Client Secret de la app (header
// x-linkedstore-hmac-sha256, base64). Verificamos la firma y respondemos 200.
// store-redact además limpia la conexión guardada de esa tienda.
const SECRET = process.env.TIENDANUBE_CLIENT_SECRET ?? "";

export async function POST(request: Request, ctx: { params: Promise<{ topic: string }> }) {
  const { topic } = await ctx.params;
  const raw = await request.text();

  // Sin secreto configurado no se puede verificar la firma → rechazar (un HMAC con
  // clave vacía sería forjable).
  if (!SECRET) return new NextResponse("no configurado", { status: 503 });

  // Verificación HMAC.
  const sig = request.headers.get("x-linkedstore-hmac-sha256") ?? "";
  const expected = crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("base64");
  const valid =
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) return new NextResponse("firma inválida", { status: 401 });

  // store-redact: TN pide borrar los datos de la tienda que desinstaló → soltamos
  // el token y los links guardados de ese store.
  if (topic === "store-redact") {
    try {
      const body = JSON.parse(raw) as { store_id?: number | string };
      const storeId = body.store_id != null ? String(body.store_id) : null;
      if (storeId) {
        const admin = createAdminClient();
        await admin.from("tiendanube_credentials").delete().eq("store_id", storeId);
      }
    } catch {
      /* body no-JSON: igual respondemos 200 (ya validamos la firma) */
    }
  }
  // customers-redact / customers-data-request: no guardamos PII de compradores de
  // TN más allá del snapshot de cada pedido; reconocemos el aviso.

  return NextResponse.json({ ok: true });
}
