/* Llamadas y Agenda a 375, 800 y 1280 píxeles, contra el mock
   (node tools/mock-panel-server.cjs; QA_BASE_URL si corre en otro puerto).
   Revisa: que la barra de pestañas no tape el estado del simulador, que una
   cita sin nombre diga «Sin nombre · ****0101», que «Marcar devuelta» abra el
   diálogo del panel (foco, Escape, envío) y no window.prompt, que no haya
   desbordes ni botones por debajo de 44 px. Con QA_CAPTURAS=<carpeta> guarda
   capturas con el prefijo QA_PREFIJO (por defecto «qa»).
   Marca una devolución como hecha: reiniciar el mock antes de repetirla. */
const { chromium } = require('playwright');
const path = require('node:path');

const BASE = process.env.QA_BASE_URL || 'http://localhost:4599';
const PANEL = `${BASE}/app/index.html`;
const CAPTURAS = process.env.QA_CAPTURAS || '';
const PREFIJO = process.env.QA_PREFIJO || 'qa';
const fallos = [];

function revisar(condicion, mensaje, detalle) {
  if (condicion) return;
  fallos.push(detalle === undefined ? mensaje : `${mensaje}: ${JSON.stringify(detalle)}`);
  console.log(`  FALLA ${mensaje}${detalle === undefined ? '' : ` ${JSON.stringify(detalle)}`}`);
}

async function captura(page, nombre, fullPage = false) {
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, `${PREFIJO}-${nombre}.png`), fullPage });
}

/* Desborde horizontal del documento o de #main. */
const desborda = () => document.documentElement.scrollWidth > innerWidth + 1
  || document.querySelector('#main').scrollWidth > document.querySelector('#main').clientWidth + 1;

/* Botones visibles de #main con alto entre 30 y 43.5 px (los chicos a
   propósito, como chips de 28 px, quedan fuera). */
const botonesBajos = () => [...document.querySelectorAll('#main .btn, #main button')]
  .filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
  .map(b => ({ t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30), h: Math.round(b.getBoundingClientRect().height * 10) / 10 }))
  .filter(b => b.h >= 30 && b.h < 43.5);

/* Textos recortados: un elemento hoja cuyo contenido se sale de su caja sin
   puntos suspensivos a propósito. */
