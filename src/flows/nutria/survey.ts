import QRCode from 'qrcode';
import { Session } from '../../services/session';
import { getNutriaSession, setNutriaSession, nutriaMessaging } from './shared';
import { guardarEncuestaNutria } from '../../services/nutriaSheets';
import { crearCodigoNutria } from '../../services/nutriaCodigoService';
import { guardarImagenMeta } from '../../services/nutriaImageService';
import { config } from '../../config';
import { describeExternalError } from '../../services/logSafe';

interface Ctx {
  from: string;
  text: string;
  session: Session | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function p(n: number): string {
  return `📊 Pregunta ${n} de 19\n\n`;
}

const TIEMPO_OPTS = [
  { id: 'menos_1h', title: '⚡ Menos de 1 hora' },
  { id: '1_3h',     title: '🕐 Entre 1 y 3 horas' },
  { id: '4_6h',     title: '🕓 Entre 4 y 6 horas' },
  { id: 'mas_6h',   title: '📵 Más de 6 horas' },
];

const TIEMPO_MAP: Record<string, string> = {
  menos_1h: 'Menos de 1 hora',
  '1_3h': 'Entre 1 y 3 horas',
  '4_6h': 'Entre 4 y 6 horas',
  mas_6h: 'Más de 6 horas',
};

const REDES_OPTS = [
  { id: 'tiktok',    title: '🎵 TikTok' },
  { id: 'instagram', title: '📸 Instagram' },
  { id: 'facebook',  title: '📘 Facebook' },
  { id: 'twitter',   title: '🐦 X / Twitter' },
  { id: 'youtube',   title: '▶️ YouTube' },
  { id: 'otra',      title: '📱 Otra' },
];

const REDES_MAP: Record<string, string> = {
  tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook',
  twitter: 'X/Twitter', youtube: 'YouTube', otra: 'Otra',
};

const FREC_OPTS = [
  { id: '0', title: '🚫 Ninguna vez' },
  { id: '1', title: '1️⃣ 1 vez' },
  { id: '2', title: '2️⃣ 2 veces' },
  { id: '3', title: '3️⃣ 3 veces' },
  { id: '4', title: '➕ Más de 4 veces' },
];

const FREC_MAP: Record<string, string> = {
  '0': 'Ninguna vez', '1': '1 vez', '2': '2 veces',
  '3': '3 veces', '4': 'Más de 4 veces',
};

async function sendRedList(to: string, desc: string): Promise<void> {
  await nutriaMessaging.sendList({
    to,
    title: 'NutriA',
    description: desc,
    footer: 'UTB · Investigación',
    buttonText: 'Ver redes',
    sections: [{ title: 'Redes sociales', rows: REDES_OPTS }],
  });
}

async function sendFrecList(to: string, desc: string): Promise<void> {
  await nutriaMessaging.sendList({
    to,
    title: 'NutriA',
    description: desc,
    footer: 'UTB · Investigación',
    buttonText: 'Ver opciones',
    sections: [{ title: 'Frecuencia semanal', rows: FREC_OPTS }],
  });
}

function invalid(to: string): Promise<void> {
  return nutriaMessaging.sendText({ to, text: 'Por favor selecciona una opción de la lista 👆' });
}

// ── 0. Inicio → Consentimiento informado ─────────────────────────────────────

export async function handleNutriaInicio(ctx: Ctx): Promise<void> {
  const { from } = ctx;

  await nutriaMessaging.sendText({
    to: from,
    text:
      '👋 *¡Hola! Soy NutriA* 🥗\n\n' +
      'Soy un bot de investigación de la *Universidad Tecnológica de Bolívar*.\n\n' +
      'Antes de comenzar, por favor lee el siguiente *consentimiento informado*. 👇',
  });

  await nutriaMessaging.sendText({
    to: from,
    text:
      '📋 *CONSENTIMIENTO INFORMADO*\n\n' +
      '*Título del estudio:*\n' +
      'Estrategias de marketing de marcas con productos ultraprocesados con sellos octogonales: Caracterización post implementación regulatoria en Colombia.\n\n' +
      '*Investigadores:*\n' +
      'Ricardo Peña Ruiz, Estefania Pulido Garcia, Fernando Salcedo Mejía\n\n' +
      '*Institución:*\n' +
      'Escuela de Transformación Digital — Universidad Tecnológica de Bolívar\n\n' +
      '📧 ripena@utb.edu.co · epulido@utb.edu.co · fsalcedo@utb.edu.co',
  });

  await nutriaMessaging.sendText({
    to: from,
    text:
      'Ha sido invitado/a a participar *voluntariamente* en este estudio. El objetivo es conocer los hábitos alimenticios de jóvenes colombianos, su conocimiento sobre alimentos ultraprocesados, percepción del etiquetado octogonal e incidencia de la publicidad en redes sociales.\n\n' +
      '⏱️ Duración aproximada: *3 minutos*\n\n' +
      '🔒 Esta encuesta es *completamente anónima*. No se solicitará cédula, nombre ni dirección.\n\n' +
      'Puede retirarse en cualquier momento sin ninguna consecuencia. Según la *Resolución 8430 de 1993* (Art. 11), esta investigación se clasifica como *sin riesgo*.\n\n' +
      'Al aceptar, usted declara que:\n' +
      '• Ha leído y comprendido esta información\n' +
      '• Acepta participar voluntariamente\n' +
      '• Autoriza el uso de sus datos únicamente para fines académicos, conforme a la *Ley 1581 de 2012*',
  });

  await setNutriaSession(from, { step: 'nutria_consentimiento', data: {} });

  await nutriaMessaging.sendButtons({
    to: from,
    title: 'NutriA · UTB',
    description: '¿Acepta participar en este estudio de investigación?',
    footer: 'Escuela de Transformación Digital',
    buttons: [
      { id: 'si', displayText: '✅ Sí, acepto' },
      { id: 'no', displayText: '❌ No, gracias' },
    ],
  });
}

// ── 0b. Consentimiento ────────────────────────────────────────────────────────

export async function handleNutriaConsentimiento(ctx: Ctx): Promise<void> {
  const { from, text } = ctx;
  const input = text.trim().toLowerCase();

  if (input !== 'si' && input !== 'no') {
    await nutriaMessaging.sendText({ to: from, text: 'Por favor responde usando los botones 👆' });
    return;
  }

  if (input === 'no') {
    await setNutriaSession(from, { step: 'nutria_rechazado', data: {} });
    await nutriaMessaging.sendText({
      to: from,
      text:
        'Gracias por tu tiempo. 🙏\n\n' +
        'Respetamos tu decisión. Si en algún momento deseas participar, escribe *encuesta* para comenzar.\n\n' +
        '🎓 *Universidad Tecnológica de Bolívar*',
    });
    return;
  }

  // Acepta → iniciar encuesta
  await setNutriaSession(from, { step: 'nutria_edad', data: {} });

  await nutriaMessaging.sendText({
    to: from,
    text:
      '¡Perfecto! Empecemos 🚀\n\n' +
      'Te haré *19 preguntas rápidas*.\n' +
      '⏱️ Tiempo estimado: *3 minutos*',
  });

  await nutriaMessaging.sendList({
    to: from,
    title: 'NutriA',
    description: p(1) + '¿Cuál es tu edad?',
    footer: 'UTB · Investigación',
    buttonText: 'Ver edades',
    sections: [{
      title: 'Edad',
      rows: [
        { id: '16', title: '16 años' }, { id: '17', title: '17 años' },
        { id: '18', title: '18 años' }, { id: '19', title: '19 años' },
        { id: '20', title: '20 años' }, { id: '21', title: '21 años' },
        { id: '22', title: '22 años' }, { id: '23', title: '23 años' },
        { id: 'otro', title: '🔢 Otra edad' },
      ],
    }],
  });
}

// ── 2. Edad ───────────────────────────────────────────────────────────────────

async function sendGeneroButtons(to: string): Promise<void> {
  await nutriaMessaging.sendButtons({
    to,
    title: 'NutriA',
    description: p(2) + '¿Con qué género te identificas?',
    buttons: [
      { id: 'F', displayText: '👩 Femenino' },
      { id: 'M', displayText: '👨 Masculino' },
      { id: 'N', displayText: '🤐 Prefiero no decir' },
    ],
  });
}

export async function handleNutriaEdad(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim();
  const validos = ['16','17','18','19','20','21','22','23','otro'];

  if (!validos.includes(input)) { await invalid(from); return; }

  if (input === 'otro') {
    await setNutriaSession(from, { step: 'nutria_edad_texto', data: { ...session?.data } });
    await nutriaMessaging.sendText({ to: from, text: '✏️ ¿Cuál es tu edad? Escribe solo el número 👇' });
    return;
  }

  const edad = `${input} años`;
  await setNutriaSession(from, { step: 'nutria_genero', data: { ...session?.data, edad } });
  await sendGeneroButtons(from);
}

export async function handleNutriaEdadTexto(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const raw = text.trim();
  const edad = /^\d+$/.test(raw) ? `${raw} años` : (raw || 'Otra');
  await setNutriaSession(from, { step: 'nutria_genero', data: { ...session?.data, edad } });
  await sendGeneroButtons(from);
}

// ── 3. Género ─────────────────────────────────────────────────────────────────

export async function handleNutriaGenero(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const generoMap: Record<string, string> = { F: 'Femenino', M: 'Masculino', N: 'Prefiero no decir' };
  const genero = generoMap[text.trim().toUpperCase()];

  if (!genero) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_tiempo_celular', data: { ...session?.data, genero } });

  await nutriaMessaging.sendList({
    to: from,
    title: 'NutriA',
    description: p(3) + '¿Cuánto tiempo usas tu celular al día? 📱',
    footer: 'UTB · Investigación',
    buttonText: 'Ver opciones',
    sections: [{ title: 'Horas de uso', rows: TIEMPO_OPTS }],
  });
}

// ── 4. Tiempo celular ─────────────────────────────────────────────────────────

export async function handleNutriaTiempoCelular(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const tiempoCelular = TIEMPO_MAP[text.trim()];

  if (!tiempoCelular) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_verificar_metricas', data: { ...session?.data, tiempoCelular } });

  await nutriaMessaging.sendButtons({
    to: from,
    title: 'NutriA',
    description: p(4) + '¿Verificarías ese tiempo en las métricas de tu celular? 🔍\n\n_(La mayoría de celulares tienen esta función en Ajustes)_',
    buttons: [
      { id: 'si', displayText: '✅ Sí, lo haría' },
      { id: 'no', displayText: '❌ No lo haré' },
    ],
  });
}

// ── 5. Verificar métricas ─────────────────────────────────────────────────────

export async function handleNutriaVerificarMetricas(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const verificarMetricas = input === 'si' ? 'Sí' : 'No';

  if (input === 'no') {
    await setNutriaSession(from, { step: 'nutria_tiempo_redes', data: { ...session?.data, verificarMetricas, imagenMetricas: 'No compartió' } });
    await nutriaMessaging.sendList({
      to: from,
      title: 'NutriA',
      description: p(5) + '¿Cuánto tiempo pasas en redes sociales al día? 📲',
      footer: 'UTB · Investigación',
      buttonText: 'Ver opciones',
      sections: [{ title: 'Horas en redes', rows: TIEMPO_OPTS }],
    });
    return;
  }

  // Usuario dijo Sí → pedir captura de pantalla
  await setNutriaSession(from, { step: 'nutria_captura_pantalla', data: { ...session?.data, verificarMetricas } });

  await nutriaMessaging.sendText({
    to: from,
    text:
      '📸 *Adjunta una captura de pantalla* de las métricas de tu celular.\n\n' +
      '*Android:*\n' +
      '→ Ajustes › Bienestar digital y controles parentales › Tomar captura\n\n' +
      '*iPhone:*\n' +
      '→ Configuración › Tiempo de uso › Tomar captura\n\n' +
      '⚠️ *Asegúrate de que NO se vea ninguna información personal en la captura.*',
  });

  await nutriaMessaging.sendButtons({
    to: from,
    title: 'NutriA',
    description: '¿Prefieres no compartir la imagen?',
    footer: 'Puedes enviar la foto en cualquier momento',
    buttons: [
      { id: 'omitir', displayText: '⏭️ Omitir foto' },
    ],
  });
}

// ── 4b. Captura de pantalla de métricas ───────────────────────────────────────

export async function handleNutriaCapturaPantalla(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;

  // Usuario quiere omitir
  if (text.trim().toLowerCase() === 'omitir' || text.trim() === '__skip__') {
    await setNutriaSession(from, { step: 'nutria_tiempo_redes', data: { ...session?.data, imagenMetricas: 'Omitió' } });
    await nutriaMessaging.sendList({
      to: from,
      title: 'NutriA',
      description: p(5) + '¿Cuánto tiempo pasas en redes sociales al día? 📲',
      footer: 'UTB · Investigación',
      buttonText: 'Ver opciones',
      sections: [{ title: 'Horas en redes', rows: TIEMPO_OPTS }],
    });
    return;
  }

  // Verificar si llegó una imagen
  const inbound = (ctx as any)._inbound;
  const mediaId: string | undefined = inbound?.mediaId;

  if (!mediaId) {
    await nutriaMessaging.sendText({
      to: from,
      text: '📸 Por favor envía la captura de pantalla como *imagen*, o escribe *omitir* para continuar.',
    });
    return;
  }

  // Descargar y guardar imagen
  let imagenMetricas = 'Error al guardar';
  try {
    const filename = await guardarImagenMeta(mediaId, config.nutria.token, from);
    imagenMetricas = filename;
  } catch (err) {
    console.error('[nutria] error guardando imagen:', describeExternalError(err));
  }

  await setNutriaSession(from, { step: 'nutria_tiempo_redes', data: { ...session?.data, imagenMetricas } });

  await nutriaMessaging.sendText({ to: from, text: '✅ ¡Imagen recibida! Continuemos.' });

  await nutriaMessaging.sendList({
    to: from,
    title: 'NutriA',
    description: p(5) + '¿Cuánto tiempo pasas en redes sociales al día? 📲',
    footer: 'UTB · Investigación',
    buttonText: 'Ver opciones',
    sections: [{ title: 'Horas en redes', rows: TIEMPO_OPTS }],
  });
}

// ── 6. Tiempo en redes ────────────────────────────────────────────────────────

export async function handleNutriaTiempoRedes(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const tiempoRedes = TIEMPO_MAP[text.trim()];

  if (!tiempoRedes) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_red_principal', data: { ...session?.data, tiempoRedes } });
  await sendRedList(from, p(6) + '¿Cuál red social usas MÁS? 📱');
}

// ── 7. Red principal ──────────────────────────────────────────────────────────

async function sendSabeUltraButtons(to: string): Promise<void> {
  await nutriaMessaging.sendButtons({
    to,
    title: 'NutriA',
    description: p(7) + '¿Sabías qué es un *producto ultraprocesado*? 🍟\n\n_(Ej: snacks, bebidas azucaradas, comida rápida envasada)_',
    buttons: [
      { id: 'si', displayText: '✅ Sí, sabía' },
      { id: 'no', displayText: '❌ No sabía' },
    ],
  });
}

export async function handleNutriaRedPrincipal(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim();

  if (input === 'otra') {
    await setNutriaSession(from, { step: 'nutria_red_principal_texto', data: { ...session?.data } });
    await nutriaMessaging.sendText({ to: from, text: '✏️ ¿Cuál red social usas más? Escríbela 👇' });
    return;
  }

  const redPrincipal = REDES_MAP[input];
  if (!redPrincipal) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_sabe_ultra', data: { ...session?.data, redPrincipal } });
  await sendSabeUltraButtons(from);
}

export async function handleNutriaRedPrincipalTexto(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const redPrincipal = text.trim() || 'Otra';
  await setNutriaSession(from, { step: 'nutria_sabe_ultra', data: { ...session?.data, redPrincipal } });
  await sendSabeUltraButtons(from);
}

// ── 8. Sabe ultraprocesado ────────────────────────────────────────────────────

export async function handleNutriaSabeUltra(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const sabeUltraprocesado = input === 'si' ? 'Sí' : 'No';
  await setNutriaSession(from, { step: 'nutria_vio_publicidad', data: { ...session?.data, sabeUltraprocesado } });

  await nutriaMessaging.sendButtons({
    to: from,
    title: 'NutriA',
    description: p(8) + '¿Has visto publicidad de productos ultraprocesados en redes sociales? 📣\n\n_(Anuncios de comida rápida, snacks, bebidas, etc.)_',
    buttons: [
      { id: 'si', displayText: '📺 Sí, he visto' },
      { id: 'no', displayText: '🤷 No recuerdo' },
    ],
  });
}

// ── 9. Vio publicidad (+ condicional 9b) ──────────────────────────────────────

export async function handleNutriaVioPublicidad(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const vioPublicidad = input === 'si' ? 'Sí' : 'No';

  if (input === 'si') {
    // Pregunta condicional: ¿en cuál red?
    await setNutriaSession(from, { step: 'nutria_red_publicidad', data: { ...session?.data, vioPublicidad } });
    await sendRedList(from, '¿En cuál red recuerdas haber visto esa publicidad? 📍');
  } else {
    await setNutriaSession(from, {
      step: 'nutria_publicidad_motivo',
      data: { ...session?.data, vioPublicidad, redPublicidad: 'N/A' },
    });
    await sendPublicidadMotivo(from);
  }
}

// ── 9b. Red publicidad (condicional) ──────────────────────────────────────────

export async function handleNutriaRedPublicidad(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const redPublicidad = REDES_MAP[text.trim()];

  if (!redPublicidad) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_publicidad_motivo', data: { ...session?.data, redPublicidad } });
  await sendPublicidadMotivo(from);
}

async function sendPublicidadMotivo(to: string): Promise<void> {
  await nutriaMessaging.sendButtons({
    to,
    title: 'NutriA',
    description: p(9) + '¿Alguna vez una publicidad en redes te motivó a consumir un producto ultraprocesado? 🤔',
    buttons: [
      { id: 'si', displayText: '🎯 Sí, me motivó' },
      { id: 'no', displayText: '🙅 No, nunca' },
    ],
  });
}

// ── 10. Publicidad motivó → intro bloque consumo ──────────────────────────────

export async function handleNutriaPublicidadMotivo(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const publicidadMotivo = input === 'si' ? 'Sí' : 'No';
  await setNutriaSession(from, { step: 'nutria_consumo_bebidas', data: { ...session?.data, publicidadMotivo } });

  await nutriaMessaging.sendText({
    to: from,
    text: '🍫 *Preguntas 10 a 13 de 18*\n\n¿Con qué frecuencia consumes estos productos por semana?\n_Son 4 preguntas rapidísimas ⚡_',
  });

  await sendFrecList(from, '10 de 18 — 🥤 *Bebidas azucaradas*\n_(Gaseosas, jugos en caja, energizantes)_');
}

// ── 11-13. Consumo semanal ────────────────────────────────────────────────────

export async function handleNutriaConsumoBebidas(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const consumoBebidas = FREC_MAP[text.trim()];

  if (!consumoBebidas) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_consumo_panaderia', data: { ...session?.data, consumoBebidas } });
  await sendFrecList(from, '11 de 18 — 🥐 *Panadería*\n_(Pan empacado, croissants industriales)_');
}

export async function handleNutriaConsumoPanaderia(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const consumoPanaderia = FREC_MAP[text.trim()];

  if (!consumoPanaderia) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_consumo_postres', data: { ...session?.data, consumoPanaderia } });
  await sendFrecList(from, '12 de 18 — 🍰 *Postres / Dulces*\n_(Galletas, chocolates, gomitas)_');
}

export async function handleNutriaConsumoPostres(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const consumoPostres = FREC_MAP[text.trim()];

  if (!consumoPostres) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_consumo_mecatos', data: { ...session?.data, consumoPostres } });
  await sendFrecList(from, '13 de 18 — 🍿 *Mecatos*\n_(Papas fritas, chitos, snacks)_');
}

export async function handleNutriaConsumoMecatos(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const consumoMecatos = FREC_MAP[text.trim()];

  if (!consumoMecatos) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_compro_despues', data: { ...session?.data, consumoMecatos } });

  await nutriaMessaging.sendButtons({
    to: from,
    title: 'NutriA',
    description: p(14) + '¿Has comprado algún producto ultraprocesado después de verlo en redes sociales? 🛒',
    buttons: [
      { id: 'si', displayText: '🛍️ Sí, lo compré' },
      { id: 'no', displayText: '🙅 No, nunca' },
    ],
  });
}

// ── 14. Compró después ────────────────────────────────────────────────────────

export async function handleNutriaComproDespues(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const comproDespues = input === 'si' ? 'Sí' : 'No';
  await setNutriaSession(from, { step: 'nutria_sellos', data: { ...session?.data, comproDespues } });

  await nutriaMessaging.sendList({
    to: from,
    title: 'NutriA',
    description: p(15) + '¿Te fijas en los sellos nutricionales al comprar productos? 🔖',
    footer: 'UTB · Investigación',
    buttonText: 'Ver opciones',
    sections: [{
      title: 'Frecuencia',
      rows: [
        { id: 'siempre',  title: '✅ Siempre' },
        { id: 'aveces',   title: '🔄 A veces' },
        { id: 'raravez',  title: '🤏 Rara vez' },
        { id: 'nunca',    title: '❌ Nunca' },
      ],
    }],
  });
}

// ── 15. Sellos ────────────────────────────────────────────────────────────────

const SELLOS_MAP: Record<string, string> = {
  siempre: 'Siempre', aveces: 'A veces', raravez: 'Rara vez', nunca: 'Nunca',
};

export async function handleNutriaSellos(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const sellos = SELLOS_MAP[text.trim().toLowerCase()];

  if (!sellos) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_consomiria_sello', data: { ...session?.data, sellos } });

  await nutriaMessaging.sendButtons({
    to: from,
    title: 'NutriA',
    description: p(16) + 'Aunque un producto tenga *sellos de advertencia nutricional*, ¿lo consumirías igual? ⚠️',
    buttons: [
      { id: 'si', displayText: '😅 Sí, igual lo como' },
      { id: 'no', displayText: '🚫 No, lo evito' },
    ],
  });
}

// ── 16. Consumiría con sello ──────────────────────────────────────────────────

export async function handleNutriaConsomiriaSello(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const consumiriaSello = input === 'si' ? 'Sí' : 'No';
  await setNutriaSession(from, { step: 'nutria_motivacion', data: { ...session?.data, consumiriaSello } });

  await nutriaMessaging.sendList({
    to: from,
    title: 'NutriA',
    description: p(17) + 'Si consumiste un ultraprocesado, ¿qué te motivó a hacerlo? 🤔',
    footer: 'UTB · Investigación',
    buttonText: 'Ver opciones',
    sections: [{
      title: 'Motivación principal',
      rows: [
        { id: 'redes',       title: '📱 Lo vi en redes sociales' },
        { id: 'recomendado', title: '👥 Me lo recomendaron' },
        { id: 'precio',      title: '💰 Precio / oferta' },
        { id: 'antojo',      title: '😋 Me dio antojo' },
        { id: 'ofrecieron',  title: '🎁 Me lo ofrecieron' },
        { id: 'otra',        title: '✍️ Otra razón' },
      ],
    }],
  });
}

// ── 17. Motivación ────────────────────────────────────────────────────────────

const MOTIVACION_MAP: Record<string, string> = {
  redes: 'Lo vi en redes sociales',
  recomendado: 'Me lo recomendaron',
  precio: 'Precio/oferta',
  antojo: 'Me dio antojo',
  ofrecieron: 'Me lo ofrecieron',
};

export async function handleNutriaMotivacion(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input === 'otra') {
    await setNutriaSession(from, { step: 'nutria_motivacion_texto', data: { ...session?.data } });
    await nutriaMessaging.sendText({ to: from, text: '✍️ ¿Cuál fue la razón? Escríbela brevemente 👇' });
    return;
  }

