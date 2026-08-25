"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Store } from "lucide-react";
import { setTnSync } from "@/app/(app)/productos/actions";

export function TnSyncToggle({ productId, synced }: { productId: string; synced: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(synced);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      const r = await setTnSync(productId, next);
      if (r.error) { toast.error(r.error); setOn(!next); return; }
      toast.success(next ? "Se sincronizará con Tiendanube" : "No se sincroniza con Tiendanube");
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={on ? "Este producto se maneja desde Tiendanube" : "Activar sincronización con Tiendanube"}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${on ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:bg-canvas"}`}
    >
      <Store className="h-3.5 w-3.5" /> Sincronizar con Tiendanube
    </button>
  );
}
