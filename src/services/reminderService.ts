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
 *   - `reminders:processing` (sorted set) score = vencimiento del lease
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
const PROCESSING_KEY = 'reminders:processing';
const INDEX_KEY = 'reminders:index';
const ITEM_KEY = (id: string) => `reminder:${id}`;
/** Cuánto se conserva un recordatorio ya resuelto (7 días). */
const TTL_RESUELTO_SEG = 7 * 24 * 60 * 60;
const CLAIM_LEASE_MS = 5 * 60_000;
let indexCleanupCursor = '0';

export type ReminderEstado = 'programado' | 'procesando' | 'enviado' | 'fallido' | 'cancelado';

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
  claimToken?: string;
  claimedAt?: number;
  sendStartedAt?: number;
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

  const tx = redis.multi();
  tx.set(ITEM_KEY(reminder.id), JSON.stringify(reminder));
  tx.zadd(QUEUE_KEY, String(scheduledAt), reminder.id);
  tx.zadd(INDEX_KEY, String(reminder.createdAt), reminder.id);
  const result = await tx.exec();
  if (!result || result.some(([err]) => err)) {
    throw new Error('No se pudo persistir el recordatorio');
  }

  return reminder;
}

export async function getReminder(id: string): Promise<Reminder | null> {
  const raw = await redis.get(ITEM_KEY(id));
  return raw ? (JSON.parse(raw) as Reminder) : null;
}

export async function listReminders(opts: { estado?: ReminderEstado; limit?: number } = {}): Promise<Reminder[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const items: Reminder[] = [];
  const huerfanos: string[] = [];
  // El filtro se aplica mientras paginamos. Una ventana fija de 2*limit
  // ocultaba recordatorios programados si había muchos envíos recientes.
  const batchSize = Math.max(100, limit);
  let offset = 0;
  while (items.length < limit) {
    const ids = await redis.zrevrange(INDEX_KEY, offset, offset + batchSize - 1);
    if (!ids.length) break;
    const raws = await redis.mget(ids.map(ITEM_KEY));
    raws.forEach((raw, i) => {
      if (!raw) {
        huerfanos.push(ids[i]);
        return;
      }
      const item = JSON.parse(raw) as Reminder;
      if (!opts.estado || item.estado === opts.estado) items.push(item);
    });
    // Se difiere ZREM para no desplazar el offset de esta lectura.
    offset += ids.length;
    if (ids.length < batchSize) break;
  }
  if (huerfanos.length) await redis.zrem(INDEX_KEY, ...huerfanos);
  return items.slice(0, limit);
}

/** Barre una porción del índice en cada tick: los items resueltos expiran,
 * pero sus IDs no deben acumularse indefinidamente en el sorted set. */
async function cleanupExpiredIndexBatch(): Promise<void> {
  const [nextCursor, pairs] = await redis.zscan(INDEX_KEY, indexCleanupCursor, 'COUNT', 100);
  indexCleanupCursor = nextCursor;
  const ids = pairs.filter((_, i) => i % 2 === 0);
  if (!ids.length) return;
  const raws = await redis.mget(ids.map(ITEM_KEY));
  const expired = ids.filter((_, i) => !raws[i]);
  if (expired.length) await redis.zrem(INDEX_KEY, ...expired);
}

/**
 * Cancela un recordatorio todavía programado: sale de la cola y queda en el
 * historial como `cancelado`. El reclamo del worker cambia atómicamente a
 * `procesando`; desde ese momento la API responde 409 a una cancelación.
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

/** Reclamo atómico: estado, cola y lease cambian juntos. */
async function claimDue(now: number): Promise<Reminder | null | 'skip'> {
  const token = nuevoId();
  const raw = await redis.eval(
    `local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
     if #ids == 0 then return false end
     local id = ids[1]
     local itemKey = 'reminder:' .. id
     local raw = redis.call('GET', itemKey)
     if not raw then
       redis.call('ZREM', KEYS[1], id)
       return 'skip'
     end
     local item = cjson.decode(raw)
     if item.estado ~= 'programado' then
       redis.call('ZREM', KEYS[1], id)
       return 'skip'
     end
     item.estado = 'procesando'
     item.claimToken = ARGV[3]
     item.claimedAt = tonumber(ARGV[1])
     redis.call('SET', itemKey, cjson.encode(item))
     redis.call('ZREM', KEYS[1], id)
     redis.call('ZADD', KEYS[2], ARGV[2], id)
     return cjson.encode(item)`,
    2, QUEUE_KEY, PROCESSING_KEY, String(now), String(now + CLAIM_LEASE_MS), token,
  );
  if (!raw) return null;
  if (raw === 'skip') return 'skip';
  return JSON.parse(String(raw)) as Reminder;
}

/** Marca que el proveedor puede recibir el mensaje. A partir de aquí un
 * reinicio no lo reenvía: el resultado externo podría ser irreversible. */
