/** Durable broadcast queue. A recipient is marked in flight before Meta is
 * called. If the process dies before the response is persisted, recovery marks
 * that recipient as unknown and continues with the rest; it never resends it. */
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { BroadcastValidationError, clasificarDestinatariosConDatos } from './broadcastValidation';
import { describeError } from './logSafe';
import {
  TEMPLATE_CON_VARIABLES, ensureApprovedTemplate, extractError, sendTemplateToRecipient,
  validarLanguage, validarTemplateName,
} from './broadcastService';
import { estaDadoDeBaja, guardarContextoCampana } from './campanaService';

const redis = new Redis(config.redis.url, { lazyConnect: true });
const QUEUE = 'broadcast:queue';
const PROCESSING = 'broadcast:processing';
const JOB_KEY = (id: string) => `broadcast:job:${id}`;
const DEDUPE_KEY = (hash: string) => `broadcast:dedupe:${hash}`;
const LEASE_MS = 5 * 60_000;
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

interface BroadcastStore {
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface BroadcastJob {
  id: string;
  templateName: string;
  language: string;
  createdBy: string;
  createdAt: number;
  estado: 'pendiente' | 'procesando' | 'completado';
  destinatarios: string[];
  solicitados: number;
  duplicadosOmitidos: number;
  enviados: string[];
  fallidos: { numero: string; error: string }[];
  nextIndex: number;
  currentIndex?: number;
  claimToken?: string;
  /** Valores de las variables de la plantilla, alineados con `destinatarios`. */
  parametros?: string[][];
  /** Contexto para el flujo del bot, alineado con `destinatarios` (null = sin contexto). */
  contextos?: (Record<string, string> | null)[];
}

function parseJob(raw: string): BroadcastJob {
  const job = JSON.parse(raw) as BroadcastJob;
  // Redis Lua cjson serializa una tabla vacía como {}, incluso si llegó como [].
  if (!Array.isArray(job.enviados)) job.enviados = [];
  if (!Array.isArray(job.fallidos)) job.fallidos = [];
  if (job.parametros !== undefined && !Array.isArray(job.parametros)) delete job.parametros;
  if (job.contextos !== undefined && !Array.isArray(job.contextos)) delete job.contextos;
  return job;
}

const ERROR_FALTAN_DATOS = (n: number) => `Faltan datos para ${n === 1 ? 'la variable' : `las ${n} variables`} de la plantilla`;
const ERROR_BAJA = 'Pidió no recibir campañas (baja); no se envió';

export async function enqueueBroadcast(
  templateName: unknown, language: unknown, recipients: unknown, createdBy: string,
  store: BroadcastStore = redis,
): Promise<BroadcastJob> {
  const name = validarTemplateName(templateName);
  const lang = validarLanguage(language);
  const classified = clasificarDestinatariosConDatos(recipients);
  const hash = createHash('sha256').update(JSON.stringify({
    // Mismo conjunto en distinto orden o formato sigue siendo el mismo envío.
    // Repetirlo intencionalmente requiere esperar 24 h.
    createdBy, name, lang, recipients: [...classified.validos].sort(),
  })).digest('hex');
  const dedupeKey = DEDUPE_KEY(hash);
  const existingId = await store.get(dedupeKey);
  if (existingId) {
    const existing = await getBroadcastJob(existingId, store);
    if (existing) return existing;
  }

  let variables = 0;
  if (classified.validos.length) {
    const { token, phoneNumberId, wabaId } = config.metaCloud;
    if (!token || !phoneNumberId || !wabaId) throw new Error('Faltan credenciales de Meta');
    variables = await ensureApprovedTemplate(name, lang);
    // Un envío sin datos por destinatario (selección de prospectos) no puede llenar variables.
    if (variables > 0 && classified.datos.every(d => d.parametros.length === 0)) {
      throw new BroadcastValidationError(TEMPLATE_CON_VARIABLES);
    }
  }

  // A quien le falte algún valor para las variables no se le envía; queda en fallidos.
  const destinatarios: string[] = [];
  const datos: typeof classified.datos = [];
  const fallidos = [...classified.invalidos];
  classified.validos.forEach((numero, i) => {
    const completos = classified.datos[i].parametros.slice(0, variables);
    if (completos.length < variables || completos.some(v => !v)) {
      fallidos.push({ numero, error: ERROR_FALTAN_DATOS(variables) });
      return;
    }
    destinatarios.push(numero);
    datos.push(classified.datos[i]);
  });

  const now = Date.now();
  const job: BroadcastJob = {
    id: randomUUID(), templateName: name, language: lang, createdBy, createdAt: now,
    estado: destinatarios.length ? 'pendiente' : 'completado',
    destinatarios, solicitados: classified.solicitados,
    duplicadosOmitidos: classified.duplicadosOmitidos,
    enviados: [], fallidos, nextIndex: 0,
    ...(variables > 0 ? { parametros: datos.map(d => d.parametros.slice(0, variables)) } : {}),
    ...(datos.some(d => d.contexto) ? { contextos: datos.map(d => d.contexto) } : {}),
  };
  const id = await store.eval(
    `local existing = redis.call('GET', KEYS[1])
     if existing then return existing end
     redis.call('SET', KEYS[2], ARGV[2])
     if ARGV[3] == 'pendiente' then
       redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
     else
       redis.call('EXPIRE', KEYS[2], ARGV[5])
     end
     redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[6])
     return ARGV[1]`,
    3, dedupeKey, JOB_KEY(job.id), QUEUE,
    job.id, JSON.stringify(job), job.estado, String(now), String(JOB_TTL_SECONDS), String(DEDUPE_TTL_SECONDS),
  );
  if (id !== job.id) {
    const existing = await getBroadcastJob(String(id), store);
    if (!existing) throw new Error('Trabajo de broadcast no disponible');
    return existing;
  }
  return job;
}

export async function getBroadcastJob(id: string, store: BroadcastStore = redis): Promise<BroadcastJob | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const raw = await store.get(JOB_KEY(id));
  return raw ? parseJob(raw) : null;
}

