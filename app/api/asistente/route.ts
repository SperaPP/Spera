import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAsistente } from "@/lib/asistente/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSystemPrompt } from "@/lib/asistente/manual";

/**
 * Motor del Asistente IA. Recibe la conversación, corre el loop de agente
 * (Claude + herramientas de solo lectura) y streamea la respuesta como NDJSON:
 *   {t:"status", v:"..."}  → qué está haciendo (consultando, mirando fotos)
 *   {t:"delta",  v:"..."}  → texto de la respuesta, a medida que sale
 *   {t:"done"} | {t:"error", v:"..."}
 * Seguridad: guard estricto del módulo 'asistente' (sin bypass de admin) +
 * asistente_query() en SQL revalida y solo permite SELECT (transacción read-only).
 */

export const maxDuration = 120;

// Haiku: el modelo económico (≈5× más barato); si las respuestas quedan flojas,
// subir a claude-sonnet-5-5 con la env ASISTENTE_MODEL, sin tocar código.
const MODEL = process.env.ASISTENTE_MODEL || "claude-haiku-5-5";
const MAX_VUELTAS = 12; // tope de idas y vueltas con herramientas por pregunta
const BUCKET_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images`;

// ── Esquema vivo de la base (cacheado 10 min por instancia) ──────────────────
let schemaCache: { value: string; at: number } | null = null;

async function getSchema(): Promise<string> {
  if (schemaCache && Date.now() - schemaCache.at < 10 * 60_000) return schemaCache.value;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("asistente_query", {
    p_sql: `select c.table_name as tabla,
                   string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as columnas
            from information_schema.columns c
            join information_schema.tables t
              on t.table_schema = c.table_schema and t.table_name = c.table_name
            where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
              and c.table_name !~ '^(tn_|tiendanube_|arca_auth)'
            group by c.table_name
            order by c.table_name`,
    p_max_rows: 500,
  });
  if (error) throw new Error(`No pude leer el esquema de la base: ${error.message}`);
  const rows = (data ?? []) as { tabla: string; columnas: string }[];
  const value = rows.map((r) => `${r.tabla}: ${r.columnas}`).join("\n");
  schemaCache = { value, at: Date.now() };
  return value;
}

// ── Herramientas ─────────────────────────────────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: "consultar_base",
    description:
      "Ejecuta UNA consulta SELECT de solo lectura sobre la base Postgres de Spera y devuelve las filas como JSON. Sin ';', una sola sentencia. Preferí agregaciones. Si falla, leé el error, corregí la consulta y reintentá.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "La consulta SELECT (o WITH ... SELECT)." },
        max_filas: { type: "number", description: "Tope de filas (default 200, máximo 1000)." },
      },
      required: ["sql"],
    },
  },
  {
    name: "ver_imagenes",
    description:
      "Te muestra hasta 6 fotos de productos (del bucket público de Spera) para que evalúes su calidad con la vista. Pasá URLs completas construidas desde product_images.",
    input_schema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs públicas de las fotos (máx. 6)." },
      },
      required: ["urls"],
    },
  },
];

type ToolResultContent = string | Anthropic.ToolResultBlockParam["content"];

async function runConsultarBase(input: { sql?: string; max_filas?: number }): Promise<{ content: ToolResultContent; isError: boolean }> {
  const sql = typeof input?.sql === "string" ? input.sql : "";
  if (!sql.trim()) return { content: "Falta la consulta SQL.", isError: true };
  const maxRows = Number.isFinite(input?.max_filas) ? Math.trunc(input!.max_filas!) : 200;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("asistente_query", { p_sql: sql, p_max_rows: maxRows });
  if (error) return { content: `Error de la base: ${error.message}`, isError: true };
  const rows = (data ?? []) as unknown[];
  const text = JSON.stringify(rows);
  if (text.length > 120_000) {
    return { content: "El resultado es demasiado grande para analizarlo. Reformulá con agregaciones o más filtros.", isError: true };
  }
  return { content: `${rows.length} filas:\n${text}`, isError: false };
}

const IMG_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

async function runVerImagenes(input: { urls?: string[] }): Promise<{ content: ToolResultContent; isError: boolean }> {
  const urls = Array.isArray(input?.urls) ? input.urls.filter((u) => typeof u === "string").slice(0, 6) : [];
  if (urls.length === 0) return { content: "No pasaste ninguna URL.", isError: true };

  const blocks: Anthropic.ToolResultBlockParam["content"] = [];
  for (const url of urls) {
    // Solo el bucket público propio: nada de ir a buscar URLs arbitrarias de internet.
    if (!url.startsWith(BUCKET_URL)) {
      blocks.push({ type: "text", text: `Salteada (fuera del bucket de Spera): ${url}` });
      continue;
    }
    try {
      // Las fotos originales pueden ser enormes (>8000px, importadas de Woo) y la API
      // las rechaza. Supabase Pro transforma al vuelo: pedimos una versión de 800px
      // y, si la transformación no está disponible, caemos al original.
      const path = url.slice(BUCKET_URL.length);
      const resized = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/render/image/public/product-images${path}?width=800&quality=75`;
      let res = await fetch(resized, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const type = IMG_TYPES[(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()];
      if (!res.ok || !type) {
        blocks.push({ type: "text", text: `No pude bajar (${res.status}): ${url}` });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > 4_500_000) {
        blocks.push({ type: "text", text: `Salteada (muy pesada, ${(buf.byteLength / 1e6).toFixed(1)} MB): ${url}` });
        continue;
      }
      blocks.push({ type: "text", text: `Foto: ${url}` });
      blocks.push({ type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } });
    } catch {
      blocks.push({ type: "text", text: `No pude bajar (timeout/red): ${url}` });
    }
  }
  return { content: blocks, isError: false };
}

