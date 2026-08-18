"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { marcarEntregada } from "@/app/(app)/caja/actions";

export function EntregarButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("Marcar el período como Entregado (la plata viajó a administración)?")) return;
        start(async () => {
          const r = await marcarEntregada(sessionId);
          if (r.error) { toast.error(r.error); return; }
          toast.success("Período entregado.");
          router.refresh();
        });
      }}
      disabled={pending}
      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
    >
      <Send className="h-3.5 w-3.5" /> {pending ? "Entregando…" : "Entregar"}
    </button>
  );
}