  const motivacion = MOTIVACION_MAP[input];
  if (!motivacion) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_como_entero', data: { ...session?.data, motivacion } });
  await sendComoEnteroList(from);
}

// ── 17b. Motivación texto libre (condicional) ─────────────────────────────────

export async function handleNutriaMotivacionTexto(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const motivacion = text.trim() || 'No especificó';

  await setNutriaSession(from, { step: 'nutria_como_entero', data: { ...session?.data, motivacion } });
  await sendComoEnteroList(from);
}

async function sendComoEnteroList(to: string): Promise<void> {
  await nutriaMessaging.sendList({
    to,
    title: 'NutriA',
    description: p(18) + '¿Por qué medio te enteraste de este stand?',
    footer: 'UTB · Investigación',
    buttonText: 'Ver opciones',
    sections: [{
      title: '¿Cómo te enteraste?',
      rows: [
        { id: 'redes',    title: '📱 Por redes sociales' },
        { id: 'amigo',    title: '👥 Por un amigo/a' },
        { id: 'profesor', title: '👨‍🏫 Invitación de profesor' },
        { id: 'otro',     title: '💬 Otro medio' },
      ],
    }],
  });
}

// ── 18. Cómo se enteró → guardar y despedir ────────────────────────────────────

const COMO_MAP: Record<string, string> = {
  redes: 'Por redes sociales', amigo: 'Por un amigo',
  profesor: 'Invitación de profesor', otro: 'Otro medio',
};