export async function renombrarUsuarioEnBroadcasts(viejo: string, nuevo: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'broadcast:job:*', 'COUNT', 100);
    cursor = next;
    if (!keys.length) continue;
    const raws = await redis.mget(keys);
    const pipe = redis.pipeline();
    raws.forEach((raw, index) => {
      if (!raw) return;
      try {
        const job = parseJob(raw);
        if (job.createdBy === viejo) {
          job.createdBy = nuevo;
          pipe.set(keys[index], JSON.stringify(job), 'KEEPTTL');
        }
      } catch { /* Un trabajo corrupto no debe bloquear los demás. */ }
    });
    await pipe.exec();
  } while (cursor !== '0');
}

async function claimJob(now: number): Promise<BroadcastJob | null | 'skip'> {
  const token = randomUUID();
  const raw = await redis.eval(
    `local ids = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 1)
     local recovered = #ids > 0
     if not recovered then ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1) end
     if #ids == 0 then return false end
     local id = ids[1]
     if recovered then redis.call('ZREM', KEYS[2], id) else redis.call('ZREM', KEYS[1], id) end
     local key = 'broadcast:job:' .. id
     local raw = redis.call('GET', key)
     if not raw then return 'skip' end
     local job = cjson.decode(raw)
     if job.estado == 'completado' then return 'skip' end
     if recovered and job.currentIndex ~= nil then
       table.insert(job.fallidos, { numero = job.destinatarios[job.currentIndex + 1], error = 'Resultado no confirmado; revisar antes de reenviar.' })
       job.nextIndex = job.currentIndex + 1
       job.currentIndex = nil
     end
     if job.nextIndex >= #job.destinatarios then
       job.estado = 'completado'
       job.claimToken = nil
       redis.call('SET', key, cjson.encode(job), 'EX', ARGV[4])
       return 'skip'
     end
     job.estado = 'procesando'
     job.claimToken = ARGV[2]
     redis.call('SET', key, cjson.encode(job))
     redis.call('ZADD', KEYS[2], ARGV[3], id)
     return cjson.encode(job)`,
    2, QUEUE, PROCESSING, String(now), token, String(now + LEASE_MS), String(JOB_TTL_SECONDS),
  );
  if (!raw) return null;
  if (raw === 'skip') return 'skip';
  return parseJob(String(raw));
}

