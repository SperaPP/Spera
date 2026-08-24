import { PackageOpen } from "lucide-react";

export default function PortalHome() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Bienvenido</h1>
      <p className="mt-1 text-sm text-muted">Tu cuenta está habilitada. Muy pronto vas a poder ver el catálogo y hacer pedidos desde acá.</p>
      <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent"><PackageOpen className="h-6 w-6" /></span>
        <p className="mt-3 font-medium text-ink">Catálogo en preparación</p>
        <p className="mt-1 text-sm text-muted">Estamos cargando los productos para vos.</p>
      </div>
    </div>
  );
}
