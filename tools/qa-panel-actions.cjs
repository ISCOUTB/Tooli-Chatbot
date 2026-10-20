/* Flujos reales del panel contra el mock local. Ejecutar con mock-panel-server.cjs. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = 'http://localhost:4599/app/index.html';

async function visit(page, route) {
  await page.goto(`${BASE}#${route}`);
  await page.locator('#main h1').waitFor();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  });
  try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack ?? error.message));

    await visit(page, 'turno');
    await page.locator('#codigo').fill('abc');
    await page.locator('#turnoBtn').click();
    await page.locator('#turnoAlert').getByText('Formato de código inválido', { exact: false }).waitFor();
    await page.locator('#codigo').fill('T00000000');
    await page.locator('#turnoBtn').click();
    await page.locator('#turnoAlert').getByText('No se encontró información', { exact: false }).waitFor();
    await page.locator('#codigo').fill('T00012345');
    await page.locator('#turnoBtn').click();
    await page.locator('#turnoResult').getByText('María José Restrepo').waitFor();
    console.log('Turno: validación, no encontrado y resultado OK');

    await page.route('**/api/tools/turno/T00012345', async route => {
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.continue();
    });
    await page.locator('#turnoBtn').click();
    await page.locator('#tabBar .tab-item[data-tab="home"]').click();
    await page.waitForFunction(() => location.hash === '#home');
    await page.waitForTimeout(500);
    assert.equal(errors.length, 0, `Errores al navegar durante turno: ${errors.join(' | ')}`);
    console.log('Turno: navegación durante consulta OK');

    await visit(page, 'recibo');
    await page.locator('#rCodigo').fill('T00012345');
    await page.locator('#rCedula').fill('123');
    await page.locator('#reciboBtn').click();
    await page.locator('#reciboAlert').getByText('Formato de cédula inválido', { exact: false }).waitFor();
    await page.locator('#rCodigo').fill('T00000000');
    await page.locator('#rCedula').fill('1001234567');
    await page.locator('#reciboBtn').click();
    await page.locator('#reciboAlert').getByText('No hay recibos pendientes', { exact: false }).waitFor();
    await page.locator('#rCodigo').fill('T00012345');
    await page.locator('#rCedula').fill('1234567890');
    await page.locator('#reciboBtn').click();
    await page.locator('#reciboAlert').getByText('Las credenciales no son válidas', { exact: false }).waitFor();
    await page.locator('#rCedula').fill('1001234567');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#reciboBtn').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'recibo-T00012345.pdf');
    await page.locator('#reciboAlert').getByText('PDF descargado correctamente').waitFor();
    console.log('Recibo: validación, sin pendientes, credenciales y PDF OK');

    await page.route('**/api/tools/recibo', async route => {
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.continue();
    });
    await page.locator('#reciboBtn').click();
    await page.locator('#tabBar .tab-item[data-tab="home"]').click();
    await page.waitForFunction(() => location.hash === '#home');
    await page.waitForTimeout(500);
    assert.equal(errors.length, 0, `Errores al navegar durante recibo: ${errors.join(' | ')}`);
    console.log('Recibo: navegación durante descarga OK');

    await visit(page, 'recordatorios');
    await page.locator('#remContent .rem-card').first().waitFor();
    await page.locator('#remMsg').fill('Recordatorio de prueba de interfaz');
    const future = new Date(Date.now() + 3_600_000);
    const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.locator('#remFecha').fill(local);
    await page.locator('#remTel').fill('x573001234567');
    await page.locator('#remSubmit').click();
    await page.locator('#remFeedback').getByText('telefono inválido', { exact: false }).waitFor();
    await page.locator('#remTel').fill('573044444444');
    await page.locator('#remVentana').getByText('No hay un mensaje entrante reciente registrado', { exact: false }).waitFor();
    await page.locator('#remTel').fill('573001234567');
    const fuera = new Date(Date.now() + 26 * 3_600_000);
    const fueraLocal = new Date(fuera.getTime() - fuera.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.locator('#remFecha').fill(fueraLocal);
    await page.locator('#remVentana').getByText('fuera de las 24 h', { exact: false }).waitFor();
    await page.locator('#remFecha').fill(local);
    await page.locator('#remVentana').waitFor({ state: 'hidden' });
    await page.locator('#remSubmit').click();
    await page.locator('#remContent .rem-card').filter({ hasText: 'Recordatorio de prueba de interfaz' }).waitFor();
    const card = page.locator('#remContent .rem-card').filter({ hasText: 'Recordatorio de prueba de interfaz' });
    await card.locator('.rem-cancel').click();
    await page.getByText('Cancelar recordatorio', { exact: true }).last().click();
    await page.locator('#remContent .rem-card').filter({ hasText: 'Recordatorio de prueba de interfaz' }).waitFor({ state: 'detached' });
    console.log('Recordatorios: teléfono inválido, ventana al enviar, programar y cancelar OK');

    await visit(page, 'conversaciones');
    await page.locator('.inbox-row[data-open]').first().waitFor();
    await page.locator('#inboxSearch').fill('María');
    assert.equal(await page.locator('.inbox-row[data-open]').count(), 1);
    await page.locator('.inbox-row[data-open]').first().click();
    await page.locator('#composerInput').waitFor();
    const replyText = `Mensaje de prueba ${Date.now()}`;
    await page.locator('#composerInput').fill(replyText);
    await page.locator('#composerSend').click();
    await page.locator('.bubble-row.out').filter({ hasText: replyText }).waitFor();
    await page.locator('.bubble-row.out.sending').waitFor({ state: 'detached' });
    await page.locator('#threadBack').click();
    await page.locator('#inboxSearch').fill('Carlos');
    await page.locator('.inbox-row[data-open="573009876543"]').click();
    await page.locator('#composerInput').fill('Respuesta sin mensaje entrante verificable');
    await page.locator('#composerSend').click();
    await page.locator('#composerHint').getByText('No hay un mensaje entrante reciente verificable', { exact: false }).waitFor();
    assert.equal(await page.locator('#composerInput').inputValue(), 'Respuesta sin mensaje entrante verificable');
    console.log('Conversaciones: respuesta válida y bloqueo con borrador conservado cuando falta ventana OK');

    await page.route('**/api/tools/bot-users', async route => {
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.continue();
    });
    await visit(page, 'conversaciones');
    await page.locator('#tabBar .tab-item[data-tab="home"]').click();
    await page.waitForFunction(() => location.hash === '#home');
    await page.waitForTimeout(500);
    assert.equal(errors.length, 0, `Errores al navegar durante conversaciones: ${errors.join(' | ')}`);
    console.log('Conversaciones: navegación durante carga OK');

    await visit(page, 'registros');
    await page.locator('#regContent .crm-card[data-row]').first().waitFor();
    await page.locator('#crmSearch').fill('María');
    assert.equal(await page.locator('#regContent .crm-card[data-row]').count(), 1);
    await page.locator('#regContent .crm-card[data-row]').first().focus();
    await page.locator('#regContent .crm-card[data-row]').first().press('Enter');
    await page.locator('#fichaEstados').waitFor();
    await page.locator('#fichaEstados [data-estado="interesado"]').click();
    await page.locator('#fichaEstados [data-estado="interesado"].active').waitFor();
    await page.locator('#fichaAsignarBtn').click();
    await page.waitForFunction(() => document.querySelector('#fichaAsignado')?.textContent === 'admin');
    await page.locator('#fichaEtiquetaInput').fill('qa');
    await page.locator('#fichaEtiquetaInput').press('Enter');
    await page.locator('#fichaEtiquetas .crm-etiqueta').filter({ hasText: 'qa' }).waitFor();
    await page.locator('#fichaNotaInput').fill('Llamada de prueba de interfaz');
    await page.locator('#fichaNotaBtn').click();
    const note = page.locator('#fichaNotas .crm-nota').filter({ hasText: 'Llamada de prueba de interfaz' });
    await note.waitFor();
    await note.locator('.crm-nota-del').click();
    await note.waitFor({ state: 'detached' });
    await page.locator('.profile-sheet-close').click();
    console.log('CRM: buscar, etapa, asignación, etiqueta y nota OK');

    await page.locator('#toggleSelectMode').click();
    await page.locator('#broadcastAll').click();
    await page.locator('#broadcastSendBtn').click();
    await page.locator('#bcTemplates .bc-template-row').first().waitFor();
    await page.locator('#bcTemplates .bc-template-row').first().click();
    await page.locator('#bcConfirm').click();
    await page.locator('#bcResult').getByText('1/1 enviados correctamente', { exact: false }).waitFor();
    await page.locator('#bcConfirm').click();
    await page.locator('#bcConfirm').waitFor({ state: 'detached' });
    await page.locator('#broadcastSendBtn').click();
    await page.locator('#bcCancel').press('Escape');
    await page.locator('#bcCancel').waitFor({ state: 'detached' });
    console.log('CRM: selección filtrada, plantilla y progreso del envío sintético OK');

    await page.route('**/api/tools/registros-posgrado', async route => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, rows: [...data.rows].reverse() } });
    });
    await page.locator('#refreshReg').click();
    await page.waitForFunction(() => document.querySelector('#broadcastCount')?.textContent === '0 seleccionados');
    assert.equal(await page.locator('#broadcastSendBtn').isDisabled(), true);
    console.log('CRM: actualizar lista invalida la selección anterior al reordenar registros OK');

    await visit(page, 'evento-posgrado');
    await page.locator('#eventoContent .crm-card[data-row]').first().waitFor();
    await page.locator('#becaVistaWrap button[data-value="beca"]').click();
    assert.equal(await page.locator('#eventoContent .crm-card[data-row]').count(), 1);
    await page.locator('#becaVistaWrap button[data-value="todos"]').click();
    await page.locator('#eventoContent .crm-card[data-row="0"]').focus();
    await page.locator('#eventoContent .crm-card[data-row="0"]').press('Enter');
    await page.locator('.profile-sheet-actions button').filter({ hasText: 'Marcar: Contactado' }).click();
    await page.locator('#eventoContent .crm-card[data-row="0"]').getByText('Contactado').waitFor();
    await page.locator('#eventoContent .crm-card[data-row="0"]').click();
    await page.locator('.profile-sheet-actions button').filter({ hasText: 'Invitar a próximo evento' }).click();
    await page.locator('#invitarText').press('Escape');
    await page.locator('#invitarSend').waitFor({ state: 'detached' });
    await page.locator('#eventoContent .crm-card[data-row="0"]').click();
    await page.locator('.profile-sheet-actions button').filter({ hasText: 'Invitar a próximo evento' }).click();
    await page.locator('#invitarSend').click();
    await page.locator('#eventoContent .crm-card[data-row="0"]').getByText('Invitado a próximo evento').waitFor();
    console.log('Evento: filtro beca, seguimiento e invitación OK');

    await visit(page, 'metricas');
    await page.locator('#metricsContent #metChartDaily').waitFor();
    const metricsRange = page.waitForResponse(response => response.url().includes('/api/tools/metrics/range?days=30'));
    await page.locator('#metRangeWrap button[data-value="30"]').click();
    assert.equal((await metricsRange).status(), 200);
    await page.locator('#metricsContent #metChartDaily').waitFor();
    await visit(page, 'posgrados');
    await page.locator('#pgContent #pgVerCrm').waitFor();
    await page.locator('#pgContent').getByText('conversión sin datos de inicio', { exact: false }).first().waitFor();
    await page.locator('#pgContent').getByText('Sin consultas de programas en este rango.').waitFor();
    await page.locator('#pgRangeWrap button[data-value="30"]').click();
    await page.waitForFunction(() => document.querySelector('#pgContent .op-contexto-texto')?.textContent.includes('30 días'));
    await page.locator('#pgVerCrm').click();
    await page.waitForFunction(() => location.hash === '#registros');
    await visit(page, 'actividad');
    await page.locator('#actChartCanvas').waitFor();
    const activityRange = page.waitForResponse(response => response.url().includes('/api/tools/audit/summary?days=30'));
    await page.locator('#actRangeWrap button[data-value="30"]').click();
    assert.equal((await activityRange).status(), 200);
    console.log('Métricas, Posgrados y Actividad: rangos y navegación OK');

    await visit(page, 'usuarios');
    await page.locator('.advisor-card').first().waitFor();
    await page.locator('#newUserBtn').click();
    await page.locator('#nUsername').fill('qaasesor');
    await page.locator('#nFullName').fill('Asesor de Prueba');
    await page.locator('#nEmail').fill('qa@example.com');
    await page.locator('#nPassword').fill('PasswordPrueba2026!');
    await page.locator('#createUserBtn').click();
    const advisor = page.locator('.advisor-card[data-username="qaasesor"]');
    await advisor.waitFor();
    await advisor.click();
    await page.locator('.profile-sheet-actions button').filter({ hasText: 'Eliminar usuario' }).click();
    await page.locator('.sheet-action.destructive').filter({ hasText: 'Eliminar usuario' }).click();
    await advisor.waitFor({ state: 'detached' });
    console.log('Usuarios: crear y eliminar asesor OK');

    await page.route('**/health/deep', async route => {
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.continue();
    });
    await visit(page, 'health');
    await page.locator('#tabBar .tab-item[data-tab="home"]').click();
    await page.waitForFunction(() => location.hash === '#home');
    await page.waitForTimeout(500);
    assert.equal(errors.length, 0, `Errores al navegar durante salud: ${errors.join(' | ')}`);
    console.log('Estado del sistema: navegación durante consulta OK');

    await visit(page, 'health');
    await page.locator('#inboundReviews button[data-decision="acknowledge"]').waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#inboundReviews button[data-decision="acknowledge"]').click();
    await page.locator('#inboundReviews').getByText('No hay mensajes pendientes de revisión.').waitFor();
    console.log('Estado del sistema: revisión de mensaje OK');

    await page.locator('#tabBar .tab-item[data-tab="__more"]').click();
    await page.locator('.sheet-action').filter({ hasText: 'Cerrar sesión' }).click();
    await page.locator('#loginForm').waitFor();
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('incorrecta');
    await page.locator('#submitBtn').click();
    await page.waitForFunction(() => document.querySelector('#alert')?.textContent === 'Usuario o contraseña incorrectos.');
    await page.locator('#togglePassword').click();
    assert.equal(await page.locator('#password').getAttribute('type'), 'text');
    await page.locator('#password').fill('demo');
    await page.locator('#submitBtn').click();
    await page.locator('#main h1').waitFor();
    console.log('Sesión: cerrar, error de credenciales, mostrar clave y entrar OK');

    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
