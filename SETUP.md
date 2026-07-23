# Setup de Spera

Guía para dejar el proyecto corriendo. Hacelo una sola vez.

## 1. Crear el proyecto en Supabase
1. Entrá a https://supabase.com → **New project**. Elegí región **South America (São Paulo)**
   (la más cercana). Guardá la contraseña de la base.
2. Cuando termine de aprovisionar, andá a **Project Settings → API** y copiá:
   - **Project URL**
   - **anon public** key
   - **service_role** key (secreta)

## 2. Variables de entorno
1. Copiá `.env.local.example` como `.env.local`.
2. Completá los tres valores con lo del paso anterior.

```bash
cp .env.local.example .env.local
```

## 3. Correr las migraciones (en orden)
En Supabase → **SQL Editor** → **New query**, pegá y ejecutá **una por una, en orden**:

1. `supabase/migrations/0001_base.sql`
2. `supabase/migrations/0002_catalogo_stock.sql`
3. `supabase/migrations/0003_clientes_precios.sql`

Son idempotentes: si las corrés dos veces no rompen nada.

## 4. Crear tu usuario administrador
1. En Supabase → **Authentication → Users → Add user** (o registrate desde la app cuando esté la
   pantalla de login). Usá tu email.
2. El **primer usuario** queda automáticamente como **SuperAdministrador** de Bodysculpt
   (lo hace el trigger `handle_new_user`).

## 5. Correr la app en local
```bash
npm run dev
```
Abrí http://localhost:3000

## 6. Deploy en Vercel (cuando quieras publicar)
1. Subí el repo a GitHub.
2. En https://vercel.com → **Import Project** → elegí el repo.
3. Cargá las mismas 3 variables de entorno en **Settings → Environment Variables**.
4. Cada `git push` a `main` deploya solo.

---
**Verificar contra la base real, no contra los archivos:** antes de afirmar que una tabla o
columna falta, consultala en el SQL Editor.
