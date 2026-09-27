/**
 * Programador de recordatorios por WhatsApp.
 *
 * QUÉ RESUELVE:
 *   `src/flows/recordatorios.ts` ya sabía *enviar* un recordatorio, pero solo
 *   "ahora mismo": alguien tenía que apretar el botón en el momento exacto. Un
 *   asesor que quiere avisarle a un aspirante el día antes del evento, o
 *   recordarle a un estudiante que su matrícula vence el viernes, no podía.
 *
 *   Este servicio agrega el "cuándo": se programa, se persiste en Redis, y un
 *   worker lo dispara solo.
 *
 * QUÉ SIGUE SIN SER REAL (y no se simula):
 *   El disparo *automático* basado en datos académicos ("se vence tu tarea",
 *   "subieron tus notas") necesita una integración con el sistema de la
 *   universidad que este repo no tiene. Lo que existe acá es la infraestructura
 *   genérica: cuando esa integración exista, solo tiene que llamar a
 *   `scheduleReminder()` — no hay que reescribir nada de esto.
 *
 * DISEÑO EN REDIS:
 *   - `reminders:queue`  (sorted set)  score = timestamp de disparo, member = id
 *   - `reminder:<id>`    (string JSON) el recordatorio completo
 *   - `reminders:index`  (sorted set)  score = createdAt, member = id — para listar
 *   Los recordatorios ya enviados/cancelados salen de la cola pero quedan en el
 *   índice con TTL, para que el asesor vea el historial reciente.
 */

import Redis from 'ioredis';
import { config } from '../config';
import { enviarRecordatorio } from '../flows/recordatorios';
// Las reglas de validación viven aparte para poder probarse sin levantar Redis
// (este módulo abre la conexión al importarse). Ver reminderValidation.test.ts.
import {
  ReminderValidationError, validarTelefono, validarMensaje, validarFecha,
} from './reminderValidation';
import { describeError } from './logSafe';

const redis = new Redis(config.redis.url);

const QUEUE_KEY = 'reminders:queue';
const INDEX_KEY = 'reminders:index';
const ITEM_KEY = (id: string) => `reminder:${id}`;
/** Cuánto se conserva un recordatorio ya resuelto (7 días). */
const TTL_RESUELTO_SEG = 7 * 24 * 60 * 60;

export type ReminderEstado = 'programado' | 'enviado' | 'fallido' | 'cancelado';

export interface Reminder {
  id: string;
  telefono: string;
  mensaje: string;
  /** epoch ms en que debe dispararse */
  scheduledAt: number;
  createdAt: number;
  /** username del asesor que lo programó */
  createdBy: string;
  estado: ReminderEstado;
  sentAt?: number;
  error?: string;
}

export { ReminderValidationError };

export interface ScheduleInput {
  telefono: string;
  mensaje: string;
  /** ISO 8601 o epoch ms */
  scheduledAt: string | number;
  createdBy: string;
}

