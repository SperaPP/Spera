import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { analizarDuplicados } from "@/app/(app)/clientes/actions";
import { DuplicadoGrupo } from "@/components/duplicado-grupo";

export default async function DuplicadosPage() {
  const { error, groups } = await analizarDuplicados();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a clientes
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Clientes duplicados</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Cuentas que comparten documento (un DNI y su CUIT cuentan como la misma persona). Revisá cada grupo antes de unificar.</p>

      {error ? (
        <div className="rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-ink">{error}</div>
      ) : !groups || groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ok-bg text-ok"><ShieldCheck className="h-6 w-6" /></span>
          <p className="mt-3 font-medium text-ink">No hay cuentas duplicadas</p>
          <p className="mt-1 text-sm text-muted">No se encontraron clientes que compartan documento.</p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted"><span className="font-semibold text-ink">{groups.length}</span> persona(s) con cuentas duplicadas · <span className="font-semibold text-ink">{groups.reduce((a, g) => a + g.accounts.length, 0)}</span> cuentas en total.</p>
          <div className="space-y-4">
            {groups.map((g) => <DuplicadoGrupo key={g.key} group={g} />)}
          </div>
        </>
      )}
    </div>
  );
}
