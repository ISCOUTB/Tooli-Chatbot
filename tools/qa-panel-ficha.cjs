/* Ficha de la persona, resumen con IA y plantilla desde el chat de Atención,
   contra el mock (PORT=4599 node tools/mock-panel-server.cjs). Guarda capturas
   en QA_CAPTURAS si se indica. Uso: node tools/qa-panel-ficha.cjs */
const { chromium } = require('playwright');
const path = require('node:path');

const PANEL = 'http://localhost:4599/app/index.html';
const CAPTURAS = process.env.QA_CAPTURAS || '';
const fallos = [];

function revisar(condicion, mensaje, detalle) {
  if (condicion) return;
  fallos.push(detalle === undefined ? mensaje : `${mensaje}: ${JSON.stringify(detalle)}`);
  console.log(`  FALLA ${mensaje}${detalle === undefined ? '' : ` ${JSON.stringify(detalle)}`}`);
}

async function captura(page, nombre) {
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) });
}

async function abrir(page, id) {
  await page.locator(`.atn-row[data-id="${id}"]`).click();
  await page.locator('#atnMensajes').waitFor();
}

async function irA(page, estado = 'open') {
  await page.goto(`${PANEL}#atencion${estado === 'open' ? '' : `?estado=${estado}`}`);
  await page.locator('.atn-row').first().waitFor();
}

