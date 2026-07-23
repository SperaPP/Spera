# ERP multicanal — Especificación base y decisiones de arquitectura

> **Cómo usar este archivo:** guardalo como `CLAUDE.md` en la raíz del proyecto nuevo.
> Claude Code lo carga automáticamente en cada sesión. Contiene la arquitectura
> probada, los circuitos de negocio, el modelo financiero y los errores ya
> cometidos (para no repetirlos) de un ERP en producción.

---

## 1. Contexto

Este proyecto replica la base de un ERP **multicanal para PyME argentina** ya en
producción (nombre de referencia: *Lamina*, empresa Porcenot — venta de
revestimientos/pisos, con local, mayorista y tienda online).

El sistema cubre: productos, stock por depósito, listas de precios, clientes con
cuenta corriente, pedidos, POS, presupuestos, producción, logística/despacho,
compras, proveedores, tesorería, cobranzas, cheques, pagos a proveedores,
reportes y un portal de autogestión para clientes.

**Importante:** este documento describe decisiones *ya validadas con el dueño del
negocio*. Antes de cambiar cualquier regla financiera, leer la sección 6 completa.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Framework | **Next.js (App Router)** + TypeScript |
| UI | Tailwind CSS + **shadcn/ui** (Radix) + `lucide-react` + `sonner` (toasts) |
| Backend/DB | **Supabase** (Postgres + Auth + Storage + RLS) |
| Deploy | **Vercel** (deploy automático por push a `main`) |
| Validación | **zod** en cada server action |
| Excel | **SheetJS (`xlsx`)** para importar/exportar (client-side) |

Idioma de toda la UI: **español rioplatense** (voseo: "Cargá", "Ingresá").
Moneda y formatos: `Intl.NumberFormat("es-AR")`.

---

## 3. Arquitectura y patrones OBLIGATORIOS

### 3.1 Multitenant desde el día uno
- **Toda** tabla de negocio lleva `organization_id uuid not null references organizations(id)`.
- **Toda** tabla tiene RLS habilitado con esta política:
  ```sql
  create policy <tabla>_all on public.<tabla> for all
    using (organization_id = public.current_org_id())
    with check (organization_id = public.current_org_id());
  ```
- `current_org_id()` es `STABLE SECURITY DEFINER` y resuelve la org del `auth.uid()`
  vía `profiles`. Debe ser SECURITY DEFINER para **no recursar** contra `profiles` por RLS.
- Tablas con secretos (tokens de integraciones, colas internas): **RLS habilitado
  y SIN policy** → solo accesibles con la service-role key desde el servidor.

### 3.2 La lógica de negocio va en funciones de Postgres
Todo lo que deba ser **atómico** o **no salteable** vive en una función SQL,
llamada con `supabase.rpc()`:
`create_order`, `approve_order`, `cancel_order`, `create_payment`,
`create_supplier_payment`, `adjust_stock`, `add_customer_movement`,
`add_supplier_movement`, `adjust_account_balance`, etc.

Ventajas comprobadas: un pedido que descuenta stock, genera OCs y mueve cuenta
corriente **no puede quedar a medias**.

### 3.3 Seguridad en TRES capas (no negociable)
1. **UI**: se oculta el botón si no corresponde.
2. **Server action**: `requireCan(modulo, editar)` o `requireAdmin()` al inicio.
3. **Función SQL**: revalida rol y organización.

> Lección real: durante meses hubo botones visibles que el servidor rechazaba al
> hacer clic. La seguridad estaba bien, pero la UX era pésima y generaba
> desconfianza. **Ocultar el botón es parte del trabajo, no un extra.**

### 3.4 Permisos por rol y módulo
- Tablas: `roles`, `role_permissions (role_id, module, can_view, can_edit)`.
- `profiles.role_id` asigna el rol a cada usuario.
- RPC `get_my_permissions()` devuelve `{ modulo: {view, edit} }`.
- Helpers puros: `canView(perms, mod)` / `canEdit(perms, mod)`.
- **Gatear por permiso, no por nombre de rol.** Excepción: acciones destructivas
  (borrado masivo, eliminar registros) que se reservan al rol `'Administrador'`
  verificado **por nombre dentro de la función SQL**.

