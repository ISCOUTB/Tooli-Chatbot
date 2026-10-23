import fs from 'fs';
import path from 'path';
import { Session } from '../../services/session';
import { getEventoSession, setEventoSession, eventoMessaging } from './shared';
import { guardarRegistroEvento, actualizarConfirmacionEvento } from '../../services/eventoSheets';
import { generarCertificado } from '../../services/certificadoService';
import { describeExternalError } from '../../services/logSafe';

interface Ctx {
  from: string;
  text: string;
  session: Session | null;
}

// ── Configurables (ajustar antes del evento) ─────────────────────────────────

const BRAND = 'Talento Tech · UTB';

/**
 * Diplomados de Talento Tech (opciones de la lista). Máx. 10 filas en WhatsApp,
 * título máx. 24 caracteres (por eso van sin emoji para no truncarse).
 */
const DIPLOMADO_OPTS = [
  { id: 'ia',    title: 'Inteligencia Artificial' },
  { id: 'ciber', title: 'Ciberseguridad' },
  { id: 'datos', title: 'Análisis de Datos' },
  { id: 'prog',  title: 'Programación' },
  { id: 'otro',  title: 'Otro' },
];
const DIPLOMADO_MAP: Record<string, string> = {
  ia:    'Inteligencia Artificial',
  ciber: 'Ciberseguridad',
  datos: 'Análisis de Datos',
  prog:  'Programación',
  otro:  'Otro',
};

// ── Imágenes ──────────────────────────────────────────────────────────────────
// La felicitación se genera como CERTIFICADO personalizado (certificadoService).
// El flyer del workshop (sábado) se lee desde disco y se sube directo a Meta
// (no depende de URL pública / nginx).
const FLYER_WORKSHOP = path.resolve(__dirname, '../../public/evento/workshop.jpeg');
const REGISTRO_URL   = 'https://gdg.community.dev/events/details/google-gdg-cartagena-presents-build-with-ai-cartagena-conociendo-a-devin-1/';
const POSGRADOS_URL  = 'https://www.utb.edu.co/posgrado/';

function invalid(to: string): Promise<void> {
  return eventoMessaging.sendText({ to, text: 'Por favor usa los botones o la lista 👆' });
}

function primerNombre(nombre: string): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

// ── Recomendación de posgrado UTB según la carrera (texto libre) ──────────────
interface PosgradoRec { nombre: string; desc: string; }

