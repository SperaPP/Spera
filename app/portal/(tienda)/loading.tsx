// Feedback instantáneo para las páginas del portal (pedidos, cuenta, producto, home)
// mientras el servidor responde. El catálogo tiene su propio skeleton más detallado.
export default function LoadingTienda() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-line/60" />
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-16 w-full rounded-xl bg-line/40" />)}
      </div>
    </div>
  );
}