// ── Handler ──────────────────────────────────────────────────────────────────
type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const denied = await requireAsistente();
  if (denied) return Response.json({ error: denied.error }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Falta configurar la variable ANTHROPIC_API_KEY (en Vercel y en .env.local)." },
      { status: 500 }
    );
  }

  let history: ChatMessage[];
  try {
    const body = await req.json();
    const raw = Array.isArray(body?.messages) ? (body.messages as unknown[]) : [];
    history = raw
      .filter(
        (m): m is ChatMessage =>
          typeof m === "object" && m !== null &&
          ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
          typeof (m as ChatMessage).content === "string" && (m as ChatMessage).content.trim() !== ""
      )
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return Response.json({ error: "Falta la pregunta." }, { status: 400 });
  }

  let system: string;
  try {
    system = buildSystemPrompt(await getSchema());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Error leyendo el esquema." }, { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

        for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
          const msgStream = client.messages.stream({
            model: MODEL,
            max_tokens: 3000,
            system,
            tools: TOOLS,
            messages,
          });
          msgStream.on("text", (delta) => send({ t: "delta", v: delta }));
          const msg = await msgStream.finalMessage();

          if (msg.stop_reason !== "tool_use") break;

          const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ t: "status", v: tu.name === "ver_imagenes" ? "Mirando fotos…" : "Consultando la base…" });
            const r =
              tu.name === "consultar_base"
                ? await runConsultarBase(tu.input as { sql?: string; max_filas?: number })
                : tu.name === "ver_imagenes"
                  ? await runVerImagenes(tu.input as { urls?: string[] })
                  : { content: `Herramienta desconocida: ${tu.name}`, isError: true };
            results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, is_error: r.isError });
          }
          messages.push({ role: "assistant", content: msg.content });
          messages.push({ role: "user", content: results });

          // Si ya venía hablando, separar del texto que sigue (si no, pega las frases).
          if (msg.content.some((b) => b.type === "text" && b.text.trim() !== "")) {
            send({ t: "delta", v: "\n\n" });
          }

          if (vuelta === MAX_VUELTAS - 1) {
            send({ t: "delta", v: "\n\n(Me quedé sin vueltas de consulta para esta pregunta; probá acotarla.)" });
          }
        }

        send({ t: "done" });
      } catch (e) {
        send({ t: "error", v: e instanceof Error ? e.message : "Error inesperado del asistente." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