function nuevoId(): string {
  return `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function scheduleReminder(input: ScheduleInput): Promise<Reminder> {
  const telefono = validarTelefono(input.telefono ?? '');
  const mensaje = validarMensaje(input.mensaje ?? '');
  const scheduledAt = validarFecha(input.scheduledAt);

  const reminder: Reminder = {
    id: nuevoId(),
    telefono,
    mensaje,
    scheduledAt,
    createdAt: Date.now(),
    createdBy: input.createdBy,
    estado: 'programado',
  };

  const pipe = redis.pipeline();
  pipe.set(ITEM_KEY(reminder.id), JSON.stringify(reminder));
  pipe.zadd(QUEUE_KEY, String(scheduledAt), reminder.id);
  pipe.zadd(INDEX_KEY, String(reminder.createdAt), reminder.id);
  await pipe.exec();

  return reminder;
}

export async function getReminder(id: string): Promise<Reminder | null> {
  const raw = await redis.get(ITEM_KEY(id));
  return raw ? (JSON.parse(raw) as Reminder) : null;
}

export async function listReminders(opts: { estado?: ReminderEstado; limit?: number } = {}): Promise<Reminder[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  // Del índice, los más recientes primero.
  const ids = await redis.zrevrange(INDEX_KEY, 0, limit * 2);
  if (!ids.length) return [];

  const raws = await redis.mget(ids.map(ITEM_KEY));
  const items: Reminder[] = [];
  const huerfanos: string[] = [];

  raws.forEach((raw, i) => {
    if (!raw) {
      // El item expiró pero quedó en el índice — se limpia solo.
      huerfanos.push(ids[i]);
      return;
    }
    items.push(JSON.parse(raw) as Reminder);
  });

  if (huerfanos.length) await redis.zrem(INDEX_KEY, ...huerfanos);

  return items
    .filter((r) => !opts.estado || r.estado === opts.estado)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * Cancela un recordatorio todavía programado: sale de la cola y queda en el
 * historial como `cancelado`. Si el envío ya está en vuelo, la cancelación
 * igual gana el estado (ver `processDueReminders`): el envío físico no se
 * puede recoger, pero el trabajo no vuelve a `enviado`.
 */
export interface CancelReminderResult {
  reminder: Reminder;
  cancelled: boolean;
}

export async function cancelReminder(id: string): Promise<CancelReminderResult | null> {
  // GET + SET separados permiten que el worker escriba `enviado` entre ambos.
  // Lua hace la transición y saca de la cola como una sola operación atómica.
  const raw = await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return false end
     local item = cjson.decode(raw)
     if item.estado ~= 'programado' then
       return cjson.encode({ cancelled = 0, reminder = item })
     end
     item.estado = 'cancelado'
     local encoded = cjson.encode(item)
     redis.call('SET', KEYS[1], encoded, 'EX', ARGV[2])
     redis.call('ZREM', KEYS[2], ARGV[1])
     return cjson.encode({ cancelled = 1, reminder = item })`,
    2, ITEM_KEY(id), QUEUE_KEY, id, String(TTL_RESUELTO_SEG),
  );
  if (!raw) return null;
  const parsed = JSON.parse(String(raw)) as { cancelled: number; reminder: Reminder };
  return { reminder: parsed.reminder, cancelled: parsed.cancelled === 1 };
}

