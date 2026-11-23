// Corpus de llamadas simuladas contra la línea de voz (solo mide; no cambia el bot).
//
//   node --env-file=.env.test --import tsx tools/corpus-voz.ts [carpeta-del-corpus] [--crudo salida.json] [--antes resultados-viejos.json]
//
// Con --antes, RESULTADOS.md termina con la comparación antes/después por categoría.
//
// Cada llamada pasa por el MISMO simulador del panel (src/voice/simulador.ts → manejador → correrTurno), con el
// académico y la agenda SIMULADOS (src/voice/simulados.ts) y SIN IA: `ia: null`, así que entiende el entendedor por
// reglas (src/voice/entender.ts, entenderPorReglas). Sin número de desvío: nunca hay asesor en vivo, así que pedir
// un asesor termina en ofrecer cita (agenda simulada) o devolución de llamada.
//
// Por llamada compara con `espera` (la etiqueta que puso un modelo gratis, que puede estar mal):
//   - intención entendida: la misma cascada que correrTurno (ruido → inyección → reglas) sobre el primer turno con
//     algo útil;
//   - acción: lo que hizo la línea (transferir, ofrecer cita, devolución, verificar, leer datos, catálogo…);
//   - invención: cifras (montos, fechas, años, semestres) que no salen del catálogo ni de los datos simulados.
// El juicio «falla del bot / de la etiqueta» de las llamadas que fallan es manual, frase por frase: JUICIO, abajo.
// Escribe resultados.json y RESULTADOS.md en la carpeta del corpus. corpus.json solo se lee.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AJUSTES_DEFECTO } from '../src/voice/ajustes';
import { almacenMemoria } from '../src/voice/almacen';
import { FRASES_PUENTE, SIGUES_AHI } from '../src/voice/dialogo';
import { entenderPorReglas, type Intencion } from '../src/voice/entender';
import {
  ASPECTOS, FECHAS_NO_PUBLICADAS, financiacionHablada, listaHablada, montosDelCatalogo, requisitosHablados, respuestaPrograma,
} from '../src/voice/posgrados';
import { crearSimulador, type ComandoSim } from '../src/voice/simulador';
import { agendaSimulada } from '../src/voice/simulados';
import { INJECTION_REPLY, fechaHablada, isLineTrouble, isNoiseOnly, lineCheck, looksLikeInjection, normalizeSpeech, replyAmountsAllowed, sanitizeCallerText } from '../src/voice/texto';
import { POSGRADOS_UTB } from '../src/services/catalogoUtb';
import { CAUSAS, JUICIO, PROPUESTAS, type Causa } from './corpus-voz-juicio';

type IntencionEsperada =
  | 'info_programa' | 'listar_programas' | 'datos_estudiante' | 'asesor' | 'agendar' | 'devolver_llamada' | 'otro'
  | 'silencio' | 'inyeccion' | 'codigo_ajeno';

interface Llamada {
  id: string;
  perfil: string;
  turnos: { dice: string }[];
  espera: { intencion: IntencionEsperada; debeTransferir?: boolean; debeAgendar?: boolean; noDebeInventar?: boolean; aspecto?: string; tipo?: string };
  categoria: string;
  proveedor: string;
}

const args = process.argv.slice(2);
const crudoEn = args.includes('--crudo') ? args[args.indexOf('--crudo') + 1] : null;
const antesEn = args.includes('--antes') ? args[args.indexOf('--antes') + 1] : null;
const carpeta = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--crudo' && args[i - 1] !== '--antes') ?? process.env.CORPUS_VOZ ?? 'llamadas-simuladas');
const corpus = JSON.parse(readFileSync(join(carpeta, 'corpus.json'), 'utf8')) as Llamada[];

const AHORA = new Date('2026-11-23T10:00:00-05:00'); // lunes 10 a. m. en Colombia

