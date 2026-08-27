import { NextResponse, after } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTNOrder, normalizeTNOrder, syncTNStockOnce } from "@/lib/tiendanube";

// Webhooks de Tiendanube. TN firma el body con HMAC-SHA256 usando el Client Secret
// de la app (header x-linkedstore-hmac-sha256, base64). Verificamos SIEMPRE la firma.
//
// Eventos que procesamos:
//   · order/* (created, paid, cancelled, updated…) → ingesta del pedido a Spera.
//   · store-redact → soltamos el token guardado de esa tienda (privacidad).
//   · customers-redact / customers-data-request → solo acuse (no guardamos PII extra).
const SECRET = process.env.TIENDANUBE_CLIENT_SECRET ?? "";

export async function POST(request: Request, ctx: { params: Promise<{ topic: string }> }) {
  const { topic } = await ctx.params;
  const raw = await request.text();

  // Sin secreto no se puede verificar la firma → rechazar (un HMAC con clave vacía
  // sería forjable).
  if (!SECRET) return new NextResponse("no configurado", { status: 503 });

  const sig = request.headers.get("x-linkedstore-hmac-sha256") ?? "";
  const expected = crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("base64");
  const valid =
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) return new NextResponse("firma inválida", { status: 401 });

  let body: { store_id?: number | string; event?: string; id?: number | string };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // body no-JSON: firma válida, acusamos
  }
  const event = String(body.event ?? topic ?? "");

  // ── Pedidos: created / paid / cancelled / updated ─────────────────────────────
  if (event.startsWith("order/") || topic.startsWith("order")) {
    try {
      const storeId = body.store_id != null ? String(body.store_id) : null;
      const orderId = body.id != null ? String(body.id) : null;
      if (!storeId || !orderId) return NextResponse.json({ ok: true });

      const admin = createAdminClient();
      const { data: cred } = await admin
        .from("tiendanube_credentials")
        .select("organization_id, store_id, access_token")
        .eq("store_id", storeId)
        .maybeSingle();
      if (!cred) return NextResponse.json({ ok: true }); // tienda no conectada acá

      const order = await fetchTNOrder({ storeId: cred.store_id, token: cred.access_token }, orderId);
      if (!order) return NextResponse.json({ ok: true }); // pedido inexistente/borrado

      const payload = normalizeTNOrder(order);
      const { error } = await admin.rpc("ingest_tn_order", {
        p_org: cred.organization_id,
        p_payload: payload,
      });
      if (error) {
        // Error de negocio/validación de la RPC = PERMANENTE. Acusamos 200 para no
        // envenenar la cola de reintentos de TN (evita que deshabilite el webhook).
        // Se loggea para revisión; order/updated o el reintento lo reconcilian luego.
        console.error("ingest_tn_order (permanente, acusado):", error.message);
        return NextResponse.json({ ok: true, warning: "ingesta con error" });
      }
      // La reserva cambió el disponible → empujar a la web enseguida (post-respuesta).
      after(() => syncTNStockOnce(cred.organization_id).catch(() => {}));
      return NextResponse.json({ ok: true });
    } catch (e) {
      // Falla de infraestructura (red/DB) = TRANSITORIA → 500 para que TN reintente.
      console.error("webhook order (transitorio):", e);
      return new NextResponse("error", { status: 500 });
    }
  }

  // ── store-redact: TN pide borrar los datos de la tienda desinstalada ──────────
  if (topic === "store-redact" || event === "store/redact") {
    try {
      const storeId = body.store_id != null ? String(body.store_id) : null;
      if (storeId) {
        const admin = createAdminClient();
        await admin.from("tiendanube_credentials").delete().eq("store_id", storeId);
      }
    } catch {
      /* body no-JSON: igual acusamos 200 (ya validamos la firma) */
    }
  }
  // customers-redact / customers-data-request: no guardamos PII de compradores más
  // allá del snapshot del pedido; solo acusamos el aviso.

  return NextResponse.json({ ok: true });
}
