"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Código de barras CODE39 que llena el ancho del contenedor.
 *  fill=true: además llena el alto disponible (el padre controla la altura). */
export function Barcode({ value, heightMm = 10, fill = false }: { value: string; heightMm?: number; fill?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !value) return;
    try {
      // marginLeft/Right = zona de silencio (quiet zone) horizontal, obligatoria en
      // CODE39. Va dentro del viewBox → se mantiene proporcional aunque la etiqueta
      // sea chica (clave para que escanee en 40 mm).
      JsBarcode(svg, value, { format: "CODE39", displayValue: false, margin: 0, marginLeft: 24, marginRight: 24, height: 60, width: 2 });
      // OJO: JsBarcode setea width/height con sufijo "px" → hay que parsear el
      // número, si no el viewBox queda inválido ("0 0 272px 60px") y el SVG
      // pierde la proporción (se estira/deforma → el lector no engancha).
      const w = parseFloat(svg.getAttribute("width") || "0");
      const h = parseFloat(svg.getAttribute("height") || "0");
      if (w && h) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      // Proporción natural (NO estirar): estirar a lo ancho deforma la relación
      // barra ancha/angosta del CODE39 y el lector no decodifica. "meet" ajusta
      // el código al espacio manteniendo las proporciones, centrado.
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    } catch {
      /* valor no codificable */
    }
  }, [value]);
  // fill (etiqueta): ancho 100% + alto automático (proporcional) → el código entra
  // COMPLETO a todo el ancho, más bajo, sin empastar el térmico. crispEdges: sin
  // suavizado, bordes nítidos.
  return <svg ref={ref} shapeRendering="crispEdges" style={{ width: "100%", height: fill ? "auto" : `${heightMm}mm`, display: "block", shapeRendering: "crispEdges" }} />;
}
