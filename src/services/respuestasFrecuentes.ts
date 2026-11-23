/**
 * Preguntas frecuentes de la IA: cuenta lo que más pregunta la gente (para el
 * panel) y guarda la respuesta de las preguntas que abren una conversación
 * para no volver a pagar la IA por la misma pregunta.
 *
 * Solo se reutiliza una respuesta cuando no depende de la conversación: es la
 * primera pregunta (sin historial), con el mismo contexto de recomendación y
 * el mismo prompt. La clave lleva un hash del prompt y del mes: si cambia el
 * catálogo, las instrucciones o el mes, la respuesta se vuelve a generar.
 * Nunca se guardan ni se reutilizan preguntas con datos personales.
 */
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { enSimulacion } from './simulacion';

const redis = new Redis(config.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1 });

const TTL_RESPUESTA_SEG = 7 * 24 * 60 * 60;
const TTL_CONTEO_SEG = 30 * 24 * 60 * 60;
const CLAVE_CONTEO = 'ia:preguntas';
const CLAVE_TEXTOS = 'ia:preguntas:texto';
const MAX_PREGUNTAS = 400;
const CONSERVAR = 300;
/** Si Redis tarda, se sigue con la IA: el ahorro nunca demora una respuesta. */
const ESPERA_MAX_MS = 400;

export interface RespuestaGuardada {
  answer: string;
  programaConsultado?: string;
}

const RELLENO = /\b(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|buen dia|saludos|tooli|por favor|porfa|porfavor|gracias|disculpa|disculpe|una pregunta|quisiera saber|me gustaria saber|quiero saber)\b/g;

