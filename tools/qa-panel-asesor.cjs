/* Ejecutar con MOCK_ROL=asesor node tools/mock-panel-server.cjs. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// QA_BASE_URL permite revisar un mock que corre en otro puerto (PORT=4602).
const BASE = process.env.QA_BASE_URL || 'http://localhost:4599';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${BASE}/app/index.html#registros`);
    await page.locator('#regContent .crm-card[data-row]').first().waitFor();
    // Enviar plantillas es parte del trabajo del asesor: la selección sí aparece.
    assert.equal(await page.locator('#toggleSelectMode').count(), 1);
    assert.equal(await page.locator('#openCampana').count(), 1);
    assert.equal(await page.locator('#nav [data-route="usuarios"]').count(), 0);
    assert.equal(await page.locator('#nav [data-route="health"]').count(), 0);
    await page.goto(`${BASE}/app/index.html#usuarios`);
    await page.waitForFunction(() => location.hash === '#home');
    await page.goto(`${BASE}/app/index.html#actividad`);
    await page.waitForFunction(() => location.hash === '#home');
    await page.goto(`${BASE}/app/index.html#informes`);
    await page.waitForFunction(() => location.hash === '#home');
    await page.goto(`${BASE}/app/index.html#health`);
    await page.waitForFunction(() => location.hash === '#home');
    assert.deepEqual(errors, []);
    console.log('Asesor: puede enviar plantillas; sin vistas administrativas, incluidos informes; acceso directo redirige a Inicio OK');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
