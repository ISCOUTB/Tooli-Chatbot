/**
 * ════════════════════════════════════════════════════════════════════════════
 *  VARIANTE "TAL VEZ"  —  flujo alternativo EN REPOSO (NO ACTIVO)
 * ════════════════════════════════════════════════════════════════════════════
 *  Este archivo NO está conectado al bot: no lo importa nadie, así que no afecta
 *  el flujo en producción. Queda disponible por si más adelante se decide usarlo.
 *
 *  Diferencia vs. el flujo activo: al responder "Sí, me interesa", además de
 *  Especialización y Maestría se ofrece una tercera opción "Tal vez", que muestra
 *  la info de ambos programas y pide una confirmación antes de cerrar.
 *
 *  FLUJO:
 *    posg_interes (Sí) → [🎯 Especialización] [🎓 Maestría] [🤔 Tal vez]
 *      · Especialización / Maestría → cierre (flyer + cupos + inscripción)
 *      · Tal vez → info de los 2 programas (con enlaces de info, SIN inscripción)
 *                  + "¿Ya estás seguro de cuál vas a escoger?"  [Sí] [No]
 *          · Sí → "¿Cuál de los dos eliges?" [Especialización] [Maestría] → cierre
 *          · No → cierre variante "no" (Piénsalo otra vez + cupos + inscripción)
 *
 *  CÓMO ACTIVARLA  (editar src/flows/posgrados-evento/index.ts):
 *    1) import { HANDLERS_VARIANTE_TALVEZ } from './variante-talvez';
 *    2) En el objeto HANDLERS, fusiona estas entradas (la de posg_interes
 *       reemplaza a handlePosgradoInteres del flujo activo):
 *         posg_interes:      HANDLERS_VARIANTE_TALVEZ.posg_interes,
 *         posg_cual_v:       HANDLERS_VARIANTE_TALVEZ.posg_cual_v,
 *         posg_confirma_v:   HANDLERS_VARIANTE_TALVEZ.posg_confirma_v,
 *         posg_cual_final_v: HANDLERS_VARIANTE_TALVEZ.posg_cual_final_v,
 *    (El consentimiento al inicio y los pasos de nombre/correo no cambian.)
 * ════════════════════════════════════════════════════════════════════════════
 */
import fs from 'fs';
import path from 'path';
import { Session } from '../../services/session';
import { setPosgradoSession, posgradoMessaging } from './shared';
import {
  guardarRegistroPosgrado,
  actualizarPosgradoInteres,
  actualizarConsentimiento,
} from '../../services/posgradosEventoSheets';
import { upsertContactoHubspot } from '../../services/hubspotService';
import { describeExternalError } from '../../services/logSafe';

interface Ctx {
  from: string;
  text: string;
  session: Session | null;
}

const BRAND        = 'Escuela de Posgrados UTB';
const URL_ESP      = 'https://www.utb.edu.co/posgrados/especializacion-en-gestion-de-tecnologias-disruptivas-en-los-negocios/';
const URL_MAESTRIA = 'https://www.utb.edu.co/posgrados/maestria-en-management-de-la-transformacion-digital/';
const URL_INSCRIPCION = 'https://ssbprod.utb.edu.co:8443/PROD/bwskalog.P_DispLoginNon';
const NOMBRE_ESP      = 'Especialización en Gestión de Tecnologías Disruptivas en los Negocios';
const NOMBRE_MAESTRIA = 'Maestría en Management de la Transformación Digital';
const FLYER_POSGRADO  = path.resolve(__dirname, '../../public/evento/flujo.jpeg');

function invalid(to: string): Promise<void> {
  return posgradoMessaging.sendText({ to, text: 'Por favor usa los botones 👆' });
}

/** Igual que el cierre del flujo activo: flyer + cupos + enlace de inscripción. */
async function cerrarConCupos(from: string, variant: 'si' | 'no'): Promise<void> {
  const gancho =
    variant === 'no'
      ? '🔥 *PIÉNSALO OTRA VEZ.*\n*¡SON CUPOS LIMITADOS, INSCRÍBETE YA!*'
      : '🔥 *¡SON CUPOS LIMITADOS, INSCRÍBETE YA!*';
  const caption = `${gancho}\n\n📝 Inscríbete aquí 👇\n${URL_INSCRIPCION}`;
  try {
    const flyer = fs.readFileSync(FLYER_POSGRADO);
    await posgradoMessaging.sendImage({ to: from, buffer: flyer, mimetype: 'image/jpeg', caption });
  } catch (err) {
    console.error('[posgrados-variante] error enviando imagen de cierre:', describeExternalError(err));
    await posgradoMessaging.sendText({ to: from, text: caption });
  }
  await setPosgradoSession(from, { step: 'posg_completada', data: {} });
}

