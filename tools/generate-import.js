// Genera import.sql a partir del CSV exportado de la planilla de Google Sheets.
// Uso: node tools/generate-import.js
// No commitear gastos.csv ni import.sql (datos privados; el repo es público).
const fs = require('fs');

const csv = fs.readFileSync('gastos.csv', 'utf8');
const rows = csv.split(/\r?\n/).map(l => l.split(','));

// Columna C (índice 2) = ABRIL 2025. Meses hasta OCTUBRE 2026 inclusive
// (después son proyecciones futuras del alquiler).
const START = { y: 2025, m: 3 }; // abril = mes 3 (0-based)
const LAST = '2026-10-01';
const monthDate = col => {
  const d = new Date(START.y, START.m + col - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

// fila de planilla -> categoría de la app
const CAT = {
  'Alquiler': 'Vivienda', 'Expensas': 'Vivienda', 'Cochera': 'Transporte',
  'Seguro': 'Otros', 'Seguro Moto': 'Transporte',
  'T. Naranja': 'Tarjeta de crédito', 'T. Macro': 'Tarjeta de crédito',
  'T. Galicia': 'Tarjeta de crédito', 'T. Master': 'Tarjeta de crédito',
  'Comision macro': 'Tarjeta de crédito',
  'MercadoCredito': 'Préstamos', 'Prestamo Galicia': 'Préstamos',
  'Préstamo Anses 36c 01/24': 'Préstamos', 'Sonia': 'Préstamos',
  'Gasnor': 'Servicios', 'EDET': 'Servicios', 'Agua': 'Servicios', 'Internet': 'Servicios',
  'CISI': 'Salud', 'JARDIN': 'Educación',
  'Nafta': 'Transporte', 'Transporte': 'Transporte',
};
const METODO = { 'MercadoCredito': 'mercadopago', 'Préstamo Anses 36c 01/24': 'debito' };
const USER = { 'Sueldo Andi': 'andreamingolla@gmail.com', 'Sueldo Franco': 'francobarriga@outlook.com' };
const AUTOR_GASTOS = 'andreamingolla@gmail.com';

const endFixed = rows.findIndex(r => r[0] === 'Gastos fijos');
const gastosVals = [], ingresosVals = [];

for (let i = 1; i < endFixed; i++) {
  const detalle = rows[i][0].trim();
  if (!detalle || !CAT[detalle]) continue;
  for (let c = 2; c < rows[i].length; c++) {
    const fecha = monthDate(c);
    const monto = parseFloat(rows[i][c]);
    if (!monto || fecha > LAST) continue;
    gastosVals.push(`('${fecha}',${monto},'${CAT[detalle]}','${detalle.replace(/'/g, "''")}','${METODO[detalle] || 'transferencia'}')`);
  }
}
for (const r of rows) {
  const detalle = r[0].trim();
  if (!USER[detalle]) continue;
  for (let c = 2; c < r.length; c++) {
    const fecha = monthDate(c);
    const monto = parseFloat(r[c]);
    if (!monto || fecha > LAST) continue;
    ingresosVals.push(`('${fecha}',${monto},'${detalle}','${USER[detalle]}')`);
  }
}

const sql = `-- Importación de la planilla de Google Sheets (abril 2025 → octubre 2026).
-- Ejecutar en Supabase Dashboard → SQL Editor. Es re-ejecutable: borra
-- primero los movimientos importados (detalle marcado con "[planilla]").
-- Los montos son los valores mensuales cargados en cada celda.

insert into public.categorias (nombre, color) values ('Préstamos', '#b91c1c')
on conflict (nombre) do nothing;

delete from public.gastos where detalle like '%[planilla]';
delete from public.ingresos where detalle like '%[planilla]';

with u as (select id from auth.users where email = '${AUTOR_GASTOS}'),
vals(fecha, monto, cat, detalle, metodo) as (values
  ${gastosVals.join(',\n  ')}
)
insert into public.gastos (fecha, monto, categoria_id, detalle, metodo, creado_por)
select v.fecha, v.monto, c.id, v.detalle || ' [planilla]', v.metodo, u.id
from vals v
join u on true
left join public.categorias c on c.nombre = v.cat;

with vals(fecha, monto, detalle, email) as (values
  ${ingresosVals.join(',\n  ')}
)
insert into public.ingresos (fecha, monto, detalle, creado_por)
select v.fecha, v.monto, v.detalle || ' [planilla]', u.id
from vals v
join auth.users u on u.email = v.email;
`;

fs.writeFileSync('import.sql', sql);
console.log(`gastos: ${gastosVals.length} filas, ingresos: ${ingresosVals.length} filas -> import.sql`);
