"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";
import { aprobarPortalCliente } from "@/app/(app)/clientes/actions";

/** Habilita el portal de un cliente que tiene login pero no está aprobado (pendiente,
 *  rechazado o sin estado). Asigna la lista Mayorista si no tenía tipo. */
export function HabilitarPortalButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function habilitar() {
    start(async () => {
      const r = await aprobarPortalCliente(customerId, null);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Portal habilitado. El cliente ya puede entrar a comprar.");
      router.refresh();
    });
  }

  return (
    <button onClick={habilitar} disabled={pending} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
      <UserCheck className="h-4 w-4" /> {pending ? "Habilitando…" : "Habilitar portal"}
    </button>
  );
}
