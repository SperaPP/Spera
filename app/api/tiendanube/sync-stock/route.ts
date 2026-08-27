import { NextResponse } from "next/server";
import { syncTNStockAll, syncTNOrdersAll } from "@/lib/tiendanube";

// Cron de Tiendanube (cada minuto). Hace dos cosas:
//  1) Respaldo de INGESTA: trae los pedidos recientes que el webhook no haya entregado.
//  2) Drena la cola de stock y empuja el disponible a TN.
// También lo llama el webhook (tras reservar) para el punto 2.
// Protegido con Authorization: Bearer CRON_SECRET.
const CRON_SECRET = process.env.CRON_SECRET ?? "";

export const maxDuration = 60; // segundos

async function run(request: Request) {
  if (!CRON_SECRET) return new NextResponse("no configurado", { status: 503 });
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${CRON_SECRET}`) return new NextResponse("no autorizado", { status: 401 });

  // 1) Respaldo de ingesta: pedidos modificados en la última hora (idempotente).
  let ordersCreated = 0;
  try {
    const ord = await syncTNOrdersAll(60);
    ordersCreated = ord.reduce((a, x) => a + x.created, 0);
  } catch { /* no bloquear el sync de stock si falla la ingesta */ }

  // 2) Drenar la cola de stock (hasta 3 lotes; corta si no queda nada).
  const results: Awaited<ReturnType<typeof syncTNStockAll>> = [];
  for (let i = 0; i < 3; i++) {
    const r = await syncTNStockAll(100);
    results.push(...r);
    if (r.every((x) => x.processed === 0 && x.failed === 0)) break;
    if (r.every((x) => x.remaining === 0)) break;
  }
  const processed = results.reduce((a, x) => a + x.processed, 0);
  const failed = results.reduce((a, x) => a + x.failed, 0);
  return NextResponse.json({ ok: true, ordersCreated, processed, failed });
}

// Vercel Cron usa GET; el webhook y pruebas manuales pueden usar POST.
export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
