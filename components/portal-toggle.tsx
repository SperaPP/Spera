"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Store } from "lucide-react";
import { setPortalVisible } from "@/app/(app)/productos/actions";

export function PortalToggle({ productId, visible }: { productId: string; visible: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(visible);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      const r = await setPortalVisible(productId, next);
      if (r.error) { toast.error(r.error); setOn(!next); return; }
      toast.success(next ? "Publicado en el portal" : "Despublicado del portal");
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={on ? "Se muestra en el portal mayorista. Click para despublicar." : "No se muestra en el portal. Click para publicar."}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${on ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:bg-canvas"}`}
    >
      <Store className="h-3.5 w-3.5" /> {on ? "En el portal" : "Fuera del portal"}
    </button>
  );
}