export async function handleNutriaComoEntero(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input === 'otro') {
    await setNutriaSession(from, { step: 'nutria_como_entero_texto', data: { ...session?.data } });
    await nutriaMessaging.sendText({ to: from, text: '✏️ ¿Por cuál otro medio te enteraste? Escríbelo 👇' });
    return;
  }

  const comoEntero = COMO_MAP[input];
  if (!comoEntero) { await invalid(from); return; }

  await setNutriaSession(from, { step: 'nutria_contacto', data: { ...session?.data, comoEntero } });

  await nutriaMessaging.sendButtons({
    to: from,
    title: 'NutriA',
    description: p(19) + '¿Estarías dispuesto/a a ser contactado/a por WhatsApp para participar en *futuros experimentos* de investigación? 🔬',
    buttons: [
      { id: 'si', displayText: '✅ Sí, acepto' },
      { id: 'no', displayText: '❌ No, gracias' },
    ],
  });
}

// ── 18b. Cómo se enteró texto libre (condicional) ────────────────────────────

export async function handleNutriaComoEnteroTexto(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const comoEntero = text.trim() || 'Otro medio';
  await setNutriaSession(from, { step: 'nutria_contacto', data: { ...session?.data, comoEntero } });

  await nutriaMessaging.sendButtons({
    to: from,
    title: 'NutriA',
    description: p(19) + '¿Estarías dispuesto/a a ser contactado/a por WhatsApp para participar en *futuros experimentos* de investigación? 🔬',
    buttons: [
      { id: 'si', displayText: '✅ Sí, acepto' },
      { id: 'no', displayText: '❌ No, gracias' },
    ],
  });
}

