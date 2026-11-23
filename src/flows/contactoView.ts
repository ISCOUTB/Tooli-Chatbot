/**
 * Canal de contacto con el asesor de Posgrados: textos, botones y parsers puros.
 * La persona elige cómo la contactan (este chat, una llamada o el correo); el
 * flujo vive en `recomendacion.ts` (sección 7) y aquí solo lo que se prueba sin red.
 *
 * Los teléfonos que escribe la persona nunca van a logs ni a URLs: solo a la
 * sesión, al perfil (con autorización) y a la conversación con el asesor.
 */
import { isBsuid, contactIdLabel } from '../services/whatsappId';
import { normalize } from './validation';
import { CORREO_REGEX, type Boton, type FilaLista } from './recomendacionView';

export type CanalContacto = 'chat' | 'llamada' | 'correo';
export type Franja = 'manana' | 'tarde' | 'noche' | 'cualquiera' | 'cita';

/** Lo que se sabe de cómo quiere que la contacten. `telefono` vacío o 'este' = este mismo WhatsApp. */
export interface Contacto {
  canal: CanalContacto;
  telefono?: string;
  franja?: Franja;
  correo?: string;
}

/** Lo que trae una respuesta escrita: el canal y, si vino, el dato de una vez. */
export interface ContactoEscrito {
  canal: CanalContacto;
  correo?: string;
  telefono?: string;
  mismoNumero?: boolean;
  franja?: Franja;
}

const CANALES: ReadonlySet<string> = new Set(['chat', 'llamada', 'correo']);
const FRANJAS: ReadonlySet<string> = new Set(['manana', 'tarde', 'noche', 'cualquiera', 'cita']);

// ── Pasos ───────────────────────────────────────────────────────────────────

export const PASO_CANAL = 'reco_contacto';
export const PASO_REPETIR = 'reco_contacto_repetir';
export const PASO_NUMERO = 'reco_llamada_numero';
export const PASO_FRANJA = 'reco_llamada_franja';
export const PASOS_DE_CONTACTO: ReadonlySet<string> = new Set([PASO_CANAL, PASO_REPETIR, PASO_NUMERO, PASO_FRANJA]);

// ── Textos y botones ────────────────────────────────────────────────────────

export const TITULO_CONTACTO = '👤 Hablar con un asesor';

/** WhatsApp admite tres botones de respuesta: exactamente los tres canales. */
export const BOTONES_CANAL: readonly Boton[] = [
  { id: 'contacto_chat', displayText: '💬 Por este chat' },
  { id: 'contacto_llamada', displayText: '📞 Llamada' },
  { id: 'contacto_correo', displayText: '📧 Correo' },
];
export const PIE_CANAL = 'También puedes escribirlo';

export function preguntaCanal(intro?: string): string {
  const pregunta = '¿Cómo prefieres que te contacte el asesor?';
  return intro ? `${intro}\n\n${pregunta}` : `🙌 ¡Gracias! ${pregunta}`;
}

export const BOTONES_REPETIR: readonly Boton[] = [
  { id: 'contacto_igual', displayText: '✅ Sí, igual' },
  { id: 'contacto_otro', displayText: '🔄 De otra forma' },
];

export function preguntaRepetir(previo: Contacto, intro?: string): string {
  const pregunta = `¿Te contactamos igual que la vez pasada: ${describirContacto(previo)}?`;
  return intro ? `${intro}\n\n${pregunta}` : pregunta;
}

export const BOTONES_NUMERO: readonly Boton[] = [
  { id: 'contacto_tel_este', displayText: '📱 A este número' },
  { id: 'contacto_tel_otro', displayText: '🔢 A otro número' },
];
export const PREGUNTA_NUMERO = '📞 ¿Te llamamos a este mismo número de WhatsApp o a otro?';
export const PEDIR_NUMERO = '✍️ Escríbeme el número al que te llamamos, por ejemplo: *300 123 4567*';
export const NUMERO_NO_VALIDO =
  '🤔 Ese número no parece de Colombia. Escríbelo con sus 10 dígitos, por ejemplo: *300 123 4567*, o escribe *por acá* y el asesor te escribe por este chat.';

export const PREGUNTA_FRANJA = '¿En qué momento del día te queda mejor que te llamemos?';
export const PREGUNTA_FRANJA_CON_CITA = '¿En qué momento del día te queda mejor que te llamemos? O agenda una cita con día y hora exactos.';

