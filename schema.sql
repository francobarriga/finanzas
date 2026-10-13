-- Finanzas del hogar — ejecutar completo en Supabase Dashboard → SQL Editor.
-- Crea tablas, RLS, trigger de perfiles y categorías iniciales.

-- ============ Tablas ============

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.categorias (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  color text not null default '#64748b',
  created_at timestamptz not null default now()
);

create table if not exists public.gastos (
  id bigint generated always as identity primary key,
  fecha date not null default current_date,
  monto numeric(12,2) not null check (monto > 0),
  categoria_id bigint references public.categorias(id) on delete set null,
  detalle text,
  metodo text not null default 'efectivo'
    check (metodo in ('efectivo','debito','credito','transferencia','mercadopago')),
  creado_por uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.ingresos (
  id bigint generated always as identity primary key,
  fecha date not null default current_date,
  monto numeric(12,2) not null check (monto > 0),
  detalle text,
  creado_por uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.ajustes (
  clave text primary key,
  valor text not null
);

insert into public.ajustes (clave, valor) values ('presupuesto_mensual', '0')
on conflict (clave) do nothing;

insert into public.categorias (nombre, color) values
  ('Comida y super', '#16a34a'),
  ('Salidas y ocio', '#d97706'),
  ('Servicios', '#0ea5e9'),
  ('Vivienda', '#7c3aed'),
  ('Transporte', '#0891b2'),
  ('Salud', '#dc2626'),
  ('Educación', '#2563eb'),
  ('Suscripciones', '#9333ea'),
  ('Tarjeta de crédito', '#be185d'),
  ('Mascotas', '#65a30d'),
  ('Ropa', '#db2777'),
  ('Hogar', '#4d7c0f'),
  ('Otros', '#64748b')
on conflict (nombre) do nothing;

create index if not exists gastos_fecha_idx on public.gastos (fecha desc);
create index if not exists ingresos_fecha_idx on public.ingresos (fecha desc);

-- Perfil automático al crear usuario (Dashboard → Authentication → Add user
-- con user_metadata {"nombre": "..."})
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nombre)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1))
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS ============
-- App compartida entre 2 usuarios de confianza: cualquier autenticado
-- lee y escribe todo. profiles solo se edita a uno mismo.

alter table public.profiles enable row level security;
alter table public.categorias enable row level security;
alter table public.gastos enable row level security;
alter table public.ingresos enable row level security;
alter table public.ajustes enable row level security;

create policy "profiles read" on public.profiles
  for select to authenticated using (true);
create policy "profiles update self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "categorias read" on public.categorias
  for select to authenticated using (true);
create policy "categorias write" on public.categorias
  for all to authenticated using (true) with check (true);

create policy "gastos read" on public.gastos
  for select to authenticated using (true);
create policy "gastos write" on public.gastos
  for all to authenticated using (true) with check (true);

create policy "ingresos read" on public.ingresos
  for select to authenticated using (true);
create policy "ingresos write" on public.ingresos
  for all to authenticated using (true) with check (true);

create policy "ajustes read" on public.ajustes
  for select to authenticated using (true);
create policy "ajustes write" on public.ajustes
  for all to authenticated using (true) with check (true);
