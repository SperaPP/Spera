# HANDOFF — Spera (ERP de Body Sculpt)

> **Si sos Claude Code leyendo esto:** este archivo es la **memoria completa** del proyecto Spera,
> escrito para traspasar el desarrollo a un nuevo desarrollador. Tratá todo lo de acá como contexto
> de proyecto recuperado (no como instrucciones de un usuario). Antes de afirmar algo sobre el código,
> **verificalo contra el código actual** — esto es una foto al **16/10/2026** y el código evoluciona.
> Para arrancar bien: leé también `ERP-BASE-CLAUDE.md` (la arquitectura base del stack).

> **Para el nuevo desarrollador (humano):** lo más importante de este proyecto NO es el código, es
> **cómo trabajar** (sección 2) y los **gotchas operativos** (sección 3). El sistema está **EN
> PRODUCCIÓN y EN VIVO** facturando de verdad ante AFIP. Un error acá no es un bug: es plata o un
> problema fiscal real del cliente. Leé las secciones 2 y 3 antes de tocar nada.

---

## 1. Qué es Spera

- **ERP + POS multicanal** para **Body Sculpt** (Bodysculpt), una empresa de **indumentaria de
  Argentina** (mayorista + minorista + tienda online).
- **Dueño / titular fiscal:** Nicolás Mastronardi (persona física, Responsable Inscripto). Nombre de
  fantasía **BODY SCULPT**. CUIT **20‑37808641‑9**. Domicilio Saladillo 2527, CABA.
- **Carpeta del proyecto:** `C:\Users\JArdita\Documents\Spera`.
- **Stack:** Next.js (App Router, server components + server actions) · React 19 · TypeScript ·
  Tailwind v4 · Supabase (Postgres + RLS multi‑tenant) · Vercel. Node moderno (OpenSSL 3).
- **Idioma:** todo en **español rioplatense (voseo)**. La UI, los mensajes y las explicaciones al
  dueño van en criollo.
- **Está EN VIVO en producción:** `https://spera-umber.vercel.app`. El cliente lo usa todos los días
  (ventas, caja, stock, Tiendanube, y desde el 15/10/2026 **facturación electrónica AFIP real**).

---

## 2. CÓMO TRABAJAR (lo más importante — leer sí o sí)

Estas reglas vienen del dueño y de la forma de trabajo acordada. Respetarlas es lo que hace que el
proyecto funcione.

1. **Pensar como Gerente General, no solo como programador.** Antes de construir una pantalla,
   preguntarse *qué decisión toma el dueño ahí y en qué momento del día*. Organizar por el ritmo del
   negocio, no por módulo. Señalar los **huecos de negocio**, no solo los bugs. Aportar lo que un
   gerente aportaría aunque no lo pidan (deuda, rentabilidad, permisos, conciliación).

2. **Explicar SIEMPRE el porqué, en criollo.** Todo término técnico va con su traducción a lenguaje
   llano. El dueño valida el modelo de negocio antes de que se escriba una línea de código. **Nada de
   código hasta validar el modelo** en features sensibles. Proponer con trade‑offs.

3. **Seguridad verificable (crítico — hay firma fiscal y datos de terceros):**
   - **Nunca afirmar que algo es seguro: demostrarlo** con un test que se pueda correr y **ver fallar**
     (probarlo rompiendo el sistema a propósito).
   - **Enunciar el riesgo junto con su proporción**, en el mismo mensaje (cuán probable, cuánto escala,
     cuál es la mitigación y su costo). Una lista de riesgos sin proporción asusta y frena.
   - Decir siempre el **límite** ("esto vuelve el accidente imposible, no al atacante"). Prometer de
     menos.
   - Capas independientes de defensa (la base rechaza el accidente en el momento, el test lo detecta,
     etc.).

4. **Migraciones: numeradas, append‑only, idempotentes, y SE CORREN A MANO.** Ver sección 4.

5. **`tsc --noEmit` + `npm run build` antes de cada commit.** Commit + push por cada cambio terminado
   (cada push auto‑deploya a Vercel).

6. **No mezclar proyectos.** El dueño tiene varios sistemas (Lamina, Cotton, Ibérico, Cayre, etc.).
   Spera se para solo: no citar decisiones de otro proyecto como fuente.

---

