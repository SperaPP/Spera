export function ModulePlaceholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && (
        <p className="mt-1 text-sm text-neutral-500">{description}</p>
      )}
      <div className="mt-6 flex h-64 items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white text-sm text-neutral-400">
        Módulo en construcción
      </div>
    </div>
  );
}
