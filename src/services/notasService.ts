import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { saltarEnSimulacion } from './simulacion';

// ─────────────────────────────────────────────────────────────────────────────
// Consulta de NOTAS vía login SSO (Microsoft) automatizado con Playwright.
// Banner solo es accesible tras el SSO, así que abrimos un navegador headless,
// hacemos login con correo+contraseña del estudiante y, si aparece MFA, PAUSAMOS
// y pedimos el código por WhatsApp — manteniendo la MISMA sesión de navegador
// viva entre mensajes (Map por usuario, con timeout de limpieza).
//
// ⚠️ NO probado end-to-end (no hay credenciales para testear). Los selectores de
//    Microsoft y la navegación a la página de notas requieren validación real.
//
// ⚠️ SEGURIDAD: este flujo recibe una contraseña institucional por WhatsApp.
//    Debe permanecer apagado hasta validación técnica y aprobación institucional.
// ─────────────────────────────────────────────────────────────────────────────

const BANNER_ENTRY = 'https://ssbprod.utb.edu.co:8443/ssomanager/c/SSB';
const GRADES_URL = 'https://ssbprod.utb.edu.co:8443/PROD/bwskogrd.P_ViewTermGrde';
const SESSION_TTL_MS = 3 * 60_000;

export interface NotaCurso {
  titulo: string;
  notaFinal: string;
}
export type NotasLoginResult =
  /** `estado`: sesión del navegador (cookies) en JSON, SOLO si se pidió exportarla (camino A). Es secreto: va cifrada o no va. */
  | { status: 'ok'; cursos: NotaCurso[]; estado?: string }
  | { status: 'mfa'; prompt: string }
  | { status: 'error'; error: string };

export interface OpcionesLogin {
  /** Camino A: devolver la sesión del navegador para guardarla cifrada. La contraseña NUNCA se devuelve ni se guarda. */
  exportarEstado?: boolean;
}

interface LiveSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  timer: NodeJS.Timeout;
  exportarEstado: boolean;
}
const sessions = new Map<string, LiveSession>();

export async function closeNotasSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.timer);
  sessions.delete(id);
  try {
    await s.browser.close();
  } catch {
    /* noop */
  }
}

const stripTags = (s: string) =>
  s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function classifyAfterPassword(page: Page): Promise<'mfa' | 'stay' | 'banner' | 'error' | 'unknown'> {
  if (/ssbprod\.utb\.edu\.co/i.test(page.url())) return 'banner';
  if (await page.locator('input[name="otc"], input#idTxtBx_SAOTCC_OTC').count()) return 'mfa';
  const content = await page.content();
  if ((await page.locator('#idSIButton9').count()) && /mantener|stay signed/i.test(content)) return 'stay';
  if (/incorrecta|no coincide|isn't correct|no pudimos/i.test(content)) return 'error';
  return 'unknown';
}

async function scrapeNotas(page: Page): Promise<NotaCurso[]> {
  await page.goto(GRADES_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  const url = new URL(page.url());
  if (url.hostname !== 'ssbprod.utb.edu.co' || !url.pathname.endsWith('/bwskogrd.P_ViewTermGrde')) {
    throw new Error('Portal de notas no autenticado');
  }
  if (await page.locator('select[name="term_in"]').count()) {
    const options = await page.locator('select[name="term_in"] option').evaluateAll(
      (elements) => elements.map(element => (element as unknown as { value: string }).value),
    );
    const term = options.find(value => /^\d{6}$/.test(value));
    if (term) {
      await page.selectOption('select[name="term_in"]', term);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 }),
        page.locator('form:has(select[name="term_in"]) button[type="submit"], form:has(select[name="term_in"]) input[type="submit"]').first().click(),
      ]);
    }
  }
  const html = await page.content();

  // Parse best-effort: filas con un título de curso y una nota numérica.
  const cursos: NotaCurso[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(stripTags).filter(Boolean);
    const nota = cells.find((c) => /^\d(\.\d{1,2})?$/.test(c));
    const titulo = cells.find((c) => c.length > 4 && /[a-záéíóúñ]/i.test(c));
    if (nota && titulo) cursos.push({ titulo, notaFinal: nota });
  }
  return cursos;
}

/** Dominios a los que puede pertenecer una sesión guardada de Banner/Microsoft. */
const LOGIN_MICROSOFT = /login\.microsoftonline\.com|login\.live\.com/i;

/**
 * Camino A: reutiliza una sesión guardada (cookies) para ejecutar `usar` sobre
 * una página ya autenticada en Banner. No recibe contraseña. Si la sesión ya no
 * vale (redirige al login) devuelve 'expirada' y el llamador debe borrarla.
 */
