/**
 * Rutas del bot NutriA. Son PÚBLICAS a propósito: las consume la landing
 * de la campaña, sin sesión de asesor. Por eso se montan antes de requireAuth.
 *
 * PÚBLICO NO SIGNIFICA «CON DATOS PERSONALES».
 *
 * Estas rutas devolvían el número de WhatsApp real de cada participante a
 * cualquiera que pidiera la URL, sin autenticación:
 *
 *   - `GET /nutria/encuestas` devolvía las filas crudas del Sheet, y la
 *     columna B es el teléfono del remitente (en `nutriaSheets.ts` se escribe
 *     tal cual; la variable se llamaba `whatsappAnon` pero no anonimizaba
 *     nada).
 *   - `GET /nutria/canjes` devolvía `{ code, phone, canjeadoEn }`.
 *   - `GET /nutria/codigo/:code` y el canje esparcían el `CodigoNutria`
 *     entero, que lleva `phone`.
 *
 * Eran teléfonos de jóvenes reales junto con su edad, su género y sus
 * hábitos de consumo. La landing (`src/public/nutria/index.html`) **nunca
 * usó ninguno de esos teléfonos**: el panel pinta agregados, el historial
 * solo enseña `code` y `canjeadoEn`, y el escáner solo mira el estado del
 * código. Por eso enmascararlos aquí no rompe nada de lo que hay montado.
 *
 * La regla que queda: por esta puerta no sale un teléfono completo. Si algún
 * día el panel necesita uno de verdad, la ruta que lo dé va **debajo** de
 * `requireAuth`, como `nutriaRouterProtegido`.
 */

import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth';
import { maskCode, maskPhone } from '../../services/logSafe';
import { canjearCodigoNutria, getCanjesRecientes, getCodigoNutria } from '../../services/nutriaCodigoService';
import { filaSinTelefono } from '../../services/nutriaPrivacidad';
import { guardarEncuestaNutria, leerEncuestasNutria } from '../../services/nutriaSheets';

export const nutriaRouter = Router();

// ── Rutas PÚBLICAS de NutriA (sin autenticación) ──────────────────────────────

nutriaRouter.get('/nutria/encuestas', async (_req, res) => {
  try {
    const rows = await leerEncuestasNutria();
    res.json({ rows: rows.map(filaSinTelefono) });
  } catch (err) {
    console.error('[tools/nutria/encuestas] error:', err);
    res.status(500).json({ error: 'internal_error', message: 'No se pudieron cargar las encuestas' });
  }
});

// ── Validación y canje de códigos QR NutriA (sin autenticación) ──────────────

nutriaRouter.get('/nutria/codigo/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const data = await getCodigoNutria(code);
  if (!data) {
    res.status(404).json({ error: 'not_found', message: 'Código no existe o expiró' });
    return;
  }
  // El escáner solo necesita saber si el código sirve y si ya se usó. El
  // teléfono del dueño del código no pinta nada aquí.
  res.json({ ok: true, code, ...data, phone: maskPhone(data.phone) });
});

nutriaRouter.get('/nutria/canjes', async (_req, res) => {
  const canjes = await getCanjesRecientes(10);
  // El historial de la landing pinta `code` y `canjeadoEn`, nada más.
  res.json({
    canjes: canjes.map(c => ({ ...c, phone: maskPhone(c.phone) })),
  });
});

nutriaRouter.post('/nutria/codigo/:code/canjear', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const result = await canjearCodigoNutria(code);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 409;
    res.status(status).json({
      error: result.error,
      data: result.data ? { ...result.data, phone: maskPhone(result.data.phone) } : undefined,
    });
    return;
  }
  console.log(`[nutria] código canjeado: ${maskCode(code)} — ${maskPhone(result.data?.phone)}`);
  res.json({
    ok: true,
    code,
    ...result.data,
    phone: maskPhone(result.data?.phone),
  });
});

// ── Rutas de NutriA que EXIGEN sesión de asesor ──────────────────────────────
//
// Se montan aparte, en `toolsRoutes.ts`, **debajo** de `requireAuth`.

export const nutriaRouterProtegido = Router();

/**
 * Siembra una fila de prueba en el Sheet de producción.
 *
 * Estaba en la sección pública, protegida solo por una clave escrita en el
 * código (`nutria-seed-2024`) que está en el repositorio y por tanto no es
 * un secreto: cualquiera podía ensuciar los datos reales de la campaña.
 * Nadie la llama desde la landing. Ahora exige sesión de asesor, y con eso
 * la clave sobra.
 */
nutriaRouterProtegido.post('/nutria/encuestas/seed', requireAdmin, async (_req, res) => {
  try {
    await guardarEncuestaNutria({
      whatsapp:           'seed-test',
      edad:               '20 años',
      genero:             'Femenino',
      tiempoCelular:      'Entre 4 y 6 horas',
      verificarMetricas:  'Sí',
      tiempoRedes:        'Entre 1 y 3 horas',
      redPrincipal:       'Instagram',
      sabeUltraprocesado: 'No',
      vioPublicidad:      'Sí',
      redPublicidad:      'Instagram',
      publicidadMotivo:   'Sí',
      consumoBebidas:     '2 veces',
      consumoPanaderia:   '1 vez',
      consumoPostres:     '2 veces',
      consumoMecatos:     '3 veces',
      comproDespues:      'Sí',
      sellos:             'A veces',
      consumiriaSello:    'Sí',
      motivacion:         'Me dio antojo',
      comoEntero:         'Por un amigo',
      contacto:           'Sí',
    });
    res.json({ ok: true, message: 'Fila de prueba guardada en Google Sheets ✅' });
  } catch (err) {
    console.error('[tools/nutria/seed] error:', err);
    res.status(500).json({ error: 'internal_error', message: 'No se pudo crear la fila de prueba' });
  }
});