// ── 19. Contacto futuro → guardar y despedir ──────────────────────────────────

export async function handleNutriaContacto(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();

  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  const contacto = input === 'si' ? 'Sí' : 'No';
  const d: Record<string, string> = { ...session?.data, contacto };

  try {
    await guardarEncuestaNutria({
      whatsapp:          from,
      edad:              d.edad              ?? '',
      genero:            d.genero            ?? '',
      tiempoCelular:     d.tiempoCelular     ?? '',
      verificarMetricas: d.verificarMetricas ?? '',
      imagenMetricas:    d.imagenMetricas    ?? '',
      tiempoRedes:       d.tiempoRedes       ?? '',
      redPrincipal:      d.redPrincipal      ?? '',
      sabeUltraprocesado:d.sabeUltraprocesado?? '',
      vioPublicidad:     d.vioPublicidad     ?? '',
      redPublicidad:     d.redPublicidad     ?? '',
      publicidadMotivo:  d.publicidadMotivo  ?? '',
      consumoBebidas:    d.consumoBebidas    ?? '',
      consumoPanaderia:  d.consumoPanaderia  ?? '',
      consumoPostres:    d.consumoPostres    ?? '',
      consumoMecatos:    d.consumoMecatos    ?? '',
      comproDespues:     d.comproDespues     ?? '',
      sellos:            d.sellos            ?? '',
      consumiriaSello:   d.consumiriaSello   ?? '',
      motivacion:        d.motivacion        ?? '',
      comoEntero:        d.comoEntero        ?? '',
      contacto,
    });
  } catch (err) {
    console.error('[nutria] error guardando encuesta:', describeExternalError(err));
  }

  await setNutriaSession(from, { step: 'nutria_completada', data: {} });

  await nutriaMessaging.sendText({
    to: from,
    text:
      '✅ *¡Muchas gracias por participar!* 🎉\n\n' +
      'Tus respuestas han sido guardadas de forma *confidencial*.\n\n' +
      'Este estudio nos ayuda a entender la influencia del marketing digital en los hábitos alimenticios de los jóvenes universitarios.\n\n' +
      '🎓 *Universidad Tecnológica de Bolívar*',
  });

  // Generar y enviar QR para reclamar la papita
  try {
    const codigo = await crearCodigoNutria(from);
    const validationUrl = `https://tooli-stand.duckdns.org/api/tools/nutria/codigo/${codigo}`;
    const qrBuffer = await QRCode.toBuffer(validationUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#1e1b4b', light: '#ffffff' },
    });

    await nutriaMessaging.sendImage({
      to: from,
      buffer: qrBuffer,
      caption:
        `🎁 *¡Tu mecato gratis te espera!*\n\n` +
        `Muestra este QR en el stand para reclamarlo 🍟\n` +
        `📍 Frente al Café UTB · Válido una sola vez\n` +
        `🔑 Código: *${codigo}*`,
    });
  } catch (err) {
    console.error('[nutria] error generando QR:', describeExternalError(err));
  }
}

// ── Rechazado (si vuelve a escribir tras no aceptar) ─────────────────────────

export async function handleNutriaRechazado(ctx: Ctx): Promise<void> {
  const { from, text } = ctx;
  if (text.trim().toLowerCase() === 'encuesta') {
    await setNutriaSession(from, { step: 'nutria_inicio', data: {} });
    await handleNutriaInicio(ctx);
    return;
  }
  await nutriaMessaging.sendText({
    to: from,
    text: 'Escribe *encuesta* si deseas participar en el estudio. 🔬',
  });
}

// ── Completada (si vuelve a escribir) ─────────────────────────────────────────

export async function handleNutriaCompletada(ctx: Ctx): Promise<void> {
  const { from, text } = ctx;

  if (text.trim().toLowerCase() === 'encuesta') {
    await setNutriaSession(from, { step: 'nutria_bienvenida', data: {} });
    await handleNutriaInicio(ctx);
    return;
  }

  await nutriaMessaging.sendText({
    to: from,
    text: '✅ Ya completaste la encuesta. ¡Gracias!\n\n_Escribe *encuesta* si deseas responderla nuevamente._',
  });
}