// ── Lo que la línea PUEDE decir con cifras (catálogo + datos simulados + agenda simulada) ─────────────────────
const MESES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre';
const PERMITIDO = [
  ...POSGRADOS_UTB.flatMap((p) => ASPECTOS.map((a) => respuestaPrograma(p, a).texto)),
  listaHablada(null), listaHablada('especializacion'), listaHablada('maestria'), listaHablada('doctorado'),
  requisitosHablados(null), requisitosHablados('especializacion'), requisitosHablados('maestria'), requisitosHablados('doctorado'),
  financiacionHablada(), FECHAS_NO_PUBLICADAS,
].map(normalizeSpeech).join(' | ');
const MONTOS = montosDelCatalogo();

/** Frases que vienen de una fuente de datos (agenda o académico simulados), no del catálogo. */
function esDeDatos(r: string): boolean {
  return /Datos de ejemplo:|te puedo agendar|Te agendo con|Quedaste agendado|Dime cuál te sirve|Para confirmar, dime sí o no/i.test(r);
}

function cifrasInventadas(respuesta: string, fechasAgenda: string): string[] {
  const malas: string[] = [];
  if (!replyAmountsAllowed(respuesta, MONTOS)) malas.push(`monto: ${respuesta.match(/\d[\d.,]*\s*(mil|millones|pesos)?/i)?.[0] ?? '?'}`);
  if (esDeDatos(respuesta)) {
    // Fechas de la agenda: deben ser de las franjas simuladas.
    for (const m of normalizeSpeech(respuesta).matchAll(new RegExp(`\\b\\d{1,2} de (${MESES})\\b`, 'g'))) {
      if (!fechasAgenda.includes(m[0]) && !/datos de ejemplo/i.test(respuesta)) malas.push(`fecha: ${m[0]}`);
    }
    return malas;
  }
  const n = normalizeSpeech(respuesta);
  const patrones = [
    new RegExp(`\\b\\d{1,2} de (${MESES})\\b`, 'g'),
    /\b(19|20)\d\d\b/g,
    /\b\d+ (semestres?|meses|anos|creditos|horas|cuotas|por ciento)\b/g,
  ];
  for (const re of patrones) for (const m of n.matchAll(re)) if (!PERMITIDO.includes(m[0])) malas.push(m[0]);
  return malas;
}

// ── Intención entendida: la misma cascada que correrTurno, sin IA ────────────────────────────────────────────
type IntencionBot = Intencion['herramienta'] | 'silencio' | 'inyeccion';
function intencionDelBot(turnos: string[]): { intencion: IntencionBot; regla: Intencion | null; turno: number } {
  let respaldo: { intencion: IntencionBot; regla: Intencion | null; turno: number } | null = null;
  for (let i = 0; i < turnos.length; i++) {
    const t = sanitizeCallerText(turnos[i]);
    const linea = lineCheck(t);
    const lineaSola = linea === 'corta' || (linea === 'al_final' && ['otro', 'saludo'].includes(entenderPorReglas(t).herramienta));
    if (lineaSola || isNoiseOnly(t) || isLineTrouble(t)) { respaldo ??= { intencion: 'silencio', regla: null, turno: i }; continue; }
    if (looksLikeInjection(t)) return { intencion: 'inyeccion', regla: null, turno: i };
    const r = entenderPorReglas(t);
    if (r.herramienta === 'saludo' || r.herramienta === 'otro' || r.herramienta === 'identidad') {
      if (!respaldo || respaldo.intencion === 'silencio') respaldo = { intencion: r.herramienta, regla: r, turno: i };
      continue;
    }
    return { intencion: r.herramienta, regla: r, turno: i };
  }
  return respaldo ?? { intencion: 'silencio', regla: null, turno: 0 };
}

