"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { probeWSAA } from "@/lib/arca/wsaa";
import { arcaConfig, arcaConfigured } from "@/lib/arca/config";

/** Prueba la autenticación con ARCA (WSAA). Solo admin. No emite ninguna factura. */
export async function probarConexionArca(): Promise<{
  ok: boolean; env: string; configurado: boolean; cuit?: string; ptoVenta?: number; expira?: string; error?: string;
}> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, env: "", configurado: false, error: denied.error };

  const cfg = arcaConfig();
  if (!arcaConfigured()) {
    return { ok: false, env: cfg.env, configurado: false, error: "Faltan datos de ARCA en el entorno (certificado, clave, CUIT o punto de venta)." };
  }

  const sb = await createClient();
  const { data: org } = await sb.rpc("current_org_id");
  if (!org) return { ok: false, env: cfg.env, configurado: true, error: "Sin organización." };

  const r = await probeWSAA(org as string);
  return { ...r, configurado: true, cuit: cfg.cuit, ptoVenta: cfg.ptoVenta };
}
