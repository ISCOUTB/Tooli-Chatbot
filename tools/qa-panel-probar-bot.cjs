/* QA del simulador de WhatsApp («Probar el bot») contra tools/mock-panel-server.cjs.
   Recorre la conversación del mock a 320, 375, 800 y 1280 px: lista desplegable con
   teclado, botones de respuesta rápida, imagen, nombre escrito, notas de prueba y
   «Empezar de nuevo». Comprueba que no haya desbordes, que los controles midan al
   menos 44 px, que las palomitas pasen a azul, que el chat no baje solo si se subió
   a leer y que la hoja de la lista atrape el foco y se cierre con Escape.
   Con QA_CAPTURAS=<carpeta> guarda capturas. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE_URL || 'http://localhost:4599';
const CAPTURAS = process.env.QA_CAPTURAS || '';
const ANCHOS = (process.env.QA_ANCHOS || '320,375,800,1280').split(',').map(Number);

async function desbordes(page) {
  return page.evaluate(() => {
    const main = document.querySelector('#main');
    const fuera = [...document.querySelectorAll('.wsim *')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).position === 'fixed') return false;
      return r.right > window.innerWidth + 1 || r.left < -1;
    }).slice(0, 5).map((el) => `${el.tagName}.${el.className}`);
    return {
      documento: document.documentElement.scrollWidth > window.innerWidth + 1,
      main: main.scrollWidth > main.clientWidth + 1,
      fuera,
    };
  });
}

async function chicos(page) {
  return page.evaluate(() => [...document.querySelectorAll(
    '.wsim .wsim-boton, .wsim .wsim-enviar, .wsim .wsim-rapida, .wsim .wsim-perfil, .wsim .wsim-reiniciar, .wsim .wsim-bajar:not(.hidden), .wsim-hoja button, .wsim-opcion',
  )].filter((el) => el.getClientRects().length).map((el) => {
    const r = el.getBoundingClientRect();
    return { el: `${el.className} «${el.textContent.trim().slice(0, 24)}»`, alto: Math.round(r.height), ancho: Math.round(r.width) };
  }).filter((x) => x.alto < 44 || x.ancho < 44));
}

const captura = async (page, nombre, opciones = {}) => {
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, `simulador-whatsapp-${nombre}.png`), ...opciones });
};

(async () => {
  const fallos = [];
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined });
  try {
    for (const ancho of ANCHOS) {
      const page = await browser.newPage({ viewport: { width: ancho, height: ancho < 720 ? 812 : 900 } });
      const errores = [];
      page.on('pageerror', (e) => errores.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
      const anota = (que, detalle) => fallos.push({ ancho, que, detalle });
      try {
        await page.goto(`${BASE}/app/index.html?qa=probar-bot-${ancho}#probar-bot`);
        await page.locator('#main h1').waitFor();
        await page.locator('#wsimBot .wsim-interruptores').waitFor();
        await captura(page, `${ancho}-vacio`, { fullPage: true });

        // 1. Escribir y enviar con Enter.
        const entrada = page.locator('#wsimTexto');
        await entrada.fill('Hola');
        await entrada.press('Enter');
        await page.locator('.wsim-boton-lista').first().waitFor();
        if (await page.locator('.wsim-fila.yo .wsim-ticks.leido').count() < 1) anota('palomitas', 'no pasaron a leído');

        // 2. La lista se abre como hoja, atrapa el foco, Escape la cierra y devuelve el foco.
        const botonLista = page.locator('.wsim-boton-lista').first();
        await botonLista.click();
        await page.locator('.wsim-hoja.abierta').waitFor();
        await page.waitForTimeout(350);
        if (!(await page.evaluate(() => document.querySelector('.wsim-hoja').contains(document.activeElement)))) anota('hoja', 'el foco no entró a la hoja');
        for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
        if (!(await page.evaluate(() => document.querySelector('.wsim-hoja').contains(document.activeElement)))) anota('hoja', 'Tab se escapó de la hoja');
        if (ancho === 375 || ancho === 1280) await captura(page, `${ancho}-lista`);
        await page.keyboard.press('Escape');
        await page.locator('.wsim-hoja').waitFor({ state: 'detached' });
        if (!(await page.evaluate(() => document.activeElement?.classList.contains('wsim-boton-lista')))) anota('hoja', 'el foco no volvió al botón');

        // 3. Elegir con el teclado: flechas dentro del grupo de radios y Enviar.
        await botonLista.click();
        await page.locator('.wsim-hoja.abierta').waitFor();
        await page.waitForTimeout(300);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.locator('.wsim-hoja-enviar:not([disabled])').click();
        await page.locator('.wsim-boton', { hasText: 'Maestría' }).waitFor();
        const elegido = await page.locator('.wsim-fila.yo').last().textContent();
        if (!/otra universidad/.test(elegido)) anota('lista', `la burbuja muestra «${elegido.trim()}» y no el título de la fila`);

        // 4. Botones de respuesta rápida, imagen y nombre.
        await page.locator('.wsim-boton', { hasText: 'Maestría' }).click();
        await page.locator('.wsim-imagen').waitFor();
        await page.locator('.wsim-boton', { hasText: 'Hablar con un asesor' }).last().click();
        await page.locator('.wsim-fila.bot', { hasText: 'nombre completo' }).waitFor();
        await entrada.fill('Laura Gómez Prueba');
        await page.locator('#wsimEnviar').click();
        await page.locator('.wsim-boton', { hasText: 'Una llamada' }).waitFor();

        // 5. Si subió a leer, la respuesta no lo baja: aparece el botón de «nuevos».
        const clic = page.locator('.wsim-boton', { hasText: 'Una llamada' }).last().click();
        // Mientras «escribiendo…» (el mock tarda MOCK_SIM_ESPERA_MS, 1200 ms por defecto) sube a leer.
        await page.locator('#wsimEscribiendo:not(.hidden)').waitFor();
        await page.waitForTimeout(500);
        await page.locator('#wsimHilo').evaluate((h) => { h.scrollTop = 0; });
        await clic;
        await page.locator('.wsim-nota', { hasText: 'Chatwoot' }).waitFor();
        await page.waitForTimeout(1600);
        const arriba = await page.locator('#wsimHilo').evaluate((h) => h.scrollTop);
        if (arriba > 40) anota('auto-scroll', `bajó solo a ${arriba}px aunque estaba leyendo arriba`);
        if (await page.locator('#wsimBajar.hidden').count()) anota('auto-scroll', 'no apareció el botón de mensajes nuevos');
        await page.locator('#wsimBajar').click();
        await page.waitForTimeout(500);
        if (!(await page.locator('#wsimHilo').evaluate((h) => h.scrollHeight - h.scrollTop - h.clientHeight < 100))) anota('auto-scroll', 'el botón no llevó al final');

        // 6. Una nota larga se despliega.
        await page.locator('.wsim-nota-detalle summary').last().click();
        if (!(await page.locator('.wsim-nota-detalle[open]').count())) anota('notas', 'la nota larga no se abre');

        const d = await desbordes(page);
        if (d.documento || d.main || d.fuera.length) anota('desborde', d);
        const pequenos = await chicos(page);
        if (pequenos.length) anota('objetivos táctiles < 44 px', pequenos);
        await captura(page, `${ancho}`, { fullPage: true });
        await page.locator('.wsim-telefono').screenshot(CAPTURAS ? { path: path.join(CAPTURAS, `simulador-whatsapp-${ancho}-chat.png`) } : {});

        // 7. Empezar de nuevo deja el chat vacío y el número por asignar.
        await page.locator('#wsimReiniciar').click();
        await page.waitForTimeout(300);
        if (await page.locator('#wsimLineas > *').count()) anota('reinicio', 'quedaron mensajes');
        if (!/Se asigna/.test(await page.locator('#wsimNumeroDato').textContent())) anota('reinicio', 'el número no se soltó');
        if (errores.length) anota('errores de consola', errores);
        console.log(`probar-bot ${ancho}px: ${fallos.some((f) => f.ancho === ancho) ? 'REVISAR' : 'OK'}`);
      } catch (err) {
        anota('excepción', err.message);
        await captura(page, `${ancho}-error`, { fullPage: true }).catch(() => {});
        console.log(`probar-bot ${ancho}px: ERROR ${err.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (fallos.length) console.log(JSON.stringify(fallos, null, 2));
  assert.deepEqual(fallos, []);
})().catch((err) => { console.error(err); process.exitCode = 1; });