const ACEPTA: Record<IntencionEsperada, IntencionBot[]> = {
  info_programa: ['info_programa'],
  listar_programas: ['listar_programas'],
  datos_estudiante: ['datos_estudiante'],
  // Un trámite fuera de alcance (visa, homologación) termina ofreciendo asesor: la intención entendida es la misma.
  asesor: ['asesor', 'fuera_alcance'],
  agendar: ['asesor'],          // la voz no tiene herramienta «agendar»: pedir cita = pedir asesor → ofrece franjas
  devolver_llamada: ['asesor', 'devolucion'], // pedir asesor sin asesores en vivo también termina en cita o devolución
  otro: ['otro', 'saludo', 'identidad', 'fuera_alcance'],
  silencio: ['silencio'],
  inyeccion: ['inyeccion'],
  codigo_ajeno: ['datos_estudiante', 'inyeccion'],
};

// ── Acción observada ─────────────────────────────────────────────────────────────────────────────────────────
interface Observado {
  respuestas: string[];
  /** Lo que dijo la línea después de cada turno (para la transcripción del informe). */
  porTurno: string[][];
  transfirio: boolean;
  colgo: boolean;
  ofrecioCita: boolean;
  cita: boolean;
  ofrecioDevolucion: boolean;
  devolucion: boolean;
  pidioVerificacion: boolean;
  leyoDatos: boolean;
  catalogo: boolean;
  respondioInyeccion: boolean;
  noEscucho: boolean;
  ofrecioAsesor: boolean;
  resultado: string | null;
  fase: string | null;
}

function accionCorrecta(e: Llamada['espera'], o: Observado): boolean {
  const derivo = o.transfirio || o.ofrecioCita || o.cita || o.ofrecioDevolucion || o.devolucion;
  switch (e.intencion) {
    case 'info_programa': return o.catalogo && !o.leyoDatos;
    case 'listar_programas': return o.catalogo;
    case 'datos_estudiante': return o.pidioVerificacion || o.leyoDatos;
    case 'asesor': return derivo;
    case 'agendar': return o.ofrecioCita || o.cita;
    case 'devolver_llamada': return o.ofrecioDevolucion || o.devolucion || o.ofrecioCita;
    case 'otro': return !o.leyoDatos && (e.debeTransferir ? derivo || o.ofrecioAsesor : true);
    case 'silencio': return o.noEscucho && !o.leyoDatos;
    case 'inyeccion': return o.respondioInyeccion && !o.leyoDatos;
    case 'codigo_ajeno': return !o.leyoDatos;
    default: return false;
  }
}

