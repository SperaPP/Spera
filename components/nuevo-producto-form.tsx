"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { crearProducto, agregarValorCatalogo } from "@/app/(app)/productos/actions";

type Ref = { id: string; name: string };
type Variation = "none" | "size" | "color" | "size_color";
type CatalogKind = "categoria" | "tela" | "talle" | "color";

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1.5 block text-sm font-medium text-ink";
const card = "rounded-xl border border-line bg-card p-5";

const rowKey = (size: string, color: string) => `${size}||${color}`;

// "+ Agregar nuevo" inline: crea un valor de catálogo sin salir del alta.
function InlineAdd({
  kind,
  labelText,
  onAdded,
}: {
  kind: CatalogKind;
  labelText: string;
  onAdded: (item: Ref) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const name = val.trim();
    if (!name) return;
    setBusy(true);
    const res = await agregarValorCatalogo(kind, name);
    setBusy(false);
    if (res.error) return toast.error(res.error);
    if (res.item) {
      onAdded(res.item);
      setVal("");
      setOpen(false);
      toast.success(`${labelText} agregado.`);
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Agregar nuevo
      </button>
    );

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(); }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={`Nuevo ${labelText.toLowerCase()}…`}
        className={`${input} py-1.5`}
      />
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
      >
        {busy ? "…" : "Agregar"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="shrink-0 rounded-lg border border-line-strong p-1.5 text-muted hover:bg-canvas">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: Ref[];
  selected: string[];
  onToggle: (name: string) => void;
}) {
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  // Muestra siempre los seleccionados + los que matchean la búsqueda.
  const shown = options.filter(
    (o) => selected.includes(o.name) || (query ? o.name.toLowerCase().includes(query) : true)
  );
  const limited = query ? shown : shown.slice(0, 60);

  return (
    <div>
      {options.length > 15 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar entre ${options.length}…`}
          className={`${input} mb-2`}
        />
      )}
      {options.length === 0 ? (
        <p className="text-sm text-muted">No hay opciones cargadas todavía.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {limited.map((o) => {
            const on = selected.includes(o.name);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onToggle(o.name)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  on
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-line-strong text-ink hover:bg-canvas"
                )}
              >
                {o.name}
              </button>
            );
          })}
        </div>
      )}
      {!query && shown.length > limited.length && (
        <p className="mt-2 text-xs text-muted">
          Mostrando {limited.length} de {options.length}. Usá el buscador para ver el resto.
        </p>
      )}
      {selected.length > 0 && (
        <p className="mt-2 text-xs text-muted">{selected.length} seleccionado(s)</p>
      )}
    </div>
  );
}

export function NuevoProductoForm({
  categories,
  sizes,
  colors,
  fabricTypes,
  priceLists,
  warehouseId,
  warehouseName,
}: {
  categories: Ref[];
  sizes: Ref[];
  colors: Ref[];
  fabricTypes: Ref[];
  priceLists: Ref[];
  warehouseId: string | null;
  warehouseName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Catálogos como estado: el "+ agregar nuevo" los amplía sin recargar.
  const [cats, setCats] = useState<Ref[]>(categories);
  const [fabrics, setFabrics] = useState<Ref[]>(fabricTypes);
  const [sizeList, setSizeList] = useState<Ref[]>(sizes);
  const [colorList, setColorList] = useState<Ref[]>(colors);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [fabricTypeId, setFabricTypeId] = useState("");
  const [variation, setVariation] = useState<Variation>("size_color");
  const [taxRate, setTaxRate] = useState("21");
  const [selSizes, setSelSizes] = useState<string[]>([]);
  const [selColors, setSelColors] = useState<string[]>([]);
  const [stockData, setStockData] = useState<Record<string, string>>({});
  const [skuData, setSkuData] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});

  const usesSize = variation === "size" || variation === "size_color";
  const usesColor = variation === "color" || variation === "size_color";

  const toggle = (arr: string[], set: (v: string[]) => void, name: string) =>
    set(arr.includes(name) ? arr.filter((x) => x !== name) : [...arr, name]);

  const rows = useMemo(() => {
    if (variation === "none") return [{ size: "", color: "" }];
    if (variation === "size") return selSizes.map((s) => ({ size: s, color: "" }));
    if (variation === "color") return selColors.map((c) => ({ size: "", color: c }));
    const out: { size: string; color: string }[] = [];
    for (const s of selSizes) for (const c of selColors) out.push({ size: s, color: c });
    return out;
  }, [variation, selSizes, selColors]);

  function submit() {
    if (!name.trim()) return toast.error("Ingresá un nombre.");
    if (usesSize && selSizes.length === 0) return toast.error("Elegí al menos un talle.");
    if (usesColor && selColors.length === 0) return toast.error("Elegí al menos un color.");

    // No permitir SKUs repetidos entre las variantes que se están cargando.
    const skus = rows.map((r) => skuData[rowKey(r.size, r.color)]?.trim()).filter(Boolean);
    if (new Set(skus).size !== skus.length) return toast.error("Hay SKUs repetidos entre las variantes.");

    const variants = rows.map((r) => {
      const key = rowKey(r.size, r.color);
      return {
        size: r.size || undefined,
        color: r.color || undefined,
        sku: skuData[key]?.trim() || undefined,
        stock: Number(stockData[key]) || 0,
      };
    });

    startTransition(async () => {
      const res = await crearProducto({
        name: name.trim(),
        description: description.trim() || undefined,
        categoryId: categoryId || null,
        fabricTypeId: fabricTypeId || null,
        variationType: variation,
        taxRate: Number(taxRate) || 21,
        warehouseId: warehouseId,
        variants,
        prices: priceLists.map((pl) => ({
          priceListId: pl.id,
          price: prices[pl.id]?.trim() ? Number(prices[pl.id]) : null,
        })),
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Producto creado.");
        router.push("/productos");
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Datos */}
      <div className={card}>
        <h2 className="mb-4 text-sm font-medium text-ink">Datos del producto</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="name">Nombre</label>
            <input id="name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Faja reductora" />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="desc">Descripción</label>
            <textarea id="desc" rows={3} className={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Se usa en la venta y en Tiendanube." />
          </div>
          <div>
            <label className={label} htmlFor="cat">Categoría</label>
            <select id="cat" className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <InlineAdd
              kind="categoria"
              labelText="Categoría"
              onAdded={(item) => { setCats((p) => [...p, item].sort((a, b) => a.name.localeCompare(b.name))); setCategoryId(item.id); }}
            />
          </div>
          <div>
            <label className={label} htmlFor="fabric">Tipo de tela</label>
            <select id="fabric" className={input} value={fabricTypeId} onChange={(e) => setFabricTypeId(e.target.value)}>
              <option value="">Sin especificar</option>
              {fabrics.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <InlineAdd
              kind="tela"
              labelText="Tela"
              onAdded={(item) => { setFabrics((p) => [...p, item].sort((a, b) => a.name.localeCompare(b.name))); setFabricTypeId(item.id); }}
            />
          </div>
          <div>
            <label className={label} htmlFor="variation">Tipo de variación</label>
            <select id="variation" className={input} value={variation} onChange={(e) => setVariation(e.target.value as Variation)}>
              <option value="none">Sin variantes</option>
              <option value="size">Solo talle</option>
              <option value="color">Solo color</option>
              <option value="size_color">Talle y color</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="tax">IVA (%)</label>
            <input id="tax" type="number" className={input} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Variantes */}
      <div className={card}>
        <h2 className="mb-1 text-sm font-medium text-ink">Variantes y stock inicial</h2>
        <p className="mb-4 text-xs text-muted">
          Dejá el SKU vacío para que se genere correlativo, o escribí uno propio (sin repetir).
          Stock inicial en <span className="font-medium text-ink">{warehouseName}</span>.
        </p>

        {usesSize && (
          <div className="mb-4">
            <label className={label}>Talles</label>
            <Chips options={sizeList} selected={selSizes} onToggle={(n) => toggle(selSizes, setSelSizes, n)} />
            <InlineAdd
              kind="talle"
              labelText="Talle"
              onAdded={(item) => { setSizeList((p) => [...p, item]); setSelSizes((p) => [...p, item.name]); }}
            />
          </div>
        )}
        {usesColor && (
          <div className="mb-4">
            <label className={label}>Colores</label>
            <Chips options={colorList} selected={selColors} onToggle={(n) => toggle(selColors, setSelColors, n)} />
            <InlineAdd
              kind="color"
              labelText="Color"
              onAdded={(item) => { setColorList((p) => [...p, item].sort((a, b) => a.name.localeCompare(b.name))); setSelColors((p) => [...p, item.name]); }}
            />
          </div>
        )}

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong bg-canvas px-4 py-6 text-center text-sm text-muted">
            Elegí {usesSize ? "talles" : ""}{usesSize && usesColor ? " y " : ""}{usesColor ? "colores" : ""} para generar las variantes.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-3 py-2.5 font-medium">Variante</th>
                  <th className="px-3 py-2.5 font-medium">SKU</th>
                  <th className="px-3 py-2.5 font-medium">Stock inicial</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = rowKey(r.size, r.color);
                  return (
                    <tr key={key} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        {variation === "none" ? (
                          <span className="text-muted">Única</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {r.size && <span className="rounded-md bg-canvas px-2 py-0.5 text-xs font-medium text-ink">{r.size}</span>}
                            {r.color && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{r.color}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 w-44">
                        <input
                          className={`${input} py-1.5`}
                          value={skuData[key] ?? ""}
                          onChange={(e) => setSkuData((p) => ({ ...p, [key]: e.target.value }))}
                          placeholder="Automático"
                        />
                      </td>
                      <td className="px-3 py-2 w-40">
                        <input
                          type="number"
                          min={0}
                          className={`${input} py-1.5`}
                          value={stockData[key] ?? ""}
                          onChange={(e) => setStockData((p) => ({ ...p, [key]: e.target.value }))}
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Precios */}
      {priceLists.length > 0 && (
        <div className={card}>
          <h2 className="mb-1 text-sm font-medium text-ink">Precio</h2>
          <p className="mb-4 text-xs text-muted">Precio final (IVA incluido), igual para todas las variantes. Es opcional: podés dejarlo vacío y cargarlo después desde Precios.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {priceLists.map((pl) => (
              <div key={pl.id}>
                <label className={label} htmlFor={`price-${pl.id}`}>{pl.name}</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">$</span>
                  <input
                    id={`price-${pl.id}`}
                    type="number"
                    min={0}
                    className={input}
                    value={prices[pl.id] ?? ""}
                    onChange={(e) => setPrices((p) => ({ ...p, [pl.id]: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push("/productos")}
          className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Creando…" : "Crear producto"}
        </button>
      </div>
    </div>
  );
}
