export function ModulePlaceholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-6 flex h-64 items-center justify-center rounded-xl border border-dashed border-line-strong bg-card text-sm text-faint">
        Módulo en construcción
      </div>
    </div>
  );
}
