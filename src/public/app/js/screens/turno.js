import { api } from '../core/api.js';
import { $$, copyToClipboard, escapeHtml, haptic } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { contextSheet } from '../ui/sheet.js';

/* ============= TURNO ============= */
function renderTurno(main) {
  main.innerHTML = `
    <div class="page-header">
      <div><h1>📋 Consultar turno de matrícula</h1><div class="subtitle">Busca el turno asignado a un estudiante por su código.</div></div>
    </div>
    <div class="tool-panel">
      <form id="turnoForm">
        <div class="field">
          <label for="codigo">Código estudiantil</label>
          <input type="text" id="codigo" placeholder="T00012345" autofocus required>
          <div class="field-help">Formato: T seguido de 8 dígitos</div>
        </div>
        <button type="submit" class="btn btn-primary" id="turnoBtn">Buscar</button>
      </form>

      <div id="turnoAlert"></div>
      <div id="turnoResult"></div>
    </div>
  `;

  const form = main.querySelector('#turnoForm');
  const alert = main.querySelector('#turnoAlert');
  const result = main.querySelector('#turnoResult');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo = form.querySelector('#codigo').value.trim().toUpperCase();
    const btn = form.querySelector('#turnoBtn');
    haptic(10);
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Buscando…';
    alert.innerHTML = '';
    result.innerHTML = `
      <div class="result-block turno-skeleton-block" aria-hidden="true">
        ${Array.from({ length: 5 }).map(() => `
          <div class="row"><span class="skeleton skeleton-line" style="width:72px;height:11px;"></span><span class="skeleton skeleton-line" style="width:118px;height:12px;"></span></div>
        `).join('')}
      </div>`;
    try {
      const r = await api(`/api/tools/turno/${encodeURIComponent(codigo)}`);
      if (!form.isConnected || !r) return;
      if (!r.ok) {
        const err = await r.json();
        if (!form.isConnected) return;
        result.innerHTML = '';
        const msg = err.error === 'no_encontrado' ? `No se encontró información para <strong>${escapeHtml(codigo)}</strong>. Verifica el código e intenta de nuevo.` :
                    err.error === 'codigo_invalido' ? 'Formato de código inválido. Usa T seguido de 8 dígitos (ej. T00012345).' : 'No se pudo consultar el turno. Intenta de nuevo en unos segundos.';
        const tone = err.error === 'no_encontrado' ? 'alert-info' : 'alert-error';
        const ic = err.error === 'no_encontrado' ? icon('search', 16) : icon('x', 16);
        alert.innerHTML = `<div class="alert ${tone} turno-alert"><span class="turno-alert-icon">${ic}</span><span>${msg}</span></div>`;
        haptic([20, 30, 20]);
        return;
      }
      const { turno } = await r.json();
      if (!form.isConnected) return;
      const fields = [
        // Si a la hoja le falta la columna de apellido, no debe salir "undefined"
        // pegado al nombre del estudiante.
        ['Estudiante', [turno.nombre, turno.apellido].filter(Boolean).join(' ') || '—'],
        ['Programa', turno.programa],
        ['Turno', turno.turno],
        ['Fecha', turno.fecha],
        ['Hora', turno.hora],
      ];
      result.innerHTML = `
        <div class="result-block turno-result">
          <div class="turno-result-head"><span class="turno-result-dot"></span> Resultado para ${escapeHtml(codigo)}</div>
          ${fields.map(([label, value]) => `<div class="row" data-copy-row><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value) || '—'}</span></div>`).join('')}
        </div>
        <p class="turno-hint">Mantén presionado un dato para copiarlo</p>
      `;
      $$('[data-copy-row]', result).forEach(row => {
        const label = row.querySelector('.label').textContent;
        const value = row.querySelector('.value').textContent;
        if (!value || value === '—') return;
        contextSheet(row, { title: label, subtitle: value, actions: [{ label: `Copiar "${value}"`, icon: '📋', onClick: () => copyToClipboard(value, `${label} copiado`) }] });
      });
      haptic([15, 40, 15]);
    } catch {
      if (form.isConnected) {
        result.innerHTML = '';
        alert.innerHTML = `<div class="alert alert-error turno-alert"><span class="turno-alert-icon">${icon('x', 16)}</span><span>Error de conexión. Revisa tu internet e intenta de nuevo.</span></div>`;
        haptic([20, 30, 20]);
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Buscar';
    }
  });
}

export { renderTurno };
