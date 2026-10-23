/**
 * Infraestructura de recordatorios — envío real de mensajes de WhatsApp.
 *
 * QUÉ ES REAL:
 *   `enviarRecordatorio()` reutiliza el cliente de WhatsApp ya existente
 *   (`messaging` de src/flows/shared.ts, que resuelve a EvolutionAPI o
 *   Meta Cloud según config.messagingAdapter). Enviar un texto a un número
 *   es 100% viable con lo que ya hay desplegado — no inventa transporte.
 *
 * QUÉ ES MANUAL / FUTURO:
 *   El *disparador* ("cuándo" enviar un recordatorio de tarea/nota/evento)
 *   depende de un sistema universitario externo tipo Banner/SIA que NO existe
 *   en este repo. No hay calificaciones, calendario académico ni cron de
 *   tareas disponible. Por eso el único punto de entrada es el endpoint HTTP
 *   `POST /api/tools/recordatorio` (protegido con auth de asesores) que recibe
 *   { telefono, mensaje } y llama a esta función. El día que exista una
 *   integración real — o incluso un cron manual que consulte un sheet — solo
 *   hay que llamar a `enviarRecordatorio` desde allí.
 *
 *   No se fabrica ningún dato académico ni se simula integración con Banner.
 *   Ver `src/routes/toolsRoutes.ts` (ruta recordatorio) para el endpoint.
 */

import { messaging } from './shared';
import { validarTelefono, validarMensaje } from '../services/reminderValidation';

export interface RecordatorioPayload {
  /** Número en formato E.164 sin + (ej: 573001234567) — se normaliza automáticamente */
  telefono: string;
  /** Texto del recordatorio (1–4096 chars) */
  mensaje: string;
}

/** Exportada para reusarla en `reminderService.ts` (no duplicar la validación). */
export { normalizarTelefono } from '../services/reminderValidation';

/**
 * Envía un recordatorio por WhatsApp usando el adaptador configurado.
 * Lanza Error si la validación falla o si el envío falla.
 */
export async function enviarRecordatorio(payload: RecordatorioPayload): Promise<{ ok: true; to: string }> {
  const to = validarTelefono(payload.telefono);
  const text = validarMensaje(payload.mensaje);

  await messaging.sendText({ to, text });

  console.log(`[recordatorio] enviado a +${to.slice(0, 4)}**** (${text.length} chars)`);
  return { ok: true, to };
}

/**
 * Punto de extensión para futuro disparo automático.
 *
 * TODO(integracion-banner): cuando exista acceso al sistema académico
 * (Banner/SIA u otro), implementar un job que:
 *   1. Consulte tareas/eventos/notas pendientes por estudiante.
 *   2. Construya el mensaje con contexto real (ej: "Tienes tarea de Cálculo I para el 20/09").
 *   3. Llame a enviarRecordatorio({ telefono, mensaje }).
 *
 * Mientras tanto el disparo es MANUAL vía POST /api/tools/recordatorio.
 * No inventar datos de notas/tareas sin fuente real.
 */
export const _extensionPoint = 'manual-only';
