/* QA visual con el servidor mock: todas las pantallas, datos sintéticos. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROUTES = [
  'home', 'turno', 'recibo', 'metricas', 'conversaciones', 'posgrados',
  'registros', 'evento-posgrado', 'recordatorios', 'health', 'usuarios', 'actividad',
];

(async () => {
  const failures = [];
  for (const width of [375, 800, 1280]) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    });
    try {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      for (const route of ROUTES) {
        const errors = [];
        const onError = error => errors.push(error.stack ?? error.message);
        page.on('pageerror', onError);
        try {
          await page.goto(`http://localhost:4599/app/index.html?qa=${route}-${width}#${route}`);
          await page.locator('#main h1').waitFor();
          await page.waitForTimeout(600);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          const alert = await page.locator('#main .alert-error').allTextContents();
          if (overflow || errors.length || alert.length) {
            failures.push({ route, width, overflow, errors, alert });
          }
          if (width !== 800) await page.screenshot({ path: `tmp/qa-all-${route}-${width}.png`, fullPage: true });
          console.log(`${route} ${width}px: ${overflow || errors.length || alert.length ? 'REVISAR' : 'OK'}`);
        } finally {
          page.off('pageerror', onError);
        }
      }
      await page.close();
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(failures, []);
})().catch(error => { console.error(error); process.exitCode = 1; });
