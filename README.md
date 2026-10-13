# Finanzas del hogar

App web estática para cargar y ver gastos/ingresos compartidos entre dos personas.
Sin servidor: HTML + Alpine.js + Supabase (Postgres + Auth + RLS), todo desde el browser.

## Stack
- `index.html` — app completa (un solo archivo, sin build).
- `config.js` — URL y anon key de Supabase.
- `schema.sql` — tablas, RLS y seed de categorías.
- CDN: `alpinejs@3.14.9`, `@supabase/supabase-js@2.116.0` (jsDelivr, sin npm).

## Setup único (≈10 min)

### 1. Crear el proyecto Supabase
1. Entrar a https://supabase.com → **New project** (tier Free).
2. Anotar la URL del proyecto y la `anon public` key
   (Dashboard → **Settings → API**).

### 2. Crear las tablas
1. En el dashboard: **SQL Editor → New query**.
2. Pegar el contenido completo de `schema.sql` → **Run**.

### 3. Crear los dos usuarios
1. **Authentication → Users → Add user → Create new user**.
2. Email + contraseña para cada uno. Marcar **Auto Confirm User**.
3. En **User Metadata** poner `{"nombre": "Marcos"}` (o el nombre que quieran
   que aparezca en "quién cargó").

### 4. Configurar la app
Editar `config.js` con la URL y la anon key del paso 1.

## Probar en local
```sh
npx serve .        # o: python -m http.server 8000
```
(Abrilo por http://localhost:3000 — no con doble clic, los módulos ES
no cargan desde file://.)

## Publicar en GitHub Pages
```sh
git init
git add .
git commit -m "Finanzas del hogar"
gh repo create finanzas --private --source=. --push
```
Luego en GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
La URL queda `https://<usuario>.github.io/finanzas/`. Es pública, pero los
datos solo se ven con login (RLS en Supabase).

> Tip: en el celular, "Agregar a pantalla de inicio" desde el navegador
> y queda como app.

## Uso
- **Cargar**: gasto o ingreso, monto, fecha, categoría (se pueden crear nuevas
  con "＋ Nueva"), método de pago y detalle.
- **Movimientos**: lista del mes; tocar una fila la carga para editar;
  la ✕ pide confirmación antes de borrar.
- **Resumen**: balance (ingresos − gastos), gastos por categoría, por método,
  por persona; presupuesto mensual editable; export a CSV para Excel.
- El selector de mes del encabezado permite ver meses anteriores.
