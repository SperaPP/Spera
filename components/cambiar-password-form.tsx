"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cambiarMiPassword } from "@/app/(app)/cuenta/actions";

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function CambiarPasswordForm() {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    if (pass.length < 6) return toast.error("La contraseña debe tener al menos 6 caracteres.");
    if (pass !== confirm) return toast.error("Las contraseñas no coinciden.");
    start(async () => {
      const r = await cambiarMiPassword(pass);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Contraseña actualizada.");
      setPass(""); setConfirm("");
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="p1">Nueva contraseña</label>
        <input id="p1" type="password" autoComplete="new-password" className={input} value={pass} onChange={(e) => setPass(e.target.value)} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="p2">Repetir contraseña</label>
        <input id="p2" type="password" autoComplete="new-password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </div>
      <div className="flex justify-end">
        <button onClick={submit} disabled={pending || !pass || !confirm} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </div>
    </div>
  );
}