async function beginRecipient(job: BroadcastJob, index: number): Promise<boolean> {
  const result = await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local job = cjson.decode(raw)
     if job.estado ~= 'procesando' or job.claimToken ~= ARGV[1] or job.nextIndex ~= tonumber(ARGV[2]) or job.currentIndex ~= nil then return 0 end
     job.currentIndex = tonumber(ARGV[2])
     redis.call('SET', KEYS[1], cjson.encode(job))
     redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
     return 1`,
    2, JOB_KEY(job.id), PROCESSING, job.claimToken!, String(index), String(Date.now() + LEASE_MS), job.id,
  );
  return Number(result) === 1;
}

async function finishRecipient(job: BroadcastJob, index: number, error?: string): Promise<BroadcastJob | null> {
  const raw = await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return false end
     local job = cjson.decode(raw)
     if job.estado ~= 'procesando' or job.claimToken ~= ARGV[1] or job.currentIndex ~= tonumber(ARGV[2]) then return false end
     local numero = job.destinatarios[tonumber(ARGV[2]) + 1]
     if ARGV[3] == '' then table.insert(job.enviados, numero)
     else table.insert(job.fallidos, { numero = numero, error = ARGV[3] }) end
     job.nextIndex = tonumber(ARGV[2]) + 1
     job.currentIndex = nil
     if job.nextIndex >= #job.destinatarios then
       job.estado = 'completado'
       job.claimToken = nil
       redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[4])
       redis.call('ZREM', KEYS[2], ARGV[5])
     else
       redis.call('SET', KEYS[1], cjson.encode(job))
       redis.call('ZADD', KEYS[2], ARGV[6], ARGV[5])
     end
     return cjson.encode(job)`,
    2, JOB_KEY(job.id), PROCESSING,
    job.claimToken!, String(index), error ?? '', String(JOB_TTL_SECONDS), job.id, String(Date.now() + LEASE_MS),
  );
  return raw ? parseJob(String(raw)) : null;
}

async function renewLease(job: BroadcastJob): Promise<void> {
  await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local job = cjson.decode(raw)
     if job.estado ~= 'procesando' or job.claimToken ~= ARGV[1] then return 0 end
     redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
     return 1`,
    2, JOB_KEY(job.id), PROCESSING, job.claimToken!, String(Date.now() + LEASE_MS), job.id,
  );
}

export interface DependenciasCampana {
  estaDadoDeBaja: (telefono: string) => Promise<boolean>;
  guardarContextoCampana: (telefono: string, contexto: Record<string, string>) => Promise<void>;
}

const CAMPANA_REDIS: DependenciasCampana = { estaDadoDeBaja, guardarContextoCampana };

/**
 * Un envío: revisa la baja justo antes (puede llegar mientras el trabajo
 * está en cola) y manda la plantilla con las variables del destinatario.
 * Devuelve el error a registrar, o undefined si Meta confirmó.
 */
export async function enviarADestinatario(
  job: BroadcastJob, index: number,
  send: typeof sendTemplateToRecipient, deps: DependenciasCampana = CAMPANA_REDIS,
): Promise<string | undefined> {
  const numero = job.destinatarios[index];
  try {
    if (await deps.estaDadoDeBaja(numero)) return ERROR_BAJA;
    await send(job.templateName, job.language, numero, job.parametros?.[index] ?? []);
    return undefined;
  } catch (err) {
    return extractError(err);
  }
}

/** Tras un envío confirmado, deja el contexto del destinatario para el flujo del bot. */
export async function guardarContextoEnviado(job: BroadcastJob, index: number, deps: DependenciasCampana = CAMPANA_REDIS): Promise<void> {
  const contexto = job.contextos?.[index];
  if (!contexto || typeof contexto !== 'object') return;
  // Si esto falla, el envío ya salió: la persona solo recibirá el flujo sin el contexto.
  await deps.guardarContextoCampana(job.destinatarios[index], contexto)
    .catch(err => console.error('[broadcast] contexto:', describeError(err)));
}

export async function processBroadcastJobs(
  send: typeof sendTemplateToRecipient = sendTemplateToRecipient,
): Promise<void> {
  for (let claims = 0; claims < 10; claims++) {
    const job = await claimJob(Date.now());
    if (!job) return;
    if (job === 'skip') continue;
    const heartbeat = setInterval(() => {
      void renewLease(job).catch(err => console.error('[broadcast] lease:', describeError(err)));
    }, Math.floor(LEASE_MS / 3));
    heartbeat.unref();
    try {
      for (let index = job.nextIndex; index < job.destinatarios.length; index++) {
        if (!(await beginRecipient(job, index))) break;
        const error = await enviarADestinatario(job, index, send);
        const updated = await finishRecipient(job, index, error);
        if (!updated) break;
        if (!error) await guardarContextoEnviado(job, index);
        if (updated.estado === 'completado') {
          console.log(`[broadcast] job completado: ${updated.enviados.length}/${updated.solicitados} enviados`);
          try {
            const { logAudit } = await import('./auditService');
            await logAudit(updated.createdBy, 'broadcast_enviado', `${updated.templateName} · ${updated.enviados.length}/${updated.solicitados}`);
          } catch (err) {
            console.error('[broadcast] auditoría:', describeError(err));
          }
        }
        if (index < job.destinatarios.length - 1) await new Promise<void>(resolve => setTimeout(resolve, 300));
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startBroadcastWorker(intervalMs = 3_000): void {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processBroadcastJobs(); }
    catch (err) { console.error('[broadcast] worker:', describeError(err)); }
    finally { running = false; }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref();
}

export function stopBroadcastWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
