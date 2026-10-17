"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, SendHorizonal, Square, Volume2, VolumeX, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Chat del Asistente IA, pensado para usarse HABLANDO:
 * - Micrófono: reconocimiento de voz del navegador (es-AR), al soltar la frase se envía sola.
 * - Parlante: la respuesta se lee en voz alta (texto a voz del navegador), apagable.
 * La respuesta llega streameada (NDJSON) desde /api/asistente.
 */

type Msg = { role: "user" | "assistant"; content: string };

const SUGERENCIAS = [
  "¿Cuánto vendimos hoy en cada local?",
  "Top 10 de productos más vendidos del mes",
  "¿Qué colores se venden más?",
  "¿Qué productos no se venden hace 60 días?",
  "¿Quiénes son los clientes que más deben?",
];

// ── Tipos mínimos del reconocimiento de voz (no vienen en lib.dom) ────────────
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function crearReconocedor(): SpeechRec | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "es-AR";
  rec.continuous = false;
  rec.interimResults = true;
  return rec;
}

// ── Render mínimo de markdown (negritas, títulos y listas; sin tablas) ────────
function renderLinea(linea: string, key: number): ReactNode {
  const partes = linea.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : p
  );
  if (/^#{1,4}\s/.test(linea)) {
    return <p key={key} className="mt-3 text-sm font-semibold text-ink">{renderLinea(linea.replace(/^#{1,4}\s/, ""), 0)}</p>;
  }
  if (/^\s*[-•*]\s/.test(linea)) {
    return (
      <p key={key} className="flex gap-2 pl-1">
        <span className="text-faint">•</span>
        <span>{linea.replace(/^\s*[-•*]\s/, "").split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
          p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : p
        )}</span>
      </p>
    );
  }
  if (linea.trim() === "") return <div key={key} className="h-2" />;
  return <p key={key}>{partes}</p>;
}

function limpiarParaVoz(texto: string): string {
  return texto
    .replace(/\*\*/g, "")
    .replace(/^#{1,4}\s/gm, "")
    .replace(/^\s*[-•*]\s/gm, "")
    .replace(/`/g, "");
}

export function AsistenteChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pensando, setPensando] = useState(false);
  const [vozActiva, setVozActiva] = useState(true);
  const [escuchando, setEscuchando] = useState(false);
  const [soportaVoz, setSoportaVoz] = useState(false);

  const recRef = useRef<SpeechRec | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<Msg[]>(msgs);
  msgsRef.current = msgs;

  useEffect(() => {
    setSoportaVoz(crearReconocedor() !== null);
    try {
      const v = localStorage.getItem("asistente_voz");
      if (v != null) setVozActiva(v === "1");
    } catch { /* sin storage, usa el default */ }
    return () => {
      abortRef.current?.abort();
      try { window.speechSynthesis?.cancel(); } catch { /* no-op */ }
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, status]);

  const hablar = useCallback((texto: string) => {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(limpiarParaVoz(texto));
      const voces = window.speechSynthesis.getVoices();
      const esAr = voces.find((v) => v.lang === "es-AR") ?? voces.find((v) => v.lang.startsWith("es"));
      if (esAr) u.voice = esAr;
      u.lang = esAr?.lang ?? "es-AR";
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch { /* sin TTS, queda el texto */ }
  }, []);

  const enviar = useCallback(async (texto: string) => {
    const pregunta = texto.trim();
    if (!pregunta || pensando) return;
    try { window.speechSynthesis?.cancel(); } catch { /* no-op */ }

    const historia: Msg[] = [...msgsRef.current, { role: "user", content: pregunta }];
    setMsgs([...historia, { role: "assistant", content: "" }]);
    setInput("");
    setPensando(true);
    setStatus("Pensando…");

    const controller = new AbortController();
    abortRef.current = controller;
    let respuesta = "";

    const pintar = (extra?: string) =>
      setMsgs([...historia, { role: "assistant", content: respuesta + (extra ?? "") }]);

    try {
      const res = await fetch("/api/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historia }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        respuesta = `⚠️ ${err?.error ?? `Error ${res.status} del servidor.`}`;
        pintar();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lineas = buffer.split("\n");
        buffer = lineas.pop() ?? "";
        for (const linea of lineas) {
          if (!linea.trim()) continue;
          let ev: { t: string; v?: string };
          try { ev = JSON.parse(linea); } catch { continue; }
          if (ev.t === "delta" && ev.v) {
            respuesta += ev.v;
            setStatus(null);
            pintar();
          } else if (ev.t === "status" && ev.v) {
            setStatus(ev.v);
          } else if (ev.t === "error" && ev.v) {
            respuesta += `\n\n⚠️ ${ev.v}`;
            pintar();
          }
        }
      }
      if (vozActiva && respuesta.trim()) hablar(respuesta);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        respuesta += "\n\n⚠️ Se cortó la conexión. Probá de nuevo.";
        pintar();
      }
    } finally {
      setPensando(false);
      setStatus(null);
      abortRef.current = null;
    }
  }, [pensando, vozActiva, hablar]);

  const toggleMic = useCallback(() => {
    if (escuchando) {
      recRef.current?.stop();
      return;
    }
    const rec = crearReconocedor();
    if (!rec) return;
    recRef.current = rec;
    let finalTexto = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTexto += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput(finalTexto + interim);
    };
    rec.onend = () => {
      setEscuchando(false);
      const texto = finalTexto.trim();
      if (texto) void enviar(texto); // habló → se envía sola, sin tocar nada
    };
    rec.onerror = () => setEscuchando(false);
    try { window.speechSynthesis?.cancel(); } catch { /* no-op */ }
    setInput("");
    setEscuchando(true);
    rec.start();
  }, [escuchando, enviar]);

  function toggleVoz() {
    const nuevo = !vozActiva;
    setVozActiva(nuevo);
    try { localStorage.setItem("asistente_voz", nuevo ? "1" : "0"); } catch { /* no-op */ }
    if (!nuevo) { try { window.speechSynthesis?.cancel(); } catch { /* no-op */ } }
  }

  function frenar() {
    abortRef.current?.abort();
    setPensando(false);
    setStatus(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-card">
      {/* Mensajes */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Sparkles className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">¿Qué querés saber del negocio?</p>
              <p className="mt-1 text-xs text-muted">
                Apretá el micrófono y preguntá hablando, o escribí. {soportaVoz ? "" : "(Este navegador no tiene micrófono de voz; usá Chrome o Edge.)"}
              </p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  onClick={() => void enviar(s)}
                  className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-muted transition-colors hover:bg-canvas hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user" ? "bg-accent text-accent-fg" : "bg-canvas text-ink"
              )}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <div className="space-y-0.5">{m.content.split("\n").map((l, j) => renderLinea(l, j))}</div>
                ) : (
                  <span className="text-muted">{status ?? "Pensando…"}</span>
                )
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {pensando && status && msgs[msgs.length - 1]?.content !== "" && (
          <p className="pl-1 text-xs text-faint">{status}</p>
        )}
      </div>

      {/* Entrada */}
      <div className="border-t border-line p-3">
        <form
          onSubmit={(e) => { e.preventDefault(); void enviar(input); }}
          className="flex items-end gap-2"
        >
          <button
            type="button"
            onClick={toggleVoz}
            title={vozActiva ? "Respuestas en voz alta: activadas" : "Respuestas en voz alta: apagadas"}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors",
              vozActiva ? "border-accent/40 bg-accent/10 text-accent" : "border-line-strong text-muted hover:text-ink"
            )}
          >
            {vozActiva ? <Volume2 className="h-4.5 w-4.5" /> : <VolumeX className="h-4.5 w-4.5" />}
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(input); }
            }}
            rows={1}
            placeholder={escuchando ? "Escuchando… hablá tranquilo" : "Preguntá lo que quieras…"}
            className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line-strong bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-accent"
          />

          {soportaVoz && (
            <button
              type="button"
              onClick={toggleMic}
              disabled={pensando}
              title={escuchando ? "Dejar de escuchar" : "Preguntar hablando"}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-50",
                escuchando ? "animate-pulse bg-red-500 text-white" : "bg-accent text-accent-fg hover:bg-accent-hover"
              )}
            >
              {escuchando ? <MicOff className="h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
            </button>
          )}

          {pensando ? (
            <button
              type="button"
              onClick={frenar}
              title="Frenar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line-strong text-muted hover:text-ink"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              title="Enviar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line-strong text-muted transition-colors hover:text-accent disabled:opacity-40"
            >
              <SendHorizonal className="h-4.5 w-4.5" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
