import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { describeError } from '../services/logSafe';

const isProduction = process.env.NODE_ENV === 'production';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const csp = [
    "default-src 'self'",
    // Sin 'unsafe-inline': el panel y el login cargan su JS desde archivos
    // propios (/app/js/*), así una inyección de HTML no puede ejecutar código.
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);

  next();
}

export function bodySizeLimit(req: Request, res: Response, next: NextFunction): void {
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
    res.status(413).json({ error: 'payload_too_large' });
    return;
  }
  next();
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[error]', describeError({ status: (err as any).status }));
  const status = (err as any).status ?? 500;
  const message = isProduction ? 'Error interno del servidor' : err.message;
  res.status(status).json({ error: 'internal_error', message });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found' });
}