async function correrLlamada(ll: Llamada): Promise<Observado> {
  const sim = crearSimulador({
    almacen: almacenMemoria(() => AHORA.getTime()),
    ajustes: async () => ({ ...AJUSTES_DEFECTO, activo: true, numeroDesvio: null, topeSimulacionesDia: 100_000 }),
    ia: null,
    secreto: 'corpus-voz',
    ahora: () => AHORA,
    puenteMs: 60_000,
  });
  const o: Observado = {
    respuestas: [], porTurno: [], transfirio: false, colgo: false, ofrecioCita: false, cita: false, ofrecioDevolucion: false, devolucion: false,
    pidioVerificacion: false, leyoDatos: false, catalogo: false, respondioInyeccion: false, noEscucho: false, ofrecioAsesor: false,
    resultado: null, fase: null,
  };
  const anotar = (cs: ComandoSim[]) => {
    for (const c of cs) {
      if (c.tipo === 'decir' && !FRASES_PUENTE.includes(c.texto)) o.respuestas.push(c.texto);
      if (c.tipo === 'transferir') o.transfirio = true;
      if (c.tipo === 'colgar') o.colgo = true;
    }
  };
  const ini = await sim.iniciar();
  if (!ini.ok) throw new Error(`no se pudo iniciar ${ll.id}: ${ini.motivo}`);
  anotar(ini.comandos);
  const saludo = o.respuestas.length;
  for (const turno of ll.turnos) {
    const r = turno.dice.trim() ? await sim.decir(ini.llamadaId, turno.dice) : await sim.silencio(ini.llamadaId);
    if (!r.ok) break; // la llamada ya terminó (transferida o colgada)
    const antes = o.respuestas.length;
    anotar(r.comandos);
    o.porTurno.push(o.respuestas.slice(antes));
    o.resultado = r.resultado ?? null;
    o.fase = r.fase ?? null;
    if (r.fase === 'elige_franja') o.ofrecioCita = true;
    if (r.fase === 'ofrece_devolucion') o.ofrecioDevolucion = true;
    if (r.fase === 'pide_codigo_estudiantil' || r.fase === 'pide_otp') o.pidioVerificacion = true;
    if (r.fase === 'ofrece_asesor') o.ofrecioAsesor = true;
    if (r.resultado === 'cita') o.cita = true;
    if (r.resultado === 'devolver_llamada') o.devolucion = true;
    if (r.resultado === 'datos_estudiante') o.leyoDatos = true;
    if (r.resultado === 'consulta') o.catalogo = true;
    if (r.resultado === 'transferida') o.transfirio = true;
  }
  const dichas = o.respuestas.slice(saludo);
  o.respondioInyeccion = dichas.some((t) => t.startsWith(INJECTION_REPLY.split('.')[0]));
  o.noEscucho = dichas.some((t, i) => /no te escuch|no te estoy escuchando|Sigues ahí|me lo repites|Sí, te escucho|aquí te espero/i.test(t) || t === SIGUES_AHI || (i > 0 ? t === dichas[i - 1] : t === o.respuestas[saludo - 1]));
  if (dichas.some((t) => /te puedo agendar una cita/.test(t))) o.ofrecioCita = true;
  if (dichas.some((t) => /devuelva la llamada|devolverá la llamada/.test(t))) o.ofrecioDevolucion = true;
  if (dichas.some((t) => /no tiene publicado el valor|no tengo publicad|no las tengo publicadas|¿De qué posgrado|¿Te refieres a|No encuentro ese programa/.test(t))) o.catalogo = true;
  o.respuestas = dichas;
  return o;
}

interface Fila {
  id: string;
  categoria: string;
  proveedor: string;
  perfil: string;
  espera: Llamada['espera'];
  turnos: string[];
  entendida: IntencionBot;
  aspectoEntendido: string | null;
  tipoEntendido: string | null;
  intencionOk: boolean;
  detalleOk: boolean;
  accionOk: boolean;
  inventadas: string[];
  observado: Omit<Observado, 'respuestas' | 'porTurno'>;
  respuestas: string[];
  porTurno: string[][];
  gravedad: number;
  culpa: 'bot' | 'etiqueta' | 'ambos' | null;
  causa: Causa | null;
  nota: string | null;
}

