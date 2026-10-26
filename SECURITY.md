# Informe de Seguridad — Tooli Chatbot (rama `oc-seguridad`)

Fecha: 2026-09-14  
Alcance: Cambios en archivos permitidos (`src/middleware/auth.ts`, `src/middleware/security.ts`, `src/routes/authRoutes.ts`, `src/services/rateLimit.ts`, `src/index.ts`).  
No se tocaron: `src/routes/toolsRoutes.ts`, `src/flows/**`, `src/services/**` (salvo `rateLimit.ts`), `src/public/**`.

---

## 1. Cabeceras de seguridad (equivalente a Helmet, a mano)

**Archivo creado:** `src/middleware/security.ts` → middleware `securityHeaders()`  
**Aplicado en:** `src/index.ts` (primer middleware, antes de rutas y estáticos)

| Cabecera | Valor | Nota |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Evita MIME sniffing |
| `X-Frame-Options` | `DENY` | Previene clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Filtra referrer en navegación cross-origin |
| `X-Permitted-Cross-Domain-Policies` | `none` | Bloquea policy files de Flash/PDF antiguos |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | **Solo en producción** (HTTPS) |
| `Content-Security-Policy` | Ver abajo | Realista para el panel actual |

### Content-Security-Policy aplicado

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https:;
connect-src 'self' https://cdn.jsdelivr.net;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

**Justificación de `unsafe-inline`:**
- El panel (`src/public/app/index.html`) tiene **todo el JavaScript y CSS inline** en un único archivo HTML (≈3400 líneas).
- Carga **Chart.js desde `cdn.jsdelivr.net`** (línea 1086 y 1407 del HTML).
- Carga **Google Fonts (DM Sans) desde `fonts.googleapis.com` / `fonts.gstatic.com`** (línea 7).
- Un CSP estricto sin `unsafe-inline` rompería completamente el panel.

**Deuda técnica documentada:**  
Mover el JS a archivos estáticos separados (`/app/app.js`, `/app/styles.css`) y usar **nonces** generados por request para `script-src` y `style-src`. Esto permitiría quitar `unsafe-inline` y endurecer el CSP. Con la librería `helmet` + `helmet-csp` + nonces sería más limpio; hoy se hizo a mano sin dependencias nuevas.

---

## 2. Cookie de sesión JWT

**Archivo:** `src/middleware/auth.ts` — función `setSessionCookie()` (líneas 23–31)

| Atributo | Valor | Estado |
|---|---|---|
| `httpOnly` | `true` | ✅ Ya estaba |
| `secure` | `process.env.NODE_ENV === 'production'` | ✅ Ya estaba (solo HTTPS en prod) |
| `sameSite` | `'lax'` | ✅ Ya estaba (protección CSRF razonable) |
| `maxAge` | `8 * 60 * 60 * 1000` (8h) | ✅ Coherente con `TOKEN_TTL = '8h'` |
| `path` | `'/'` | ✅ Ya estaba |

**Conclusión:** La cookie ya estaba bien configurada. No se requirieron cambios.

---

## 3. Validación de JWT_SECRET al arranque

**Archivo:** `src/middleware/auth.ts` — nueva función `validateJwtSecret()` (líneas 17–33)  
**Llamada desde:** `src/index.ts` al inicio del bootstrap (línea 71)

Comportamiento:
- **Producción (`NODE_ENV=production`):** Si `JWT_SECRET` equals al default inseguro (`cambia-este-secreto-largo-para-jwt-tooli-2026`), el proceso **falla ruidosamente** con `process.exit(1)` y mensaje claro en stderr.
- **Desarrollo:** Permite el default pero emite **`console.warn` visible** recordando configurar variable de entorno.
- Adicional: avisa si el secreto tiene **< 32 caracteres** (recomendación mínima para HS256).

**Por qué no fallar en dev:** Evita bloquear a desarrolladores que clonan y corren `npm run dev` sin `.env` local. El warning es imposible de ignorar en consola.

---

## 4. Rate limiting genérico + aplicado a API

### Extensión en `src/services/rateLimit.ts`

- Se mantiene `checkRateLimit(key, max, window)` (ya existía, usado por login).
- Nueva helper **`createRateLimiter(options)`** (líneas 53–73) que devuelve un middleware Express listo para usar con:
  - `prefix`: namespace de la clave Redis
  - `maxRequests`, `windowSec`: límites
  - `keyGenerator(req)`: por defecto IP, personalizable (ej. user ID)

### Aplicación en `src/index.ts` (líneas 26–39)

Middleware global **solo en producción** para rutas `/api/*`:

```ts
// 120 req/min por IP en producción
checkRateLimit(`api:${ip}`, 120, 60)
```