/** "Hola!! ¿Cuánto cuesta el MBA?" y "cuanto cuesta el mba" son la misma pregunta. */
export function normalizarPregunta(texto: string): string {
  return (texto ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/(\p{L})\1{2,}/gu, '$1')
    .replace(RELLENO, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nombres, correos, teléfonos o documentos: ni se cuentan ni se reutilizan. */
const PERSONAL = new RegExp([
  String.raw`\b(me llamo|mi nombre|mi correo|mi numero|mi telefono|mi celular|mi cedula|mi documento)\b`,
  // "soy Ana" sí; "soy egresado", "soy ingeniera" o "soy de Cartagena" no son un nombre.
  String.raw`\bsoy (?!(egresad[oa]|estudiante|ingenier[oa]|profesional|abogad[oa]|contador[a]?|administrador[a]?|medic[oa]|psicolog[oa]|docente|profesor[a]?|tecnic[oa]|tecnolog[oa]|licenciad[oa]|economista|arquitect[oa]|enfermer[oa]|de|del|un|una|nuev[oa])\b)`,
  '@', String.raw`\d[\d\s.-]{5,}\d`,
].join('|'));

/** La forma de guardar una pregunta, o null si no conviene guardarla. */
export function preguntaGuardable(texto: string): string | null {
  if (PERSONAL.test((texto ?? '').toLowerCase()) || PERSONAL.test(normalizarPregunta(texto))) return null;
  const n = normalizarPregunta(texto);
  if (n.length < 4 || n.length > 160 || n.split(' ').length > 30) return null;
  return n;
}

/** Clave de la respuesta: pregunta normalizada + todo lo que la IA ve (prompt, contexto) + el mes. */
export function claveDeRespuesta(area: string, pregunta: string, loQueVeLaIa: string, hoy = new Date()): string | null {
  const n = preguntaGuardable(pregunta);
  if (!n) return null;
  const hash = createHash('sha256').update([area, n, loQueVeLaIa, hoy.toISOString().slice(0, 7)].join('\u0000')).digest('hex').slice(0, 32);
  return `ia:respuesta:${hash}`;
}

/** Lo que se muestra en el panel: la pregunta sin el saludo de adelante y corta. */
export function textoParaPanel(texto: string): string {
  const sinSaludo = (texto ?? '').replace(/\s+/g, ' ').trim()
    .replace(/^((buenas tardes|buenas noches|buenos dias|buenos días|buen dia|buen día|buenas|hola|holi|saludos)( tooli)?[\s,.!¡]+)+/i, '');
  const t = sinSaludo || (texto ?? '').trim();
  return (t.charAt(0).toLocaleUpperCase('es') + t.slice(1)).slice(0, 100);
}

/** Entre dos formas de la misma pregunta, la que tiene signos y tildes se lee mejor en el panel. */
export function seLeeMejor(nueva: string, actual: string | null): boolean {
  if (!actual) return true;
  const puntos = (t: string) => (t.includes('¿') ? 2 : 0) + (/[áéíóúñ]/i.test(t) ? 1 : 0) - (t.length > 80 ? 1 : 0);
  return puntos(nueva) > puntos(actual);
}

async function conLimite<T>(promesa: Promise<T>, siVence: T): Promise<T> {
  let reloj: NodeJS.Timeout | undefined;
  const vence = new Promise<T>((r) => { reloj = setTimeout(() => r(siVence), ESPERA_MAX_MS); });
  try {
    return await Promise.race([promesa, vence]);
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}

export async function buscarRespuesta(clave: string): Promise<RespuestaGuardada | null> {
  try {
    const crudo = await conLimite(redis.get(clave), null);
    if (!crudo) return null;
    const r = JSON.parse(crudo) as RespuestaGuardada;
    return typeof r.answer === 'string' && r.answer ? r : null;
  } catch {
    return null;
  }
}

export async function guardarRespuesta(clave: string, respuesta: RespuestaGuardada): Promise<void> {
  // Lo que se pregunta en el simulador no queda como respuesta para las personas reales.
  if (enSimulacion()) return;
  try {
    const valor: RespuestaGuardada = { answer: respuesta.answer, ...(respuesta.programaConsultado ? { programaConsultado: respuesta.programaConsultado } : {}) };
    await conLimite(redis.set(clave, JSON.stringify(valor), 'EX', TTL_RESPUESTA_SEG), 'OK');
  } catch {
    // Sin Redis no hay ahorro, pero la persona ya tiene su respuesta.
  }
}

/** Suma una vez la pregunta al ranking del panel (los últimos 30 días). */
export async function contarPregunta(texto: string): Promise<void> {
  // El ranking del panel cuenta solo preguntas de personas reales.
  if (enSimulacion()) return;
  const n = preguntaGuardable(texto);
  if (!n) return;
  try {
    await conLimite((async () => {
      const visible = textoParaPanel(texto);
      const actual = await redis.hget(CLAVE_TEXTOS, n);
      const pipe = redis.multi().zincrby(CLAVE_CONTEO, 1, n);
      if (seLeeMejor(visible, actual)) pipe.hset(CLAVE_TEXTOS, n, visible);
      await pipe.expire(CLAVE_CONTEO, TTL_CONTEO_SEG).expire(CLAVE_TEXTOS, TTL_CONTEO_SEG).exec();
      // El ranking no crece sin fin: se quedan las más preguntadas.
      if (await redis.zcard(CLAVE_CONTEO) > MAX_PREGUNTAS) {
        const sobran = await redis.zrange(CLAVE_CONTEO, 0, -(CONSERVAR + 1));
        if (sobran.length) await redis.multi().zrem(CLAVE_CONTEO, ...sobran).hdel(CLAVE_TEXTOS, ...sobran).exec();
      }
    })(), undefined);
  } catch {
    // El conteo es para el panel: si falla, la conversación sigue.
  }
}

export interface PreguntaFrecuente {
  texto: string;
  veces: number;
}

export async function preguntasFrecuentes(limite = 20): Promise<PreguntaFrecuente[]> {
  const pares = await redis.zrevrange(CLAVE_CONTEO, 0, limite - 1, 'WITHSCORES');
  const claves: string[] = [];
  const veces: number[] = [];
  for (let i = 0; i < pares.length; i += 2) {
    claves.push(pares[i]);
    veces.push(Number(pares[i + 1]) || 0);
  }
  if (!claves.length) return [];
  const textos = await redis.hmget(CLAVE_TEXTOS, ...claves);
  return claves.map((clave, i) => ({ texto: textos[i] || clave, veces: veces[i] }));
}