/** La cita solo aparece con la agenda de asesores encendida. */
export function filasFranja(conAgenda: boolean): FilaLista[] {
  return [
    { id: 'contacto_franja_manana', title: '🌅 En la mañana' },
    { id: 'contacto_franja_tarde', title: '🌇 En la tarde' },
    { id: 'contacto_franja_noche', title: '🌙 En la noche' },
    { id: 'contacto_franja_cualquiera', title: '🕐 Cuando sea' },
    ...(conAgenda ? [{ id: 'contacto_franja_cita', title: '📅 Agendar una cita', description: 'Eliges el día y la hora exactos' }] : []),
  ];
}

export function pedirCorreo(conocido?: string): string {
  const base = '📧 ¿A qué correo te escribimos?';
  const ese = conocido ? `\n\n_Si es *${conocido}*, escribe *ese*._` : '';
  return `${base}${ese}\n\n_Si no tienes, escribe *por acá* y el asesor te escribe por este chat._`;
}

export const CORREO_NO_VALIDO =
  '📧 Ese correo no parece válido. Escríbelo de nuevo, por ejemplo: *nombre@correo.com*, o escribe *por acá* y el asesor te escribe por este chat.';

/** El nombre se pide después del canal, en un solo mensaje que dice qué quedó anotado. */
export function pedirNombreTrasCanal(c: Contacto): string {
  return `👍 Anotado: ${describirContacto(c)}.\n\n✍️ Solo me falta tu *nombre completo*.\n\n_Escribe *0* para volver._`;
}

// ── Formatos ────────────────────────────────────────────────────────────────

/** 10 dígitos colombianos legibles: 300 123 4567 (celular) o 605 123 4567 (fijo). */
export function formatearTelefono(diez: string): string {
  return /^\d{10}$/.test(diez) ? `${diez.slice(0, 3)} ${diez.slice(3, 6)} ${diez.slice(6)}` : diez;
}

const FRANJA_TEXTO: Record<Exclude<Franja, 'cita'>, string> = {
  manana: 'en la mañana',
  tarde: 'en la tarde',
  noche: 'en la noche',
  cualquiera: 'a cualquier hora',
};

const esEste = (tel?: string) => !tel || tel === 'este';

/** El número tal como lo lee la persona. */
function numeroParaLaPersona(c: Contacto): string {
  return esEste(c.telefono) ? 'este número' : `*${formatearTelefono(c.telefono!)}*`;
}

/** "llamada a este número en la tarde", "correo a *ana@x.com*", "por este chat". */
export function describirContacto(c: Contacto): string {
  if (c.canal === 'correo') return `📧 correo a *${c.correo}*`;
  if (c.canal === 'llamada') {
    const cuando = c.franja && c.franja !== 'cita' ? ` ${FRANJA_TEXTO[c.franja]}` : '';
    return `📞 llamada a ${numeroParaLaPersona(c)}${cuando}`;
  }
  return '💬 por este chat';
}

/**
 * La línea para el asesor (Chatwoot) y la nota del CRM. Con el número completo:
 * es lo que el asesor necesita para llamar.
 */
export function lineaContacto(c: Contacto, from: string): string {
  if (c.canal === 'correo') return `📧 Pidió que le escriban al correo ${c.correo}`;
  if (c.canal === 'llamada') {
    const numero = esEste(c.telefono) ? `${contactIdLabel(from)} (este WhatsApp)` : `+57 ${formatearTelefono(c.telefono!)}`;
    if (c.franja === 'cita') return `📞 Pidió llamada al ${numero}; está agendando la cita en la agenda de asesores`;
    if (c.franja === 'cualquiera') return `📞 Pidió llamada al ${numero}, a cualquier hora`;
    return c.franja ? `📞 Pidió llamada al ${numero} ${FRANJA_TEXTO[c.franja]}` : `📞 Pidió llamada al ${numero}`;
  }
  return '💬 Prefiere que le escriban por este chat';
}

export function etiquetaContacto(c: Contacto): string {
  return `contacto-${c.canal}`;
}

/**
 * Lo que la persona lee al quedar conectada, en lugar de "te responderá en
 * breve" (que no aplica a quien pidió una llamada en la noche o un correo).
 */
