"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { eliminarProducto } from "@/app/(app)/productos/actions";

export function EliminarProducto({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function del() {
    if (!confirm(`¿Eliminar "${productName}" del sistema?\n\nSe borran sus variantes, stock, precios y fotos. Esta acción NO se puede deshacer.\n\nSolo se puede si el producto nunca tuvo ventas ni transferencias; si las tuvo, desactivalo en su lugar.`)) return;
    start(async () => {
      const r = await eliminarProducto(productId);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Producto eliminado.");
      router.push("/productos");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={del}
      disabled={pending}
      className="flex items-center gap-1.5 rounded-lg border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-bg disabled:opacity-60"
    >
      <Trash2 className="h-3.5 w-3.5" /> {pending ? "Eliminando…" : "Eliminar"}
    </button>
  );
}