### 3.5 Server actions
```ts
export async function guardarX(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const denied = await requireCan("modulo", true);
  if (denied) return denied;
  const parsed = schema.safeParse({ ...campos });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  // ... rpc / update
  revalidatePath("/ruta");
  return { ok: true };
}
```
- Formularios: `useActionState` + `<form action={action}>`.
- Feedback: `toast.success` / `toast.error` desde un `useEffect` sobre el estado.

---

## 4. Modelo de datos (módulos)

| Módulo | Tablas núcleo |
|---|---|
| Organización | `organizations`, `profiles`, `roles`, `role_permissions` |
| Catálogo | `products`, `price_lists`, `price_list_items` |
| Stock | `warehouses`, `stock`, `stock_movements`, `stock_transfers(+items)` |
| Clientes | `customers`, `customer_movements` |
| Ventas | `orders`, `order_items`, `quotes(+items)`, `coupons` |
| Producción | `production_orders` |
| Logística | campos en `orders` (`logistic_status`, `carrier`, `tracking_number`, `remito_path`) + `shipping_methods` |
| Compras | `suppliers`, `supplier_movements`, `purchase_orders(+items)` |
| Tesorería | `financial_accounts`, `account_movements`, `account_methods` |
| Cobranzas | `payments`, `payment_items`, `cheques` |
| Pagos prov. | `supplier_payments`, `supplier_payment_items` |
| Portal | `portal_users` + funciones `current_portal_org()`, `current_portal_customer()` |

### Tipos de producto (define TODO el comportamiento de stock)
| Tipo | Stock | Al vender sin stock |
|---|---|---|
| `fabricacion` | No lleva | Genera **orden de producción** |
| `compra_nacional` | Lleva, puede ir negativo | Genera **OC automática** (backorder) |
| `importacion` | Lleva, **no puede ir negativo** | **Bloquea la venta** |

> Esta distinción es la regla más usada del sistema. Aparece en aprobación de
> pedidos, disponibilidad del portal, push de stock a la tienda online y reportes.

---

## 5. Circuitos de negocio

### 5.1 Pedido (el circuito central)
```
Creación (POS / portal / tienda online) → status = en_espera
   ↓ (aprobar, manual)
approve_order():
   • fabricacion    → crea orden de producción
   • importacion    → valida stock y descuenta (si no alcanza, ERROR)
   • compra_nacional→ descuenta; si queda negativo → OC automática (backorder)
   • carga la deuda en la cuenta corriente del cliente
   ↓
Logística → despacho (tracking) → "Completado"
```
- **Editar** solo mientras está `en_espera` (no tocó nada todavía).
- **Rechazar** (en_espera) / **Cancelar** (aprobado, solo admin → revierte todo).
- Notas del vendedor visibles en Producción y Logística.

### 5.2 Compras — LA OC ES SOLO OPERATIVA
> **Decisión de negocio validada:** la orden de compra es un documento de
> **aprovisionamiento/stock**, **sin valores** y **sin impacto contable**.

- La OC automática se genera **con costo 0** (total 0).
- **Recibir** una OC **suma stock** y nada más.
- Truco de implementación: las funciones `receive_purchase_order` y
  `cancel_purchase_order` condicionan la deuda a `total > 0`. Con OCs en 0,
  **nunca** tocan la cuenta corriente. No hace falta tocar esas funciones.
- **Toda la plata de proveedores se maneja en "Pagos a proveedores".**

### 5.3 Pago a proveedor (acá vive lo financiero)
Campos: proveedor · medios de pago (cuentas) · **Oficial/Remito** · **IVA** · **Percepciones**.
```
Total pagado (= lo que sale de tesorería) = Neto + IVA + Percepciones
   • Total        → egreso de la cuenta (tesorería)
   • IVA          → IVA crédito (solo "Oficial") → balanza
   • Percepciones → saldo a favor (acumulador aparte, NO es costo)
   • Neto         → referencia (NO se usa para el margen)
```
- **Sin orden de compra.** El pago es siempre "a cuenta".
- **Efecto neutro en la cuenta corriente:** asienta una *compra implícita* (+) y
  el *pago* (−) por el mismo importe. Así **no queda saldo a favor** cuando se
  paga algo que nunca se cargó como compra.

### 5.4 Cobranza
- Se registra contra una o varias cuentas/medios, con comisión por sub-método
  (tarjeta/cuotas) → se acredita el neto en la cuenta y el total al cliente.
- Estados: pendiente → acreditada / anulada.
- **El alcance de cajas por rol NO aplica al cobrar**: un vendedor debe poder
  cobrar con cualquier medio de la empresa. El alcance limita **operar Tesorería**.