async function cerrarConPrograma(from: string, d: Record<string, string>, input: 'esp' | 'maestria'): Promise<void> {
  const fila  = parseInt(d.filaSheet ?? '0', 10);
  const valor = input === 'esp' ? NOMBRE_ESP : NOMBRE_MAESTRIA;
  try {
    await actualizarPosgradoInteres(fila, valor);
  } catch (err) {
    console.error('[posgrados-variante] error actualizando posgrado:', describeExternalError(err));
  }
  void upsertContactoHubspot({
    email:               d.correo ?? '',
    nombre:              d.nombre ?? '',
    whatsapp:            from,
    posgradoInteres:     valor,
    interesFinanciacion: d.interesFinanciacion ?? '',
    consentimiento:      true,
  });
  await cerrarConCupos(from, 'si');
}

// ── Interés (Sí) → 3 opciones: Especialización / Maestría / Tal vez ──────────
export async function handleInteresV(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  const map: Record<string, string> = { si: 'Sí', no: 'No' };
  const interesFinanciacion = map[input];
  if (!interesFinanciacion) { await invalid(from); return; }

  const d: Record<string, string> = { ...session?.data, interesFinanciacion };

  let fila = 0;
  try {
    fila = await guardarRegistroPosgrado({
      whatsapp: from, nombre: d.nombre ?? '', correo: d.correo ?? '', interesFinanciacion,
    });
    if (fila) await actualizarConsentimiento(fila, 'Sí');
  } catch (err) {
    console.error('[posgrados-variante] error guardando registro:', describeExternalError(err));
  }

  if (input === 'no') { await cerrarConCupos(from, 'no'); return; }

  await setPosgradoSession(from, { step: 'posg_cual_v', data: { ...d, filaSheet: String(fila) } });
  await posgradoMessaging.sendText({
    to: from,
    text:
      '🎓 *Tenemos 2 programas para ti:*\n\n' +
      '1️⃣ *Especialización en Gestión de Tecnologías Disruptivas en los Negocios*\n📌 Presencial · 2 semestres\n\n' +
      '2️⃣ *Maestría en Management de la Transformación Digital*\n📌 Presencial · 3 semestres',
  });
  await posgradoMessaging.sendButtons({
    to: from,
    title: BRAND,
    description: '¿En cuál de estas dos opciones estás interesado?',
    footer: 'Elige una opción',
    buttons: [
      { id: 'esp',      displayText: '🎯 Especialización' },
      { id: 'maestria', displayText: '🎓 Maestría' },
      { id: 'talvez',   displayText: '🤔 Tal vez' },
    ],
  });
}

// ── Elección → cierre directo, o "Tal vez" muestra info + pide confirmación ───
export async function handleCualV(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  const d: Record<string, string> = session?.data ?? {};

  if (input === 'esp' || input === 'maestria') {
    await cerrarConPrograma(from, d, input);
    return;
  }

  if (input === 'talvez') {
    await setPosgradoSession(from, { step: 'posg_confirma_v', data: d });
    await posgradoMessaging.sendText({
      to: from,
      text:
        '🎯 *Especialización en Gestión de Tecnologías Disruptivas en los Negocios*\n' +
        `📌 Presencial · 2 semestres\nInfo 👇\n${URL_ESP}\n\n` +
        '🎓 *Maestría en Management de la Transformación Digital*\n' +
        `📌 Presencial · 3 semestres\nInfo 👇\n${URL_MAESTRIA}`,
    });
    await posgradoMessaging.sendButtons({
      to: from,
      title: BRAND,
      description: '¿Ya estás seguro de cuál vas a escoger?',
      footer: 'Cuéntanos',
      buttons: [
        { id: 'si', displayText: '✅ Sí' },
        { id: 'no', displayText: '❌ No' },
      ],
    });
    return;
  }

  await invalid(from);
}

// ── Confirmación → Sí pregunta cuál; No cierra con "Piénsalo otra vez" ────────
export async function handleConfirmaV(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  const d: Record<string, string> = session?.data ?? {};

  if (input === 'si') {
    await setPosgradoSession(from, { step: 'posg_cual_final_v', data: d });
    await posgradoMessaging.sendButtons({
      to: from,
      title: BRAND,
      description: '¿Cuál de los dos programas eliges?',
      footer: 'Elige una opción',
      buttons: [
        { id: 'esp',      displayText: '🎯 Especialización' },
        { id: 'maestria', displayText: '🎓 Maestría' },
      ],
    });
    return;
  }

  if (input === 'no') {
    await cerrarConCupos(from, 'no');
    return;
  }

  await invalid(from);
}

// ── Elección final tras confirmar → cierre ────────────────────────────────────
export async function handleCualFinalV(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  if (input !== 'esp' && input !== 'maestria') { await invalid(from); return; }
  const d: Record<string, string> = session?.data ?? {};
  await cerrarConPrograma(from, d, input);
}

// Mapa listo para fusionar en el HANDLERS de index.ts (ver instrucciones arriba).
export const HANDLERS_VARIANTE_TALVEZ = {
  posg_interes:      handleInteresV,
  posg_cual_v:       handleCualV,
  posg_confirma_v:   handleConfirmaV,
  posg_cual_final_v: handleCualFinalV,
};
