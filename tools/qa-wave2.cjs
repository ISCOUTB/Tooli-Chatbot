/* QA local de la segunda ola contra tools/mock-panel-server.cjs. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined,
  });
  try {
    for (const width of [375, 800, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.stack ?? error.message));
      await page.goto('http://localhost:4599/app/index.html#registros');
      await page.locator('#crmSegResumen').filter({ hasText: '5 prospectos' }).waitFor();
      assert.match(await page.locator('#crmSegResumen').innerText(), /2 Pregrado · 3 Posgrado/);
      assert.equal(await page.locator('#crmFilterWrap [role="radiogroup"]').count(), 1);
      assert.equal(await page.locator('#crmFilterWrap [role="radio"][aria-checked="true"]').count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `CRM overflow a ${width}px`);
      await page.screenshot({ path: `tmp/qa-wave2-crm-${width}.png`, fullPage: true });

      await page.goto('http://localhost:4599/app/index.html#evento-posgrado');
      await page.locator('#eventoResumen').filter({ hasText: '3 registros' }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Evento overflow a ${width}px`);
      await page.screenshot({ path: `tmp/qa-wave2-evento-${width}.png`, fullPage: true });

      await page.goto('http://localhost:4599/app/index.html#posgrados');
      await page.locator('.op-contexto').waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Posgrados overflow a ${width}px`);
      await page.screenshot({ path: `tmp/qa-wave2-posgrados-${width}.png`, fullPage: true });

      await page.goto('http://localhost:4599/app/index.html#health');
      await page.locator('#inboundReviews').filter({ hasText: 'Mensajes por revisar · 1' }).waitFor();
      assert.equal(await page.locator('#inboundReviews button[data-review-id]').count(), 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Estado overflow a ${width}px`);
      await page.screenshot({ path: `tmp/qa-wave2-health-${width}.png`, fullPage: true });
      assert.deepEqual(errors, [], `errores JS a ${width}px`);
      await page.close();
      console.log(`Panel ${width}px: CRM, evento, Posgrados y Estado OK`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