---

## 6. MODELO FINANCIERO (leer completo antes de tocar nada)

Esta sección costó varias iteraciones con el dueño. **No improvisar acá.**

### 6.1 La pregunta correcta
```
Rentabilidad = Ventas − Costo de la Mercadería VENDIDA (CMV)
```
La palabra clave es **vendida**, no *comprada*.

### 6.2 Por qué "ventas − compras del período" ESTÁ MAL
Se distorsiona con el inventario:
| Escenario | Compra | Vende | Ventas − Compras | Margen real |
|---|---|---|---|---|
| Se stockea | $1.000 | $720 | **−$280 (pérdida)** | **+$320** |
| Vende de stock | $0 | $720 | **+$720 (100%)** | **+$320** |

Solo sería válido si el inventario no varía. La fórmula contable correcta es
`CMV = Inv. Inicial + Compras − Inv. Final`, lo que exige **valuar inventario**,
o sea **costo por unidad**.

### 6.3 La solución adoptada (simple y correcta)
- **Costo por producto**, **NETO** (sin IVA), en **moneda local**, método
  **último costo**, actualizado **manualmente** en cada compra.
- Esto resuelve el matching: el CMV sale de `cantidad × costo del producto`,
  no de las compras del período.

### 6.4 IVA (Responsable Inscripto) — el error más caro
- El **IVA de la compra NO es costo**: es crédito fiscal recuperable.
  Usar el bruto de la factura como costo **subvalúa el margen ~17%**.
- El margen se calcula **NETO DE LOS DOS LADOS**:
```
Margen = Σ ( Venta neta − Cantidad × Costo neto )
  Venta neta:  oficial (con factura) → total ÷ 1,21
               remito  (sin factura) → total tal cual
  Costo neto:  el costo del producto (sin IVA)
```
- **Percepciones**: son pago a cuenta / saldo a favor. **No son costo** y **no
  entran al margen**.
- Impuestos que **SÍ** son costo (se cargan a la mercadería): en importación,
  flete, seguro, aranceles, tasa estadística y despacho (*landed cost*). El precio
  del proveedor del exterior es solo el FOB.

### 6.5 Balanza de IVA
```
Posición IVA = IVA débito (ventas oficiales) − IVA crédito (pagos "Oficial")
Percepciones = saldo a favor, se muestra APARTE
```
Criterio adoptado: el IVA crédito se reconoce **al pagar** (no a la fecha de
factura), porque todo el circuito financiero pasa por los pagos.

### 6.6 Monedas
- **Todos los costos en moneda local.** Si cambia el tipo de cambio, el usuario
  actualiza el costo a mano.
- **Nunca** restar un costo en USD de una venta en pesos. Fue un bug real: el
  margen daba absurdamente alto.

---

## 7. Integración con tienda online (patrón Tiendanube)

Aplicable a cualquier canal externo. Reglas que costaron bugs:

- **OAuth**: el token no expira; se guarda por organización junto al `store_id`.
- **Webhooks**: el proveedor manda solo `{store_id, event, id}` → hay que pedir el
  detalle por API. Verificar **firma HMAC-SHA256** del body crudo (¡en **hex**, no base64!).
- **El middleware/proxy debe dejar pasar la ruta del webhook** (si no, redirige a
  login y el webhook muere con 307).
- **Idempotencia**: índice único `(organization_id, external_id)` en pedidos.
- **⚠️ Los webhooks llegan DESORDENADOS y se reintentan.** Bug real: `order/created`
  se procesaba *después* de que el pedido fue cancelado, y lo recreaba como
  pendiente. **Solución: la ingesta debe consultar el estado actual en el
  proveedor** y, si está cancelado, no crearlo. **El proveedor externo es la
  fuente de verdad del estado.**
- **Bidireccional**: aprobar → empuja stock; rechazar/cancelar → cancela allá;
  despachar → marca enviado + tracking.
- **Regla del negocio**: el equipo **no entra al panel del proveedor**; todo se
  gestiona desde el ERP y se refleja allá.

---

## 8. Portal de clientes

- Login con email + contraseña (usuario de Auth marcado con `user_metadata.portal`).
- El middleware separa clientes del portal del staff del ERP.
- Datos vía funciones `SECURITY DEFINER` (`get_portal_catalog`, `get_portal_orders`…)
  que resuelven la org/cliente desde el token.
