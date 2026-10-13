// Parser de resúmenes de tarjeta (PDF → consumos).
// Módulo ES compartido: lo usa index.html en el browser y tools/dump-lines.js
// en Node para desarrollar contra PDFs reales.

const MONEY = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };

const parseMoney = s => parseFloat(String(s).trim().replace(/\./g, '').replace(',', '.'));
const lastMoney = items => {
  for (let i = items.length - 1; i >= 0; i--) {
    const t = items[i].t.trim();
    if (MONEY.test(t)) return { monto: parseMoney(t), idx: i };
  }
  return null;
};

// Agrupa los items de texto de pdf.js en líneas por coordenada Y,
// ordenados por X. Devuelve [{ text, items: [{x,t}] }].
export async function extraerLineas(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      let key = null;
      for (const k of rows.keys()) if (Math.abs(k - y) <= 2) { key = k; break; }
      if (key === null) { key = y; rows.set(key, []); }
      rows.get(key).push({ x: it.transform[4], t: it.str });
    }
    for (const [y, its] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      its.sort((a, b) => a.x - b.x);
      lines.push({ text: its.map(i => i.t).join(' ').replace(/\s+/g, ' ').trim(), items: its });
    }
  }
  return lines;
}

export function detectarBanco(lines) {
  const all = lines.map(l => l.text).join('\n');
  if (/naranja ?x/i.test(all)) return 'naranja';
  if (/tarjeta cr.dito visa/i.test(all)) return 'visa';
  if (/mastercard/i.test(all)) return 'mastercard';
  return null;
}

function mesVencimiento(lines) {
  for (const { text } of lines) {
    const v = text.match(/vence el (\d{2})\/(\d{2})\/(\d{2})/i); // Naranja: "vence el 10/10/26"
    if (v) return `20${v[3]}-${v[2]}-01`;
  }
  // Macro: fila de fechas "10-Sep-26 18-Sep-26 08-Oct-26 ..." → la 3ra es vencimiento
  const fechas = [];
  for (const { text } of lines.slice(0, 15)) {
    for (const m of text.matchAll(/(\d{2})-(\w{3})-(\d{2})/g)) {
      const mm = MESES[m[2].toLowerCase()];
      if (mm) fechas.push(`20${m[3]}-${String(mm).padStart(2, '0')}-01`);
    }
  }
  return fechas[2] || fechas[0] || null;
}

// Línea de consumo con fecha dd/mm/yy o dd-Mmm-yy. Devuelve {detalle, monto, quien, cuota} | null
function lineaConsumo(text, montoForzado) {
  const m = text.match(/^(\d{2}[/-]\d{2}[/-]\d{2}|\d{2}-[A-Za-z]{3}-\d{2})\s+(.+)$/);
  if (!m) return null;
  return { fechaStr: m[1], resto: m[2], monto: montoForzado };
}