**Números elegidos y por qué:**
- **120 req/min (2 req/seg)** — Un asesor navegando el panel dispara ~10–20 peticiones por pantalla (métricas, conversaciones, CRM, recordatorios, health, etc.). 120/min deja holgura para uso normal intenso sin bloquear.
- **Ventana 60s** — Sliding window real via Redis TTL; evita ráfagas cortas.
- **Solo `/api/*`** — No afecta assets estáticos (`/app/*`, `/nutria/*`, `/posgrados/*`, `/uploads/*`, `/public/*`) ni webhooks (`/webhook`, `/meta-webhook`, `/chatwoot-webhook`) que tienen sus propios controles.
- **Fail-open** — Si Redis falla, `checkRateLimit` devuelve `allowed: true` (ver `rateLimit.ts:40-41`). No se deniega servicio por caída de Redis.

**Cabeceras de respuesta añadidas:**
- `X-RateLimit-Limit: 120`
- `X-RateLimit-Remaining: <n>`
- `Retry-After: <seg>` en 429

---

## 5. Manejo de errores centralizado

**Archivo:** `src/middleware/security.ts`  
- `errorHandler(err, req, res, next)` (líneas 37–45): loguea stack trace **solo en servidor** (`console.error('[error]', err)`), responde JSON coherente.
  - Producción: `{ "error": "internal_error", "message": "Error interno del servidor" }` (sin detalles).
  - Desarrollo: `{ "error": "internal_error", "message": "<err.message>" }`.
- `notFoundHandler` (líneas 47–49): 404 JSON para rutas no existentes.
- `bodySizeLimit` (líneas 18–27): rechaza bodies > 5 MB **antes** de `express.json` (413 `payload_too_large`). Complementa el límite de `express.json({ limit: '5mb' })` en `index.ts:21`.

**Aplicados al final de la cadena** en `index.ts:68-69` (después de rutas y estáticos).

---

## 6. Fuga de datos en logs — archivos modificables

Revisados los 5 archivos permitidos:

| Archivo | Hallazgo | Acción |
|---|---|---|
| `src/middleware/auth.ts` | Solo warnings de config (JWT_SECRET). Sin PII. | ✅ OK |
| `src/middleware/security.ts` | `console.error('[error]', err)` — loguea Error completo (stack) **en servidor**. No sale al cliente. | ✅ OK (intencional para debugging) |
| `src/routes/authRoutes.ts` | L98: `console.error('[chatwoot-sso] error generando URL:', err?.message)` — solo message, sin token ni credenciales. | ✅ OK |
| `src/services/rateLimit.ts` | L40: `console.error('[rateLimit] redis error, fail-open:', err)` — error de Redis, sin datos de usuario. | ✅ OK |
| `src/index.ts` | Solo logs de arranque (puerto, URL). | ✅ OK |

**Patrón de enmascarado seguido:** En `src/flows/recordatorios.ts:61` se usa `to.slice(0, 4) + '****'` para teléfonos. Los archivos modificables ya respetan ese estilo o no logean PII.

---

## 7. Hallazgos en archivos NO modificables (reportados para el orquestador)

> **Regla:** No se tocan `src/routes/toolsRoutes.ts`, `src/flows/**`, `src/services/**` (salvo `rateLimit.ts`), `src/public/**`.  
> Se documentan aquí con **ruta y línea exacta** para que el orquestador los corrija en su turno.

### 7.1 `src/routes/toolsRoutes.ts:143` — **Severidad: MEDIA**
```ts
console.log(`[tools/recibo] solicitud de asesor ${req.user?.username} para código ${codigo}`);
```
- **Qué filtra:** Código estudiantil completo (formato `T00012345`) — **dato personal identificable** (PII).
- **Contexto:** Endpoint `POST /api/tools/recibo` (descarga recibo de matrícula).
- **Fix sugerido:** `codigo.slice(0, 2) + '******'` o `codigo.slice(-4)` igual que con teléfonos.

### 7.2 `src/routes/toolsRoutes.ts:100` — **Severidad: BAJA**
```ts
console.log(`[nutria] código canjeado: ${code} — ${result.data?.phone?.slice(-4)}`);
```
- **Qué filtra:** Código QR NutriA (no es PII sensible, pero es token de un uso). Teléfono ya enmascarado.
- **Fix sugerido:** Enmascarar código (`code.slice(0, 4) + '****'`).

### 7.3 `src/routes/webhook.ts:41` — **Severidad: ALTA**
```ts
console.log('[webhook] inbound:', { from: inbound.from, text: inbound.text, id: inbound.messageId });
```
- **Qué filtra:** **Número de teléfono completo** (`from`) + **texto completo del mensaje** (`text`) — conversación privada de estudiantes.
- **Contexto:** Webhook Evolution API (Baileys), **cada mensaje entrante**.
- **Fix sugerido:** `from.slice(-4)` y `text.slice(0, 50) + '…'` o hash del texto.