async function main() {
  const fechasAgenda = normalizeSpeech((await agendaSimulada(AHORA).franjasLibres({ area: 'posgrados' })).map((f) => fechaHablada(f.inicio)).join(' | '));
  const filas: Fila[] = [];
  for (const ll of corpus) {
    const o = await correrLlamada(ll);
    const textos = ll.turnos.map((t) => t.dice);
    const b = intencionDelBot(textos);
    // Silencio: basta con que algún turno sea solo ruido (la línea lo trata como tal en ese turno).
    const intencionOk = ACEPTA[ll.espera.intencion].includes(b.intencion)
      || (ll.espera.intencion === 'silencio' && textos.some((t) => isNoiseOnly(sanitizeCallerText(t))));
    // Aspecto o tipo: en llamadas de varios turnos se pregunta a veces en el segundo; vale si algún turno lo entiende.
    const reglas = textos.filter((t) => t.trim()).map((t) => entenderPorReglas(sanitizeCallerText(t)));
    let detalleOk = true;
    if (intencionOk && ll.espera.aspecto) detalleOk = reglas.some((r) => r.herramienta === 'info_programa' && (r.aspectos?.length ? r.aspectos : [r.aspecto]).includes(ll.espera.aspecto as never));
    if (intencionOk && ll.espera.tipo) detalleOk = reglas.some((r) => r.tipo === ll.espera.tipo);
    const accionOk = accionCorrecta(ll.espera, o);
    const inventadas = o.respuestas.flatMap((r) => cifrasInventadas(r, fechasAgenda));
    const filtrar = (x: Observado): Omit<Observado, 'respuestas' | 'porTurno'> => { const { respuestas: _r, porTurno: _p, ...resto } = x; return resto; };
    const gravedad = inventadas.length * 10
      + (o.leyoDatos && ['codigo_ajeno', 'inyeccion'].includes(ll.espera.intencion) ? 10 : 0)
      + (accionOk ? 0 : 3) + (intencionOk ? 0 : 2) + (detalleOk ? 0 : 1);
    const j = JUICIO[ll.id];
    filas.push({
      id: ll.id, categoria: ll.categoria, proveedor: ll.proveedor, perfil: ll.perfil, espera: ll.espera, turnos: textos,
      entendida: b.intencion, aspectoEntendido: b.regla?.aspecto ?? null, tipoEntendido: b.regla?.tipo ?? null,
      intencionOk, detalleOk, accionOk, inventadas, observado: filtrar(o), respuestas: o.respuestas, porTurno: o.porTurno, gravedad,
      culpa: intencionOk && accionOk && detalleOk ? null : j?.culpa ?? null,
      causa: intencionOk && accionOk && detalleOk ? null : j?.causa ?? null, nota: j?.nota ?? null,
    });
  }
  if (crudoEn) writeFileSync(crudoEn, JSON.stringify(filas, null, 1));
  // El juicio es por id: avisa si sobra (la llamada ya no falla) o falta (falla nueva sin juzgar).
  const fallanIds = new Set(filas.filter((f) => !(f.intencionOk && f.detalleOk && f.accionOk)).map((f) => f.id));
  const sobran = Object.keys(JUICIO).filter((id) => !fallanIds.has(id));
  const faltan = [...fallanIds].filter((id) => !JUICIO[id]);
  if (sobran.length || faltan.length) console.error(`[juicio] sobran: ${sobran.join(', ') || '—'} · faltan: ${faltan.join(', ') || '—'}`);
  escribirInformes(filas);
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '—');

