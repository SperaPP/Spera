import { NextResponse } from "next/server";
import { syncTNStockAll } from "@/lib/tiendanube";

// Drena la cola de sync de stock y empuja el disponible a Tiendanube.
// Lo llaman: el cron (cada minuto) y el webhook de pedidos (tras reservar).
// Protegido con Authorization: Bearer CRON_SECRET.
const CRON_SECRET = process.env.CRON_SECRET ?? "";

export const maxDuration = 60; // segundos (drenado por lotes)

async function run(request: Request) {
  if (!CRON_SECRET) return new NextResponse("no configurado", { status: 503 });
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${CRON_SECRET}`) return new NextResponse("no autorizado", { status: 401 });

  // Hasta 3 lotes por invocación (por si se acumuló cola); corta si no queda nada.
  const results: Awaited<ReturnType<typeof syncTNStockAll>> = [];
  for (let i = 0; i < 3; i++) {
    const r = await syncTNStockAll(100);
    results.push(...r);
    if (r.every((x) => x.processed === 0 && x.failed === 0)) break;
    if (r.every((x) => x.remaining === 0)) break;
  }
  const processed = results.reduce((a, x) => a + x.processed, 0);
  const failed = results.reduce((a, x) => a + x.failed, 0);
  return NextResponse.json({ ok: true, processed, failed });
}

// Vercel Cron usa GET; el webhook y pruebas manuales pueden usar POST.
export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
