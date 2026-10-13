-- Reset total: deja la app en cero para empezar a cargar de nuevo.
-- Ejecutar completo en Supabase Dashboard → SQL Editor.
-- BORRA todos los gastos, ingresos y deudas (incluye lo importado de la
-- planilla y lo cargado a mano). Conserva usuarios, categorías y ajustes.

truncate table public.gastos, public.ingresos, public.deudas restart identity;