const desborda = () => document.documentElement.scrollWidth > window.innerWidth + 1
  || [...document.querySelectorAll('#atnFicha *')].some(el => el.getBoundingClientRect().right > window.innerWidth + 1);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined });
  const errores = [];

  /* Escritorio ancho: la ficha es una columna y abre sola la primera vez. */
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => errores.push(`1440: ${e.message}`));
    await irA(page);
    await abrir(page, 101);
    await page.locator('#atnFicha .atn-ficha-resumen li').first().waitFor({ timeout: 5000 });
    const ficha = await page.locator('#atnFicha').innerText();
    for (const texto of ['Egresada de la UTB', 'María José Restrepo', 'Maestría en Ingeniería', 'Interesado', 'Feria de posgrados 2026', 'gracias_por_asistir', 'Puedes escribirle']) {
      revisar(ficha.includes(texto), `ficha 101 muestra «${texto}»`);
    }
    revisar(!(await page.locator('#atnVentana').isVisible()), 'con la ventana abierta no hay aviso de 24 h');
    const columnas = await page.evaluate(() => {
      const hilo = document.querySelector('#atnHilo').getBoundingClientRect();
      const ficha = document.querySelector('#atnFicha').getBoundingClientRect();
      return { hiloDerecha: hilo.right, fichaIzquierda: ficha.left, fichaAncho: ficha.width };
    });
    revisar(columnas.fichaIzquierda >= columnas.hiloDerecha, 'en 1440 px la ficha va al lado del chat, sin taparlo', columnas);
    const cabecera = await page.evaluate(() => {
      const info = document.querySelector('.atn-cabecera-info').getBoundingClientRect();
      const acciones = document.querySelector('.atn-acciones').getBoundingClientRect();
      return { info: Math.round(info.width), separadas: info.right <= acciones.left + 1 };
    });
    revisar(cabecera.info >= 90 && cabecera.separadas, 'con la ficha abierta el nombre se ve y los botones no lo tapan', cabecera);
    revisar(!(await page.evaluate(desborda)), '1440 sin desborde');
    await captura(page, 'ficha-1440');

    // Actualizar el resumen lo vuelve a pedir.
    await page.locator('[data-resumen="actualizar"]').click();
    await page.locator('#atnFicha .atn-ficha-resumen[aria-busy], #atnFicha [aria-busy="true"]').first().waitFor({ timeout: 2000 }).catch(() => {});
    await page.locator('#atnFicha .atn-ficha-resumen li').first().waitFor({ timeout: 5000 });
    revisar((await page.locator('#atnFicha').innerText()).includes('hace un momento'), 'el resumen actualizado dice que es nuevo');

    /* Conversación con la ventana cerrada: aviso, plantilla y nota. */
    await irA(page, 'pending');
    await abrir(page, 104);
    await page.locator('#atnVentana .atn-enviar-plantilla').waitFor({ timeout: 5000 });
    const aviso = await page.locator('#atnVentana').innerText();
    revisar(/Pasaron más de 24 horas/.test(aviso), 'aviso de 24 h con la ventana cerrada', aviso);
    const ficha104 = await page.locator('#atnFicha').innerText();
    revisar(ficha104.includes('Pidió no recibir campañas'), 'la ficha avisa que pidió no recibir campañas');
    revisar(ficha104.includes('No se pudo consultar: CRM'), 'la ficha nombra la fuente que no respondió');
    revisar(ficha104.includes('No se envió'), 'la ficha muestra la plantilla que falló');
    const sellos = await page.evaluate(() => {
      const panel = document.querySelector('#atnFicha .atn-ficha-cuerpo').getBoundingClientRect();
      return [...document.querySelectorAll('#atnFicha .badge')].map(b => b.getBoundingClientRect().right - panel.right).filter(d => d > 1);
    });
    revisar(!sellos.length, 'los sellos de la ficha caben en la columna', sellos);
    await captura(page, 'ventana-cerrada-1440');

    // Texto libre fuera de la ventana: el servidor lo rechaza y el aviso sigue.
    await page.locator('#atnTexto').fill('Hola Andrés');
    await page.locator('#atnEnviar').click();
    await page.waitForFunction(() => /24 horas/.test(document.querySelector('#atnPista')?.textContent ?? ''));
    revisar(await page.locator('#atnVentana').isVisible(), 'tras el rechazo el aviso sigue a la vista');

    await page.locator('#atnVentana .atn-enviar-plantilla').click();
    await page.locator('#eptPlantilla').waitFor();
    const opciones = await page.locator('#eptPlantilla option').allInnerTexts();
    revisar(opciones.length === 6 && !opciones.some(o => /recordatorio_entrevista|descuento_matricula/.test(o)), 'solo se ofrecen plantillas aprobadas', opciones);
    revisar(/aviso_academico_demo/.test(opciones[0]), 'las de utilidad van primero', opciones[0]);

    await page.locator('#eptPlantilla').selectOption({ label: 'campana_posgrado_pregrado · es_CO' });
    revisar(await page.locator('#eptVar_cuerpo_1').inputValue() === 'Andrés', 'el primer nombre ya viene puesto');
    revisar(await page.locator('.dialogo-cuerpo .alert-warning').isVisible(), 'advierte que es de marketing y pidió no recibir campañas');

    await page.locator('#eptPlantilla').selectOption({ label: 'vehiculo_listo · es' });
    revisar(await page.locator('#eptEnviar').isDisabled(), 'sin llenar los datos no se puede enviar');
    await page.locator('#eptVar_cuerpo_1').fill('77');
    revisar((await page.locator('#eptPrevia').innerText()).includes('#77'), 'la vista previa usa lo escrito');
    revisar(await page.locator('#eptEnviar').isEnabled(), 'con los datos llenos se puede enviar');
    await page.waitForTimeout(600);
    await captura(page, 'enviar-plantilla-1440');
    await page.locator('#eptEnviar').click();
    await page.locator('.password-dialog').waitFor({ state: 'detached', timeout: 10000 });
    await page.waitForFunction(() => /Plantilla «vehiculo_listo» enviada/.test(document.querySelector('#atnMensajes')?.innerText ?? ''), null, { timeout: 5000 })
      .catch(() => revisar(false, 'queda la nota privada con la plantilla enviada'));
    await page.waitForFunction(() => /vehiculo_listo/.test(document.querySelector('#atnFicha')?.innerText ?? ''), null, { timeout: 5000 })
      .catch(() => revisar(false, 'la ficha suma la plantilla enviada'));

    // Repetir el mismo envío no lo duplica.
    await page.locator('#atnVentana .atn-enviar-plantilla').click();
    await page.locator('#eptPlantilla').selectOption({ label: 'vehiculo_listo · es' });
    await page.locator('#eptVar_cuerpo_1').fill('77');
    await page.locator('#eptEnviar').click();
    await page.locator('#eptEstado .alert-info').waitFor({ timeout: 5000 });
    revisar(/no se volvió a enviar/.test(await page.locator('#eptEstado').innerText()), 'un envío repetido se avisa');
    await page.keyboard.press('Escape');

    // Cerrar la ficha se recuerda.
    await page.locator('#atnFichaBtn').click();
    revisar(await page.locator('#atnFicha').isHidden(), 'el botón Ficha la cierra');
    await irA(page);
    await abrir(page, 101);
    await page.waitForTimeout(500);
    revisar(await page.locator('#atnFicha').isHidden(), 'la ficha cerrada sigue cerrada al volver');
    await page.locator('#atnFichaBtn').click();
    await page.locator('#atnFicha .atn-ficha-resumen').first().waitFor();
    revisar(await page.locator('#atnFichaBtn').getAttribute('aria-expanded') === 'true', 'el botón dice que la ficha está abierta');
    await page.close();
  }

  /* Escritorio angosto: la ficha se superpone al chat. */
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    page.on('pageerror', e => errores.push(`1100: ${e.message}`));
    await irA(page);
    await abrir(page, 101);
    revisar(await page.locator('#atnFicha').isHidden(), 'en pantallas angostas la ficha no abre sola');
    await page.locator('#atnFichaBtn').click();
    await page.locator('#atnFicha .atn-ficha-resumen li').first().waitFor({ timeout: 5000 });
    const pos = await page.evaluate(() => ({
      position: getComputedStyle(document.querySelector('#atnFicha')).position,
      fichaArriba: document.querySelector('#atnFicha').getBoundingClientRect().top,
      cabeceraAbajo: document.querySelector('#atnCabecera').getBoundingClientRect().bottom,
    }));
    revisar(pos.position === 'absolute', 'en 1100 px la ficha se superpone', pos);
    revisar(pos.fichaArriba >= pos.cabeceraAbajo - 1, 'superpuesta, deja libre la cabecera del chat', pos);
    revisar(await page.locator('.atn-cabecera [data-estado="resolved"]').isVisible(), 'Resolver sigue a la vista con la ficha abierta');
    revisar(!(await page.evaluate(desborda)), '1100 sin desborde');
    await captura(page, 'ficha-1100');
    await page.locator('#atnFicha .atn-ficha-cerrar').click();
    revisar(await page.locator('#atnFicha').isHidden(), 'la X cierra la ficha');
    await page.close();
  }

  /* Celular: la ficha sale de Detalles y ocupa la pantalla. */
  for (const [ancho, alto] of [[320, 568], [375, 812]]) {
    const page = await browser.newPage({ viewport: { width: ancho, height: alto }, isMobile: true, hasTouch: true });
    page.on('pageerror', e => errores.push(`${ancho}: ${e.message}`));
    await irA(page, 'pending');
    await abrir(page, 104);
    await page.locator('#atnVentana .atn-enviar-plantilla').waitFor({ timeout: 5000 });
    await page.waitForTimeout(450); // la entrada del aviso lleva un pequeño desplazamiento
    const caja = await page.evaluate(() => {
      const v = document.querySelector('#atnVentana').getBoundingClientRect();
      const f = document.querySelector('.inbox-thread-footer').getBoundingClientRect();
      return { ventanaAbajo: v.bottom, footerArriba: f.top, derecha: v.right };
    });
    revisar(caja.ventanaAbajo <= caja.footerArriba + 1 && caja.derecha <= ancho + 1, `${ancho}: el aviso queda encima de la caja de texto`, caja);
    revisar(!(await page.evaluate(desborda)), `${ancho}: sin desborde con el aviso`);
    await captura(page, `ventana-cerrada-${ancho}`);
    await page.locator('#atnDetalles').click();
    await page.locator('.atn-detalles .sheet-action', { hasText: 'Ficha' }).click();
    await page.locator('#atnFicha .atn-ficha-cuerpo').waitFor();
    await page.waitForTimeout(500);
    const tapa = await page.evaluate(() => {
      const r = document.querySelector('#atnFicha').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    revisar(tapa.x === 0 && tapa.y === 0 && tapa.w === ancho && tapa.h === alto, `${ancho}: la ficha ocupa la pantalla`, tapa);
    revisar(!(await page.evaluate(desborda)), `${ancho}: la ficha no desborda`);
    await captura(page, `ficha-${ancho}`);
    await page.locator('#atnFicha .atn-ficha-cerrar').click();
    revisar(await page.locator('#atnFicha').isHidden(), `${ancho}: la X vuelve al chat`);
    revisar(await page.locator('#atnMensajes').isVisible(), `${ancho}: el chat sigue ahí`);
    // La ventana de plantilla cabe en el celular.
    await page.locator('#atnVentana .atn-enviar-plantilla').click();
    await page.locator('#eptPlantilla').waitFor();
    revisar(!(await page.evaluate(() => document.querySelector('.password-dialog').scrollWidth > document.querySelector('.password-dialog').clientWidth + 1)), `${ancho}: la ventana de plantilla no desborda`);
    await page.waitForTimeout(600);
    await captura(page, `enviar-plantilla-${ancho}`);
    await page.close();
  }

  await browser.close();
  for (const e of errores) revisar(false, 'error de JavaScript', e);
  if (fallos.length) {
    console.log(`\nFicha: ${fallos.length} falla(s)`);
    process.exit(1);
  }
  console.log('Ficha, resumen y plantilla desde el chat: todo OK');
})();