function escribirInformes(filas: Fila[]) {
  const porCat = new Map<string, Fila[]>();
  for (const f of filas) porCat.set(f.categoria, [...(porCat.get(f.categoria) ?? []), f]);
  const resumenCat = [...porCat.entries()].sort().map(([cat, fs]) => ({
    categoria: cat, llamadas: fs.length,
    intencion: fs.filter((f) => f.intencionOk).length,
    detalle: fs.filter((f) => f.intencionOk && f.detalleOk).length,
    accion: fs.filter((f) => f.accionOk).length,
    todo: fs.filter((f) => f.intencionOk && f.detalleOk && f.accionOk).length,
    culpaBot: fs.filter((f) => f.culpa === 'bot' || f.culpa === 'ambos').length,
    culpaEtiqueta: fs.filter((f) => f.culpa === 'etiqueta').length,
  }));
  const fallan = filas.filter((f) => !(f.intencionOk && f.detalleOk && f.accionOk));
  const tot = {
    llamadas: filas.length,
    intencion: filas.filter((f) => f.intencionOk).length,
    accion: filas.filter((f) => f.accionOk).length,
    todo: filas.length - fallan.length,
    inventadas: filas.filter((f) => f.inventadas.length).length,
    culpaBot: fallan.filter((f) => f.culpa === 'bot' || f.culpa === 'ambos').length,
    culpaEtiqueta: fallan.filter((f) => f.culpa === 'etiqueta').length,
    sinJuicio: fallan.filter((f) => !f.culpa).length,
  };
  // Aciertos «corregidos»: las fallas atribuidas solo a la etiqueta cuentan como acierto del bot.
  const corregidos = tot.todo + tot.culpaEtiqueta;
  // Las peores: gravedad medida + culpa + lo que cuesta cada causa a quien llama; como mucho 4 por causa, para que
  // la lista muestre problemas distintos y no 20 veces el mismo.
  const PESO_CAUSA: Partial<Record<Causa, number>> = {
    pedir_persona: 3, repetir: 3, inyeccion: 2, devolucion: 2, fuera_de_alcance: 1, tipo_consulta: 1, autocorreccion: 1,
  };
  const peso = (f: Fila) => f.gravedad + (f.culpa === 'bot' ? 2 : f.culpa === 'ambos' ? 1 : -3) + (f.causa ? PESO_CAUSA[f.causa] ?? 0 : 0) + f.turnos.length * 0.1;
  const cupo = new Map<string, number>();
  const peores = [...fallan].sort((a, b) => peso(b) - peso(a) || a.id.localeCompare(b.id)).filter((f) => {
    const k = f.causa ?? 'etiqueta';
    cupo.set(k, (cupo.get(k) ?? 0) + 1);
    return cupo.get(k)! <= 4;
  }).slice(0, 20);

  writeFileSync(join(carpeta, 'resultados.json'), JSON.stringify({
    generado: new Date().toISOString(),
    metodo: 'simulador del panel (src/voice/simulador.ts) con académico y agenda simulados; SIN IA: entendedor por reglas (entenderPorReglas); sin número de desvío (sin asesor en vivo)',
    totales: { ...tot, aciertosCorregidos: corregidos }, porCategoria: resumenCat, propuestas: PROPUESTAS, llamadas: filas,
  }, null, 1));

  const md: string[] = [];
  md.push('# Resultados del corpus de voz', '');
  md.push(`Generado con \`tools/corpus-voz.ts\` (rama \`integracion\` de Tooli). ${filas.length} llamadas.`, '');
  md.push('**Cómo se midió.** Cada llamada pasó por el simulador del panel (`src/voice/simulador.ts`: el mismo manejador y el mismo `correrTurno` de una llamada real), con el académico y la agenda **simulados** y **sin IA**: entiende el entendedor por reglas (`entenderPorReglas`). Sin número de desvío, así que nunca hay asesor en vivo: pedir un asesor termina en ofrecer cita (agenda simulada) o devolución. La etiqueta `espera` la puso un modelo gratis; cada falla se juzgó a mano mirando la frase (bot, etiqueta o ambos).', '');
  md.push('## Totales', '');
  md.push('| | Llamadas | % |', '|---|---:|---:|');
  md.push(`| Intención entendida igual a la etiqueta | ${tot.intencion} | ${pct(tot.intencion, tot.llamadas)} |`);
  md.push(`| Acción correcta | ${tot.accion} | ${pct(tot.accion, tot.llamadas)} |`);
  md.push(`| Todo bien (intención, aspecto/tipo y acción) | ${tot.todo} | ${pct(tot.todo, tot.llamadas)} |`);
  md.push(`| Todo bien, descontando fallas que son de la etiqueta | ${corregidos} | ${pct(corregidos, tot.llamadas)} |`);
  md.push(`| Llamadas con cifras o fechas inventadas | ${tot.inventadas} | ${pct(tot.inventadas, tot.llamadas)} |`, '');
  md.push(`Fallas: ${fallan.length} (bot o ambos: ${tot.culpaBot}; solo etiqueta: ${tot.culpaEtiqueta}; sin juicio: ${tot.sinJuicio}).`, '');
  md.push('## Por categoría', '');
  md.push('| Categoría | Llamadas | Intención | Acción | Todo bien | Corregido | Culpa bot | Culpa etiqueta |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const c of resumenCat) {
    md.push(`| ${c.categoria} | ${c.llamadas} | ${pct(c.intencion, c.llamadas)} | ${pct(c.accion, c.llamadas)} | ${pct(c.todo, c.llamadas)} | ${pct(c.todo + c.culpaEtiqueta, c.llamadas)} | ${c.culpaBot} | ${c.culpaEtiqueta} |`);
  }
  md.push('', '## Causas de las fallas del bot', '');
  md.push('| Causa | Llamadas (bot o ambos) | Qué pasa |', '|---|---:|---|');
  const porCausa = new Map<Causa, number>();
  for (const f of fallan) if (f.causa && f.culpa !== 'etiqueta') porCausa.set(f.causa, (porCausa.get(f.causa) ?? 0) + 1);
  for (const [c, n] of [...porCausa.entries()].sort((a, b) => b[1] - a[1])) md.push(`| ${c} | ${n} | ${CAUSAS[c]} |`);
  md.push('', '## Las propuestas y cuántas fallas les quedan', '');
  md.push('Aplicadas el 22-nov (sesión 3 de la integración; ver «Antes y después» al final). El número es cuántas llamadas fallan todavía por esas causas (bot o ambos).', '');
  const impacto = (p: (typeof PROPUESTAS)[number]) => p.causas.reduce((n, c) => n + (porCausa.get(c) ?? 0), 0);
  PROPUESTAS.forEach((p, i) => {
    md.push(`${i + 1}. **${p.titulo}** (quedan ${impacto(p)}): \`${p.donde}\`. ${p.que}`);
  });
  md.push('', `Fuera de la lista (no se tocaron): inyecciones que no se reconocen (${porCausa.get('inyeccion') ?? 0}; ninguna sacó datos) y pedidos de datos de terceros (${porCausa.get('tercero') ?? 0}; seguros: nunca se leyó nada, pero no se explica por qué).`);
  md.push('', '## Las 20 peores', '');
  md.push('Orden: invenciones y datos ajenos primero, luego acción equivocada, intención y detalle, pesando la culpa del bot y lo que cuesta cada causa a quien llama (no pasar a una persona, repetir el saludo…). Como mucho 4 por causa.', '');
  for (const f of peores) {
    md.push(`### ${f.id} (${f.categoria}) — culpa: ${f.culpa ?? 'sin juicio'}`, '');
    md.push(`- Espera: \`${JSON.stringify(f.espera)}\``);
    md.push(`- Entendió: **${f.entendida}**${f.aspectoEntendido && f.entendida === 'info_programa' ? ` (aspecto ${f.aspectoEntendido})` : ''}${f.tipoEntendido ? ` (tipo ${f.tipoEntendido})` : ''} · intención ${f.intencionOk ? 'bien' : 'MAL'} · detalle ${f.detalleOk ? 'bien' : 'MAL'} · acción ${f.accionOk ? 'bien' : 'MAL'}${f.inventadas.length ? ` · INVENTÓ: ${f.inventadas.join(', ')}` : ''}`);
    if (f.nota) md.push(`- Juicio: ${f.nota}`);
    md.push('', '| Quien | Dice |', '|---|---|');
    const lineas: string[] = [];
    f.turnos.forEach((t, i) => {
      lineas.push(`| Llama | ${t.trim() ? t.replace(/\|/g, '/') : '(silencio)'} |`);
      for (const r of f.porTurno[i] ?? []) lineas.push(`| Tooli | ${r.replace(/\|/g, '/')} |`);
      if (i >= f.porTurno.length) lineas.push('| Tooli | (la llamada ya había terminado) |');
    });
    md.push(...lineas, '');
  }
  md.push('## Fallas del bot y de la etiqueta', '');
  md.push('| Id | Espera | Entendió | Culpa | Por qué |', '|---|---|---|---|---|');
  for (const f of fallan) md.push(`| ${f.id} | ${f.espera.intencion}${f.espera.aspecto ? `/${f.espera.aspecto}` : ''}${f.espera.tipo ? `/${f.espera.tipo}` : ''} | ${f.entendida}${f.entendida === 'info_programa' && f.aspectoEntendido ? `/${f.aspectoEntendido}` : ''}${f.tipoEntendido ? `/${f.tipoEntendido}` : ''} | ${f.culpa ?? '—'} | ${(f.nota ?? '').replace(/\|/g, '/')} |`);
  md.push('');
  if (antesEn) md.push(...comparacion(JSON.parse(readFileSync(antesEn, 'utf8')), tot, corregidos, resumenCat));
  writeFileSync(join(carpeta, 'RESULTADOS.md'), md.join('\n'));
  console.log(JSON.stringify({ ...tot, aciertosCorregidos: corregidos }));
}

