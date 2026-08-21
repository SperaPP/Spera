"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Printer } from "lucide-react";
import { ArmadoSheet, armadoPrintCss, type ArmadoSale } from "@/components/armado-print";
import { marcarArmadoImpresoBulk } from "@/app/(app)/ventas/actions";

export function ArmadoTodosPrint({ sales }: { sales: ArmadoSale[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ids = sales.map((s) => s.id);

  function imprimir() {
    window.print();
    // Marca los pedidos como impresos (quedan bloqueados, igual que el individual).
    start(async () => {
      const r = await marcarArmadoImpresoBulk(ids);
      if (r.error) { toast.error(r.error); return; }
      toast.success(`${ids.length} pedido(s) marcados como impresos.`);
      router.push("/ventas");
    });
  }

  return (
    <div>
      <style>{armadoPrintCss}</style>

      <div className="ar-toolbar mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/ventas" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver a ventas
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{sales.length} pedido(s) disponibles</span>
          <button onClick={imprimir} disabled={pending || sales.length === 0} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
            <Printer className="h-4 w-4" /> {pending ? "Procesando…" : `Imprimir todos (${sales.length})`}
          </button>
        </div>
      </div>

      {sales.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-card py-14 text-center text-sm text-muted">
          No hay pedidos disponibles para imprimir (todos ya se imprimieron o no hay pendientes).
        </div>
      ) : (
        <div className="space-y-8">
          {sales.map((s, i) => (
            <div key={s.id} className={i < sales.length - 1 ? "ar-break" : ""}>
              <ArmadoSheet sale={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
