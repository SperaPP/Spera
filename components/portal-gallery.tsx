"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

export function PortalGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const main = images[active] ?? images[0] ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="aspect-square w-full bg-canvas">
        {main ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={main} alt={alt} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-faint"><ImageOff className="h-10 w-10" /></span>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-2">
          {images.slice(0, 8).map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${i === active ? "border-accent" : "border-transparent hover:border-line-strong"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
