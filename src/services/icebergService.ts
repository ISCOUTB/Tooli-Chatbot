import { chromium, Browser, Page } from 'playwright';
import { createWorker } from 'tesseract.js';
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import { observeReciboLatency } from './promMetrics';

const PORTAL_URL = 'https://iceberg-niif.utb.edu.co/iceberg-pf/';
const DEBUG_DIR = '/tmp/iceberg';
const MAX_CAPTCHA_RETRIES = 5;

export interface MatriculaFecha {
  tipo: 'ORDINARIA' | 'EXTRAORDINARIA' | 'EXTEMPORANEA';
  fechaVencimiento: string;
  recargo: string;
}

export interface IcebergLoginResult {
  ok: boolean;
  error?: string;
  nombre?: string;
  cedula?: string;
  noRecibos?: boolean;
  menuUsado?: string;
  pdf?: Buffer;
  /** Fechas de vencimiento extraídas de la tabla del portal */
  matriculas?: MatriculaFecha[];
  captchaAttempts?: Array<{ solver: 'openai' | 'tesseract'; text: string }>;
  debugFiles?: string[];
}

const MENUS_RECIBOS = [
  'Derechos Académicos',
  'Creditos Vigentes',
  'Creditos Vencidos',
  'Otros Pagos',
];

const openaiClient = config.openai.apiKey
  ? new OpenAI({ apiKey: config.openai.apiKey })
  : null;

/**
 * Resuelve captcha usando OpenAI GPT-4o-mini Vision (barato y rápido).
 * Acierta ~95%+ en captchas alfanuméricos con ruido moderado.
 */
async function solveCaptchaWithOpenAI(imageBuffer: Buffer): Promise<string | null> {
  if (!openaiClient) return null;

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Esta imagen es un captcha alfanumérico (letras y números). ' +
                'Lee únicamente los caracteres principales, ignora líneas tachadas o ruido de fondo. ' +
                'Responde SOLO con los caracteres del captcha, sin espacios, sin explicación, sin puntuación.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (text) {
      return text.replace(/[^a-zA-Z0-9]/g, '').trim();
    }
  } catch {
    console.error('[openai-ocr] no se pudo resolver el captcha');
  }
  return null;
}

/**
 * Fallback OCR con Tesseract (gratis, ~60-70% accuracy en captchas con ruido).
 */
async function solveCaptchaWithTesseract(imageBuffer: Buffer): Promise<string> {
  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  });
  const { data } = await worker.recognize(imageBuffer);
  await worker.terminate();
  return data.text.replace(/[^a-zA-Z0-9]/g, '').trim();
}

async function ensureDebugDir(): Promise<void> {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
}

/**
 * Descarga la imagen del captcha actual del portal a través del contexto del navegador
 * (para mantener cookies/sesión).
 */
async function downloadCaptchaImage(page: Page): Promise<Buffer> {
  const captchaSrc = await page.$eval('img[src*="captcha"]', (el: any) => el.src);

  const buffer = await page.evaluate(async (src: string) => {
    const res = await fetch(src);
    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, captchaSrc);

  return Buffer.from(buffer);
}

/**
 * Si hay un modal de error visible (ej: "Valores de Captcha Incorrectos!"),
 * lo cierra y devuelve true.
 *
 * El portal usa ZK framework que crea modales con .z-modal-mask de fondo
 * y .z-window-modal o .z-messagebox. El botón puede ser OK/Aceptar/Cerrar.
 */
async function dismissErrorModalIfPresent(page: Page): Promise<boolean> {
  // Detectar si hay máscara de modal visible
  const mask = page.locator('.z-modal-mask').first();
  const maskVisible = await mask.isVisible().catch(() => false);

  if (!maskVisible) return false;

  // Intentar varios selectores de botón en orden de probabilidad
  const buttonSelectors = [
    '.z-messagebox button:visible',
    '.z-window-modal button:visible',
    'button:visible:has-text("OK")',
    'button:visible:has-text("Aceptar")',
    'button:visible:has-text("Cerrar")',
    'button:visible:has-text("Close")',
    '.z-window-modal .z-window-close',
  ];

  for (const sel of buttonSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(800);
      // Verificar que la máscara desapareció
      const stillVisible = await mask.isVisible().catch(() => false);
      if (!stillVisible) return true;
    }
  }

  // Último recurso: presionar ESC
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  return true;
}