- Los pedidos del portal entran como **en_espera** (requieren aprobación).
- **Forzar tema claro** en el portal: es una tienda para clientes, no debe seguir
  el modo oscuro del navegador. Se logra re-declarando las variables CSS claras
  en un contenedor del portal.
- Validar stock **en el servidor** al enviar el pedido (no alcanza con la UI).

---

## 9. Errores YA COMETIDOS (no repetirlos)

### Datos y validación
- `formData.get("campo")` devuelve **`null`** si el campo no existe en el form.
  Un `z.preprocess` que solo convierte `""` a `undefined` **falla con `null`**.
  Usar: `v == null || (typeof v === "string" && v.trim() === "") ? undefined : v`.
  *(Bug real: el alta rápida de clientes fallaba siempre por un campo "notas" inexistente.)*
- No guardar en cada `onChange` de un input de fecha: al tipear el año, el primer
  dígito dispara el guardado y corta la edición. **Guardar en `onBlur`.**

### React / Next
- Un **server component no puede pasar closures** a un client component. Para
  pasar una server action con argumentos: `accion.bind(null, arg1, arg2)`.
- No importar módulos de servidor (que usan `cookies()`) desde client components.
  Separar las constantes compartidas en un archivo neutro.

### Base de datos
- La policy típica de `profiles` permite editar **solo el propio perfil**. Cambiar
  el rol de *otro* usuario con el cliente normal **falla en silencio** (0 filas).
  Usar el cliente service-role **después** del guard de permisos.
- Al eliminar registros con impacto financiero: revertir el **efecto neto** de los
  movimientos y **borrarlos**, en vez de asentar contra-movimientos (que ensucian
  la cuenta corriente).

### Fechas
- El servidor corre en **UTC**. Sin `timeZone` explícito, todo se muestra corrido.
  Fijar la zona local en el formateo **y** calcular "hoy" en esa zona (si no, cerca
  de medianoche el sistema cambia de día antes de tiempo).
- Distinguir columnas `date` (día calendario, mostrar tal cual) de `timestamptz`
  (convertir a zona local). Si no, los cumpleaños/eventos se corren un día.

### Reportes
- El margen debe usar **venta neta**, no el total con IVA.
- Nunca mezclar monedas entre costo y venta.

---

## 10. Flujo de trabajo

1. **Migraciones**: archivos numerados `NNNN_descripcion.sql` en `supabase/migrations/`.
   El usuario las corre **manualmente** en el SQL Editor de Supabase, **en orden**.
   Son **append-only**: nunca editar una ya entregada; crear una nueva.
   Usar `create or replace function`, `add column if not exists` → **idempotentes**.
2. **Verificar contra la base real**, no contra los archivos. Antes de afirmar que
   algo falta o sobra, **consultarlo**. (Se afirmó más de una vez que faltaban
   migraciones que ya estaban corridas.)
3. **Build antes de cada commit** (`npm run build`) — atrapa errores de tipos.
4. **Commit + push** → Vercel deploya solo.
5. Al terminar una feature, decir **explícitamente** qué migración hay que correr.

---

## 11. Qué adaptar para la empresa nueva

Revisar con el dueño **antes de codear**:
1. **Rubro y tipos de producto**: ¿aplica fabricación / compra nacional / importación,
   o son otras categorías con otras reglas de stock?
2. **Condición fiscal**: ¿Responsable Inscripto? Define si el IVA es costo o crédito.
3. **¿Vende con y sin factura?** (Oficial/Remito). Impacta margen y balanza.
4. **Canales**: ¿local, mayorista, tienda online? ¿cuál integrar?
5. **Roles y permisos** reales del equipo.
6. **¿Maneja cuenta corriente** de clientes y proveedores?
7. **¿Cheques, múltiples cajas, varias monedas?**
8. **Método de costeo**: último costo (recomendado con inflación) vs promedio ponderado.

---

## 12. Cómo trabajar conmigo (preferencias del usuario)

- Explicar **por qué**, no solo el qué. Le importa entender el criterio.
- **Antes de features financieras sensibles: estudiar y proponer, no codear.**
  Presentar opciones con trade-offs y pedir definición.
- Si detectás que su premisa tiene un problema, **decirlo** con fundamento.
- Verificar contra datos reales y **mostrar la evidencia**.
- Respuestas en español rioplatense, concretas, sin relleno.
