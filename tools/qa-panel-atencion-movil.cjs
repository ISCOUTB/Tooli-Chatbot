/* Atención en el celular: mide lo que promete la vista de una conversación
   abierta y recorre sus acciones contra el mock. Crea sus propias
   conversaciones, así que no hace falta reiniciar el mock entre corridas. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const PANEL = 'http://localhost:4599/app/index.html';
const TAMANOS = [[320, 568], [375, 667], [375, 812], [768, 1024], [812, 375]];
const fallos = [];

function revisar(condicion, mensaje, detalle) {
  if (condicion) return;
  fallos.push(detalle === undefined ? mensaje : `${mensaje}: ${JSON.stringify(detalle)}`);
  console.log(`  FALLA ${mensaje}`);
}

async function nuevaConversacion(page, texto) {
  const r = await page.request.post('http://localhost:4599/api/mock/atencion/simular', { data: { nueva: true, texto } });
  return (await r.json()).id;
}

async function irALista(page) {
  await page.goto(`${PANEL}#atencion`);
  await page.locator('.atn-row').first().waitFor();
  await page.waitForTimeout(300);
}

async function abrir(page, id) {
  const fila = id ? page.locator(`.atn-row[data-id="${id}"]`) : page.locator('.atn-row').first();
  await fila.click();
  await page.locator('#atnMensajes').waitFor();
  await page.waitForTimeout(250);
}

async function abrirDetalles(page) {
  await page.locator('#atnDetalles').click();
  await page.locator('.atn-detalles').waitFor();
  await page.waitForTimeout(450);
}

async function cerrarDetalles(page) {
  await page.keyboard.press('Escape');
  await page.locator('.atn-detalles').waitFor({ state: 'detached' });
}

async function accionDetalles(page, texto) {
  await abrirDetalles(page);
  await page.locator('.atn-detalles .sheet-action', { hasText: texto }).click();
}

/** Lo que no depende de cada acción: alto, desbordes, íconos y blancos táctiles. */
function medirHilo() {
  const caja = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
  const visible = (el) => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
  const botones = ['#atnVolver', '#atnDetalles', '.atn-acciones .btn-primary, .atn-acciones .btn-secondary', '#atnAdjuntar', '#atnRapidas', '#atnEnviar'];
  const pequenos = [];
  const descentrados = [];
  for (const sel of botones) {
    const btn = document.querySelector(sel);
    if (!visible(btn)) { pequenos.push({ sel, oculto: true }); continue; }
    // offset y no rect: #atnEnviar deshabilitado se encoge con transform.
    if (btn.offsetHeight < 44 || btn.offsetWidth < 44) pequenos.push({ sel, w: btn.offsetWidth, h: btn.offsetHeight });
    const svg = [...btn.querySelectorAll('svg')].find(visible);
    if (!svg) continue;
    const a = btn.getBoundingClientRect();
    const b = svg.getBoundingClientRect();
    const dx = Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2);
    const dy = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
    if (dx > 1.5 || dy > 1.5) descentrados.push({ sel, dx: +dx.toFixed(1), dy: +dy.toFixed(1) });
  }
  const inbox = caja('#atnInbox');
  const cabecera = caja('#atnCabecera');
  return {
    alto: innerHeight,
    ancho: innerWidth,
    desbordeX: document.documentElement.scrollWidth > innerWidth + 1,
    desplazable: document.documentElement.scrollHeight > innerHeight + 1,
    pctMensajes: +(caja('#atnMensajes').height / innerHeight * 100).toFixed(1),
    cubre: inbox.top === 0 && inbox.left === 0 && Math.round(inbox.width) === innerWidth && Math.round(inbox.height) === innerHeight,
    altoCabecera: cabecera.height,
    tabBarVisible: visible(document.querySelector('#tabBar')),
    tituloVisible: visible(document.querySelector('#main .page-header')),
    asignacionVisible: visible(document.querySelector('#atnAsignacion')),
    pista: document.querySelector('#atnPista').textContent,
    pequenos, descentrados,
  };
}

