/** Inbox durable para webhooks entrantes. Redis confirma la escritura antes
 * del HTTP 200. Un solo worker por remitente procesa su FIFO; un handler cuyo
 * resultado queda incierto bloquea esa FIFO para revisión humana. */
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { InboundMessage } from '../adapters/messaging/IMessagingAdapter';
import { config } from '../config';
import { describeExternalError, describeId } from './logSafe';
import { processInboundMessage, type InboundSource } from './inboundProcessor';

const redis = new Redis(config.redis.url, { lazyConnect: true });
const READY = 'inbound:ready';
const PROCESSING = 'inbound:processing';
const BLOCKED = 'inbound:blocked';
const REVIEW = 'inbound:review';
const ITEM = (id: string) => `inbound:item:${id}`;
const FIFO = (senderKey: string) => `inbound:fifo:${senderKey}`;
const SEEN = (source: InboundSource, inbound: InboundMessage) =>
  `inbound:seen:${createHash('sha256').update(`${source}:${inbound.phoneNumberId}:${inbound.from}:${inbound.messageId}`).digest('hex')}`;
const senderKeyFor = (from: string) => createHash('sha256').update(from).digest('hex');
const LEASE_MS = 5 * 60_000;
const RESOLVED_TTL_SECONDS = 7 * 24 * 60 * 60;
const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;

interface InboxStore {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface InboxItem {
  id: string;
  source: InboundSource;
  inbound: InboundMessage;
  senderKey: string;
  createdAt: number;
  estado: 'pendiente' | 'procesando' | 'atendido' | 'ignorado' | 'revision';
  claimToken?: string;
  claimedAt?: number;
  reviewReason?: string;
}

/** Devuelve false para una entrega repetida; no vuelve a procesarla. */
export async function enqueueInbound(
  source: InboundSource, inbound: InboundMessage, store: InboxStore = redis,
): Promise<boolean> {
  if (!inbound.from || inbound.from.length > 128 || !inbound.messageId || inbound.messageId.length > 256) {
    throw new Error('Mensaje entrante inválido');
  }
  const now = Date.now();
  const senderKey = senderKeyFor(inbound.from);
  const item: InboxItem = {
    id: randomUUID(), source, inbound, senderKey, createdAt: now, estado: 'pendiente',
  };
  const result = await store.eval(
    `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
     redis.call('SET', KEYS[2], ARGV[2])
     redis.call('RPUSH', KEYS[3], ARGV[1])
     redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[5])
     if not redis.call('ZSCORE', KEYS[5], ARGV[3]) and redis.call('SISMEMBER', KEYS[6], ARGV[3]) == 0 then
       redis.call('ZADD', KEYS[4], ARGV[4], ARGV[3])
     end
     return 1`,
    6, SEEN(source, inbound), ITEM(item.id), FIFO(senderKey), READY, PROCESSING, BLOCKED,
    item.id, JSON.stringify(item), senderKey, String(now), String(SEEN_TTL_SECONDS),
  );
  return Number(result) === 1;
}

async function claimInbound(now: number): Promise<InboxItem | null | 'skip'> {
  const token = randomUUID();
  const raw = await redis.eval(
    `local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 1)
     if #expired > 0 then
       local sender = expired[1]
       redis.call('ZREM', KEYS[2], sender)
       local fifo = 'inbound:fifo:' .. sender
       local id = redis.call('LINDEX', fifo, 0)
       if not id then return 'skip' end
       local key = 'inbound:item:' .. id
       local raw = redis.call('GET', key)
       if not raw then
         redis.call('LPOP', fifo)
         if redis.call('LLEN', fifo) > 0 then redis.call('ZADD', KEYS[1], ARGV[1], sender) end
         return 'skip'
       end
       local item = cjson.decode(raw)
       item.estado = 'revision'
       item.reviewReason = 'Resultado del handler no confirmado tras vencerse el lease.'
       item.claimToken = nil
       redis.call('SET', key, cjson.encode(item))
       redis.call('SADD', KEYS[3], sender)
       redis.call('ZADD', KEYS[4], ARGV[1], id)
       return 'skip'
     end
     local ready = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
     if #ready == 0 then return false end
     local sender = ready[1]
     redis.call('ZREM', KEYS[1], sender)
     if redis.call('SISMEMBER', KEYS[3], sender) == 1 then return 'skip' end
     local fifo = 'inbound:fifo:' .. sender
     local id = redis.call('LINDEX', fifo, 0)
     if not id then return 'skip' end
     local key = 'inbound:item:' .. id
     local raw = redis.call('GET', key)
     if not raw then
       redis.call('LPOP', fifo)
       if redis.call('LLEN', fifo) > 0 then redis.call('ZADD', KEYS[1], ARGV[1], sender) end
       return 'skip'
     end
     local item = cjson.decode(raw)
     if item.estado == 'revision' then
       redis.call('SADD', KEYS[3], sender)
       redis.call('ZADD', KEYS[4], ARGV[1], id)
       return 'skip'
     end
     item.estado = 'procesando'
     item.claimToken = ARGV[2]
     item.claimedAt = tonumber(ARGV[1])
     redis.call('SET', key, cjson.encode(item))
     redis.call('ZADD', KEYS[2], ARGV[3], sender)
     return cjson.encode(item)`,
    4, READY, PROCESSING, BLOCKED, REVIEW,
    String(now), token, String(now + LEASE_MS),
  );
  if (!raw) return null;
  if (raw === 'skip') return 'skip';
  return JSON.parse(String(raw)) as InboxItem;
}

async function renewInboundLease(item: InboxItem): Promise<void> {
  await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local item = cjson.decode(raw)
     if item.estado ~= 'procesando' or item.claimToken ~= ARGV[1] then return 0 end
     redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
     return 1`,
    2, ITEM(item.id), PROCESSING,
    item.claimToken!, String(Date.now() + LEASE_MS), item.senderKey,
  );
}

async function finishInbound(item: InboxItem, estado: 'atendido' | 'ignorado' | 'revision', reason = ''): Promise<boolean> {
  const result = await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local item = cjson.decode(raw)
     if item.estado ~= 'procesando' or item.claimToken ~= ARGV[1] then return 0 end
     if redis.call('LINDEX', KEYS[2], 0) ~= ARGV[2] then return 0 end
     item.estado = ARGV[3]
     item.claimToken = nil
     redis.call('ZREM', KEYS[4], ARGV[4])
     if ARGV[3] == 'revision' then
       item.reviewReason = ARGV[5]
       redis.call('SET', KEYS[1], cjson.encode(item))
       redis.call('SADD', KEYS[5], ARGV[4])
       redis.call('ZADD', KEYS[6], ARGV[6], ARGV[2])
     else
       redis.call('LPOP', KEYS[2])
       redis.call('SET', KEYS[1], cjson.encode(item), 'EX', ARGV[7])
       if redis.call('LLEN', KEYS[2]) > 0 then redis.call('ZADD', KEYS[3], ARGV[6], ARGV[4]) end
     end
     return 1`,
    6, ITEM(item.id), FIFO(item.senderKey), READY, PROCESSING, BLOCKED, REVIEW,
    item.claimToken!, item.id, estado, item.senderKey, reason, String(Date.now()), String(RESOLVED_TTL_SECONDS),
  );
  return Number(result) === 1;
}