export async function usarSesionGuardada<T>(
  estadoJson: string,
  usar: (page: Page) => Promise<T>,
): Promise<{ status: 'ok'; valor: T } | { status: 'expirada' } | { status: 'error' }> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({ storageState: JSON.parse(estadoJson), viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(GRADES_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    if (LOGIN_MICROSOFT.test(page.url()) || new URL(page.url()).hostname !== 'ssbprod.utb.edu.co') {
      return { status: 'expirada' };
    }
    return { status: 'ok', valor: await usar(page) };
  } catch {
    return { status: 'error' };
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Notas con una sesión guardada (camino A). */
export async function consultarNotasConSesion(estadoJson: string) {
  return usarSesionGuardada(estadoJson, scrapeNotas);
}

// SIN VERIFICAR contra el Banner real de la UTB: URL estándar de Banner 8 («Horario
// detallado del estudiante»). Confirmar con una cuenta del equipo (docs/datos-academicos.md).
const HORARIO_URL = 'https://ssbprod.utb.edu.co:8443/PROD/bwskfshd.P_CrseSchdDetl';

/** HTML del horario con una sesión guardada (camino A); el parseo está en proveedores/bannerHorarioParser.ts. */
export async function consultarHorarioHtmlConSesion(estadoJson: string) {
  return usarSesionGuardada(estadoJson, async (page) => {
    await page.goto(HORARIO_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    if (new URL(page.url()).hostname !== 'ssbprod.utb.edu.co') throw new Error('Portal de horario no autenticado');
    return page.content();
  });
}

export async function startNotasLogin(
  id: string, email: string, password: string, opciones: OpcionesLogin = {},
): Promise<NotasLoginResult> {
  // Nadie escribe una contraseña real del portal en el panel: en el simulador no se entra a Banner.
  if (saltarEnSimulacion('Portal de notas', 'No se entró al portal de notas: el simulador nunca usa contraseñas reales.', id)) {
    return { status: 'error', error: 'En el simulador no se consulta el portal de notas.' };
  }
  await closeNotasSession(id);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(BANNER_ENTRY, { waitUntil: 'networkidle', timeout: 40_000 });

    // Redirige a login.microsoftonline.com → correo → contraseña.
    await page.locator('input[type="email"], input[name="loginfmt"]').first().fill(email, { timeout: 20_000 });
    await page.locator('#idSIButton9, input[type="submit"]').first().click();
    await page.locator('input[type="password"], input[name="passwd"]').first().fill(password, { timeout: 20_000 });
    await page.locator('#idSIButton9, input[type="submit"]').first().click();
    await page.waitForTimeout(3000);

    const state = await classifyAfterPassword(page);

    if (state === 'mfa') {
      sessions.set(id, {
        browser, context, page, exportarEstado: Boolean(opciones.exportarEstado),
        timer: setTimeout(() => closeNotasSession(id), SESSION_TTL_MS),
      });
      return { status: 'mfa', prompt: 'Escribe el *código de verificación* (MFA) que te llegó por SMS o tu app.' };
    }
    if (state === 'error') {
      await browser.close();
      return { status: 'error', error: 'Correo o contraseña incorrectos.' };
    }
    if (state === 'stay') {
      await page.locator('#idSIButton9').first().click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    const cursos = await scrapeNotas(page);
    const estado = opciones.exportarEstado ? JSON.stringify(await context.storageState()) : undefined;
    await browser.close();
    return cursos.length
      ? { status: 'ok', cursos, ...(estado ? { estado } : {}) }
      : { status: 'error', error: 'No pude leer las notas del portal. Intenta más tarde.' };
  } catch {
    await browser?.close();
    return { status: 'error', error: 'No pude iniciar sesión en el portal. Intenta más tarde.' };
  }
}

export async function submitNotasMfa(id: string, code: string): Promise<NotasLoginResult> {
  const s = sessions.get(id);
  if (!s) return { status: 'error', error: 'La sesión de login expiró. Vuelve a empezar desde el menú.' };
  const { page } = s;

  try {
    await page.locator('input[name="otc"], input#idTxtBx_SAOTCC_OTC').first().fill(code, { timeout: 15_000 });
    await page.locator('#idSubmit_SAOTCC_Continue, #idSIButton9, input[type="submit"]').first().click();
    await page.waitForTimeout(3000);

    if (/mantener|stay signed/i.test(await page.content())) {
      await page.locator('#idSIButton9').first().click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    const cursos = await scrapeNotas(page);
    const estado = s.exportarEstado ? JSON.stringify(await s.context.storageState()) : undefined;
    await closeNotasSession(id);
    return cursos.length
      ? { status: 'ok', cursos, ...(estado ? { estado } : {}) }
      : { status: 'error', error: 'No pude leer las notas del portal. Intenta más tarde.' };
  } catch {
    await closeNotasSession(id);
    return { status: 'error', error: 'No pude verificar el código con el portal. Vuelve a empezar.' };
  }
}