function medirLista() {
  const avisos = document.querySelector('#atnAvisos');
  const fila = [...avisos.children].filter(h => getComputedStyle(h).display !== 'none');
  const tops = new Set(fila.map(h => Math.round(h.getBoundingClientRect().top + h.getBoundingClientRect().height / 2)));
  return {
    desbordeX: document.documentElement.scrollWidth > innerWidth + 1,
    ventanaDesplazable: document.documentElement.scrollHeight > innerHeight + 1,
    filasAvisos: tops.size,
    ayudaVisible: getComputedStyle(document.querySelector('.atn-estado-ayuda')).display !== 'none',
    sonidoSvg: !!document.querySelector('#atnSonidoBtn svg') && document.querySelector('#atnSonidoBtn svg').getBoundingClientRect().width > 0,
    altoFilas: Math.round(document.querySelector('#atnFilas').getBoundingClientRect().height),
    pieDeLista: Math.round(document.querySelector('#atnInbox').getBoundingClientRect().bottom),
    topeTabBar: Math.round(document.querySelector('#tabBar').getBoundingClientRect().top || innerHeight),
  };
}

async function medirTamano(browser, width, height) {
  const nombre = `${width}x${height}`;
  console.log(nombre);
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await irALista(page);

  const lista = await page.evaluate(medirLista);
  revisar(!lista.desbordeX, `${nombre} lista sin desborde`, lista);
  revisar(!lista.ventanaDesplazable, `${nombre} la ventana no se desplaza en la lista`, lista);
  revisar(lista.filasAvisos === 1, `${nombre} presencia en una fila`, lista);
  revisar(!lista.ayudaVisible, `${nombre} ayuda oculta`, lista);
  revisar(lista.sonidoSvg, `${nombre} sonido con SVG`, lista);
  await page.screenshot({ path: `tmp/qa-atn-${nombre}-lista.png` });

  await abrir(page);
  const hilo = await page.evaluate(medirHilo);
  console.log(`  mensajes ${hilo.pctMensajes}% cabecera ${hilo.altoCabecera}px`);
  revisar(hilo.cubre, `${nombre} el hilo cubre la pantalla`, hilo);
  revisar(!hilo.desbordeX, `${nombre} hilo sin desborde`, hilo);
  revisar(!hilo.desplazable, `${nombre} la página no se desplaza`, hilo);
  revisar(!hilo.tabBarVisible && !hilo.tituloVisible && !hilo.asignacionVisible, `${nombre} solo queda el hilo`, hilo);
  revisar(hilo.altoCabecera <= 64, `${nombre} cabecera de una fila`, hilo);
  revisar(!hilo.pequenos.length, `${nombre} blancos de 44 px`, hilo.pequenos);
  revisar(!hilo.descentrados.length, `${nombre} íconos centrados`, hilo.descentrados);
  revisar(hilo.pista === '', `${nombre} sin pista de Enter en táctil`, hilo.pista);
  if (width === 375 && height === 812) revisar(hilo.pctMensajes >= 65, 'los mensajes ocupan al menos 65 % a 375x812', hilo.pctMensajes);
  await page.screenshot({ path: `tmp/qa-atn-${nombre}-hilo.png` });

  await abrirDetalles(page);
  const hoja = await page.evaluate(() => {
    const h = document.querySelector('.atn-detalles');
    const b = h.getBoundingClientRect();
    const chip = h.querySelector('.atn-chip-etiqueta');
    const x = h.querySelector('.atn-etiqueta-quitar');
    let toqueLejano = null;
    if (x) {
      const r = x.getBoundingClientRect();
      const punto = document.elementFromPoint((r.left + r.right) / 2 + 16, (r.top + r.bottom) / 2 + 16);
      toqueLejano = punto?.closest('.atn-etiqueta-quitar') === x;
    }
    return {
      dentro: b.top >= 0 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth + 1,
      expandido: document.querySelector('#atnDetalles').getAttribute('aria-expanded'),
      focoDentro: h.contains(document.activeElement),
      unaAsignacion: document.querySelectorAll('#atnAsignacion').length === 1 && h.contains(document.querySelector('#atnAsignacion')),
      altoChip: chip ? Math.round(chip.getBoundingClientRect().height) : null,
      toqueLejano,
      acciones: [...h.querySelectorAll('.sheet-action')].map(a => a.textContent.trim()),
    };
  });
  revisar(hoja.dentro, `${nombre} Detalles dentro de la pantalla`, hoja);
  revisar(hoja.expandido === 'true', `${nombre} aria-expanded abierto`, hoja);
  revisar(hoja.focoDentro, `${nombre} foco dentro de Detalles`, hoja);
  revisar(hoja.unaAsignacion, `${nombre} una sola asignación`, hoja);
  revisar(hoja.altoChip == null || hoja.altoChip <= 32, `${nombre} píldora de tamaño normal`, hoja);
  revisar(hoja.toqueLejano !== false, `${nombre} × tocable fuera de su caja`, hoja);
  await page.screenshot({ path: `tmp/qa-atn-${nombre}-detalles.png` });
  await cerrarDetalles(page);
  const cerrado = await page.evaluate(() => ({
    expandido: document.querySelector('#atnDetalles').getAttribute('aria-expanded'),
    foco: document.activeElement?.id,
    asignaciones: document.querySelectorAll('#atnAsignacion').length,
    asesor: document.querySelector('#atnHilo #atnAsesor') !== null,
  }));
  revisar(cerrado.expandido === 'false' && cerrado.foco === 'atnDetalles', `${nombre} Esc devuelve el foco`, cerrado);
  revisar(cerrado.asignaciones === 1 && cerrado.asesor, `${nombre} la asignación vuelve al hilo`, cerrado);

  await page.locator('#atnVolver').click();
  await page.locator('.atn-row').first().waitFor();
  const vuelta = await page.evaluate(() => ({
    titulo: getComputedStyle(document.querySelector('#main .page-header')).display,
    abierto: document.querySelector('#atnInbox').classList.contains('thread-open'),
  }));
  revisar(vuelta.titulo !== 'none' && !vuelta.abierto, `${nombre} la flecha vuelve a la lista`, vuelta);
  revisar(!errores.length, `${nombre} sin errores de JavaScript`, errores);
  await ctx.close();
}

