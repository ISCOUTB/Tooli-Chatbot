// Webhook de Telnyx (Voice API). Portado de FastFood (src/app/api/voice/telnyx/[hookKey]/route.ts):
//   1. tope de cuerpo (256 KB) y cuerpo CRUDO (la firma va sobre los bytes que llegaron, nunca sobre JSON re-armado);
//   2. clave larga de la URL (comparación en tiempo constante);
//   3. firma Ed25519 con ventana de ±5 min ANTES de mirar el contenido;
//   4. procesa y DESPUÉS responde (punto 10). Telnyx reintenta solo ante un 5xx, un 408 o 429, o la falta de
//      respuesta; un 2xx cuenta como entregado y no se reintenta nunca (developers.telnyx.com, Voice API Webhooks,
//      «Response codes»). Por eso, si procesar falla se responde 500 y el manejador suelta la idempotencia del evento:
//      el reintento de Telnyx lo vuelve a procesar. Telnyx no publica cuánto espera (el «webhook_timeout_secs» de la
//      aplicación va de 0 a 30 s); si procesar tarda más que `plazoMs` (5 s; casi siempre es un turno con IA), se
//      responde 202 y se termina de procesar: un reintento que llegue mientras tanto es un duplicado. Lo que se pierda
//      igual (un fallo después del 202) lo cierra el barrido del tope duro (punto 8).
// Se monta en src/index.ts ANTES de express.json (si no, el parser global se come el cuerpo crudo).
import express, { Router, type Request, type Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { VoiceEvent, VoiceProvider } from '../voice/proveedor/tipos';

export const VOICE_WEBHOOK_MAX_BYTES = 256_000;

export interface DepsWebhookVoz {
  clave: () => string;
  llavePublica: () => string | null;
  proveedor: VoiceProvider;
  procesar: (ev: VoiceEvent) => Promise<{ handled: boolean; note: string }>;
  /** Lo máximo que se espera a procesar antes de responder 202 y seguir en segundo plano. */
  plazoMs?: number;
  log?: (msg: string) => void;
}

export const PLAZO_WEBHOOK_MS = 5000;

function mismaClave(a: string, b: string): boolean {
  // Se comparan huellas de igual largo: no se filtra el largo de la clave real.
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length > 0;
}

export function crearWebhookVoz(d: DepsWebhookVoz): Router {
  const router = Router();
  const log = d.log ?? ((m: string) => console.warn(`[voz] ${m}`));
  const plazoMs = d.plazoMs ?? PLAZO_WEBHOOK_MS;
  router.post(
    '/telnyx/:hookKey',
    express.raw({ type: () => true, limit: VOICE_WEBHOOK_MAX_BYTES }),
    async (req: Request, res: Response) => {
      const clave = d.clave();
      if (!clave || clave.length < 24 || !mismaClave(String(req.params.hookKey ?? ''), clave)) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      const check = d.proveedor.verifyWebhook({ rawBody, headers: req.headers, publicKey: d.llavePublica() });
      if (!check.ok) {
        log(`webhook rechazado: firma ${check.reason}`);
        res.status(401).json({ error: 'firma_invalida' });
        return;
      }
      const ev = d.proveedor.parseEvent(rawBody);
      if (!ev) {
        res.json({ ok: true, ignored: 'evento sin datos' });
        return;
      }
      const trabajo = d.procesar(ev).then(
        (r) => ({ ok: true as const, note: r.note }),
        (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : 'error' }),
      );
      let reloj: NodeJS.Timeout | undefined;
      const vencio = new Promise<null>((r) => { reloj = setTimeout(() => r(null), plazoMs); reloj.unref?.(); });
      const r = await Promise.race([trabajo, vencio]);
      clearTimeout(reloj);
      if (r === null) {
        res.status(202).json({ ok: true, enCurso: true });
        void trabajo.then((x) => {
          if (!x.ok) log(`evento ${ev.rawType} falló después de responder (lo cierra el barrido del tope duro): ${x.error}`);
        });
        return;
      }
      if (!r.ok) {
        log(`evento ${ev.rawType} falló; se responde 500 para que Telnyx lo reintente: ${r.error}`);
        res.status(500).json({ error: 'reintentar' });
        return;
      }
      if (process.env.NODE_ENV !== 'production') log(`${ev.rawType}: ${r.note}`);
      res.json({ ok: true });
    },
  );
  // Cuerpo más grande que el tope: 413 sin procesar nada.
  router.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      res.status(413).json({ error: 'payload_too_large' });
      return;
    }
    next(err);
  });
  return router;
}
