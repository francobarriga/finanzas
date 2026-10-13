// Edge Function "asistente" — proxy seguro a Gemini.
// La API key vive en el secret GEMINI_API_KEY (Supabase Dashboard →
// Edge Functions → Secrets). El browser solo ve el JWT de Supabase.
//
// Deploy: Dashboard → Edge Functions → nuevo → pegar este código,
// o `npx supabase functions deploy asistente`.
//
// Modes (POST JSON):
//   { mode: 'chat',        pregunta, mes: 'YYYY-MM' }            → { texto }
//   { mode: 'analisis',    mes: 'YYYY-MM' }                      → { texto }
//   { mode: 'texto',       texto, categorias: [nombres] }        → { items }
//   { mode: 'categorizar', detalles: [...], categorias: [...] }  → { categorias }
//   { mode: 'pdf',         lineas: '...texto crudo...' }         → { items }

import { createClient } from 'npm:@supabase/supabase-js@2';

const KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function gemini(sys: string, prompt: string, jsonMode = false): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: jsonMode ? { responseMimeType: 'application/json' } : {},
      }),
    },
  );
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(data?.error?.message || 'Gemini no devolvió respuesta');
  return text;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: 'No autorizado' }, 401);
    if (!KEY) return json({ error: 'Falta configurar GEMINI_API_KEY en los secrets de la función' }, 500);

    const body = await req.json();

    if (body.mode === 'texto' || body.mode === 'pdf') {
      const esPdf = body.mode === 'pdf';
      const prompt = esPdf
        ? `Extraé TODOS los consumos de este texto de un resumen de tarjeta. Devolvé JSON:
[{"detalle": "...", "monto": numero, "cuota": "NN/NN" o null, "quien": "nombre del titular si se distingue" o null}].
Ignorá totales, saldos, pagos recibidos, límites y texto legal. Montos en pesos argentinos (punto=miles, coma=decimales).
Texto:\n${String(body.lineas || '').slice(0, 12000)}`
        : `El usuario anotó gastos/ingresos en texto libre. Devolvé JSON:
[{"tipo": "gasto"|"ingreso", "monto": numero, "detalle": "...", "categoria": "una de: ${(body.categorias || []).join(', ')}"}].
"mil" = ×1000, "lucas" = ×1000. Si no se entiende el monto, omití el item.
Texto: "${String(body.texto || '').slice(0, 2000)}"`;
      const out = await gemini(
        'Sos un parser de datos financieros. Respondés SOLO con JSON válido, sin markdown ni explicaciones.',
        prompt, true,
      );
      return json({ items: JSON.parse(out) });
    }

    if (body.mode === 'categorizar') {
      const prompt = `Categorizá cada consumo con UNA de estas categorías: ${(body.categorias || []).join(', ')}.
Detalles: ${JSON.stringify((body.detalles || []).slice(0, 200))}
Devolvé JSON: {"categorias": ["...", "..."]} con un elemento por detalle, en el mismo orden.`;
      const out = await gemini(
        'Sos un clasificador. Respondés SOLO con JSON válido.', prompt, true,
      );
      return json(JSON.parse(out));
    }

    if (body.mode === 'chat' || body.mode === 'analisis') {
      const ini = `${body.mes}-01`;
      const d = new Date(ini + 'T00:00:00');
      const finMes = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
      const sel = 'fecha, monto, detalle, metodo, origen, categorias(nombre), profiles(nombre)';
      const [g, i, dd, aj, pf] = await Promise.all([
        sb.from('gastos').select(sel).gte('fecha', ini).lt('fecha', finMes),
        sb.from('ingresos').select('fecha, monto, detalle, profiles(nombre)').gte('fecha', ini).lt('fecha', finMes),
        sb.from('deudas').select('nombre, total, saldo'),
        sb.from('ajustes').select('*'),
        sb.from('profiles').select('nombre'),
      ]);
      const ctx = {
        mes: body.mes,
        integrantes: (pf.data || []).map((x: any) => x.nombre),
        gastos: g.data || [],
        ingresos: i.data || [],
        deudas: dd.data || [],
        presupuesto_mensual: (aj.data || []).find((a: any) => a.clave === 'presupuesto_mensual')?.valor || 'sin definir',
      };
      const REGLA = ` Regla de la app: los consumos de tarjetas se importan del resumen como gastos individuales con metodo "credito" y campo "origen" indicando de qué resumen vienen. El pago del resumen NO se carga como gasto porque duplicaría — ya están contados los consumos. Si el usuario pregunta por pagos de tarjeta, explicale esto.`;
      if (body.mode === 'chat') {
        const out = await gemini(
          `Sos un asistente de finanzas de un hogar argentino. Respondés en español rioplatense, breve y concreto, con los números reales del contexto (montos en ARS).${REGLA} Datos del mes consultado: ${JSON.stringify(ctx)}`,
          String(body.pregunta || '').slice(0, 1000),
        );
        return json({ texto: out });
      }
      if (!ctx.gastos.length && !ctx.ingresos.length) {
        return json({ texto: '' });
      }
      const out = await gemini(
        `Sos un asesor de finanzas hogareñas de una pareja argentina que quiere dejar de perder visibilidad de su plata. Respondés en español rioplatense, tono cercano pero directo, montos en formato argentino ($ 1.234.567). Estructurá la respuesta EXACTAMENTE así:

📊 En números
Balance del mes (ingresos vs gastos) y % del presupuesto usado si existe.

🔍 Qué detecté
3 a 5 hallazgos concretos con montos reales: categoría dominante, suscripciones o gastos recurrentes, quién concentró más gasto, cuotas, cargos bancarios/impuestos, consumos en dólares.

💡 Recomendaciones
3 acciones concretas para el mes que arranca, ordenadas por impacto.

Máximo 300 palabras, sin markdown con #, usá saltos de línea y los emojis de sección indicados.${REGLA}`,
        `Datos completos del mes a analizar: ${JSON.stringify(ctx)}`,
      );
      return json({ texto: out });
    }

    return json({ error: 'mode inválido' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
