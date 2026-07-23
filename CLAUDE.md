# Spera — ERP multicanal de Bodysculpt

> **Arquitectura, patrones y errores ya cometidos: ver [`ERP-BASE-CLAUDE.md`](./ERP-BASE-CLAUDE.md).**
> Este archivo describe **qué cambia** para Bodysculpt (indumentaria). Ante una regla
> financiera o de datos, leé primero la base y después este delta.

## Negocio
Bodysculpt: venta de **indumentaria** en Argentina. Multicanal (5 locales físicos + Tiendanube),
minorista y mayorista. **Solo ARS.** Responsable Inscripto (facturación AFIP: más adelante).

## Alcance fase 1
Productos + variantes · stock por local · POS (venta y devolución) · mayorista · listas de
precios · tipos de cliente · caja por local · cobranza · cierre de caja diario · logística con
control de picking por escaneo · Tiendanube.

**Afuera (preparado pero apagado):** compras, proveedores, pagos a proveedores, **costo**,
**rentabilidad/margen**, **facturación AFIP**. Al no haber costo, no hay CMV ni margen —se evitan
de raíz los dos errores caros de la base (IVA dentro del costo, mezclar monedas).

## Deltas vs. la base
- **Producto → producto + variantes.** `products` (modelo) + `product_variants` (unidad vendible
  con `size`/`color` texto opcional, `sku`, `barcode` único Code128). Sin-variante = 1 fila con
  nulls. Talles alfabéticos y numéricos conviven (texto libre). Todo (stock/POS/transfer/picking)
  referencia `variant_id`.
- **Depósito ≠ punto de venta.** `warehouses` (stock físico) y `stores` (punto de venta con caja).
  Cada store → un warehouse. **Tiendanube (online, sin caja) → depósito Mayorista - Central.**
- **Precio por producto** (igual en todas las variantes; override por variante opcional), **por
  lista**; la lista la define el **tipo de cliente**. Precios **IVA incluido** (finales).
  Tiendanube usa lista gestionada desde Spera → Spera empuja el precio; los pedidos entrantes
  guardan el precio como vino en el payload.
- **Cliente siempre identificado** en el POS (existe cliente por defecto "Consumidor Final").
- **Devolución** (pantalla aparte, `pendiente → aprobada`): al aprobar vuelve el stock + suma
  saldo a favor en cuenta corriente. **Regla 30 días:** al agregar una variante se chequea la
  última compra de esa variante por ese cliente; si supera 30 días o no existe, se bloquea.
- **Logística/despacho:** control de picking por escaneo sobre pedido aprobado (lista variante +
  cantidad esperada; escaneo tacha; error si variante ajena o excede; 100% habilita despachar).
- **Caja** 1 por local, cada cajero abre/cierra su turno; cierre **abierto** (no ciego). Efectivo
  → caja del turno; otros medios → cuenta financiera del medio (todos se ven en el cierre).
- **Roles:** estructura lista; por ahora solo `SuperAdministrador` (full). Futuros: cajero,
  vendedor, depósito, administración. Permisos finos, al final. Gatear por permiso.

## Stack (instalado)
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase (`@supabase/ssr`,
`@supabase/supabase-js`) · zod v4 · sonner · lucide-react. Deploy previsto: Vercel.

Clientes Supabase: `lib/supabase/server.ts` (RLS, cookies), `client.ts` (browser),
`admin.ts` (service-role, solo tras guard). Guards: `lib/auth.ts` (`requireCan`, `requireAdmin`).
Formateo es-AR y zona Buenos Aires: `lib/format.ts`.

## Migraciones
`supabase/migrations/NNNN_*.sql`, **append-only e idempotentes**. Se corren **a mano** en el SQL
Editor de Supabase, **en orden**. Nunca editar una entregada; crear la siguiente.
- `0001_base` — organizations, roles, role_permissions, profiles, `current_org_id()`,
  `get_my_permissions()`, `is_admin()`, trigger de bootstrap, RLS, seed org + SuperAdministrador.
- `0002_catalogo_stock` — warehouses, stores, products, product_variants, stock, stock_movements,
  stock_transfers(+items) + seed de 5 depósitos y 6 stores.
- `0003_clientes_precios` — price_lists, customer_types, customers, customer_movements,
  price_list_items + seed de listas/tipos + cliente Consumidor Final.

## Convenciones
- UI en **español rioplatense** (voseo). Plata con `formatMoney` (ARS).
- Lógica atómica (venta, devolución, transferencia, cobranza) en **funciones SQL** vía `rpc()`.
- Seguridad en 3 capas: ocultar botón (UI) + `requireCan` (action) + revalidar en SQL.
- `npm run build` antes de cada commit.