/** Asesor, equipo y etiquetas desde la hoja, sin que se cierre al cambiar. */
async function probarDetalles(page) {
  const id = await nuevaConversacion(page, 'Quiero cambiar de programa');
  await irALista(page);
  await abrir(page, id);
  await abrirDetalles(page);

  const asignar = page.waitForResponse(r => r.url().endsWith(`/conversaciones/${id}/asignar`) && r.ok());
  await page.locator('#atnAsesor').selectOption('4');
  await asignar;
  await page.waitForTimeout(250);
  revisar(await page.locator('.atn-detalles #atnAsesor').inputValue() === '4', 'el asesor cambia desde Detalles');
  const equipo = page.waitForResponse(r => r.url().endsWith(`/conversaciones/${id}/asignar`) && r.ok());
  await page.locator('#atnEquipoConv').selectOption('11');
  await equipo;
  await page.waitForTimeout(250);
  revisar(await page.locator('.atn-detalles #atnEquipoConv').inputValue() === '11', 'el equipo cambia desde Detalles');

  await page.locator('#atnAgregarEtiqueta').click();
  await page.locator('#atnEtiquetaNueva').fill('beca');
  await page.locator('#atnEtiquetaForm button[type="submit"]').click();
  await page.locator('.atn-detalles .atn-chip-etiqueta', { hasText: 'beca' }).waitFor();
  await page.locator('.atn-detalles .atn-etiqueta-quitar').first().click();
  await page.locator('.atn-detalles .atn-chip-etiqueta').waitFor({ state: 'detached' });
  // La trampa de Tab cubre los controles nuevos y no se escapa a la página.
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Tab');
    const dentro = await page.evaluate(() => {
      const hoja = document.querySelector('.atn-detalles');
      return hoja.contains(document.activeElement) && document.activeElement !== hoja;
    });
    revisar(dentro, `Tab ${i} sigue dentro de Detalles`);
  }
  await cerrarDetalles(page);
  revisar(await page.locator('#atnHilo #atnAsesor').inputValue() === '4', 'la asignación repintada conserva el asesor');
  console.log('Detalles: asesor, equipo y etiquetas OK');
}