export function avisoContacto(c: Contacto, proxima: string | null): string {
  const cuando = proxima ? ` desde el próximo horario de atención (*${proxima}*)` : '';
  if (c.canal === 'correo') {
    return `📧 Un asesor de Posgrados te escribirá a *${c.correo}*${proxima ? cuando : ' pronto'}.`;
  }
  if (c.canal === 'llamada') {
    if (c.franja === 'cita') return `📅 Elige abajo el día y la hora de tu cita: el asesor te llamará a ${numeroParaLaPersona(c)} a esa hora.`;
    const franja = c.franja && c.franja !== 'cualquiera' ? ` ${FRANJA_TEXTO[c.franja]}` : proxima ? '' : ' apenas pueda';
    return `📞 Un asesor de Posgrados te llamará a ${numeroParaLaPersona(c)}${franja}${franja && cuando ? ',' : ''}${cuando}.`;
  }
  return proxima
    ? `Tu solicitud quedó registrada. Un asesor de Posgrados te responderá en el próximo horario de atención: *${proxima}*.`
    : 'Un asesor de Posgrados te responderá en breve.';
}

// ── Sesión ──────────────────────────────────────────────────────────────────

/** Campos de la sesión (y del perfil) que guardan el canal elegido. */
export function camposContacto(c: Contacto): Record<string, string> {
  return {
    contactoCanal: c.canal,
    contactoTel: c.canal === 'llamada' ? (c.telefono || 'este') : '',
    contactoFranja: c.canal === 'llamada' ? (c.franja ?? '') : '',
    ...(c.canal === 'correo' && c.correo ? { correo: c.correo } : {}),
    // Compatibilidad: lo que ya leía el resto del bot para "pidió que lo llamen".
    pideLlamada: c.canal === 'llamada' ? '1' : '',
  };
}

/** El canal en curso (aún sin completar) desde la sesión. */
export function contactoEnCurso(data: Record<string, string>): Contacto | null {
  const canal = data.contactoCanal;
  if (!canal || !CANALES.has(canal)) return null;
  const franja = FRANJAS.has(data.contactoFranja ?? '') ? (data.contactoFranja as Franja) : undefined;
  return {
    canal: canal as CanalContacto,
    ...(data.contactoTel ? { telefono: data.contactoTel } : {}),
    ...(franja ? { franja } : {}),
    ...(data.correo && CORREO_REGEX.test(data.correo) ? { correo: data.correo } : {}),
  };
}

/**
 * Cómo se contactó la vez pasada (perfil o esta misma conversación), si se
 * puede repetir tal cual. Quien solo dejó su correo antes, lo tiene como canal.
 */
export function contactoAnterior(data: Record<string, string>, from: string): Contacto | null {
  const c = contactoEnCurso(data);
  const correo = data.correo && CORREO_REGEX.test(data.correo) ? data.correo : '';
  if (c?.canal === 'chat') return c;
  if (c?.canal === 'correo' && correo) return { canal: 'correo', correo };
  if (c?.canal === 'llamada') {
    const tel = c.telefono && c.telefono !== 'este' ? telefonoColombiano(c.telefono) : null;
    // A "este número" no se puede llamar si el WhatsApp no trae teléfono (BSUID).
    if (tel) return { canal: 'llamada', telefono: tel, ...(c.franja && c.franja !== 'cita' ? { franja: c.franja } : {}) };
    if (c.telefono === 'este' && !isBsuid(from)) return { canal: 'llamada', telefono: 'este', ...(c.franja && c.franja !== 'cita' ? { franja: c.franja } : {}) };
    return null;
  }
  return correo ? { canal: 'correo', correo } : null;
}

// ── Parsers ─────────────────────────────────────────────────────────────────