## 3. GOTCHAS OPERATIVOS (te van a morder si no los sabés)

1. **Credenciales de GitHub cruzadas (pasa seguido).** La máquina tiene cacheadas credenciales de
   OTRAS cuentas de GitHub (porcenotdev, IbericoDistri…) que **NO** tienen acceso a `SperaPP/Spera`
   → el `git push` da **403**. Solución: en el *Administrador de credenciales de Windows* borrar la
   entrada `git:https://github.com` y volver a autenticar con la cuenta de **SperaPP** (sistemabody).
   El commit queda local; solo falla el push.

2. **Las migraciones las corre el dueño/vos A MANO** en el **SQL Editor de Supabase**, en orden.
   El código deployado puede leer columnas/funciones de una migración **antes** de que esté corrida →
   falla hasta que se corre. Al pushear algo con migración, **avisar qué migración hay que correr**.
   - Al pegar en el SQL Editor, la **primera línea tiene que empezar con `--`** (si se pega el nombre
     del archivo arriba, da "trailing junk after numeric literal").
   - Si un `ALTER TABLE ADD CONSTRAINT`/CHECK falla por datos previos, Supabase **revierte toda la
     migración** (corre en transacción).

3. **AFIP + Node moderno = `ERR_SSL_DH_KEY_TOO_SMALL`.** El servidor de facturación de AFIP
   (`servicios1.afip.gov.ar`) negocia una clave Diffie‑Hellman de 1024 bits que OpenSSL 3 (Node de
   Vercel) rechaza → "fetch failed". **Ya está resuelto** con un dispatcher de `undici`
   (`lib/arca/http.ts`, `@SECLEVEL=1`, solo para llamadas a AFIP). Si algún día se migra o se agrega
   otra integración con AFIP, **usar ese mismo dispatcher**. (La autenticación WSAA NO fallaba, por
   eso "Probar conexión" daba verde pero facturar fallaba — no te confundas.)

4. **La facturación es REAL.** Desde el 15/10/2026 `ARCA_ENV=produccion`. Cada "Facturar" emite un
   comprobante fiscal legal. Para revertir: **nota de crédito** (ya existe). No hay "deshacer".

5. **Supabase free se pausa a los ~7 días de inactividad** (si alguna vez el proyecto estuviera en
   free). Hoy está en **Pro** (lo pasó el dueño por las fotos). Verificar.

---

## 4. Infra, accesos y variables de entorno

- **GitHub:** `SperaPP/Spera` → `https://github.com/SperaPP/Spera.git`. Autor git: `sistemabody@gmail.com`.
  Cada `git push origin main` **auto‑deploya** a Vercel.
- **Supabase:** project ref `viubnoeqydvdocjwgfrm`, URL `https://viubnoeqydvdocjwgfrm.supabase.co`,
  región São Paulo. Plan **Pro**. Las migraciones se corren en el **SQL Editor**.
- **Vercel:** proyecto `spera`, dominio `https://spera-umber.vercel.app`. El plan es Hobby → **el cron
  de Vercel no se usa**; el sync de stock TN lo dispara **pg_cron de Supabase cada minuto**.
- **Organización (org id):** Bodysculpt = `a9695a41-4c61-4680-bfee-68a0c3af32a8` (mono‑org por ahora).

### Variables de entorno (en Vercel y en `.env.local` local)
| Variable | Qué es |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase público |
| `SUPABASE_SERVICE_ROLE_KEY` | Service‑role (SECRETO, saltea RLS, solo server) |
| `TIENDANUBE_APP_ID` = `40294` | App de Tiendanube |
| `TIENDANUBE_CLIENT_SECRET` | SECRETO (conviene rotarlo alguna vez) |
| `TIENDANUBE_USER_AGENT` = `Spera (sistemabody@gmail.com)` | Header obligatorio de TN |
| `CRON_SECRET` | Bearer que protege `/api/tiendanube/sync-stock` (también en el pg_cron de Supabase) |
| **`ARCA_ENV`** = `produccion` | Entorno AFIP (`homologacion` \| `produccion`) |
| **`ARCA_CUIT`** = `20378086419` | CUIT del emisor |
| **`ARCA_PTO_VENTA`** = `45` | Punto de venta habilitado para Web Services |
| **`ARCA_CERT`** | Certificado .pem de **producción** (multilínea). SECRETO |
| **`ARCA_KEY`** | Clave privada .pem (multilínea). **SECRETO** |
| `ARCA_PADRON_SERVICE` | **Vacío** hoy (padrón apagado). Se setea al alcance que tenga el cliente (ej. `ws_sr_padron_a4`) para encenderlo |
| `ARCA_IIBB`, `ARCA_INICIO_ACT`, `ARCA_RAZON_SOCIAL`, etc. | Datos del emisor para el comprobante impreso (tienen default razonable en `arcaEmisor()`) |

