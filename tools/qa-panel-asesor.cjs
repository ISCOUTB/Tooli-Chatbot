/* Ejecutar con MOCK_ROL=asesor node tools/mock-panel-server.cjs. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:4599/app/index.html#registros');
    await page.locator('#regContent .crm-card[data-row]').first().waitFor();
    assert.equal(await page.locator('#toggleSelectMode').count(), 0);
    assert.equal(await page.locator('#nav [data-route="usuarios"]').count(), 0);
    assert.equal(await page.locator('#nav [data-route="health"]').count(), 0);
    await page.goto('http://localhost:4599/app/index.html#usuarios');
    await page.waitForFunction(() => location.hash === '#home');
    await page.goto('http://localhost:4599/app/index.html#actividad');
    await page.waitForFunction(() => location.hash === '#home');
    await page.goto('http://localhost:4599/app/index.html#health');
    await page.waitForFunction(() => location.hash === '#home');
    assert.deepEqual(errors, []);
    console.log('Asesor: sin envío masivo ni vistas administrativas; acceso directo redirige a Inicio OK');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
