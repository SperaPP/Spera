"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { editarProducto } from "@/app/(app)/productos/actions";

type Ref = { id: string; name: string };
type Lifecycle = "actual" | "discontinuo";
type Product = { id: string; name: string; description: string; categoryId: string; mainCategoryId: string; seasonId: string; fabricTypeId: string; taxRate: number; active: boolean; portalVisible: boolean; lifecycle: Lifecycle };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1.5 block text-sm font-medium text-ink";

export function EditarProductoForm({ product, categories, mainCategories, seasons, fabricTypes }: { product: Product; categories: Ref[]; mainCategories: Ref[]; seasons: Ref[]; fabricTypes: Ref[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [mainCategoryId, setMainCategoryId] = useState(product.mainCategoryId);
  const [seasonId, setSeasonId] = useState(product.seasonId);
  const [fabricTypeId, setFabricTypeId] = useState(product.fabricTypeId);
  const [taxRate, setTaxRate] = useState(String(product.taxRate));
  const [active, setActive] = useState(product.active);
  const [portalVisible, setPortalVisible] = useState(product.portalVisible);
  const [lifecycle, setLifecycle] = useState<Lifecycle>(product.lifecycle);

  function submit() {
    if (!name.trim()) return toast.error("Ingresá un nombre.");
    start(async () => {
      const r = await editarProducto({
        id: product.id, name: name.trim(), description: description.trim() || undefined,
        categoryId: categoryId || null, mainCategoryId: mainCategoryId || null, seasonId: seasonId || null,
        fabricTypeId: fabricTypeId || null,
        taxRate: Number(taxRate) || 21, active, portalVisible, lifecycle,
      });
      if (r.error) { toast.error(r.error); return; }
      toast.success("Producto actualizado.");
      router.push(`/productos/${product.id}`);
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="name">Nombre</label>
            <input id="name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="desc">Descripción</label>
            <textarea id="desc" rows={3} className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="maincat">Categoría principal</label>
            <select id="maincat" className={input} value={mainCategoryId} onChange={(e) => setMainCategoryId(e.target.value)}>
              <option value="">Sin categoría principal</option>
              {mainCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="cat">Categoría secundaria</label>
            <select id="cat" className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="season">Temporada</label>
            <select id="season" className={input} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
              <option value="">Sin temporada</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="fabric">Tipo de tela</label>
            <select id="fabric" className={input} value={fabricTypeId} onChange={(e) => setFabricTypeId(e.target.value)}>
              <option value="">Sin especificar</option>
              {fabricTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="tax">IVA (%)</label>
            <input id="tax" type="number" className={input} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="lifecycle">Ciclo de vida</label>
            <select id="lifecycle" className={input} value={lifecycle} onChange={(e) => setLifecycle(e.target.value as Lifecycle)}>
              <option value="actual">Actual</option>
              <option value="discontinuo">Discontinuo</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[color:var(--color-accent)]" />
              Producto activo
            </label>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={portalVisible} onChange={(e) => setPortalVisible(e.target.checked)} className="h-4 w-4 accent-[color:var(--color-accent)]" />
              Publicar en portal mayorista
            </label>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-muted">
              <span className="font-medium text-ink">Ciclo de vida</span> clasifica el producto para decisiones futuras (qué reponer, qué dejar de fabricar).
              Marcar <span className="font-medium text-ink">Discontinuo</span> no lo saca de la venta: para eso destildá <span className="font-medium text-ink">Producto activo</span>.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => router.push(`/productos/${product.id}`)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}