/**
 * Refresca el captcha haciendo click en el icono de recharge.
 */
async function refreshCaptcha(page: Page): Promise<void> {
  await page.click('img[src*="recharge"]').catch(() => {});
  await page.waitForTimeout(1500); // dar tiempo a que el nuevo captcha cargue
}

/**
 * Lee la tabla del portal y extrae fechas de vencimiento por tipo de matrícula.
 * ZK Listbox renderiza las filas como .z-listitem y las celdas como .z-listcell-cnt.
 */
async function extractMatriculaFechas(page: Page): Promise<MatriculaFecha[]> {
  try {
    // Extraer todo el texto visible de la página y parsear con regex.
    // Esto es robusto ante cualquier versión de ZK Framework.
    const bodyText = await page.locator('body').innerText().catch(() => '');

    console.log(`[iceberg] página recibida (${bodyText.length} caracteres)`);

    const matriculas: MatriculaFecha[] = [];
    const DATE_RE = /(\d{2}\/\d{2}\/\d{4})/g;

    // Buscar líneas que contengan tipo de matrícula y una fecha
    const lines = bodyText.split(/\n|\\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const tipo = parseTipo(line);
      if (!tipo) continue;
      const dates = line.match(DATE_RE);
      if (dates && dates.length > 0) {
        // Tomar la última fecha del texto (suele ser la fecha de vencimiento)
        const fecha = dates[dates.length - 1];
        // Buscar recargo en la misma línea (ej: "2 %" o "0 %")
        const recargoMatch = line.match(/(\d+)\s*%/);
        const recargo = recargoMatch ? `${recargoMatch[1]}%` : '0%';
        // Evitar duplicados del mismo tipo
        if (!matriculas.find(m => m.tipo === tipo)) {
          matriculas.push({ tipo, fechaVencimiento: fecha, recargo });
        }
      }
    }

    // Si no encontró nada por líneas, buscar patrones directamente en el texto completo
    if (matriculas.length === 0) {
      const tipos: Array<[MatriculaFecha['tipo'], RegExp]> = [
        ['EXTRAORDINARIA', /EXTRAORDINARIA[^\d]*(\d{2}\/\d{2}\/\d{4})/i],
        ['ORDINARIA',      /ORDINARIA[^\d]*(\d{2}\/\d{2}\/\d{4})/i],
        ['EXTEMPORANEA',   /EXTEMPORA[NÑ]EA[^\d]*(\d{2}\/\d{2}\/\d{4})/i],
      ];
      for (const [tipo, re] of tipos) {
        const m = bodyText.match(re);
        if (m) matriculas.push({ tipo, fechaVencimiento: m[1], recargo: '0%' });
      }
    }

    console.log(`[iceberg] tipos de matrícula encontrados: ${matriculas.length}`);
    return matriculas;
  } catch {
    console.error('[iceberg] no se pudieron extraer fechas de matrícula');
    return [];
  }
}

function parseTipo(text: string): MatriculaFecha['tipo'] | null {
  const t = text.toUpperCase();
  if (t.includes('EXTRAORDINARIA')) return 'EXTRAORDINARIA';
  if (t.includes('ORDINARIA')) return 'ORDINARIA';
  if (t.includes('EXTEMPORANEA') || t.includes('EXTEMPORÁNEA')) return 'EXTEMPORANEA';
  return null;
}

