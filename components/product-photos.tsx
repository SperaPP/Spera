"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Star, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { subirFoto, eliminarFoto, setFotoPrimaria, asignarColorFoto } from "@/app/(app)/productos/fotos-actions";

type Photo = { id: string; path: string; url: string; color: string | null; isPrimary: boolean };

const select =
  "rounded-lg border border-line-strong bg-card px-2 py-1 text-xs text-ink outline-none focus:border-accent";

export function ProductPhotos({ productId, photos, colors }: { productId: string; photos: Photo[]; colors: string[] }) {
  const [uploadColor, setUploadColor] = useState("");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("productId", productId);
    fd.set("color", uploadColor);
    start(async () => {
      const r = await subirFoto(fd);
      if (r.error) toast.error(r.error); else toast.success("Foto subida.");
    });
  }

  function run(fn: () => Promise<{ error?: string }>) {
    start(async () => { const r = await fn(); if (r.error) toast.error(r.error); });
  }

  return (
    <div className="mb-5 rounded-xl border border-line bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">Fotos</h2>
        <div className="flex items-center gap-2">
          <select value={uploadColor} onChange={(e) => setUploadColor(e.target.value)} className={select} title="Color al que corresponde">
            <option value="">General</option>
            {colors.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {pending ? "Subiendo…" : "Subir foto"}
          </button>
        </div>
      </div>

      {photos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-canvas px-4 py-8 text-center text-sm text-muted">
          Todavía no hay fotos. Elegí el color (o "General") y subí la primera.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-lg border border-line">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="aspect-square w-full object-cover" />
                {p.isPrimary && (
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-fg">Portada</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <select
                  value={p.color ?? ""}
                  onChange={(e) => run(() => asignarColorFoto(p.id, productId, e.target.value || null))}
                  className={`${select} min-w-0 flex-1`}
                >
                  <option value="">General</option>
                  {colors.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button title="Marcar como portada" onClick={() => run(() => setFotoPrimaria(p.id, productId))} className="rounded-md p-1 text-muted hover:bg-canvas hover:text-accent">
                  <Star className={cn("h-4 w-4", p.isPrimary && "fill-accent text-accent")} />
                </button>
                <button title="Eliminar" onClick={() => run(() => eliminarFoto(p.id, p.path, productId))} className="rounded-md p-1 text-faint hover:bg-canvas hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
