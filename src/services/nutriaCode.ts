import { randomInt } from 'crypto';

/** Ten cryptographically random, human-readable characters after NUTR-. */
export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 10; i++) {
    suffix += chars[randomInt(chars.length)];
  }
  return `NUTR-${suffix}`;
}