function recomendarPosgrado(carrera: string): PosgradoRec {
  const c = (carrera ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const has = (...keys: string[]) => keys.some((k) => c.includes(k));

  if (has('cibersegur', 'seguridad informatica'))
    return { nombre: 'Maestría en Ciberseguridad', desc: 'Especialízate en proteger sistemas, redes y datos — una de las áreas tech más demandadas del mundo.' };
  if (has('sistema', 'software', 'informatic', 'computac', 'telematic', 'programac'))
    return { nombre: 'Especialización en Ingeniería de Software (Virtual)', desc: 'Profundiza en arquitectura, calidad y desarrollo de software moderno, 100% virtual.' };
  if (has('dato', 'estadistic', 'matematic', 'actuari'))
    return { nombre: 'Maestría en Estadística Aplicada y Ciencia de Datos', desc: 'Conviértete en experto en analítica, modelos predictivos y ciencia de datos.' };
  if (has('industrial', 'mecatron', 'automatiz', 'mecanic', 'electron', 'electric'))
    return { nombre: 'Maestría en Industria 4.0 y Automatización Industrial', desc: 'Lidera la transformación tecnológica y la automatización de la industria.' };
  if (has('financ', 'contad', 'contab', 'econom'))
    return { nombre: 'Maestría en Finanzas', desc: 'Domina las finanzas corporativas y la toma de decisiones de inversión.' };
  if (has('mercade', 'marketing', 'publicidad'))
    return { nombre: 'Especialización en Gerencia de Mercadeo', desc: 'Lleva tu perfil al liderazgo de estrategias de mercadeo y marca.' };
  if (has('comunicac', 'periodis', 'disen', 'audiovisual', 'multimedia'))
    return { nombre: 'Maestría en Management de la Transformación Digital', desc: 'Lidera la transformación digital de las organizaciones desde la estrategia y la comunicación.' };
  if (has('administ', 'negocio', 'empresa', 'comercial'))
    return { nombre: 'MBA - Maestría en Administración', desc: 'Potencia tu liderazgo y tu visión estratégica de negocios.' };
  if (has('psicolog', 'trabajo social', 'social'))
    return { nombre: 'Maestría en Intervención Psicosocial', desc: 'Diseña e implementa intervenciones que transforman comunidades.' };
  if (has('derecho', 'juridic', 'abogac'))
    return { nombre: 'Maestría en Derecho', desc: 'Fortalece tu ejercicio profesional con profundización jurídica avanzada.' };
  if (has('salud', 'enfermer', 'medic', 'odontolog', 'fisioterap'))
    return { nombre: 'Especialización en Gerencia de Servicios de Salud (Virtual)', desc: 'Gestiona y lidera servicios e instituciones de salud, 100% virtual.' };
  if (has('ingenier'))
    return { nombre: 'Maestría en Ingeniería', desc: 'Fortalece tu perfil técnico con investigación e innovación aplicada.' };

  // Default — tema digital (encaja con el espíritu del evento)
  return { nombre: 'Maestría en Management de la Transformación Digital', desc: 'Lidera la transformación digital y la innovación en cualquier sector.' };
}

// ── 0. Inicio → pide nombre ──────────────────────────────────────────────────

export async function handleEventoInicio(ctx: Ctx): Promise<void> {
  const { from } = ctx;

  await eventoMessaging.sendText({
    to: from,
    text:
      '🎉 *¡Felicitaciones!* 🎓\n\n' +
      'Soy el asistente de la *Escuela de Transformación Digital* de la UTB.\n\n' +
      'Acabas de cerrar tu paso por *Talento Tech* 🚀 — ¡un gran logro!\n\n' +
      'Antes de entregarte tu reconocimiento, cuéntame unos datos rápidos (menos de 1 minuto).',
  });

  await setEventoSession(from, { step: 'evento_nombre', data: {} });

  await eventoMessaging.sendText({
    to: from,
    text: '✍️ ¿Cuál es tu *nombre completo*?',
  });
}

// ── 1. Nombre → ¿estudiante UTB? ─────────────────────────────────────────────

export async function handleEventoNombre(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const nombre = text.trim();

  if (nombre.length < 2) {
    await eventoMessaging.sendText({ to: from, text: 'Por favor escribe tu nombre 🙂' });
    return;
  }

  await setEventoSession(from, { step: 'evento_es_utb', data: { ...session?.data, nombre } });

  await eventoMessaging.sendButtons({
    to: from,
    title: BRAND,
    description: `¡Gracias, ${primerNombre(nombre)}! 👋\n\n¿Eres estudiante de la *UTB*?`,
    footer: 'Universidad Tecnológica de Bolívar',
    buttons: [
      { id: 'si', displayText: '✅ Sí' },
      { id: 'no', displayText: '❌ No' },
    ],
  });
}

// ── 2. ¿Estudiante UTB? → carrera ────────────────────────────────────────────

export async function handleEventoEsUTB(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const esEstudianteUTB = input === 'si' ? 'Sí' : 'No';
  await setEventoSession(from, {
    step: 'evento_carrera',
    data: { ...session?.data, esEstudianteUTB },
  });

  await eventoMessaging.sendText({
    to: from,
    text: '🎓 ¿Qué *carrera* estudias o estudiaste?',
  });
}

// ── 3. Carrera → diplomado ───────────────────────────────────────────────────

export async function handleEventoCarrera(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const carrera = text.trim();

  if (carrera.length < 2) {
    await eventoMessaging.sendText({ to: from, text: 'Por favor escribe tu carrera 🙂' });
    return;
  }

  await setEventoSession(from, { step: 'evento_diplomado', data: { ...session?.data, carrera } });

  await eventoMessaging.sendList({
    to: from,
    title: BRAND,
    description: '📚 ¿Qué *diplomado* de Talento Tech realizaste?',
    footer: 'Selecciona una opción',
    buttonText: 'Ver diplomados',
    sections: [{ title: 'Diplomados', rows: DIPLOMADO_OPTS }],
  });
}

// ── 4. Diplomado → ¿interesa posgrado? ───────────────────────────────────────

export async function handleEventoDiplomado(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  const diplomado = DIPLOMADO_MAP[input];

  if (!diplomado) { await invalid(from); return; }

  // Si elige "Otro", pedimos el nombre por texto libre
  if (input === 'otro') {
    await setEventoSession(from, { step: 'evento_diplomado_texto', data: { ...session?.data } });
    await eventoMessaging.sendText({
      to: from,
      text: '✏️ ¿Cuál diplomado realizaste? Escríbelo 👇',
    });
    return;
  }

  await setEventoSession(from, { step: 'evento_posgrado', data: { ...session?.data, diplomado } });
  await preguntarPosgrado(from);
}

// ── 4b. Diplomado (texto libre cuando eligió "Otro") ─────────────────────────

export async function handleEventoDiplomadoTexto(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const diplomado = text.trim();

  if (diplomado.length < 2) {
    await eventoMessaging.sendText({ to: from, text: 'Por favor escribe el nombre del diplomado 🙂' });
    return;
  }

  await setEventoSession(from, { step: 'evento_posgrado', data: { ...session?.data, diplomado } });
  await preguntarPosgrado(from);
}

async function preguntarPosgrado(to: string): Promise<void> {
  await eventoMessaging.sendButtons({
    to,
    title: BRAND,
    description: '🎓 ¿Te interesaría hacer un *posgrado* (especialización o maestría)?',
    footer: 'Escuela de Transformación Digital',
    buttons: [
      { id: 'si',     displayText: '✅ Sí' },
      { id: 'talvez', displayText: '🤔 Tal vez' },
      { id: 'no',     displayText: '❌ No' },
    ],
  });
}

// ── 5. ¿Posgrado? → ¿contactar? ──────────────────────────────────────────────

export async function handleEventoPosgrado(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  const map: Record<string, string> = { si: 'Sí', talvez: 'Tal vez', no: 'No' };
  const interesaPosgrado = map[input];
  if (!interesaPosgrado) { await invalid(from); return; }

  await setEventoSession(from, {
    step: 'evento_contacto',
    data: { ...session?.data, interesaPosgrado },
  });

  // Si le interesa (Sí / Tal vez), recomendar un posgrado UTB según su carrera
  if (input === 'si' || input === 'talvez') {
    const carrera = session?.data?.carrera ?? '';
    const rec = recomendarPosgrado(carrera);
    await eventoMessaging.sendText({
      to: from,
      text:
        `🎓 *¡Me encanta!*\n\n` +
        `Según lo que estudiaste${carrera ? ` (*${carrera}*)` : ''}, en la UTB te podría interesar:\n\n` +
        `📘 *${rec.nombre}*\n${rec.desc}\n\n` +
        `La UTB tiene más de 40 posgrados (especializaciones, maestrías y doctorados). Míralos todos aquí 👇\n${POSGRADOS_URL}`,
    });
  }

  await eventoMessaging.sendButtons({
    to: from,
    title: BRAND,
    description: '📩 ¿Te gustaría que te contactemos para enviarte información sobre programas y próximos eventos?',
    footer: 'Tus datos se tratan según la Ley 1581 de 2012',
    buttons: [
      { id: 'si', displayText: '✅ Sí, claro' },
      { id: 'no', displayText: '❌ No, gracias' },
    ],
  });
}

// ── 6. ¿Contactar? → guardar + felicitar + invitar ───────────────────────────

export async function handleEventoContacto(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const aceptaContacto = input === 'si' ? 'Sí' : 'No';
  const d: Record<string, string> = { ...session?.data, aceptaContacto };

  // Guardar el registro — devuelve la fila para actualizar la confirmación luego
  let fila = 0;
  try {
    fila = await guardarRegistroEvento({
      whatsapp:         from,
      nombre:           d.nombre           ?? '',
      esEstudianteUTB:  d.esEstudianteUTB  ?? '',
      carrera:          d.carrera          ?? '',
      diplomado:        d.diplomado        ?? '',
      interesaPosgrado: d.interesaPosgrado ?? '',
      aceptaContacto,
    });
  } catch (err) {
    console.error('[evento] error guardando registro:', describeExternalError(err));
  }

  const nombre = primerNombre(d.nombre ?? '');

  // 1) Certificado personalizado de felicitación (generado con el nombre)
  try {
    const certBuffer = await generarCertificado(d.nombre ?? '', d.diplomado ?? '');
    await eventoMessaging.sendImage({
      to: from,
      buffer: certBuffer,
      mimetype: 'image/png',
      caption:
        `🎓 ¡${nombre}, felicitaciones por completar Talento Tech! 👏\n\n` +
        '¡Compártelo con orgullo, este logro es tuyo! 🚀',
    });
  } catch (err) {
    console.error('[evento] error generando/enviando certificado:', describeExternalError(err));
    // Fallback: felicitación en texto si el certificado falla
    await eventoMessaging.sendText({
      to: from,
      text:
        `🎓 ¡${nombre}, felicitaciones por completar Talento Tech! 👏\n\n` +
        'Fuiste parte de uno de los proyectos tecnológicos más grandes de la región. 🚀',
    }).catch(() => {});
  }

  // 2) Preguntar si quiere conocer el workshop (para no saturar con info de golpe)
  await setEventoSession(from, {
    step: 'evento_quiere_info',
    data: { ...d, filaSheet: String(fila) },
  });

  await eventoMessaging.sendButtons({
    to: from,
    title: BRAND,
    description:
      '🎉 Y antes de irte... tenemos un *workshop gratuito de IA* este *sábado* en la UTB.\n\n' +
      '¿Te gustaría conocerlo?',
    footer: 'Cupos limitados',
    buttons: [
      { id: 'si', displayText: '✅ Sí, cuéntame' },
      { id: 'no', displayText: '❌ No, gracias' },
    ],
  });
}

// ── 6b. ¿Quiere conocer el workshop? → flyer + programa, o cierre ─────────────

export async function handleEventoQuiereInfo(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const fila = parseInt(session?.data?.filaSheet ?? '0', 10);

  // No quiere info → cerrar amablemente
  if (input === 'no') {
    try { await actualizarConfirmacionEvento(fila, 'No quiso info'); }
    catch (err) { console.error('[evento] error actualizando confirmación:', describeExternalError(err)); }

    await setEventoSession(from, { step: 'evento_completada', data: {} });
    await eventoMessaging.sendText({
      to: from,
      text:
        '¡Perfecto! 🙌 Gracias por participar y felicitaciones de nuevo por tu logro.\n\n' +
        '🎓 *Universidad Tecnológica de Bolívar*',
    });
    return;
  }

  // Sí quiere info → flyer + programa + preguntar confirmación
  const invitacionCaption =
    '🚀 *Workshop "Transforma con IA"*\n' +
    '📅 Sábado 6 de junio · 9:00 a.m.\n' +
    '📍 Campus Lemaitre — Auditorio Taua\n' +
    '🎤 Con *Erasmo Hernández* (Globant · Embajador Cognition LATAM)';
  try {
    const flyerBuffer = fs.readFileSync(FLYER_WORKSHOP);
    await eventoMessaging.sendImage({
      to: from,
      buffer: flyerBuffer,
      mimetype: 'image/jpeg',
      caption: invitacionCaption,
    });
  } catch (err) {
    console.error('[evento] error enviando flyer del workshop:', describeExternalError(err));
    await eventoMessaging.sendText({ to: from, text: invitacionCaption }).catch(() => {});
  }

  await eventoMessaging.sendText({
    to: from,
    text:
      '✨ *¿Qué vivirás en el workshop?*\n\n' +
      '🎬 *Demo en vivo* — mira a *Devin* crear aplicaciones completas a partir de una simple descripción en lenguaje natural.\n\n' +
      '🛠️ *Taller práctico* — instala la herramienta y da tus primeros pasos.\n\n' +
      '🚀 *Construye tu idea* — crea un desarrollo funcional en menos de 1 hora.\n\n' +
      '🤝 *Networking* — conecta con la comunidad de devs que usan IA en Cartagena.\n\n' +
      '🎁 Cupones para probar *Devin* gratis, swag de Cognition y comida. 🍕\n' +
      '💻 *Requisito:* lleva tu portátil cargado.',
  });

  await setEventoSession(from, { step: 'evento_confirmar', data: { ...session?.data } });

  await eventoMessaging.sendButtons({
    to: from,
    title: BRAND,
    description: '🎟️ ¿Confirmas tu asistencia al workshop del *sábado 6 de junio*?',
    footer: 'Cupo limitado · Auditorio Taua',
    buttons: [
      { id: 'si',     displayText: '✅ Sí, confirmo' },
      { id: 'talvez', displayText: '🤔 Tal vez' },
      { id: 'no',     displayText: '❌ No puedo' },
    ],
  });
}

// ── 7. Confirmación de asistencia → actualizar Sheet + enviar link ───────────

export async function handleEventoConfirmar(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  const map: Record<string, string> = { si: 'Sí', talvez: 'Tal vez', no: 'No' };
  const confirma = map[input];
  if (!confirma) { await invalid(from); return; }

  const fila = parseInt(session?.data?.filaSheet ?? '0', 10);
  try {
    await actualizarConfirmacionEvento(fila, confirma);
  } catch (err) {
    console.error('[evento] error actualizando confirmación:', describeExternalError(err));
  }

  const nombre = primerNombre(session?.data?.nombre ?? '');
  await setEventoSession(from, { step: 'evento_completada', data: {} });

  if (input === 'si') {
    await eventoMessaging.sendText({
      to: from,
      text:
        `🎟️ ¡Listo${nombre ? ', ' + nombre : ''}! Tu asistencia quedó *confirmada*. ✅\n\n` +
        `Agrégalo a tu calendario o compártelo aquí 👇\n${REGISTRO_URL}\n\n` +
        '📅 Sábado 6 de junio · 9:00 a.m.\n' +
        '📍 Campus Lemaitre — Auditorio Taua\n' +
        '💻 Recuerda llevar tu portátil cargado.\n\n' +
        '¡Nos vemos! 🚀\n🎓 *Universidad Tecnológica de Bolívar*',
    });
  } else {
    await eventoMessaging.sendText({
      to: from,
      text:
        '👍 ¡Gracias por participar!\n\n' +
        `Si cambias de opinión, aquí tienes el link para registrarte al workshop del sábado 👇\n${REGISTRO_URL}\n\n` +
        '¡Te esperamos! 🚀',
    });
  }
}

// ── Completada (si vuelve a escribir) ─────────────────────────────────────────

export async function handleEventoCompletada(ctx: Ctx): Promise<void> {
  const { from } = ctx;
  await eventoMessaging.sendText({
    to: from,
    text:
      '✅ ¡Ya quedaste registrado! Nos vemos el *sábado 6 de junio · 9:00 a.m.* 🚀\n' +
      '📍 Campus Lemaitre — Auditorio Taua\n\n' +
      `_Link del evento:_ ${REGISTRO_URL}`,
  });
}
