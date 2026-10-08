"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Send, X, Copy, Check } from "lucide-react";
import { generarLinkAccesoCliente } from "@/app/(app)/clientes/actions";

export function EnviarLinkPortalButton({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [link, setLink] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);

  function generar() {
    start(async () => {
      const r = await generarLinkAccesoCliente(customerId);
      if (r.error || !r.link) { toast.error(r.error ?? "No se pudo generar el link."); return; }
      setLink(r.link); setPhone(r.phone ?? null); setName(r.name ?? ""); setCopied(false);
      setOpen(true);
    });
  }

  const msg = `Hola${name ? " " + name : ""}! Para entrar al Portal Mayorista de Body Sculpt y crear tu contraseña, ingresá a este link: ${link}`;
  const waDigits = (phone ?? "").replace(/\D/g, "");
  const waUrl = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}` : null;

  async function copiar() {
    try { await navigator.clipboard.writeText(link); setCopied(true); toast.success("Link copiado."); setTimeout(() => setCopied(false), 2000); }
    catch { toast.error("No se pudo copiar."); }
  }

  return (
    <>
      <button onClick={generar} disabled={pending} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60">
        <Send className="h-4 w-4" /> {pending ? "Generando…" : "Link de acceso"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Link de acceso al portal</h2>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-muted">Mandale este link al cliente. Al abrirlo, crea su propia contraseña y queda adentro del portal. Es de un solo uso y vence; si no lo usa, generás otro.</p>

            <div className="mt-3 flex items-center gap-2">
              <input readOnly value={link} className="w-full truncate rounded-lg border border-line-strong bg-canvas px-3 py-2 text-xs text-muted outline-none" />
              <button onClick={copiar} className="flex shrink-0 items-center gap-1 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas">
                {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cerrar</button>
              {waUrl ? (
                <a href={waUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
                  className="flex items-center gap-1.5 rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                  <Send className="h-4 w-4" /> Enviar por WhatsApp
                </a>
              ) : (
                <span className="rounded-lg bg-canvas px-4 py-2 text-xs text-muted">Sin teléfono: copiá el link</span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