const recortados = () => [...document.querySelectorAll('#main *')]
  .filter(el => el.children.length === 0 && el.getClientRects().length && el.textContent.trim() && !el.closest('.sr-only'))
  .filter(el => {
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis') return false;
    return el.scrollWidth > el.clientWidth + 1 && (cs.overflow === 'hidden' || cs.overflowX === 'hidden');
  })
  .map(el => el.textContent.trim().slice(0, 40));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined });
  const errores = [];
  try {
    for (const ancho of [375, 800, 1280]) {
      console.log(`— ${ancho} px`);
      const movil = ancho < 720;
      const page = await browser.newPage({ viewport: { width: ancho, height: movil ? 812 : 900 }, hasTouch: movil, isMobile: movil });
      page.on('pageerror', e => errores.push(`${ancho}: ${e.message}`));
      let promptAbierto = false;
      page.on('dialog', d => { promptAbierto = true; d.dismiss(); });

      /* ── Llamadas ── */
      await page.goto(`${PANEL}#llamadas`);
      await page.locator('#vozDevoluciones button[data-devolver]').first().waitFor();
      await page.locator('#vozRegistro details').first().waitFor();
      await page.waitForTimeout(400);
      revisar(!(await page.evaluate(desborda)), `${ancho} Llamadas sin desborde horizontal`);
      revisar((await page.evaluate(recortados)).length === 0, `${ancho} Llamadas sin texto recortado`, await page.evaluate(recortados));
      if (ancho >= 720) revisar((await page.evaluate(botonesBajos)).length === 0, `${ancho} Llamadas botones de 44 px`, await page.evaluate(botonesBajos));
      await captura(page, `llamadas-${ancho}-pagina`, true);

      // Simulador: «Fase: …» y el campo deben quedar sobre la barra de pestañas
      // tras iniciar (el foco va al campo y el navegador desplaza la página),
      // tras decir algo y tras un silencio. Se pulsa sin que Playwright
      // desplace antes: el botón se deja arriba de la pantalla.
      const tapado = () => page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const barra = document.querySelector('.tab-bar');
        const tope = barra && barra.getClientRects().length ? barra.getBoundingClientRect().top : innerHeight;
        return { faseArriba: Math.round(r('#simEstado').top), faseAbajo: Math.round(r('#simEstado').bottom), campoAbajo: Math.round(r('#simTexto').bottom), barraArriba: Math.round(tope) };
      });
      const visible = (t) => t.faseArriba >= 0 && t.faseAbajo <= t.barraArriba && t.campoAbajo <= t.barraArriba;
      // Caso difícil: «Iniciar» justo encima de la barra (o del borde inferior),
      // como cuando se baja la página hasta verlo y se toca.
      await page.evaluate(() => {
        const b = document.querySelector('#simIniciar');
        b.scrollIntoView({ block: 'start' });
        const barra = document.querySelector('.tab-bar');
        const tope = barra && barra.getClientRects().length ? barra.getBoundingClientRect().top : innerHeight;
        scrollBy(0, b.getBoundingClientRect().bottom - tope + 8);
      });
      await page.evaluate(() => document.querySelector('#simIniciar').click());
      await page.locator('#simEstado').filter({ hasText: 'Fase:' }).waitFor();
      await page.waitForTimeout(400);
      let t = await tapado();
      revisar(visible(t), `${ancho} tras iniciar, «Fase:» y el campo quedan sobre la barra`, t);
      await captura(page, `llamadas-${ancho}-simulador-inicio`);
      await page.locator('#simTexto').fill('Hola, quiero información de la maestría');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('#simLog .voz-linea').length >= 3);
      await page.waitForTimeout(500);
      t = await tapado();
      revisar(visible(t), `${ancho} tras decir, «Fase:» y el campo quedan sobre la barra`, t);
      revisar(await page.locator('#simTexto').evaluate(el => document.activeElement === el), `${ancho} el foco sigue en el campo del simulador`);
      await captura(page, `llamadas-${ancho}-simulador`);
      const lineas = await page.locator('#simLog .voz-linea').count();
      await page.evaluate(() => document.querySelector('#simSilencio').click());
      await page.waitForFunction(n => document.querySelectorAll('#simLog .voz-linea').length > n, lineas);
      await page.waitForTimeout(400);
      t = await tapado();
      revisar(visible(t), `${ancho} tras un silencio, «Fase:» queda sobre la barra`, t);
      // Al final de la página también debe quedar todo por encima de la barra.
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(200);
      const finVisible = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#main .card')];
        const ultima = cards[cards.length - 1].getBoundingClientRect();
        const barra = document.querySelector('.tab-bar');
        const tope = barra && barra.getClientRects().length ? barra.getBoundingClientRect().top : innerHeight;
        return { ultimaAbajo: Math.round(ultima.bottom), barraArriba: Math.round(tope) };
      });
      revisar(finVisible.ultimaAbajo <= finVisible.barraArriba, `${ancho} la última tarjeta termina sobre la barra`, finVisible);
      await captura(page, `llamadas-${ancho}-final`);
      await page.locator('#simColgar').click().catch(() => {});

      // Marcar devuelta: diálogo propio, foco dentro, Escape cierra y devuelve el foco.
      const boton = page.locator('#vozDevoluciones button[data-devolver]').first();
      await boton.scrollIntoViewIfNeeded();
      await boton.click();
      const dialogo = page.locator('[role="dialog"][aria-modal="true"]');
      await dialogo.waitFor({ timeout: 2000 }).catch(() => {});
      revisar(!promptAbierto, `${ancho} «Marcar devuelta» no usa window.prompt`);
      revisar(await dialogo.isVisible(), `${ancho} «Marcar devuelta» abre el diálogo del panel`);
      if (await dialogo.isVisible()) {
        await page.waitForTimeout(150);
        revisar(await page.evaluate(() => document.activeElement?.id === 'devNota'), `${ancho} el foco va a la nota`);
        revisar(await dialogo.getAttribute('aria-labelledby') !== null, `${ancho} el diálogo tiene título accesible`);
        revisar(await page.evaluate(() => document.querySelector('label[for="devNota"]') !== null), `${ancho} la nota tiene etiqueta`);
        revisar(!(await page.evaluate(desborda)), `${ancho} diálogo sin desborde`);
        const bajosDlg = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] .btn')].map(b => Math.round(b.getBoundingClientRect().height)).filter(h => h < 44));
        revisar(bajosDlg.length === 0, `${ancho} botones del diálogo de 44 px`, bajosDlg);
        await captura(page, `llamadas-${ancho}-devuelta-dialogo`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        revisar(!(await dialogo.isVisible()), `${ancho} Escape cierra el diálogo`);
        revisar(await page.evaluate(() => document.activeElement?.hasAttribute('data-devolver')), `${ancho} el foco vuelve a «Marcar devuelta»`);
        if (ancho === 1280) {
          // Envío real con nota: la devolución desaparece de la cola.
          const antes = await page.locator('#vozDevoluciones button[data-devolver]').count();
          await boton.click();
          await dialogo.waitFor();
          await page.locator('#devNota').fill('Le devolví la llamada; pidió el folleto.');
          await page.locator('#devGuardar').click();
          await dialogo.waitFor({ state: 'detached' });
          await page.waitForFunction(n => document.querySelectorAll('#vozDevoluciones button[data-devolver]').length < n, antes);
          revisar(true, 'envío');
        }
      }
      await page.evaluate(() => scrollTo(0, 0));

      /* ── Agenda ── */
      await page.goto(`${PANEL}#agenda`);
      await page.locator('#agContenido [data-cita]').first().waitFor();
      await page.waitForTimeout(400);
      const textos = await page.locator('#agContenido [data-cita] strong').allTextContents();
      revisar(textos.includes('Sin nombre · ****0101'), `${ancho} Agenda día: cita sin nombre`, textos);
      revisar(!(await page.evaluate(desborda)), `${ancho} Agenda sin desborde`);
      revisar((await page.evaluate(recortados)).length === 0, `${ancho} Agenda sin texto recortado`, await page.evaluate(recortados));
      if (ancho >= 720) revisar((await page.evaluate(botonesBajos)).length === 0, `${ancho} Agenda botones de 44 px`, await page.evaluate(botonesBajos));
      await captura(page, `agenda-${ancho}-dia`, true);
      await page.locator('#agContenido [data-cita]', { hasText: '****0101' }).click();
      await page.locator('.action-sheet').waitFor();
      await page.waitForTimeout(350);
      const hoja = await page.evaluate(() => ({
        titulo: document.querySelector('.action-sheet .sheet-title')?.textContent,
        label: document.querySelector('.action-sheet')?.getAttribute('aria-label'),
        cabecera: document.querySelector('.ag-detalle-cabecera strong')?.textContent,
        persona: [...document.querySelectorAll('.ag-detalle dl > div')].find(d => d.querySelector('dt')?.textContent === 'Persona')?.querySelector('dd')?.textContent,
      }));
      revisar(hoja.titulo === 'Sin nombre · ****0101' && hoja.label === 'Sin nombre · ****0101', `${ancho} hoja de la cita: título`, hoja);
      revisar(hoja.cabecera === 'Sin nombre · ****0101', `${ancho} detalle de la cita: cabecera`, hoja);
      revisar(hoja.persona === 'Sin nombre', `${ancho} detalle de la cita: Persona`, hoja);
      await captura(page, `agenda-${ancho}-detalle`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      // Vista de semana.
      await page.locator('#agVistaWrap button', { hasText: 'Semana' }).first().click();
      await page.locator('.ag-semana').waitFor();
      await page.waitForTimeout(400);
      const semana = await page.locator('.ag-semana [data-cita] strong').allTextContents();
      revisar(semana.includes('Sin nombre · ****0101'), `${ancho} Agenda semana: cita sin nombre`, semana);
      revisar(!(await page.evaluate(desborda)), `${ancho} Agenda semana sin desborde`);
      if (ancho >= 720) revisar((await page.evaluate(botonesBajos)).length === 0, `${ancho} Agenda semana botones de 44 px`, await page.evaluate(botonesBajos));
      await captura(page, `agenda-${ancho}-semana`, true);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  revisar(errores.length === 0, 'sin errores de JavaScript', errores);
  console.log(fallos.length ? `\n${fallos.length} fallos` : '\nTodo bien');
  process.exitCode = fallos.length ? 1 : 0;
})();