async function markSendStarted(reminder: Reminder): Promise<boolean> {
  const result = await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local item = cjson.decode(raw)
     if item.estado ~= 'procesando' or item.claimToken ~= ARGV[1] then return 0 end
     item.sendStartedAt = tonumber(ARGV[2])
     redis.call('SET', KEYS[1], cjson.encode(item))
     return 1`,
    1, ITEM_KEY(reminder.id), reminder.claimToken!, String(Date.now()),
  );
  return Number(result) === 1;
}

/** Mantiene vivo el lease mientras la llamada al proveedor sigue pendiente. */
async function renewClaimLease(reminder: Reminder): Promise<void> {
  await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local item = cjson.decode(raw)
     if item.estado ~= 'procesando' or item.claimToken ~= ARGV[1] or not item.sendStartedAt then return 0 end
     redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
     return 1`,
    2, ITEM_KEY(reminder.id), PROCESSING_KEY,
    reminder.claimToken!, String(Date.now() + CLAIM_LEASE_MS), reminder.id,
  );
}

async function finalizeClaim(reminder: Reminder, token: string): Promise<boolean> {
  const result = await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local current = cjson.decode(raw)
     if current.estado ~= 'procesando' or current.claimToken ~= ARGV[1] then return 0 end
     redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
     redis.call('ZREM', KEYS[2], ARGV[4])
     return 1`,
    2, ITEM_KEY(reminder.id), PROCESSING_KEY,
    token, JSON.stringify(reminder), String(TTL_RESUELTO_SEG), reminder.id,
  );
  return Number(result) === 1;
}

/** Recupera un reclamo abandonado. Solo se reencola si todavía no se había
 * iniciado el intento externo. Si pudo haberse enviado, exige revisión. */
async function recoverExpiredClaims(now: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const result = await redis.eval(
      `local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
       if #ids == 0 then return false end
       local id = ids[1]
       local key = 'reminder:' .. id
       local raw = redis.call('GET', key)
       redis.call('ZREM', KEYS[1], id)
       if not raw then return 'missing' end
       local item = cjson.decode(raw)
       if item.estado ~= 'procesando' then return 'stale' end
       item.claimToken = nil
       item.claimedAt = nil
       if item.sendStartedAt then
         item.estado = 'fallido'
         item.error = 'Resultado del envío no confirmado; revisar antes de reprogramar.'
         redis.call('SET', key, cjson.encode(item), 'EX', ARGV[2])
         return 'review'
       end
       item.estado = 'programado'
       redis.call('SET', key, cjson.encode(item))
       redis.call('ZADD', KEYS[2], ARGV[1], id)
       return 'requeued'`,
      2, PROCESSING_KEY, QUEUE_KEY, String(now), String(TTL_RESUELTO_SEG),
    );
    if (!result) break;
    if (result === 'review') {
      console.error('[recordatorios] envío con resultado desconocido; requiere revisión');
    }
  }
}

/**
 * Procesa los recordatorios vencidos. Exportada aparte del worker para poder
 * dispararla a mano (o desde un test) sin depender del intervalo.
 *
 * Dos workers compiten mediante el mismo script de reclamo: solo uno obtiene
 * el ID. Cancelar solo es posible antes de ese reclamo. Los leases vencidos
 * se recuperan antes de procesar el siguiente lote.
 */
export async function processDueReminders(
  now: number = Date.now(),
  send: typeof enviarRecordatorio = enviarRecordatorio,
): Promise<{ enviados: number; fallidos: number }> {
  let enviados = 0;
  let fallidos = 0;

  try {
    await cleanupExpiredIndexBatch();
  } catch (err) {
    // El mantenimiento del índice no debe impedir envíos vencidos.
    console.error('[recordatorios] no se pudo limpiar el índice:', describeError(err));
  }
  await recoverExpiredClaims(now);

  for (let i = 0; i < 50; i++) {
    const reminder = await claimDue(now);
    if (!reminder) break;
    if (reminder === 'skip') continue;

    try {
      if (!(await markSendStarted(reminder))) continue;
    } catch (err) {
      // El lease permanece en Redis. Cuando venza, se reencolará porque no
      // quedó constancia de que se inició el envío externo.
      fallidos++;
      console.error('[recordatorios] no se pudo iniciar el envío:', describeError(err));
      continue;
    }

    const heartbeat = setInterval(() => {
      void renewClaimLease(reminder).catch((err) => {
        console.error('[recordatorios] no se pudo renovar lease:', describeError(err));
      });
    }, Math.floor(CLAIM_LEASE_MS / 3));
    heartbeat.unref();
    let resuelto: Reminder;
    try {
      await send({ telefono: reminder.telefono, mensaje: reminder.mensaje });
      resuelto = { ...reminder, estado: 'enviado', sentAt: Date.now() };
    } catch (err) {
      // Un fallo no debe frenar a los demás ni reintentar en bucle: se marca
      // fallido con la razón y el asesor decide si lo reprograma.
      const error = describeError(err);
      console.error(`[recordatorios] falló el envío de ${reminder.id}:`, error);
      resuelto = { ...reminder, estado: 'fallido', error };
    } finally {
      clearInterval(heartbeat);
    }
    delete resuelto.claimToken;
    delete resuelto.claimedAt;
    delete resuelto.sendStartedAt;

    try {
      const actualizado = await finalizeClaim(resuelto, reminder.claimToken!);
      if (!actualizado) {
        fallidos++;
        console.error('[recordatorios] no se pudo confirmar un reclamo; revisar el historial');
        continue;
      }
    } catch (err) {
      // El proveedor ya respondió. El lease acabará en revisión sin reenvío.
      fallidos++;
      console.error(
        `[recordatorios] no se pudo persistir ${reminder.id}; no se re-encola para evitar duplicados:`,
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
      console.error('[recordatorios] error en el tick del worker:', describeError(err));
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