### 7.4 `src/routes/metaWebhook.ts:50–55` — **Severidad: ALTA**
```ts
console.log('[meta-webhook] inbound:', {
  from: inbound.from,       // teléfono completo
  text: inbound.text,       // texto completo
  messageId: inbound.messageId,
  timestamp: inbound.timestamp,
});
```
- **Qué filtra:** Igual que 7.3 — teléfono + mensaje completo por **cada mensaje entrante** vía Meta Cloud API.
- **Fix sugerido:** Mismo enmascarado que 7.3.

### 7.5 `src/routes/metaWebhook.ts:36` — **Severidad: BAJA**
```ts
console.log('[meta-webhook] parser returned null — ignorado (status/no-text)');
```
- No filtra datos, pero ruido en logs. Opcional: bajar a `debug` o quitar.

### 7.6 `src/adapters/messaging/EvolutionAPIAdapter.ts:134` — **Severidad: BAJA**
```ts
console.log('[sendList] to:', msg.to);
```
- **Qué filtra:** Teléfono destino completo en envíos de lista interactiva.
- **Fix sugerido:** `msg.to.slice(-4)`.

---

## 8. Decisiones de compromiso (trade-offs)

| Decisión | Qué se hizo | Por qué | Camino para mejorar |
|---|---|---|---|
| CSP con `unsafe-inline` | Permitido en `script-src` y `style-src` | Panel es HTML único con JS/CSS inline (3.4k líneas). Romperlo no es opción antes de publish. | Mover JS/CSS a archivos estáticos + nonces por request. Con `helmet` + nonces se quita `unsafe-inline`. |
| HSTS solo en producción | `if (isProduction)` | En `localhost` (HTTP) HSTS rompe el dev (navegador recuerda y exige HTTPS). | Ninguno — es práctica estándar. |
| Rate limit 120/min solo en prod | `if (isProduction)` | En dev molesta al recargar / hot-reload. | Añadir flag `RATE_LIMIT_DEV=true` si se quiere probar en local. |
| Fail-open en Redis | `checkRateLimit` devuelve `allowed: true` en error | Disponibilidad > seguridad estricta para panel interno. Un asesor bloqueado por caída de Redis es peor que pasar 130 req/min. | Si se requiere estricto: `failClosed: true` option + alerta a ops. |
| `sameSite: 'lax'` (no `strict`) | Mantenido | `strict` rompe navegación desde enlaces externos (ej. email con link al panel). `lax` protege CSRF en POST y permite GET top-level. | Si no hay navegación cross-site: cambiar a `strict`. |
| No tocar `toolsRoutes.ts` | Reportado arriba | Restricción de aislamiento del worktree. | Orquestador aplica fixes en su PR. |

---

## 9. Verificación obligatoria

```bash
npx tsc --noEmit
```
✅ **Pasa sin errores nuevos** (exit code 0, sin output).

---

## 10. Resumen de severidad real (panel interno detrás de login)

| Severidad | Cuenta | Qué incluye |
|---|---|---|
| **Alta** | 2 | Logs de webhooks con teléfono + mensaje completo (archivos no tocables) |
| **Media** | 1 | Log de código estudiantil en `toolsRoutes.ts:143` (archivo no tocable) |
| **Baja** | 3 | Códigos QR NutriA, teléfonos en adapter, ruido de parser |

**Total hallazgos reales:** 6 (2 alta, 1 media, 3 baja) — **0 inventados**.

---

## 11. Archivos modificados en este commit

| Archivo | Cambio |
|---|---|
| `src/middleware/security.ts` | **NUEVO** — cabeceras seguridad, body limit, error handlers |
| `src/index.ts` | Usa `securityHeaders`, `bodySizeLimit`, rate limit API (prod), `notFoundHandler`, `errorHandler`, llama `validateJwtSecret()` |
| `src/middleware/auth.ts` | Añade `validateJwtSecret()` con fail-hard en prod + warnings en dev |
| `src/services/rateLimit.ts` | Añade `createRateLimiter()` factory reutilizable |
| `SECURITY.md` | **NUEVO** — este reporte |

---

## 12. Próximos pasos recomendados (fuera de scope de este worktree)

1. **Orquestador:** Aplicar fixes de §7 en `toolsRoutes.ts`, `webhook.ts`, `metaWebhook.ts`, `EvolutionAPIAdapter.ts`.
2. **Frontend:** Separar JS/CSS del `index.html` → archivos estáticos + nonces → quitar `unsafe-inline` del CSP.
3. **Dependencias:** Evaluar añadir `helmet` + `helmet-csp` cuando se haga (2) para no mantener CSP a mano.
4. **Observabilidad:** Sustituir `console.*` por logger estructurado (pino/winston) con niveles y redactores de PII automáticos.
5. **Rate limit:** Añadir límite por usuario autenticado (`req.user?.username`) además de IP para API críticas.