async function marcarResueltoSiProgramado(reminder: Reminder): Promise<boolean> {
  // Compare-and-set atómico: una cancelación que gane la carrera nunca puede
  // ser pisada por el resultado tardío del worker.
  const updated = await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local current = cjson.decode(raw)
     if current.estado ~= 'programado' then return 0 end
     redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
     return 1`,
    1, ITEM_KEY(reminder.id), JSON.stringify(reminder), String(TTL_RESUELTO_SEG),
  );
  return Number(updated) === 1;
}

/**
 * Devuelve un id a la cola sin tumbar el lote si Redis también falla.
 * Sin esto, un fallo de Redis entre el ZREM de reclamo y la persistencia
 * perdería el trabajo: ya no está en la cola y nunca se guardó el resultado.
 */
async function reencolar(id: string, score: number): Promise<void> {
  try {
    await redis.zadd(QUEUE_KEY, String(score), id);
  } catch (err) {
    console.error(
      `[recordatorios] no se pudo re-encolar ${id}:`,
      describeError(err),
    );
  }
}

/**
 * Procesa los recordatorios vencidos. Exportada aparte del worker para poder
 * dispararla a mano (o desde un test) sin depender del intervalo.
 *
 * Idempotencia: cada id se saca de la cola con ZREM *antes* de enviarlo, y solo
 * el llamador que efectivamente lo removió (zrem devuelve 1) lo envía. Así dos
 * ticks superpuestos —o dos instancias del servidor— no mandan el mismo mensaje
 * dos veces.
 *
 * Semántica cancelar/enviar: cancelar solo frena un envío todavía en cola.
 * Si la cancelación entra mientras el envío ya está en vuelo, el estado queda
 * `cancelado` y NO se pisa con `enviado`/`fallido` (el trabajo no resucita);
 * el envío en vuelo no se puede recoger y queda registrado en el log, no en
 * el estado. Nunca se marca `enviado` antes de la confirmación del proveedor.
 */
export async function processDueReminders(now: number = Date.now()): Promise<{ enviados: number; fallidos: number }> {
  let enviados = 0;
  let fallidos = 0;

  const vencidos = await redis.zrangebyscore(QUEUE_KEY, '-inf', String(now), 'LIMIT', 0, 50);

  for (const id of vencidos) {
    const removidos = await redis.zrem(QUEUE_KEY, id);
    if (removidos !== 1) continue; // otro tick/instancia se lo llevó

    let reminder: Reminder | null;
    try {
      reminder = await getReminder(id);
    } catch (err) {
      // Redis falló después de reclamar: se devuelve a la cola para el
      // próximo tick en vez de perder el trabajo.
      await reencolar(id, now);
      fallidos++;
      console.error(
        `[recordatorios] no se pudo leer ${id}, se re-encola:`,
        describeError(err),
      );
      continue;
    }
    if (!reminder || reminder.estado !== 'programado') continue;

    let resuelto: Reminder;
    try {
      await enviarRecordatorio({ telefono: reminder.telefono, mensaje: reminder.mensaje });
      resuelto = { ...reminder, estado: 'enviado', sentAt: Date.now() };
    } catch (err) {
      // Un fallo no debe frenar a los demás ni reintentar en bucle: se marca
      // fallido con la razón y el asesor decide si lo reprograma.
      const error = describeError(err);
      console.error(`[recordatorios] falló el envío de ${id}:`, error);
      resuelto = { ...reminder, estado: 'fallido', error };
    }

    try {
      const actualizado = await marcarResueltoSiProgramado(resuelto);
      if (!actualizado) {
        // La cancelación pudo entrar cuando el proveedor ya estaba enviando.
        // Conservamos el estado cancelado, pero el conteo refleja el resultado
        // físico del intento para que operaciones pueda conciliarlo.
        if (resuelto.estado === 'enviado') enviados++;
        else fallidos++;
        continue;
      }
    } catch (err) {
      // En este punto el proveedor ya respondió. Reencolar sería peligroso:
      // una confirmación seguida de una caída de Redis produciría un segundo
      // WhatsApp. Se conserva semántica at-most-once y se deja conciliación.
      fallidos++;
      console.error(
        `[recordatorios] no se pudo persistir ${id}; no se re-encola para evitar duplicados:`,
        describeError(err),
      );
      continue;
    }

    if (resuelto.estado === 'enviado') enviados++;
    else fallidos++;
  }

  return { enviados, fallidos };
}

let workerTimer: NodeJS.Timeout | null = null;

/**
 * Arranca el loop que dispara los recordatorios vencidos.
 * Es seguro llamarlo más de una vez: si ya hay un worker corriendo, no arranca otro.
 */
export function startReminderWorker(intervalMs = 30_000): void {
  if (workerTimer) return;

  const tick = async () => {
    try {
      const { enviados, fallidos } = await processDueReminders();
      if (enviados || fallidos) {
        console.log(`[recordatorios] tick: ${enviados} enviados, ${fallidos} fallidos`);
      }
    } catch (err) {
      // Si Redis está caído, se loguea y se reintenta en el siguiente tick.
      // Nunca se deja escapar la excepción: tumbaría el proceso entero.
      console.error('[recordatorios] error en el tick del worker:', err);
    }
  };

  workerTimer = setInterval(tick, intervalMs);
  // No mantener vivo el proceso solo por este timer.
  workerTimer.unref?.();
  console.log(`[recordatorios] worker iniciado (cada ${Math.round(intervalMs / 1000)}s)`);
}

export function stopReminderWorker(): void {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}
