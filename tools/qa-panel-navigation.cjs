/* Cambiar de pantalla durante cargas lentas no debe dejar errores de JavaScript. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROUTES = [
  'home', 'metricas', 'conversaciones', 'posgrados', 'registros',
  'evento-posgrado', 'recordatorios', 'health', 'usuarios', 'actividad',
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  });
  try {
    const failures = [];
    for (const route of ROUTES) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/tools/**', async request => {
        await new Promise(resolve => setTimeout(resolve, 400));
        await request.continue();
      });
      await page.route('**/health/deep', async request => {
        await new Promise(resolve => setTimeout(resolve, 400));
        await request.continue();
      });
      await page.goto(`http://localhost:4599/app/index.html#${route}`);
      await page.locator('#main h1').waitFor();
      if (route !== 'home') {
        await page.locator('#tabBar .tab-item[data-tab="home"]').click();
        await page.waitForFunction(() => location.hash === '#home');
      } else {
        await page.locator('#tabBar .tab-item[data-tab="turno"]').click();
        await page.waitForFunction(() => location.hash === '#turno');
      }
      await page.waitForTimeout(1000);
      if (errors.length) failures.push({ route, errors });
      console.log(`${route}: ${errors.length ? errors.join(' | ') : 'OK'}`);
      await page.close();
    }
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