async function probarCompositor(page) {
  await page.locator('#atnModo button', { hasText: 'Nota privada' }).click();
  await page.locator('#atnPista', { hasText: 'solo la ve el equipo' }).waitFor();
  await page.locator('#atnTexto').fill('Llamar mañana en la tarde');
  await page.locator('#atnEnviar').click();
  await page.locator('.atn-nota', { hasText: 'Llamar mañana en la tarde' }).waitFor();

  await page.locator('#atnModo button', { hasText: 'Responder' }).click();
  await page.locator('#atnTexto').fill('Con gusto te ayudo');
  await page.locator('#atnEnviar').click();
  await page.locator('.bubble.out', { hasText: 'Con gusto te ayudo' }).waitFor();

  await page.locator('#atnArchivo').setInputFiles({ name: 'requisitos.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prueba') });
  await page.locator('#atnArchivoChip', { hasText: 'requisitos.pdf' }).waitFor();
  revisar(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), 'el chip del adjunto no desborda');
  await page.locator('#atnEnviar').click();
  await page.locator('#atnArchivoChip').waitFor({ state: 'hidden' });
  console.log('Compositor: nota, respuesta y adjunto OK');
}

async function probarAcciones(page) {
  await accionDetalles(page, 'Macros');
  await page.locator('.action-sheet .sheet-title', { hasText: 'Macros' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  revisar(await page.locator('#atnDetalles').getAttribute('aria-expanded') === 'false', 'Macros cierra Detalles');

  await accionDetalles(page, 'Pendiente');
  await page.locator('#atnInbox:not(.thread-open) .atn-row').first().waitFor();
  revisar(await page.locator('#tabBar').isVisible(), 'Pendiente vuelve a la lista con la barra de pestañas');

  const id = await nuevaConversacion(page, 'Ya resolví mi duda');
  await irALista(page);
  await abrir(page, id);
  await page.locator('.atn-acciones [data-estado="resolved"]').click();
  await page.locator('#atnInbox:not(.thread-open) .atn-row').first().waitFor();
  console.log('Acciones: Macros, Pendiente y Resolver OK');

  const otra = await nuevaConversacion(page, 'Una consulta más');
  await irALista(page);
  await abrir(page, otra);
  await accionDetalles(page, 'Historial');
  await page.waitForFunction(() => location.hash.startsWith('#conversaciones'));
  await page.locator('#tabBar').waitFor();
  console.log('Acciones: Historial OK');
}

/* La emulación no abre un teclado: se finge visualViewport para probar que el
   pie reacciona a lo invadido y se retira cuando Safari desplaza la ventana. */
async function probarTeclado(browser) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    const falso = new EventTarget();
    falso.height = window.innerHeight;
    falso.offsetTop = 0;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: falso });
    window.__teclado = (alto, desplazado) => {
      falso.height = window.innerHeight - alto;
      falso.offsetTop = desplazado;
      falso.dispatchEvent(new Event('resize'));
    };
  });
  const page = await ctx.newPage();
  await irALista(page);
  await abrir(page);
  await page.evaluate(() => window.__teclado(300, 0));
  await page.waitForTimeout(100);
  const conTeclado = await page.evaluate(() => ({
    kb: document.querySelector('#atnHilo').style.getPropertyValue('--kb'),
    pie: Math.round(document.querySelector('#atnTexto').getBoundingClientRect().bottom),
    limite: innerHeight - 300,
  }));
  revisar(conTeclado.kb === '300px' && conTeclado.pie <= conTeclado.limite, 'el compositor sube sobre el teclado', conTeclado);
  await page.evaluate(() => window.__teclado(300, 300));
  await page.waitForTimeout(100);
  revisar(await page.evaluate(() => document.querySelector('#atnHilo').style.getPropertyValue('--kb')) === '0px', 'sin doble compensación al desplazarse');
  await page.locator('#atnVolver').click();
  revisar(await page.evaluate(() => document.querySelector('#atnHilo').style.getPropertyValue('--kb')) === '', 'la flecha limpia --kb');
  await ctx.close();
  console.log('Teclado: --kb OK');
}

async function probarSinTelefono(browser) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.route(/\/api\/tools\/atencion\/conversaciones\/\d+$/, async route => {
    const respuesta = await route.fetch();
    const data = await respuesta.json();
    data.conversacion.contacto = { nombre: 'Usuario de WhatsApp', telefono: 'CO.ENT.ABC123' };
    data.conversacion.asignado = null;
    await route.fulfill({ response: respuesta, json: data });
  });
  await irALista(page);
  await abrir(page);
  const sub = await page.locator('#atnCabecera .atn-cabecera-sub').innerText();
  revisar(sub.trim() === 'Sin asignar', 'sin teléfono el subtítulo no repite el nombre', sub);
  await ctx.close();
  console.log('Sin teléfono OK');
}

