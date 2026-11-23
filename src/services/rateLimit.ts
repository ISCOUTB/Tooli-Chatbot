import Redis from 'ioredis';
import { config } from '../config';

const redis = new Redis(config.redis.url, { lazyConnect: true });

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  /** Es la primera vez en esta ventana que se bloquea — útil para avisar al usuario solo una vez. */
  firstBlock: boolean;
}

/**
 * Rate limit por sliding window con contador fijo en Redis.
 * Devuelve si se permite el mensaje y cuánto falta para que se libere.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSec: number
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;

  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSec);
    }
    const ttl = await redis.ttl(redisKey);
    const allowed = count <= maxRequests;
    const firstBlock = count === maxRequests + 1;
    return {
      allowed,
      remaining: Math.max(0, maxRequests - count),
      retryAfterSec: ttl > 0 ? ttl : windowSec,
      firstBlock,
    };
  } catch (err) {
    console.error('[rateLimit] redis error, fail-open:', err);
    return { allowed: true, remaining: maxRequests, retryAfterSec: 0, firstBlock: false };
  }
}

const DEFAULT_MAX = 30;
const DEFAULT_WINDOW = 60;

export async function checkUserRateLimit(phoneNumber: string): Promise<RateLimitResult> {
  return checkRateLimit(`user:${phoneNumber}`, DEFAULT_MAX, DEFAULT_WINDOW);
}

export interface RateLimiterOptions {
  prefix: string;
  maxRequests: number;
  windowSec: number;
  keyGenerator?: (req: any) => string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { prefix, maxRequests, windowSec, keyGenerator = (req) => req.ip ?? 'unknown' } = options;
  return async (req: any, res: any, next: any) => {
    const key = `${prefix}:${keyGenerator(req)}`;
    const limit = await checkRateLimit(key, maxRequests, windowSec);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({ error: 'too_many_requests', retryAfterSec: limit.retryAfterSec });
      return;
    }
    next();
  };
}