export async function processInboundInbox(
  process: typeof processInboundMessage = processInboundMessage,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const item = await claimInbound(Date.now());
    if (!item) return;
    if (item === 'skip') continue;
    const heartbeat = setInterval(() => {
      void renewInboundLease(item).catch(err => console.error('[inbound] lease:', describeExternalError(err)));
    }, Math.floor(LEASE_MS / 3));
    heartbeat.unref();
    try {
      const outcome = await process(item.source, item.inbound);
      if (!(await finishInbound(item, outcome === 'ignored' ? 'ignorado' : 'atendido'))) {
        console.error('[inbound] no se pudo confirmar handler:', describeId(item.id));
      }
    } catch (err) {
      const reason = describeExternalError(err);
      console.error('[inbound] handler requiere revisión:', describeId(item.id), reason);
      await finishInbound(item, 'revision', `Fallo del handler; ${reason}. Revisar efectos externos antes de reintentar.`);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

export interface InboundReviewSummary {
  id: string;
  source: InboundSource;
  from: string;
  messageId: string;
  createdAt: number;
  claimedAt?: number;
  reviewReason?: string;
}

export async function listInboundReviews(limit = 100): Promise<InboundReviewSummary[]> {
  const ids = await redis.zrevrange(REVIEW, 0, Math.max(1, Math.min(limit, 200)) - 1);
  if (!ids.length) return [];
  const raws = await redis.mget(ids.map(ITEM));
  const stale: string[] = [];
  const items = raws.flatMap((raw, i) => {
    if (!raw) { stale.push(ids[i]); return []; }
    const item = JSON.parse(raw) as InboxItem;
    return [{
      id: item.id, source: item.source, from: item.inbound.from,
      messageId: item.inbound.messageId, createdAt: item.createdAt,
      claimedAt: item.claimedAt, reviewReason: item.reviewReason,
    }];
  });
  if (stale.length) await redis.zrem(REVIEW, ...stale);
  return items;
}

export async function resolveInboundReview(
  id: string, decision: 'acknowledge' | 'retry',
): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return false;
  const raw = await redis.get(ITEM(id));
  if (!raw) return false;
  const item = JSON.parse(raw) as InboxItem;
  const result = await redis.eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local item = cjson.decode(raw)
     if item.estado ~= 'revision' or redis.call('LINDEX', KEYS[2], 0) ~= ARGV[1] then return 0 end
     redis.call('ZREM', KEYS[5], ARGV[1])
     redis.call('SREM', KEYS[4], ARGV[2])
     if ARGV[3] == 'retry' then
       item.estado = 'pendiente'
       item.reviewReason = nil
       item.claimedAt = nil
       redis.call('SET', KEYS[1], cjson.encode(item))
     else
       item.estado = 'ignorado'
       item.reviewReason = nil
       redis.call('LPOP', KEYS[2])
       redis.call('SET', KEYS[1], cjson.encode(item), 'EX', ARGV[5])
     end
     if redis.call('LLEN', KEYS[2]) > 0 then redis.call('ZADD', KEYS[3], ARGV[4], ARGV[2]) end
     return 1`,
    5, ITEM(id), FIFO(item.senderKey), READY, BLOCKED, REVIEW,
    id, item.senderKey, decision, String(Date.now()), String(RESOLVED_TTL_SECONDS),
  );
  return Number(result) === 1;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startInboundWorker(intervalMs = 1_000): void {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processInboundInbox(); }
    catch (err) { console.error('[inbound] worker:', describeExternalError(err)); }
    finally { running = false; }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref();
}

export function stopInboundWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