/**
 * Navega a un menú y verifica si tiene registros. Si los tiene, selecciona la primera
 * fila y clickea "Generar Recibo", capturando el PDF de la pestaña nueva que se abre.
 *
 * Devuelve:
 *  - { found: true, pdf }     si se descargó el PDF
 *  - { found: false }         si no había registros en ese menú
 *  - { found: true, error }   si había registros pero falló la descarga
 */
async function tryDownloadFromMenu(
  page: Page,
  menuName: string,
  debug: boolean,
  debugFiles: string[]
): Promise<{ found: boolean; pdf?: Buffer; error?: string; matriculas?: MatriculaFecha[] }> {
  // Click en el item del menú lateral
  await page.locator(`text="${menuName}"`).first().click().catch(() => {});
  await page.waitForTimeout(2_000);

  if (debug) {
    const p = path.join(DEBUG_DIR, `06-menu-${menuName.replace(/\s+/g, '_')}.png`);
    await page.screenshot({ path: p, fullPage: true });
    debugFiles.push(p);
  }

  // Detectar si dice "No se han encontrado Registros"
  const sinRegistros = await page
    .locator('text=/No se han encontrado/i')
    .first()
    .isVisible()
    .catch(() => false);

  if (sinRegistros) {
    return { found: false };
  }

  // Extraer fechas de vencimiento de la tabla antes de seleccionar fila
  const matriculas = await extractMatriculaFechas(page);

  // Seleccionar la primera fila del ZK Listbox.
  // ZK oculta visualmente los inputs y usa spans custom, así que probamos en orden:
  // 1) radio button (con force para elementos ocultos por CSS)
  // 2) checkbox (con force)
  // 3) click directo en la primera fila del listbox
  const firstRadio = page.locator('input[type="radio"]').first();
  const firstCheckbox = page.locator('input[type="checkbox"]').first();
  const firstRow = page.locator('.z-listitem, tr.z-listitem, li.z-listitem').first();

  const radioExists = await firstRadio.count().then(n => n > 0).catch(() => false);
  const checkboxExists = await firstCheckbox.count().then(n => n > 0).catch(() => false);
  const rowExists = await firstRow.count().then(n => n > 0).catch(() => false);

  if (radioExists) {
    await firstRadio.click({ force: true }).catch(() => {});
  } else if (checkboxExists) {
    await firstCheckbox.click({ force: true }).catch(() => {});
  } else if (rowExists) {
    await firstRow.click().catch(() => {});
  } else {
    return { found: false };
  }
  await page.waitForTimeout(500);

  // Click en "Generar Recibo" — puede abrir pestaña nueva o disparar descarga directa
  const context = page.context();
  const newPagePromise = context.waitForEvent('page', { timeout: 15_000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });

  const generarBtn = page.locator('text="Generar Recibo"').first();
  const btnVisible = await generarBtn.isVisible().catch(() => false);
  console.log(`[iceberg] botón "Generar Recibo" visible: ${btnVisible}`);
  await generarBtn.click({ timeout: 5_000 }).catch(() => console.error('[iceberg] click Generar Recibo falló'));

  // Esperar lo que llegue primero: nueva pestaña o descarga directa
  let pdfBuffer: Buffer | undefined;
  try {
    const result = await Promise.race([
      newPagePromise.then(async (pdfPage) => {
        console.log('[iceberg] nueva pestaña de recibo abierta');
        await pdfPage.waitForLoadState('domcontentloaded', { timeout: 15_000 });

        if (debug) {
          const p = path.join(DEBUG_DIR, `07-pdf-tab-${menuName.replace(/\s+/g, '_')}.png`);
          await pdfPage.screenshot({ path: p, fullPage: true }).catch(() => {});
          debugFiles.push(p);
        }

        const pdfUrl = pdfPage.url();
        const pdfBytes = await pdfPage.evaluate(async (url: string) => {
          const res = await fetch(url, { credentials: 'include' });
          const buf = await res.arrayBuffer();
          return Array.from(new Uint8Array(buf));
        }, pdfUrl);
        await pdfPage.close().catch(() => {});
        return Buffer.from(pdfBytes);
      }),
      downloadPromise.then(async (download) => {
        console.log('[iceberg] descarga directa detectada');
        const buffer = await download.createReadStream().then((stream: any) =>
          new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
          })
        );
        return buffer;
      }),
    ]);
    pdfBuffer = result;
  } catch {
    console.error(`[iceberg] error esperando PDF en menú ${menuName}`);
    return { found: true, error: 'No se pudo obtener el PDF del portal' };
  }

  if (!pdfBuffer || pdfBuffer.length === 0) {
    return { found: true, error: 'PDF vacío o no recibido' };
  }

  if (debug) {
    const p = path.join(DEBUG_DIR, `08-recibo-${menuName.replace(/\s+/g, '_')}.pdf`);
    await fs.writeFile(p, pdfBuffer);
    debugFiles.push(p);
  }

  return { found: true, pdf: pdfBuffer, matriculas };
}

