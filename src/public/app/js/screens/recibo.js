import { api } from '../core/api.js';
import { $$, copyToClipboard, escapeHtml, haptic } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { buildProgressRing, setProgress, successCheckSvg } from '../ui/controls.js';
import { contextSheet } from '../ui/sheet.js';

/* ============= RECIBO ============= */
function renderRecibo(main) {
  main.innerHTML = `
    <div class="page-header">
      <div><h1>🧾 Descargar recibo de matrícula</h1><div class="subtitle">Tooli ingresa al portal Iceberg con las credenciales del estudiante y descarga el recibo.</div></div>
    </div>
    <div class="tool-panel">
      <form id="reciboForm">
        <div class="field">
          <label>Código estudiantil</label>
          <input type="text" id="rCodigo" placeholder="T00012345" required>
        </div>
        <div class="field">
          <label>Cédula</label>
          <input type="text" id="rCedula" placeholder="1001234567" required>
          <div class="field-help">Solo dígitos, sin puntos ni guiones</div>
        </div>
        <button type="submit" class="btn btn-primary" id="reciboBtn">Descargar PDF</button>
      </form>

      <div id="reciboAlert"></div>
      <div id="reciboResult"></div>
    </div>
  `;

  const form = main.querySelector('#reciboForm');
  const alertBox = main.querySelector('#reciboAlert');
  const result = main.querySelector('#reciboResult');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo = form.querySelector('#rCodigo').value.trim().toUpperCase();
    const cedula = form.querySelector('#rCedula').value.trim();
    const btn = form.querySelector('#reciboBtn');
    haptic(10);
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Descargando…';
    alertBox.innerHTML = `
      <div class="alert alert-info recibo-loading">
        ${buildProgressRing('reciboProgress')}
        <div class="recibo-loading-text">
          <div class="recibo-loading-title">Ingresando al portal Iceberg…</div>
          <div class="recibo-loading-sub">Puede tardar hasta un minuto. No cierres esta pestaña.</div>
        </div>
      </div>`;
    result.innerHTML = `
      <div class="result-block turno-skeleton-block" aria-hidden="true">
        ${Array.from({ length: 3 }).map(() => `
          <div class="row"><span class="skeleton skeleton-line" style="width:72px;height:11px;"></span><span class="skeleton skeleton-line" style="width:180px;height:12px;"></span></div>
        `).join('')}
      </div>`;
    let pct = 4;
    setProgress('reciboProgress', pct);
    const progTimer = setInterval(() => {
      pct = Math.min(92, pct + (Math.random() * 5 + 1));
      setProgress('reciboProgress', pct);
    }, 500);
    try {
      const res = await fetch('/api/tools/recibo', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, cedula }),
      });
      clearInterval(progTimer);
      if (!form.isConnected) return;
      if (res.status === 401) { window.location.href = '/app/login.html'; return; }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/pdf')) {
        const blob = await res.blob();
        if (!form.isConnected) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `recibo-${codigo}.pdf`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setProgress('reciboProgress', 100);
        haptic([15, 40, 15]);
        alertBox.innerHTML = `<div class="alert alert-success recibo-success">${successCheckSvg()}<div class="recibo-success-title">PDF descargado correctamente</div><div class="recibo-success-sub">Se guardó como recibo-${escapeHtml(codigo)}.pdf</div></div>`;
        result.innerHTML = `
          <div class="result-block recibo-result">
            <div class="row" data-copy-row data-copy-label="Código"><span class="label">Código</span><span class="value">${escapeHtml(codigo)}</span></div>
            <div class="row" data-copy-row data-copy-label="Archivo"><span class="label">Archivo</span><span class="value">recibo-${escapeHtml(codigo)}.pdf</span></div>
          </div>
          <p class="turno-hint">Mantén presionado un dato para copiarlo</p>`;
        $$('[data-copy-row]', result).forEach(row => {
          const label = row.dataset.copyLabel || row.querySelector('.label').textContent;
          const value = row.querySelector('.value').textContent;
          contextSheet(row, { title: label, subtitle: value, actions: [{ label: `Copiar "${value}"`, icon: '📋', onClick: () => copyToClipboard(value, `${label} copiado`) }] });
        });
      } else {
        const err = await res.json().catch(() => ({}));
        if (!form.isConnected) return;
        let msg = '';
        let tone = 'alert-error';
        let ic = icon('x', 16);
        if (err.noRecibos) {
          tone = 'alert-info';
          ic = icon('search', 16);
          msg = err.nombre ? `No hay recibos pendientes para <strong data-copy-nombre>${escapeHtml(err.nombre)}</strong>.` : 'No hay recibos pendientes para este estudiante.';
        } else if (err.error === 'login_failed') {
          msg = 'Las credenciales no son válidas. Verifica el código y la cédula.';
        } else if (err.error === 'codigo_invalido') {
          msg = 'Formato de código inválido. Usa T seguido de 8 dígitos.';
        } else if (err.error === 'cedula_invalida') {
          msg = 'Formato de cédula inválido. Solo dígitos, sin puntos ni guiones.';
        } else {
          msg = err.detail ? escapeHtml(err.detail) : 'No se pudo descargar el recibo. Intenta de nuevo en unos segundos.';
        }
        haptic([20, 30, 20]);
        alertBox.innerHTML = `<div class="alert ${tone} turno-alert"><span class="turno-alert-icon">${ic}</span><span>${msg}</span></div>`;
        if (err.noRecibos && err.nombre) {
          const nombreEl = alertBox.querySelector('[data-copy-nombre]');
          if (nombreEl) contextSheet(nombreEl, { title: 'Estudiante', subtitle: err.nombre, actions: [{ label: `Copiar "${err.nombre}"`, icon: '📋', onClick: () => copyToClipboard(err.nombre, 'Nombre copiado') }] });
        }
      }
    } catch {
      clearInterval(progTimer);
      if (form.isConnected) {
        haptic([20, 30, 20]);
        alertBox.innerHTML = `<div class="alert alert-error turno-alert"><span class="turno-alert-icon">${icon('x', 16)}</span><span>Error de conexión. Revisa tu internet e intenta de nuevo.</span></div>`;
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Descargar PDF';
    }
  });
}

export { renderRecibo };