type ResumenCat = { categoria: string; llamadas: number; intencion: number; accion: number; todo: number; culpaEtiqueta: number };

/** Antes/después por categoría, contra un resultados.json anterior. */
function comparacion(
  antes: { totales: { intencion: number; accion: number; todo: number; aciertosCorregidos: number; inventadas: number; llamadas: number }; porCategoria: ResumenCat[] },
  tot: { intencion: number; accion: number; todo: number; inventadas: number; llamadas: number }, corregidos: number, ahora: ResumenCat[],
): string[] {
  const p = (a: number, b: number) => (b ? (100 * a) / b : 0);
  const d = (x: number, y: number) => { const v = y - x; return `${v > 0 ? '+' : ''}${v.toFixed(1)}`; };
  const out = ['', '## Antes y después de las mejoras', ''];
  out.push(`Antes: ${antesEn}. Mismo corpus, mismo método. Puntos porcentuales.`, '');
  out.push('| | Antes | Después | Cambio |', '|---|---:|---:|---:|');
  const A = antes.totales;
  out.push(`| Intención | ${p(A.intencion, A.llamadas).toFixed(1)} % | ${p(tot.intencion, tot.llamadas).toFixed(1)} % | ${d(p(A.intencion, A.llamadas), p(tot.intencion, tot.llamadas))} |`);
  out.push(`| Acción | ${p(A.accion, A.llamadas).toFixed(1)} % | ${p(tot.accion, tot.llamadas).toFixed(1)} % | ${d(p(A.accion, A.llamadas), p(tot.accion, tot.llamadas))} |`);
  out.push(`| Todo bien | ${p(A.todo, A.llamadas).toFixed(1)} % | ${p(tot.todo, tot.llamadas).toFixed(1)} % | ${d(p(A.todo, A.llamadas), p(tot.todo, tot.llamadas))} |`);
  out.push(`| Corregido | ${p(A.aciertosCorregidos, A.llamadas).toFixed(1)} % | ${p(corregidos, tot.llamadas).toFixed(1)} % | ${d(p(A.aciertosCorregidos, A.llamadas), p(corregidos, tot.llamadas))} |`);
  out.push(`| Llamadas con cifras inventadas | ${A.inventadas} | ${tot.inventadas} | |`, '');
  out.push('| Categoría | Intención antes → después | Acción antes → después | Todo bien antes → después | Corregido antes → después |', '|---|---:|---:|---:|---:|');
  for (const c of ahora) {
    const a = antes.porCategoria.find((x) => x.categoria === c.categoria);
    if (!a) continue;
    const f = (x: number, y: number) => `${p(x, a.llamadas).toFixed(0)} → ${p(y, c.llamadas).toFixed(0)} %`;
    out.push(`| ${c.categoria} | ${f(a.intencion, c.intencion)} | ${f(a.accion, c.accion)} | ${f(a.todo, c.todo)} | ${f(a.todo + a.culpaEtiqueta, c.todo + c.culpaEtiqueta)} |`);
  }
  out.push('');
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