function parseNaranja(lines) {
  const items = [];
  let quien = null, enCargos = false, pendingLabel = null;
  for (let i = 0; i < lines.length; i++) {
    const { text } = lines[i];
    const sec = text.match(/cr.dito de (\w+)/i);
    if (sec) { quien = sec[1]; continue; }
    if (/^otros\b|cargos:?\s*$/i.test(text)) {
      enCargos = true;
      const lbl = text.match(/^otros\s+(.+?)\*?\s*$/i);
      if (lbl && lbl[1]) pendingLabel = lbl[1].trim();
      continue;
    }
    if (/^total|consumos:|hasta el mes|hola|hoja|control:|informaci/i.test(text)) { enCargos = false; pendingLabel = null; }
    if (/pago en pesos|total a pagar|saldo|vence/i.test(text)) continue;

    const c = lineaConsumo(text);
    if (c) {
      let resto = c.resto, monto = lastMoney(lines[i].items)?.monto;
      if (monto == null && lines[i + 1] && lastMoney(lines[i + 1].items)) {
        // monto en la línea siguiente (renglón partido)
        monto = lastMoney(lines[i + 1].items).monto; i++;
      }
      if (monto == null) continue;
      resto = resto.replace(/^Naranja X\s*/i, '').replace(/\s*[\d.]+,\d{2}\s*$/, '');
      const cuota = resto.match(/(\d{2}\/\d{2})/);
      resto = resto.replace(/^\d{4,}\s*/, '').replace(/\s*\d{2}\/\d{2}\s*/, ' ').replace(/\s+/g, ' ').trim();
      items.push({ detalle: resto || 'Consumo', monto, quien, cuota: cuota ? cuota[1] : null });
      continue;
    }
    // Cargos sin fecha: impuestos/comisiones con monto al final
    const im = text.match(/^(.+?)\s+([\d.]+,\d{2})\s*$/);
    if (im) {
      let det = im[1].trim();
      if (/^\(/.test(det) && pendingLabel) det = pendingLabel; // "(Base Imponible ...)" usa el rótulo anterior
      if (/impuesto|iva|sellos|percepc|comisi|db\.rg/i.test(det)
          && (enCargos || /^(impuesto|iva|sellos|percepci|comisi|db\.rg)/i.test(det))) {
        items.push({ detalle: det, monto: parseMoney(im[2]), quien });
      }
      pendingLabel = null;
    } else if (enCargos) {
      pendingLabel = text;
    }
  }
  return items.filter(x => x.monto > 0);
}

function parseMacro(lines) { // Visa y Mastercard de Banco Macro
  const items = [];
  let enDetalle = false, quien = null;
  for (let i = 0; i < lines.length; i++) {
    const { text } = lines[i];
    if (/detalle del consumo/i.test(text)) { enDetalle = true; continue; }
    const adic = text.match(/adicional de ([A-ZÁÉÍÓÚÑ ,]+)/i);
    if (adic) { quien = adic[1].split(',')[0].trim(); continue; }
    if (/total consumos de|total adicional/i.test(text)) { quien = null; continue; }
    if (/saldo anterior|su pago|total consumos|subtotal|compras del mes|consolidado|tasas|l.mites|plan v|cuotas a vencer|debitaremos|p.gina|resumen n|cuit|socio|cuenta:|sucursal|consumidor|fecha referencia/i.test(text)) continue;
    const c = enDetalle ? lineaConsumo(text) : null;
    // descartar fila de cabecera con las fechas del resumen
    if (c && /\d{2}-[A-Za-z]{3}-\d{2}/.test(c.resto)) continue;
    if (c) {
      const lm = lastMoney(lines[i].items);
      let monto = lm ? lm.monto : null;
      if (monto == null && lines[i + 1] && lastMoney(lines[i + 1].items) && !lineaConsumo(lines[i + 1].text)) {
        monto = lastMoney(lines[i + 1].items).monto; i++;
      }
      if (monto == null) continue;
      const usd = /usd/i.test(c.resto);
      let resto = c.resto.replace(/^\*\s*/, '').replace(/\s*[\d.]+,\d{2}\s*$/, '').trim();
      const cuota = resto.match(/(\d{2}\/\d{2})/);
      resto = resto.replace(/\s*\d{2}\/\d{2}\s*/, ' ').replace(/USD\s*[\d.,]*/i, ' USD')
        .replace(/\s+\d{5,}\s*$/, '').replace(/\s+/g, ' ').trim();
      items.push({ detalle: resto || 'Consumo', monto, cuota: cuota ? cuota[1] : null, usd, quien });
      continue;
    }
    const im = text.match(/^(.+?)\s+([\d.]+,\d{2})\s*$/);
    if (im && /^(impuesto|iva|sellos|percepci|comisi|db\.rg)/i.test(im[1])) {
      items.push({ detalle: im[1].trim(), monto: parseMoney(im[2]), quien });
    }
  }
  return items.filter(x => x.monto > 0);
}

export function parseResumen(lines) {
  const banco = detectarBanco(lines);
  const items = banco === 'naranja' ? parseNaranja(lines)
    : banco ? parseMacro(lines) : [];
  return { banco, mes: mesVencimiento(lines), items };
}
