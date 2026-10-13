// Dev: inspecciona líneas extraídas de un PDF y prueba el parser.
// Uso: node tools/dump-lines.js "RESUMENES TARJETA/archivo.pdf" [--raw]
import fs from 'fs';
const path = process.argv[2];
const raw = process.argv.includes('--raw');

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { extraerLineas, parseResumen } = await import('../pdf-parser.js');

const data = new Uint8Array(fs.readFileSync(path));
const lines = await extraerLineas(pdfjs, data);

if (raw) {
  for (const l of lines) console.log(l.text);
} else {
  const r = parseResumen(lines);
  console.log(`banco: ${r.banco} | mes: ${r.mes} | items: ${r.items.length}`);
  let total = 0;
  for (const it of r.items) { total += it.monto; console.log(`  ${String(it.monto).padStart(12)}  ${it.detalle}${it.cuota ? ' (cuota ' + it.cuota + ')' : ''}${it.quien ? ' [' + it.quien + ']' : ''}`); }
  console.log(`  TOTAL: ${total}`);
}