/** Normaliza sin tildes ni signos, para comparar palabras. */
function plano(texto: string): string {
  return normalize(texto ?? '').replace(/[^\p{L}\p{N}@.\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Un número colombiano en el texto, en 10 dígitos: celular (3xx) o fijo (60x).
 * Acepta +57, espacios, puntos y guiones. Null si no hay uno válido.
 */
export function telefonoColombiano(texto: string): string | null {
  // Primero la forma exacta (así "300 111 2233 o 301 444 5566" no se junta en un solo número).
  const exacto = /(?<!\d)(?:\+?\s*57[\s.-]*)?\(?(3\d{2}|60[1-8])\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?!\d)/.exec(texto ?? '');
  if (exacto) return `${exacto[1]}${exacto[2]}${exacto[3]}`;
  const candidatos = (texto ?? '').match(/\+?\d[\d\s().-]{6,}\d/g) ?? [];
  for (const crudo of candidatos) {
    let d = crudo.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
    if (/^3\d{9}$/.test(d) || /^60[1-8]\d{7}$/.test(d)) return d;
  }
  return null;
}

/** ¿Escribió algo con forma de número (7 o más dígitos), válido o no? */
export function traeNumero(texto: string): boolean {
  return ((texto ?? '').replace(/[^\d]/g, '').length >= 7);
}

/** El primer correo que aparezca en el texto, en minúsculas y sin el signo final. */
export function correoEnTexto(texto: string): string | null {
  const m = (texto ?? '').match(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/);
  if (!m) return null;
  const correo = m[0].replace(/[.!?]+$/, '').toLowerCase();
  return CORREO_REGEX.test(correo) ? correo : null;
}

const NO_LLAMAR = /\bno (me )?(llam|marqu|timbr)\w*/;
const LLAMADA = /\b(llam\w*|telefon\w*|celular|marquen\w*|marcame|timbr\w*)\b/;
const SIN_CORREO = /\b(no (tengo|uso|manejo|me se|recuerdo)( mi| el| un)? (correo|email|mail|gmail)|sin (correo|email|mail))\b/;
const CORREO = /\b(correo\w*|e ?mail|mail|gmail|hotmail|outlook)\b/;
const CHAT =
  /\b(por (aca|aqui|aki|ahi|whatsapp|wpp|wsp|whats|wasap|chat|el chat|mensaje|mensajes|escrito|este (chat|medio))|(aqui|aca) mismo|escrib\w*|chat|whatsapp|wpp|wsp|mensaje\w*)\b/;
/** "A este número", "al mismo", "aquí mismo": llamar al WhatsApp desde el que escribe. */
const MISMO_NUMERO = /\b((a |al )?(este|ese|mismo|el mismo) (mismo )?(numero|whatsapp|wpp|cel|celular|telefono)|al mismo|este mismo|el mismo|(aqui|aca) mismo|al whatsapp|a este)\b/;

/**
 * El canal que eligió, con botón o escrito: "llámenme", "por correo", "aquí
 * mismo", "al 300 123 4567", "a mi correo ana@x.com", "1", "2", "3".
 */
export function parseCanal(texto: string): ContactoEscrito | null {
  const t = (texto ?? '').trim();
  if (t === 'contacto_chat') return { canal: 'chat' };
  if (t === 'contacto_llamada') return { canal: 'llamada' };
  if (t === 'contacto_correo') return { canal: 'correo' };
  if (t.startsWith('__')) return null;
  const n = plano(t);
  if (n === '1') return { canal: 'chat' };
  if (n === '2') return { canal: 'llamada' };
  if (n === '3') return { canal: 'correo' };

  // El dato manda: un correo o un teléfono escritos dicen el canal y lo traen de una vez.
  const correo = correoEnTexto(t);
  if (correo) return { canal: 'correo', correo };
  const franja = parseFranja(t) ?? undefined;
  const conFranja = franja && franja !== 'cita' ? { franja } : {};
  const telefono = telefonoColombiano(t);
  if (telefono && !NO_LLAMAR.test(n)) return { canal: 'llamada', telefono, ...conFranja };

  if (LLAMADA.test(n) && !NO_LLAMAR.test(n)) {
    return { canal: 'llamada', ...(MISMO_NUMERO.test(n) ? { mismoNumero: true } : {}), ...conFranja };
  }
  if (CORREO.test(n) && !SIN_CORREO.test(n)) return { canal: 'correo' };
  if (CHAT.test(n) || SIN_CORREO.test(n) || NO_LLAMAR.test(n) || /\b(prefiero|mejor) (whatsapp|que me escriban|escrito)\b/.test(n)) return { canal: 'chat' };
  return null;
}

/** "Buenas tardes" es un saludo, no la franja de la tarde. */
const SALUDO_CON_FRANJA = /\bbuen(as|os|a)? (tardes|noches|dias|dia)\b/g;

/**
 * La franja para la llamada: botón, número de la lista o escrita ("en la
 * tarde", "cuando sea", "a las 3 pm"). 'cita' si quiere agendar.
 */
export function parseFranja(texto: string): Franja | null {
  const t = (texto ?? '').trim();
  const id = /^contacto_franja_(\w+)$/.exec(t)?.[1];
  if (id) return FRANJAS.has(id) ? (id as Franja) : null;
  if (t.startsWith('__')) return null;
  const n = plano(t).replace(SALUDO_CON_FRANJA, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  const porNumero: Record<string, Franja> = { '1': 'manana', '2': 'tarde', '3': 'noche', '4': 'cualquiera', '5': 'cita' };
  if (porNumero[n]) return porNumero[n];
  if (/\b(agend\w*|agenda|cita)\b/.test(n)) return 'cita';
  if (/\b(cuando sea|cuando (puedan|quieran|gusten|pueda)|cualquier (hora|momento|rato|franja)|a cualquier|(me )?da igual|no importa|indiferente|todo el dia|cuando sea mejor|lo antes posible|ya mismo|ahora)\b/.test(n)) return 'cualquiera';
  // "A las 3 pm", "10 am": la hora dice la franja.
  const hora = /\b(\d{1,2})(?:[:.]\d{2})?\s*(am|a\.?m|pm|p\.?m)\b/.exec(n);
  if (hora) {
    const h = Number(hora[1]);
    if (hora[2].startsWith('a')) return h >= 1 && h <= 11 ? 'manana' : null;
    if (h === 12 || (h >= 1 && h < 6)) return 'tarde';
    if (h >= 6 && h <= 11) return 'noche';
  }
  if (/\bnoche\w*\b/.test(n)) return 'noche';
  if (/\btarde\w*\b/.test(n)) return 'tarde';
  if (/\b(manana|temprano|mediodia)\b/.test(n)) return 'manana';
  return null;
}

export type RespuestaNumero = { este: true } | { telefono: string } | { otro: true };

/** A qué número llamar: botón, el número escrito, "a este" o "a otro". */
export function parseNumero(texto: string): RespuestaNumero | null {
  const t = (texto ?? '').trim();
  if (t === 'contacto_tel_este') return { este: true };
  if (t === 'contacto_tel_otro') return { otro: true };
  if (t.startsWith('__')) return null;
  const telefono = telefonoColombiano(t);
  if (telefono) return { telefono };
  const n = plano(t);
  if (n === '1') return { este: true };
  if (n === '2') return { otro: true };
  if (/\b(otro|otra|diferente|distinto|fijo)\b/.test(n)) return { otro: true };
  // "No, a este" es este; un "no" solo es que quiere otro.
  if (MISMO_NUMERO.test(n) || /\b(este|ese|aqui|aca|whatsapp|wpp)\b/.test(n) || /^(si|sip|claro|dale|ok|okay|listo|correcto|de una)\b/.test(n)) {
    return { este: true };
  }
  if (/^no\b/.test(n)) return { otro: true };
  return null;
}

export type RespuestaRepetir = 'igual' | 'otro';

export function parseRepetir(texto: string): RespuestaRepetir | null {
  const t = (texto ?? '').trim();
  if (t === 'contacto_igual') return 'igual';
  if (t === 'contacto_otro') return 'otro';
  const n = plano(t);
  if (/^(si|sip|claro|dale|ok|okay|listo|correcto|de una|perfecto|igual|como la vez pasada|igual que antes|lo mismo)\b/.test(n) || /\b(igual|lo mismo)\b/.test(n) && !/\bno\b/.test(n)) return 'igual';
  if (/^(no|nop|cambiar|otra|otro|de otra)\b/.test(n) || /\b(otra forma|otra manera|cambiar|diferente)\b/.test(n)) return 'otro';
  return null;
}

/** En un paso del canal, ¿la respuesta escrita es para el paso (y no una pregunta para la IA)? */
export function respondeAlPaso(paso: string, texto: string): boolean {
  if (paso === PASO_CANAL) return parseCanal(texto) !== null;
  if (paso === PASO_REPETIR) return parseRepetir(texto) !== null || parseCanal(texto) !== null;
  if (paso === PASO_NUMERO) return parseNumero(texto) !== null || traeNumero(texto) || parseCanal(texto)?.canal === 'correo';
  if (paso === PASO_FRANJA) return parseFranja(texto) !== null || telefonoColombiano(texto) !== null;
  return false;
}

/** El canal elegido con todo lo que necesita (correo, número y franja), o null si falta algo. */
export function contactoListo(data: Record<string, string>): Contacto | null {
  const c = contactoEnCurso(data);
  if (!c) return null;
  if (c.canal === 'correo') return c.correo ? c : null;
  if (c.canal === 'llamada') return c.telefono && c.franja ? c : null;
  return c;
}

/** "Ese", "el mismo": el correo que ya tenía. */
export function esElMismoCorreo(texto: string): boolean {
  return /^(a )?(ese|el mismo|ese mismo|el de antes|ese correo|el mismo correo|al mismo|si|sip|correcto|ese es)$/.test(plano(texto));
}

export const REPETIR_CANAL =
  '🤔 No te entendí. Toca una opción o escríbelo, por ejemplo: *llámenme en la tarde*, *por correo* o *por acá*.';
