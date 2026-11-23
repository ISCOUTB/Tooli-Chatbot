// Webhook de Telnyx (Voice API). Portado de FastFood (src/app/api/voice/telnyx/[hookKey]/route.ts):
//   1. tope de cuerpo (256 KB) y cuerpo CRUDO (la firma va sobre los bytes que llegaron, nunca sobre JSON re-armado);
//   2. clave larga de la URL (comparación en tiempo constante);
//   3. firma Ed25519 con ventana de ±5 min ANTES de mirar el contenido;
//   4. responde 200 enseguida y procesa el turno después (Telnyx no espera a la IA). Si procesar falla, el manejador
//      suelta la idempotencia del evento para que el reintento de Telnyx sirva.
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
  /** Cómo correr el trabajo después de responder (pruebas: inmediato y esperable). */
  despues?: (fn: () => Promise<void>) => void;
  log?: (msg: string) => void;
}

function mismaClave(a: string, b: string): boolean {
  // Se comparan huellas de igual largo: no se filtra el largo de la clave real.
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length > 0;
}

export function crearWebhookVoz(d: DepsWebhookVoz): Router {
  const router = Router();
  const log = d.log ?? ((m: string) => console.warn(`[voz] ${m}`));
  const despues = d.despues ?? ((fn) => { setImmediate(() => { void fn(); }); });
  router.post(
    '/telnyx/:hookKey',
    express.raw({ type: () => true, limit: VOICE_WEBHOOK_MAX_BYTES }),
    (req: Request, res: Response) => {
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
      res.json({ ok: true });
      despues(async () => {
        try {
          const r = await d.procesar(ev);
          if (process.env.NODE_ENV !== 'production') log(`${ev.rawType}: ${r.note}`);
        } catch (err) {
          log(`evento ${ev.rawType} falló (se reintentará si Telnyx lo reenvía): ${err instanceof Error ? err.message : 'error'}`);
        }
      });
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
