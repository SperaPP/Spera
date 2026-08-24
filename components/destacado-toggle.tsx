"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { setDestacado } from "@/app/(app)/productos/actions";

export function DestacadoToggle({ productId, featured }: { productId: string; featured: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(featured);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      const r = await setDestacado(productId, next);
      if (r.error) { toast.error(r.error); setOn(!next); return; }
      toast.success(next ? "Marcado como destacado" : "Ya no es destacado");
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={on ? "Destacado en el portal mayorista" : "Marcar como destacado en el portal"}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${on ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:bg-canvas"}`}
    >
      <Sparkles className="h-3.5 w-3.5" /> Destacado
    </button>
  );
}
