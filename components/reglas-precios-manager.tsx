"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Sparkles } from "lucide-react";
import { setReglaPrecio, recalcularPrecios, inicializarPrecios } from "@/app/(app)/configuracion/actions";

type Rule = { markup: number; discount: number };
type Cat = { id: string; name: string };

const input =
  "w-24 rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const card = "rounded-xl border border-line bg-card p-5";
const btn = "rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-50";

export function ReglasPreciosManager({
  defaultRule,
  categories,
  overrides,
}: {
  defaultRule: Rule;
  categories: Cat[];
  overrides: Record<string, Rule>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");

  // Regla general
  const [gMarkup, setGMarkup] = useState(String(defaultRule.markup));
  const [gDiscount, setGDiscount] = useState(String(defaultRule.discount));

  function saveGeneral() {
    start(async () => {
      const r = await setReglaPrecio(null, Number(gMarkup), Number(gDiscount));
      if (r.error) { toast.error(r.error); return; }
      toast.success("Regla general guardada.");
      router.refresh();
    });
  }

  function runRecalc() {
    if (!confirm("Recalcular Publico y Mayorista de todos los productos a partir de su Platinum. ¿Seguir?")) return;
    start(async () => {
      const r = await recalcularPrecios();
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Precios recalculados: ${r.count} productos.`);
      router.refresh();
    });
  }

  function runSeed() {
    if (!confirm("Inicialización única: toma los precios actuales como Publico y calcula Platinum y Mayorista. Sólo afecta productos sin Platinum. ¿Seguir?")) return;
    start(async () => {
      const r = await inicializarPrecios();
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Precios inicializados: ${r.count} productos.`);
      router.refresh();
    });
  }

  const shown = q.trim()
    ? categories.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
    : categories;
  const nOverrides = Object.keys(overrides).length;

  return (
    <div className="space-y-5">
      {/* Regla general */}
      <div className={card}>
        <h3 className="text-sm font-medium text-ink">Regla general</h3>
        <p className="mt-1 text-xs text-muted">
          La base es <span className="font-medium text-ink">Platinum</span>. Publico y Mayorista se derivan y se redondean a peso entero.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Publico = Platinum +</label>
            <div className="flex items-center gap-1.5">
              <input type="number" className={input} value={gMarkup} onChange={(e) => setGMarkup(e.target.value)} />
              <span className="text-sm text-muted">%</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Mayorista = Publico −</label>
            <div className="flex items-center gap-1.5">
              <input type="number" className={input} value={gDiscount} onChange={(e) => setGDiscount(e.target.value)} />
              <span className="text-sm text-muted">%</span>
            </div>
          </div>
          <button type="button" onClick={saveGeneral} disabled={pending} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
            Guardar
          </button>
        </div>
      </div>

      {/* Excepciones por categoría */}
      <div className={card}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-ink">Excepciones por categoría</h3>
          <span className="text-xs text-muted">{nOverrides} con regla propia</span>
        </div>
        <p className="mt-1 text-xs text-muted">Las categorías sin regla propia usan la general. Marcá sólo las que difieren (ej. Accesorios, Calzados, Mallas).</p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar entre ${categories.length} categorías…`}
          className="mt-3 w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
        <div className="mt-3 max-h-[26rem] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {shown.map((c) => (
            <CategoryRow key={c.id} category={c} override={overrides[c.id]} defaultRule={defaultRule} />
          ))}
          {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Sin coincidencias.</p>}
        </div>
      </div>

      {/* Acciones masivas */}
      <div className={card}>
        <h3 className="text-sm font-medium text-ink">Aplicar a los productos</h3>
        <p className="mt-1 text-xs text-muted">
          <span className="font-medium text-ink">Inicializar</span> es de un solo uso al arrancar (los precios actuales se toman como Publico).
          Después de cambiar reglas, usá <span className="font-medium text-ink">Recalcular</span>.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={runSeed} disabled={pending} className={btn}>
            <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Inicializar precios (una vez)</span>
          </button>
          <button type="button" onClick={runRecalc} disabled={pending} className={btn}>
            <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Recalcular todos</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({ category, override, defaultRule }: { category: Cat; override?: Rule; defaultRule: Rule }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [own, setOwn] = useState(!!override);
  const [markup, setMarkup] = useState(String(override?.markup ?? defaultRule.markup));
  const [discount, setDiscount] = useState(String(override?.discount ?? defaultRule.discount));

  function toggleOwn(next: boolean) {
    setOwn(next);
    if (!next) {
      // Quitar override → vuelve a la general.
      start(async () => {
        const r = await setReglaPrecio(category.id, null, null);
        if (r.error) { toast.error(r.error); setOwn(true); return; }
        toast.success(`${category.name}: usa la regla general.`);
        router.refresh();
      });
    }
  }

  function save() {
    start(async () => {
      const r = await setReglaPrecio(category.id, Number(markup), Number(discount));
      if (r.error) { toast.error(r.error); return; }
      toast.success(`${category.name} guardada.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
      <label className="flex min-w-48 flex-1 items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={own} onChange={(e) => toggleOwn(e.target.checked)} className="h-4 w-4 accent-[color:var(--color-accent)]" />
        {category.name}
      </label>
      {own ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">+</span>
          <input type="number" className="w-20 rounded-lg border border-line-strong bg-card px-2 py-1 text-sm text-ink outline-none focus:border-accent" value={markup} onChange={(e) => setMarkup(e.target.value)} />
          <span className="text-xs text-muted">% · −</span>
          <input type="number" className="w-20 rounded-lg border border-line-strong bg-card px-2 py-1 text-sm text-ink outline-none focus:border-accent" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          <span className="text-xs text-muted">%</span>
          <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">Guardar</button>
        </div>
      ) : (
        <span className="text-xs text-muted">Usa la general (+{defaultRule.markup}% · −{defaultRule.discount}%)</span>
      )}
    </div>
  );
}