/**
 * Intenta hacer login en el portal Iceberg.
 */
export async function loginAndDownloadReceipt(
  codigo: string,
  cedula: string,
  options: { debug?: boolean; headless?: boolean } = {}
): Promise<IcebergLoginResult> {
  const start = Date.now();
  try {
    const result = await loginAndDownloadReceiptInternal(codigo, cedula, options);
    const outcome: 'success' | 'error' | 'no_recibos' = !result.ok
      ? 'error'
      : result.noRecibos
        ? 'no_recibos'
        : 'success';
    observeReciboLatency(outcome, (Date.now() - start) / 1000);
    return result;
  } catch (err) {
    observeReciboLatency('error', (Date.now() - start) / 1000);
    throw err;
  }
}

async function loginAndDownloadReceiptInternal(
  codigo: string,
  cedula: string,
  options: { debug?: boolean; headless?: boolean } = {}
): Promise<IcebergLoginResult> {
  const debug = options.debug ?? false;
  const headless = options.headless ?? true;
  const debugFiles: string[] = [];
  const captchaAttempts: Array<{ solver: 'openai' | 'tesseract'; text: string }> = [];

  if (debug) await ensureDebugDir();

  const browser: Browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    });
    const page: Page = await context.newPage();

    // 1. Cargar portal
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    if (debug) {
      const p = path.join(DEBUG_DIR, '01-portal-loaded.png');
      await page.screenshot({ path: p, fullPage: true });
      debugFiles.push(p);
    }

    // 2. Llenar credenciales
    await page.locator('input[type="text"]').first().fill(codigo);
    await page.locator('input[type="password"]').fill(cedula);

    // 3. Loop de captcha
    let loggedIn = false;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRIES; attempt++) {
      // Descargar imagen del captcha actual
      const captchaBuffer = await downloadCaptchaImage(page);

      if (debug) {
        const p = path.join(DEBUG_DIR, `03-captcha-attempt-${attempt}.jpeg`);
        await fs.writeFile(p, captchaBuffer);
        debugFiles.push(p);
      }

      // Intentar primero con OpenAI, fallback a Tesseract
      let captchaText: string | null = await solveCaptchaWithOpenAI(captchaBuffer);
      let solver: 'openai' | 'tesseract' = 'openai';

      if (!captchaText || captchaText.length < 4) {
        console.log(`[iceberg] OpenAI falló o vacío, fallback a Tesseract`);
        captchaText = await solveCaptchaWithTesseract(captchaBuffer);
        solver = 'tesseract';
      }

      captchaAttempts.push({ solver, text: captchaText });
      console.log(`[iceberg] intento ${attempt}: solver=${solver}, longitud=${captchaText?.length ?? 0}`);

      if (!captchaText || captchaText.length < 3) {
        lastError = `OCR devolvió texto muy corto`;
        await refreshCaptcha(page);
        continue;
      }

      // Llenar captcha y enviar
      const captchaInput = page.locator('input[placeholder*="Captcha"]');
      await captchaInput.fill('');
      await captchaInput.fill(captchaText);

      await page.locator('button:has-text("Ingresar")').first().click();
      await page.waitForTimeout(2500); // esperar respuesta del servidor

      if (debug) {
        const p = path.join(DEBUG_DIR, `04-after-attempt-${attempt}.png`);
        await page.screenshot({ path: p, fullPage: true });
        debugFiles.push(p);
      }

      // Detectar resultado
      if (debug) {
        const maskVisible = await page.locator('.z-modal-mask').first().isVisible().catch(() => false);
        if (maskVisible) {
          const p = path.join(DEBUG_DIR, `04b-modal-attempt-${attempt}.png`);
          await page.screenshot({ path: p, fullPage: true });
          debugFiles.push(p);
        }
      }
      const errorModalDismissed = await dismissErrorModalIfPresent(page);
      const stillSeesCaptcha = await page
        .locator('input[placeholder*="Captcha"]')
        .isVisible()
        .catch(() => false);

      if (errorModalDismissed || stillSeesCaptcha) {
        lastError = 'Captcha o credenciales incorrectos';
        // Limpiar campo captcha y refrescar imagen
        await captchaInput.fill('').catch(() => {});
        await refreshCaptcha(page);
        continue;
      }

      // Login exitoso
      loggedIn = true;
      break;
    }

    if (!loggedIn) {
      return {
        ok: false,
        error: `Login falló tras ${MAX_CAPTCHA_RETRIES} intentos. Último error: ${lastError}`,
        captchaAttempts,
        debugFiles,
      };
    }

    // 4. Login OK
    if (debug) {
      const p = path.join(DEBUG_DIR, '05-logged-in.png');
      await page.screenshot({ path: p, fullPage: true });
      debugFiles.push(p);
      await fs.writeFile(path.join(DEBUG_DIR, '05-logged-in.html'), await page.content());
    }

    // Extraer "[CEDULA, NOMBRE COMPLETO]" del banner superior derecho
    let nombre: string | undefined;
    let cedulaExtraida: string | undefined;
    try {
      const bannerText = await page.locator('text=/\\[\\d+,\\s*[^\\]]+\\]/').first().textContent({ timeout: 5_000 });
      const match = bannerText?.match(/\[(\d+),\s*([^\]]+)\]/);
      if (match) {
        cedulaExtraida = match[1].trim();
        nombre = match[2].trim();
      }
    } catch {
      // no crítico — seguimos sin nombre
    }

    // 5. Recorrer menús buscando recibos disponibles
    let pdf: Buffer | undefined;
    let menuUsado: string | undefined;
    let downloadError: string | undefined;

    let matriculas: MatriculaFecha[] | undefined;

    for (const menu of MENUS_RECIBOS) {
      console.log(`[iceberg] revisando menú: ${menu}`);
      const r = await tryDownloadFromMenu(page, menu, debug, debugFiles);
      if (r.pdf) {
        pdf = r.pdf;
        menuUsado = menu;
        matriculas = r.matriculas;
        break;
      }
      if (r.found && r.error) {
        downloadError = r.error;
        menuUsado = menu;
        break;
      }
    }

    if (pdf) {
      return { ok: true, nombre, cedula: cedulaExtraida, pdf, menuUsado, matriculas, captchaAttempts, debugFiles };
    }

    if (downloadError) {
      return { ok: false, error: downloadError, nombre, cedula: cedulaExtraida, menuUsado, captchaAttempts, debugFiles };
    }

    // No había registros en ningún menú
    return { ok: true, nombre, cedula: cedulaExtraida, noRecibos: true, captchaAttempts, debugFiles };
  } catch {
    return {
      ok: false,
      error: 'No se pudo completar la consulta del portal',
      captchaAttempts,
      debugFiles,
    };
  } finally {
    await browser.close();
  }
}
