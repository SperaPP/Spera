import { requireAsistentePage } from "@/lib/asistente/guard";
import { AsistenteChat } from "@/components/asistente/chat";

export const metadata = { title: "Asistente — Spera" };

export default async function AsistentePage() {
  // Guard ESTRICTO: solo roles con el módulo 'asistente' tildado (sin bypass de admin).
  await requireAsistentePage();

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-3xl flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Asistente</h1>
        <p className="mt-1 text-sm text-muted">
          Preguntale lo que quieras del negocio: consulta los datos reales en el momento y no puede modificar nada.
        </p>
      </div>
      <AsistenteChat />
    </div>
  );
}