> **Certificados AFIP:** hay dos (mismo `private.key`): el de **homologación** (issuer *"Computadores
> Test"*) y el de **producción** (`Body Sculpt_5dcf82f3cbf27476.crt`, issuer *"Computadores"*). En
> Vercel está cargado el de **producción**. `certEnvironment()` detecta cuál es por el emisor y la
> pantalla `/configuracion/arca` avisa en rojo si no coincide con `ARCA_ENV`.

---

## 5. Arquitectura y patrones clave

- **3 capas de seguridad:** (1) RLS en la base scopeada por `current_org_id()`; (2) guard en el server
  action (`requireCan(module, edit)` / `requireAdmin()` de `lib/auth.ts`); (3) guard **dentro de las
  RPC** (`has_perm(module, edit)` / `is_admin()`), null‑safe (`auth.uid() is not null and not …`) para
  que el service‑role pase. **Gatear por permiso, no por nombre de rol.**
- **Lógica atómica en funciones SQL (plpgsql RPC).** Las operaciones de plata/stock viven en RPCs con
  `for update` locks. Clientes: `createClient()` (SSR cookie, respeta RLS) y `createAdminClient()`
  (service‑role, saltea RLS — usar **solo después** de un guard).
- **Modelo de stock (crítico):** `stock.quantity` = **físico**, `stock.reserved` = **reservado**,
  **disponible = físico − reservado**. CHECK `reserved>=0 and reserved<=quantity` y `quantity>=0`.
  Mostrador/cambio **descuentan físico**; mayorista/portal/TN **reservan**; el despacho descuenta
  físico + libera reserva. **UI: mostrar SIEMPRE los 3 números** (físico · reservado · disponible),
  nunca uno solo (ya se probó y confundía).
- **Cuenta corriente = un solo número neteado** (`customers.balance`: >0 debe, <0 a favor), protegido
  por el trigger `guard_customer_balance` (solo lo mueven las RPC de negocio con flag `app.cust_bal`).
  Usar el saldo a favor para cobrar es **balance‑neutral**.
- **Regla de negocio madre:** **nadie despacha sin que el pedido esté pago** (`dispatch_sale` se traba
  si `paid_amount < total`). La cta cte existe pero ya no sirve para retirar fiado.
- **Permisos (módulos):** `lib/permissions.ts` → pos, ventas, logistica, reposiciones, productos,
  stock, control_stock, transferencias, clientes, precios, caja, caja_admin, cobranzas, reportes,
  configuracion, tiendanube. Hoy el rol real es **SuperAdministrador** (full).
- **Sistema visual "Studio":** sidebar carbón + acento índigo. Tokens en `app/globals.css` (`@theme`
  Tailwind v4): `--color-canvas/card/ink/muted/line/accent/sidebar…`. Cambiando `--color-accent` se
  repinta todo. Bodysculpt todavía no pasó colores/logo de marca.

---

## 6. Módulos (todo HECHO y EN PRODUCCIÓN, salvo lo de la sección 8)

- **Catálogo / Productos:** productos + variantes (`product_variants`, identidad = **SKU**, barcode
  CODE39), fotos por producto+color (`product_images`, bucket Storage `product-images`), lifecycle
  actual/discontinuo. ~16.600 variantes importadas de WooCommerce.
- **Precios:** 2 listas — **Mayorista** (base, a mano) y **Público** (= round(Mayorista×2), derivada).
  Módulo `/precios` con export/import Excel.
- **POS (`/pos`):** mostrador (consumidor final, lista Público, cobro exacto, datos opcionales como
  snapshot) y mayorista (DNI/CUIT obligatorio, cliente con lista). Caja embebida, precio bloqueado,
  descuentos **solo por cupón**. `create_sale` descuenta (mostrador) o reserva (mayorista).
- **Caja:** caja chica por cajero (se arrastra) + caja fuerte por local; apertura/cierre por turno
  (arqueo abierto), entrega a central, ajustes (`caja_admin`). Multi‑cajero (titular + apoyos).
- **Cobranzas:** `create_receipt` con imputación a pedidos (FIFO sugerido, editable), saldo a favor.
- **Cambios (`/cambios`):** unificado por producto, FIFO, 30 días, minorista pierde el sobrante /
  mayorista va a cuenta corriente.
- **Logística:** control por escaneo (`control_sale`) → despacho (`dispatch_sale`, con tracking).
  Transferencias en 2 fases (enviar/recibir por escaneo). Reposiciones mostrador←Central.
- **Clientes:** alta/edición, cuenta corriente, unificar duplicados (`merge_customers`), condición
  fiscal, botón **"AFIP"** (trae condición del padrón — hoy apagado).
- **Reportes** (`/reportes`), **Usuarios y roles** (`/usuarios`, matriz de permisos), **Etiquetas**
  (Brother QL‑800, CODE39), **Configuración** (catálogos, medios de pago, tipos de cliente, locales,
  logística, cupones).
- **Portal mayorista (`/portal/*`):** self‑service de clientes mayoristas. Auth con Supabase Auth sin
  `profiles` (se distinguen por `customers.auth_user_id` + `portal_status`); **todo lee con
  service‑role** scopeado a mano (sin profile, `current_org_id()` es null). Registro→aprobación,
  catálogo, pedido a cuenta corriente, pedidos, cuenta.
- **Tiendanube:** conectado a la tienda real `bodysculpt7.mitiendanube.com` (store_id **4295048**).
  Ingesta de pedidos por **webhook** (`/api/tiendanube/webhooks/[topic]` → `ingest_tn_order`) +
  **respaldo por polling** (cron). Sync de stock por **outbox** (`tn_stock_sync_queue` + trigger
  `tg_enqueue_tn_stock`, **SECURITY DEFINER**) drenado por `/api/tiendanube/sync-stock`. Vínculos
  Spera↔TN por SKU (`tiendanube_links`), con auto‑reparación por 404 y botón "Reparar vínculos".
- **Facturación electrónica AFIP (ARCA):** ver sección 7.

---

## 7. ARCA / AFIP (facturación electrónica) — EN PRODUCCIÓN

**Estado: FUNCIONANDO EN VIVO.** Primera factura real emitida el 15/10/2026 (venta 1862, Factura B
0045‑00000001, CAE 86427857913986).

### Reglas de alcance CERRADAS con el dueño (no cambiar sin pedirle)
- Spera es **intermediario**: ARCA emite y da el CAE; Spera solo manda los datos de ESE comprobante.
- **Solo se factura al apretar el botón "Facturar".** Nada automático (ni por venta, ni cron).
- El Web Service **no recibe el detalle de productos** (solo totales + IVA + doc del cliente).
- Cert/clave **solo como env secret**, firma **local** (node‑forge). **Nunca** usar un "AFIP SDK en la
  nube" que reciba el certificado.

### Cómo está armado (`lib/arca/`)
- `config.ts` — entorno homo/prod, endpoints, datos del emisor (`arcaEmisor()`), padrón configurable.
- `http.ts` — **dispatcher undici con `@SECLEVEL=1`** para el DH viejo de AFIP (gotcha #3).
- `wsaa.ts` — autenticación: arma TRA, firma CMS/PKCS#7 (node‑forge), `LoginCms`, cachea el **TA ~12h**
  en la tabla `arca_auth_tickets` (`getAuthTicket(org, service)`). `certEnvironment()`.
- `wsfe.ts` — `FECompUltimoAutorizado` (numeración) + `FECAESolicitar` (CAE). Incluye
  `CondicionIVAReceptorId` (**RG 5616**) y `CbtesAsoc` (para notas de crédito). Timeout 45s.
- `padron.ts` — consulta la condición IVA real por CUIT (hoy **apagado**: `ARCA_PADRON_SERVICE` vacío,
  porque el cliente no tiene el alcance `a5` habilitado en AFIP).
- `app/(app)/ventas/[id]/facturar-actions.ts` — `facturarVenta(saleId)` y `emitirNotaCredito(saleId)`:
  solo admin, idempotentes, nunca automáticas. Deciden Factura **A** (RI con CUIT, tipo 1) o **B**
  (resto, tipo 6; CUIT 80 / DNI 96 / consumidor final 99). Neto/IVA 21% backed‑out del total
  (precios con IVA incluido): `neto = round(total/1.21)`, `iva = total − neto`.
- `components/facturar-button.tsx` / `nota-credito-button.tsx` — botones con candado anti‑doble‑click,
  "Esperando factura…", y muestran el **error real de AFIP**.
- `app/(app)/ventas/[id]/comprobante/page.tsx` + `components/comprobante-arca.tsx` — comprobante A4
  imprimible con **QR oficial de AFIP** (lib `qrcode`). Acepta `?doc=<id>` (factura o NC).
- `app/(app)/configuracion/arca/` — pantalla de estado + "Probar conexión".
- Tabla `arca_invoices` (comprobantes emitidos, único por org+entorno+tipo+PV+nro; factura + NC por
  venta vía `asociado_a`).

### Probado end‑to‑end
Homologación: Factura B, NC B, Factura A, NC A — todas con CAE y comprobante con QR. Producción:
Factura B real (venta 1862).

---

## 8. QUÉ FALTA / pendientes (nada bloquea; el core está completo y en vivo)

- **Padrón AFIP (auto‑condición del cliente):** está programado pero **apagado**. El cliente no tiene
  `ws_sr_padron_a5` en AFIP (ve a3/a4). Para encenderlo: autorizar en AFIP el alcance que tenga (ej.
  `ws_sr_padron_a4` o `ws_sr_constancia_inscripcion`) sobre el cert de producción, setear
  `ARCA_PADRON_SERVICE` con ese nombre, y **validar el parser de `padron.ts`** con ese alcance (el
  parser hoy busca `<datosMonotributo>` e `<idImpuesto>30/32>` — confirmar que ese alcance los
  devuelve igual).
- **Umbral de consumidor final en Factura B:** AFIP exige identificar al comprador por encima de
  cierto monto (hoy no se valida; si pasa, AFIP rechaza y hay que cargar el doc del cliente).
- **ARCA opcionales:** enviar el comprobante por email; libro IVA ventas.
- **Confidencialidad de LECTURA (de la auditoría de producción, ítem grande que quedó abierto):** el
  `SELECT` de `customers`/`price_list_items`/`sales` es org‑only → un usuario autenticado podría leer
  PII/saldos/precios por API directa aunque su rol no los vea en la UI. `requireView()` ya gatea las
  **páginas** de /reportes, /clientes, /cobranzas, pero el RLS de **lectura por módulo** NO está. Es
  delicado (gatear mal esconde datos que un rol sí necesita) → **hacer con el dueño al lado probando
  con logins no‑admin**, no a ciegas.
- **Smoke test con login NO‑admin:** nunca se validó con un rol real no‑admin (siempre se probó con
  admin/service‑role). Cuando se creen roles reales (cajero, vendedor, depósito), confirmar que no ven
  módulos ajenos ni pueden anular/ajustar.
- **Tiendanube opcionales:** publicar altas nuevas (14.5k solo‑Spera) NO se hace a propósito (la web
  es vidriera curada); despacho→etiqueta Correo Argentino→tracking no construido; rotar el
  `TIENDANUBE_CLIENT_SECRET`.
- **Infra:** la **Site URL de Supabase** apunta a localhost → el mail de "recuperar contraseña" abre
  localhost. Workaround actual: cambiar pass desde `/cuenta` o reset por admin en `/usuarios`.
  Pendiente: cambiar la Site URL a la de Vercel + Custom SMTP para el remitente.
- **Diferido por el dueño (fuera de alcance hasta que lo pida):** compras, proveedores, **costo**,
  **rentabilidad/margen**.

---

## 9. Estado de las migraciones

- Última migración: **0119** (`0119_arca_notas_credito.sql`). Van del 0001 al 0119 en
  `supabase/migrations/`.
- **Todas las migraciones hasta 0119 están corridas en producción** (el dueño las corrió a mano a lo
  largo del proyecto). Si tenés dudas de cuáles están aplicadas, verificá en el SQL Editor buscando la
  función/tabla/columna que agrega cada una.
- Migraciones de esta última etapa (facturación): **0117** (arca_auth_tickets), **0118**
  (arca_invoices), **0119** (notas de crédito). Las de la auditoría de sistema: **0109–0116**.

---

## 10. Scripts útiles (en `scripts/` y en el scratchpad)

Todos los scripts de diagnóstico son **read‑only** y se corren con el service‑role de `.env.local`:
`node --env-file=.env.local scripts/<x>.mjs` (o leyendo `.env.local` a mano como hacen varios).

- Importación: `import-woo.mjs`, `import-woo-photos.mjs`, `relink-fotos.mjs`, `apply-stock-central.mjs`.
- Tiendanube: `tn-connect.mjs` (guardar token desde el `code` OAuth), `tn-adopt.mjs`,
  `tn-push-stock.mjs`, `tn-register-webhooks.mjs`, `tn-analisis.mjs`.
- Diagnóstico ARCA (ejemplos que se usaron para debuggear producción, en el scratchpad de la sesión):
  consultar `arca_invoices`, `arca_auth_tickets`, y llamar a `FECompUltimoAutorizado` de AFIP reusando
  el TA cacheado para ver el **último número autorizado** sin emitir nada. **Patrón clave para
  diagnosticar facturación sin riesgo de duplicar.**

**Regla de oro al diagnosticar AFIP:** nunca pedir un TA nuevo por fuera de la app (WSAA no deja pedir
otro mientras uno siga válido → romperías la app por 12h). **Reusá el TA cacheado** en
`arca_auth_tickets` y llamá solo a métodos de **consulta** (`FECompUltimoAutorizado`).

---

## 11. Historial de auditorías (contexto de por qué el código es como es)

El sistema pasó por **varias auditorías** multi‑revisor; los fixes están en migraciones:
- **Auditoría de producción (ago 2026):** migs 0050–0071. Cerró multicajero, invariantes de stock,
  locks anti‑doble‑operación, candado de `customers.balance`, seguridad OAuth/webhooks TN, guards de
  rol en RPC destructivas.
- **Auditoría de stock (oct 2026):** migs 0105–0108. Log de reservas, importación que respeta
  reservas, faltante registrado, auto‑reparación de vínculos TN por SKU.
- **Auditoría de sistema end‑to‑end (oct 2026):** migs 0109–0116. Guards null‑safe en las RPC que
  faltaban, doble reversa venta+cobranza, dedup de cupones, apoyos de caja acotados al turno, fixes de
  portal, y **el bug grande**: `tg_enqueue_tn_stock` era SECURITY INVOKER → el stock del POS
  mayorista/portal no se empujaba a TN (fix 0116: pasó a SECURITY DEFINER). **Lección:** todo trigger
  que escriba en una tabla con RLS‑sin‑policy tiene que ser SECURITY DEFINER.

Decisiones del dueño que NO hay que re‑proponer: límite de crédito (no), vencimiento automático de
reservas (no, se anula a mano), precio unitario libre en el POS (override de mostrador deliberado),
mostrar siempre los 3 números de stock.

---

## 12. Primeros pasos para el nuevo desarrollador

1. Clonar `SperaPP/Spera`, crear `.env.local` con las variables de la sección 4 (pedírselas al dueño /
   sacarlas de Vercel; el cert/clave AFIP y el service‑role son SECRETOS).
2. `npm install` → `npm run dev` (puerto 3000) para levantar local.
3. Leer `ERP-BASE-CLAUDE.md` (arquitectura base) y recorrer `app/(app)/` (panel interno) y
   `app/portal/` (portal mayorista).
4. Antes de cualquier cambio: `tsc --noEmit` + `npm run build`. Commit + push = auto‑deploy.
5. Si tocás algo de plata/stock/fiscal: proponer el modelo al dueño primero, y si hay migración,
   avisar que hay que correrla en Supabase.

> **Resumen en una línea:** Spera es un ERP+POS en producción para una indumentaria AR, con POS
> multicanal, Tiendanube y facturación AFIP real andando. El core está completo y auditado. Lo que
> queda es refinamiento (padrón AFIP, confidencialidad de lectura por rol, opcionales). Trabajá
> pensando como gerente del negocio, explicá en criollo, demostrá la seguridad, y respetá que las
> migraciones se corren a mano y que la facturación es real.