/* Lo que la lista de Abiertas no muestra: otros estados y datos que estiran. */
async function probarOtrosEstados(page) {
  await irALista(page);
  await page.locator('#atnEstadoWrap button', { hasText: 'Resueltas' }).click();
  await page.locator('.atn-row').first().waitFor();
  await abrir(page);
  revisar(await page.locator('.atn-acciones [data-estado="open"]', { hasText: 'Reabrir' }).isVisible(), 'resuelta muestra Reabrir en la cabecera');
  await abrirDetalles(page);
  const resuelta = await page.locator('.atn-detalles .sheet-action').allInnerTexts();
  revisar(!resuelta.some(t => t.includes('Pendiente') || t.includes('Abrir')), 'resuelta sin Pendiente ni Abrir', resuelta);
  await cerrarDetalles(page);

  await page.locator('#atnVolver').click();
  await page.locator('#atnEstadoWrap button', { hasText: 'Pendientes' }).click();
  await page.locator('.atn-row').first().waitFor();
  await abrir(page);
  await accionDetalles(page, 'Abrir');
  await page.locator('#atnInbox:not(.thread-open)').waitFor();
  console.log('Estados: resuelta y pendiente OK');
}

async function probarDatosLargos(browser) {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const etiquetas = Array.from({ length: 12 }, (_, i) => `etiqueta-muy-larga-numero-${i}-para-probar`);
  await page.route(/\/api\/tools\/atencion\/conversaciones\/\d+$/, async route => {
    const respuesta = await route.fetch();
    const data = await respuesta.json();
    data.conversacion.contacto.nombre = 'María Fernanda de los Ángeles Restrepo Gutiérrez Santamaría';
    data.conversacion.etiquetas = etiquetas;
    await route.fulfill({ response: respuesta, json: data });
  });
  await irALista(page);
  await abrir(page);
  const hilo = await page.evaluate(medirHilo);
  revisar(!hilo.desbordeX && hilo.altoCabecera <= 64, 'nombre largo en una fila', hilo);
  await abrirDetalles(page);
  const hoja = await page.evaluate(() => {
    const h = document.querySelector('.atn-detalles');
    const b = h.getBoundingClientRect();
    return { dentro: b.top >= 0 && b.bottom <= innerHeight + 1, desplaza: h.scrollHeight > h.clientHeight, desbordeX: h.scrollWidth > h.clientWidth + 1 };
  });
  revisar(hoja.dentro && hoja.desplaza && !hoja.desbordeX, 'muchas etiquetas se desplazan dentro de la hoja', hoja);
  await page.screenshot({ path: 'tmp/qa-atn-320x568-largos.png' });
  await ctx.close();
  console.log('Datos largos OK');
}

async function probarEscritorio(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await irALista(page);
  await abrir(page);
  revisar(!await page.locator('#atnDetalles').isVisible(), 'escritorio sin botón de Detalles');
  revisar(await page.locator('#atnAsignacion').isVisible(), 'escritorio con asignación a la vista');
  revisar(await page.locator('#atnMacrosHilo').isVisible(), 'escritorio con Macros en la cabecera');
  revisar(await page.locator('#atnPista').innerText() === 'Enter envía · Shift+Enter salta de línea', 'escritorio con la pista de Enter');
  await page.close();
  console.log('Escritorio OK');
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined });
  try {
    for (const [width, height] of TAMANOS) await medirTamano(browser, width, height);
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await probarDetalles(page);
    await probarCompositor(page);
    await probarAcciones(page);
    await probarOtrosEstados(page);
    revisar(!errores.length, 'recorrido sin errores de JavaScript', errores);
    await ctx.close();
    await probarTeclado(browser);
    await probarSinTelefono(browser);
    await probarDatosLargos(browser);
    await probarEscritorio(browser);
  } finally {
    await browser.close();
  }
  assert.deepEqual(fallos, []);
  console.log('Atención móvil: todo OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
