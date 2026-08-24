"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { solicitarReset } from "../login/actions";

const input = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export default function RecuperarPage() {
  const [state, action, pending] = useActionState(solicitarReset, {});
  useEffect(() => { if (state.error) toast.error(state.error); }, [state]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Recuperar contraseña</h1>
          <p className="mt-1 text-sm text-muted">Te enviamos un enlace por email para crear una nueva.</p>
        </div>

        {state.ok ? (
          <div className="rounded-lg bg-ok-bg px-4 py-6 text-center text-sm text-ink">
            Si el email está registrado, te llegó un enlace para restablecer la contraseña. Revisá tu bandeja (y el spam).
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required className={input} />
            </div>
            <button type="submit" disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
              {pending ? "Enviando…" : "Enviar enlace"}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-muted">
          <Link href="/login" className="font-medium text-accent hover:underline">Volver al ingreso</Link>
        </p>
      </div>
    </main>
  );
}
