import { api } from '../core/api.js';
import { $, $$, escapeHtml, toast } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import {
  duracionCorta, etiquetaVerificacionNegada, horarioATexto, porcentajeUso, resultadoLlamada, rolLinea, textoAHorario,
} from '../core/llamadas.js';

/* ============= LLAMADAS (línea de voz con IA) =============
   Estado de la conexión con Telnyx, costo del mes y topes, simulador
   conversacional (mismo motor que una llamada real, con datos y agenda
   simulados), cola de devoluciones, registro de llamadas y ajustes (admin).
   Las llaves de Telnyx viven en el entorno del servidor: aquí solo se ve si
   están puestas. */

const esAdmin = () => sesion.user?.role === 'admin';

async function pedir(path, opts) {
  const r = await api(path, opts);
  if (!r) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.message || data.error || 'error'), { status: r.status, data });
  return data;
}

function barra(usado, tope, etiqueta) {
  const pct = porcentajeUso(usado, tope);
  const color = pct >= 90 ? '#c5221f' : pct >= 70 ? '#b45309' : 'var(--utb-blue)';
  return `
    <div class="voz-barra">
      <div class="voz-barra-txt"><span>${escapeHtml(etiqueta)}</span><strong>${Number(usado) || 0} / ${Number(tope) || 0} min</strong></div>
      <div class="voz-barra-pista" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(etiqueta)}">
        <div class="voz-barra-relleno" style="width:${pct}%;background:${color};"></div>
      </div>
    </div>`;
}

const fechaCorta = (iso) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function telefonoBonito(t) {
  const d = String(t ?? '').replace(/[^0-9]/g, '');
  if (/^[*]+[0-9]{4}$/.test(String(t ?? ''))) return String(t);
  if (d.length === 12 && d.startsWith('57')) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return String(t ?? '');
}

function chipResultado(clave) {
  const r = resultadoLlamada(clave);
  return `<span class="badge" style="background:${r.color}1a;color:${r.color};">${escapeHtml(r.label)}</span>`;
}

function lineasTranscripcion(lineas) {
  if (!lineas?.length) return '<p class="field-help">Sin transcripción.</p>';
  return lineas.map(l => `
    <div class="voz-linea voz-linea-${l.r}">
      <strong>${escapeHtml(rolLinea(l.r))}</strong>
      <span>${escapeHtml(l.t)}</span>
    </div>`).join('');
}

async function renderLlamadas(main) {
  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('phone', 26)} Llamadas</h1><div class="subtitle">La línea de voz atiende posgrados, datos del estudiante verificado y agenda con asesores.</div></div>
      <button class="btn btn-secondary" id="vozRefrescar"><span class="refresh-icon">${icon('refresh', 16)}</span> Actualizar</button>
    </div>
    <div id="vozEstado" class="card" aria-live="polite"><p>Cargando…</p></div>
    <div class="card voz-card" id="vozSimulador">
      <h2>Simulador</h2>
      <p class="field-help">Escribe como si hablaras por teléfono y mira lo que diría la línea. Usa el mismo motor que una llamada real, pero con datos de estudiante y agenda <strong>de ejemplo</strong>: nunca reserva citas reales. El código estudiantil de ejemplo es T00012345.</p>
      <div class="voz-fila">
        <button type="button" class="btn btn-primary" id="simIniciar">Iniciar llamada simulada</button>
        <label class="asis-check voz-check"><input type="checkbox" id="simDesdeEstudiante"> <span>Llamar desde el número del estudiante de ejemplo</span></label>
      </div>
      <div id="simLog" class="voz-sim-log" aria-live="polite"></div>
      <form id="simForm" class="hidden voz-sim-form">
        <input type="text" id="simTexto" maxlength="300" placeholder="Lo que dice la persona…" aria-label="Lo que dice la persona" autocomplete="off">
        <button type="submit" class="btn btn-primary">Decir</button>
        <button type="button" class="btn btn-secondary" id="simSilencio" title="Simula que la persona no dice nada">Silencio</button>
        <button type="button" class="btn btn-secondary" id="simColgar">Colgar</button>
      </form>
      <div id="simEstado" class="field-help"></div>
    </div>
    <div class="card voz-card"><h2>Devolver la llamada</h2><div id="vozDevoluciones"><p>Cargando…</p></div></div>
    <div class="card voz-card">
      <div class="voz-fila voz-fila-entre">
        <h2>Registro de llamadas</h2>
        <label class="asis-check voz-check"><input type="checkbox" id="vozConSimuladas"> <span>Incluir simuladas</span></label>
      </div>
      <div id="vozRegistro"><p>Cargando…</p></div>
    </div>
    ${esAdmin() ? '<div class="card voz-card" id="vozAjustes"><h2>Ajustes</h2><p>Cargando…</p></div>' : ''}
  `;

  let estado = null;

  const cargarEstado = async () => {
    const box = $('#vozEstado', main);
    try {
      estado = await pedir('/api/tools/voz/estado');
      if (!estado || !box?.isConnected) return;
      const a = estado.ajustes;
      const c = estado.conexion;
      const lista = esAdmin() ? c.llaveApi && c.llavePublica : c.lista;
      box.innerHTML = `
        <div class="voz-estado">
          <div>
            <h2 class="voz-titulo-linea">Línea ${a.activo ? '<span class="badge" style="background:#15803d1a;color:#15803d;">Encendida</span>' : '<span class="badge" style="background:#64748b1a;color:#64748b;">Apagada</span>'}</h2>
            <p class="field-help">${lista ? 'Telnyx configurado.' : 'Sin llaves de Telnyx en el servidor: solo funciona el simulador.'}
            ${esAdmin() ? ` IA: ${c.ia ? escapeHtml(c.modeloIa) : 'sin OPENAI_API_KEY (entiende por reglas)'} · Datos académicos: ${c.academico ? 'conectados' : 'sin conectar'} · Agenda: ${c.agenda ? 'conectada' : 'sin conectar'} · Webhook: ${c.webhookListo ? 'listo' : 'falta VOICE_WEBHOOK_KEY'}` : ''}</p>
          </div>
          <div class="voz-costo">
            <div class="field-help">Costo del mes (estimado)</div>
            <strong>US$ ${Number(estado.costoMes.usd).toFixed(2)}</strong>
            <div class="field-help">≈ $ ${Number(estado.costoMes.copAprox).toLocaleString('es-CO')}</div>
          </div>
        </div>
        ${barra(estado.uso.dia, estado.uso.topeDia, 'Minutos de hoy')}
        ${barra(estado.uso.mes, estado.uso.topeMes, 'Minutos del mes')}
        ${estado.avisos?.length ? `<h3 class="voz-sub">Avisos recientes</h3>${estado.avisos.slice(0, 5).map(x => `<div class="field-help voz-aviso">${escapeHtml(fechaCorta(x.at))} · ${escapeHtml(x.texto)}</div>`).join('')}` : ''}
      `;
      if (esAdmin()) pintarAjustes();
    } catch {
      if (box?.isConnected) box.innerHTML = '<div class="alert alert-error">No se pudo cargar el estado de la línea.</div>';
    }
  };

  const cargarDevoluciones = async () => {
    const box = $('#vozDevoluciones', main);
    try {
      const { devoluciones } = await pedir('/api/tools/voz/devoluciones') ?? { devoluciones: [] };
      if (!box?.isConnected) return;
      box.innerHTML = devoluciones.length ? devoluciones.map(d => `
        <div class="voz-devo">
          <div class="voz-devo-txt">
            <strong>${escapeHtml(telefonoBonito(d.phone))}</strong> · ${escapeHtml(d.motivo)}${d.attempts > 1 ? ` · llamó ${d.attempts} veces` : ''}
            <div class="field-help">${escapeHtml(fechaCorta(d.startedAt))}${d.summary ? ` · ${escapeHtml(d.summary)}` : ''}</div>
          </div>
          <button type="button" class="btn btn-secondary" data-devolver="${escapeHtml(d.id)}">Marcar devuelta</button>
        </div>`).join('') : '<p class="field-help">Nadie espera que le devuelvan la llamada.</p>';
      $$('button[data-devolver]', box).forEach(b => b.addEventListener('click', async () => {
        const nota = window.prompt('Nota de la devolución (opcional):', '') ?? null;
        if (nota === null) return;
        b.disabled = true;
        try {
          await pedir(`/api/tools/voz/devoluciones/${encodeURIComponent(b.dataset.devolver)}/hecha`, { method: 'POST', body: JSON.stringify({ nota }) });
          toast('Marcada como devuelta');
          cargarDevoluciones();
        } catch {
          b.disabled = false;
          toast('No se pudo marcar. Intenta de nuevo.');
        }
      }));
    } catch {
      if (box?.isConnected) box.innerHTML = '<div class="alert alert-error">No se pudo cargar la cola de devoluciones.</div>';
    }
  };

  const cargarRegistro = async () => {
    const box = $('#vozRegistro', main);
    const sim = $('#vozConSimuladas', main)?.checked ? '1' : '0';
    try {
      const { llamadas } = await pedir(`/api/tools/voz/llamadas?simuladas=${sim}`) ?? { llamadas: [] };
      if (!box?.isConnected) return;
      box.innerHTML = llamadas.length ? llamadas.map(l => `
        <details class="voz-llamada" data-llamada="${escapeHtml(l.id)}">
          <summary>
            <strong>${escapeHtml(telefonoBonito(l.telefono))}</strong> ${chipResultado(l.resultado)} ${l.simulada ? '<span class="badge">Simulada</span>' : ''}
            <span class="field-help">${escapeHtml(fechaCorta(l.iniciada))} · ${duracionCorta(l.duracionSeg)}${l.verificado ? ' · verificado' : ''}</span>
            ${l.verificacionNegada ? `<span class="badge" style="background:#b453091a;color:#b45309;">${escapeHtml(etiquetaVerificacionNegada(l.verificacionNegada))}</span>` : ''}
          </summary>
          ${l.verificacionNegadaTexto ? `<p class="field-help">${escapeHtml(l.verificacionNegadaTexto)}</p>` : ''}
          <div class="voz-transcripcion"><p class="field-help">Cargando transcripción…</p></div>
        </details>`).join('') : '<p class="field-help voz-vacio">Todavía no hay llamadas.</p>';
      $$('details[data-llamada]', box).forEach(det => det.addEventListener('toggle', async () => {
        if (!det.open || det.dataset.cargada) return;
        det.dataset.cargada = '1';
        const t = $('.voz-transcripcion', det);
        try {
          const { transcripcion } = await pedir(`/api/tools/voz/llamadas/${encodeURIComponent(det.dataset.llamada)}`);
          t.innerHTML = lineasTranscripcion(transcripcion);
        } catch {
          t.innerHTML = '<div class="alert alert-error">No se pudo cargar la transcripción.</div>';
        }
      }));
    } catch {
      if (box?.isConnected) box.innerHTML = '<div class="alert alert-error">No se pudo cargar el registro.</div>';
    }
  };

  // ── Simulador ──
  let simId = null;
  const simLog = $('#simLog', main);
  const simForm = $('#simForm', main);
  const pintarSim = (r) => {
    simLog.innerHTML = lineasTranscripcion(r.transcripcion);
    simLog.scrollTop = simLog.scrollHeight;
    const acciones = (r.comandos ?? []).filter(c => c.tipo === 'transferir' || c.tipo === 'colgar' || c.tipo === 'cortar_audio')
      .map(c => (c.tipo === 'transferir' ? `Transfiere a ${c.a}` : c.tipo === 'colgar' ? 'Cuelga' : 'Corta el audio'));
    const puente = (r.comandos ?? []).some(c => c.tipo === 'decir' && c.encolado);
    $('#simEstado', main).textContent = [
      `Fase: ${r.fase}`, r.verificado ? 'verificado' : 'sin verificar', resultadoLlamada(r.resultado).label,
      puente ? 'dijo frase puente' : '', ...acciones, r.estado === 'cerrada' ? 'llamada terminada' : '',
    ].filter(Boolean).join(' · ');
    simForm.classList.toggle('hidden', r.estado === 'cerrada');
    if (r.estado === 'cerrada') { simId = null; cargarRegistro(); }
  };
  const errorSim = (err) => toast(err?.status === 429 ? 'Se alcanzó el tope de simulaciones de hoy.' : 'El simulador no respondió. Intenta de nuevo.');

  $('#simIniciar', main).addEventListener('click', async () => {
    $('#simIniciar', main).disabled = true;
    try {
      const r = await pedir('/api/tools/voz/simular', { method: 'POST', body: JSON.stringify({ desdeNumeroDelEstudiante: $('#simDesdeEstudiante', main).checked }) });
      if (!r) return;
      simId = r.llamadaId;
      pintarSim(r);
      $('#simTexto', main).focus();
    } catch (err) { errorSim(err); } finally { $('#simIniciar', main).disabled = false; }
  });
  simForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#simTexto', main);
    const texto = input.value.trim();
    if (!texto || !simId) return;
    input.value = '';
    input.disabled = true;
    try { pintarSim(await pedir(`/api/tools/voz/simular/${simId}/decir`, { method: 'POST', body: JSON.stringify({ texto }) })); } catch (err) { errorSim(err); } finally { input.disabled = false; input.focus(); }
  });
  $('#simSilencio', main).addEventListener('click', async () => {
    if (!simId) return;
    try { pintarSim(await pedir(`/api/tools/voz/simular/${simId}/silencio`, { method: 'POST' })); } catch (err) { errorSim(err); }
  });
  $('#simColgar', main).addEventListener('click', async () => {
    if (!simId) return;
    try { pintarSim(await pedir(`/api/tools/voz/simular/${simId}/colgar`, { method: 'POST' })); } catch (err) { errorSim(err); }
  });

  // ── Ajustes (admin) ──
  function pintarAjustes() {
    const box = $('#vozAjustes', main);
    if (!box || !estado || box.dataset.pintado) return;
    box.dataset.pintado = '1';
    const a = estado.ajustes;
    const num = (id, label, valor, ayuda = '', extra = '') => `<div class="field"><label for="${id}">${label}</label><input type="number" id="${id}" value="${escapeHtml(String(valor))}" ${extra}>${ayuda ? `<div class="field-help">${ayuda}</div>` : ''}</div>`;
    const check = (id, label, valor, ayuda = '') => `<div class="field"><label class="asis-check"><input type="checkbox" id="${id}" ${valor ? 'checked' : ''}> <span>${label}</span></label>${ayuda ? `<div class="field-help">${ayuda}</div>` : ''}</div>`;
    box.innerHTML = `
      <h2>Ajustes</h2>
      <form id="vozAjustesForm">
        ${check('ajActivo', 'Línea encendida', a.activo, 'Apagada, la llamada pasa al número de desvío (si hay) sin gastar minutos.')}
        <div class="field"><label for="ajNombre">Nombre del asistente virtual</label><input type="text" id="ajNombre" maxlength="30" value="${escapeHtml(a.nombreAgente)}"></div>
        <div class="field"><label for="ajVoz">Voz</label><select id="ajVoz">${estado.voces.map(v => `<option value="${escapeHtml(v.id)}" ${v.id === a.voz ? 'selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</select><div class="field-help">La línea se presenta como «el asistente» o «la asistente» según la voz.</div></div>
        <div class="field"><label for="ajSaludo">Saludo propio (opcional)</label><textarea id="ajSaludo" maxlength="300" rows="2">${escapeHtml(a.saludo)}</textarea><div class="field-help">Siempre se agrega el aviso de transcripción y retención.</div></div>
        <div class="field"><label for="ajDesvio">Número de desvío a asesores</label><input type="tel" id="ajDesvio" value="${escapeHtml(a.numeroDesvio ?? '')}" placeholder="+57 300 000 0000"><div class="field-help">Sin número no hay transferencia en vivo: se ofrece cita o devolución.</div></div>
        <div class="field"><label for="ajHorario">Horario de asesores (hora de Colombia)</label><textarea id="ajHorario" rows="3">${escapeHtml(horarioATexto(a.horarioAsesores))}</textarea><div class="field-help">Una franja por línea: días (D L M X J V S) y horas, p. ej. «L M X J V 08:00-18:00».</div></div>
        ${check('ajGrabar', 'Grabar las llamadas (además de transcribir)', a.grabar, 'El saludo avisa que se graba.')}
        ${num('ajRetencion', 'Retención (días)', a.retencionDias, 'Ley 1581: la transcripción y el registro se borran solos pasado este plazo.', 'min="1" max="730"')}
        ${num('ajTopeDia', 'Tope de minutos por día', a.topeMinutosDia, '', 'min="0"')}
        ${num('ajTopeMes', 'Tope de minutos por mes', a.topeMinutosMes, '', 'min="0"')}
        ${num('ajMax', 'Máximo de minutos por llamada', a.maxMinutosLlamada, '', 'min="1" max="30"')}
        ${num('ajMaxTransfer', 'Máximo de minutos con el asesor', a.maxMinutosTransferencia, 'Tope de la llamada pasada a un asesor (también el desvío con la línea apagada o sin minutos). La parte con el asesor también se cobra.', 'min="1" max="240"')}
        ${num('ajPorNumero', 'Llamadas por día desde un mismo número', a.maxLlamadasNumeroDia, 'Así un solo número no gasta los minutos del día. Las llamadas sin número cuentan juntas.', 'min="1" max="100"')}
        ${num('ajCosto', 'Costo por minuto (US$)', a.costoMinutoUsd, 'Solo para estimar el costo del mes.', 'min="0" step="0.001"')}
        ${num('ajSim', 'Tope de simulaciones por día', a.topeSimulacionesDia, '', 'min="0"')}
        <div id="ajAlerta" role="alert"></div>
        <div class="voz-fila">
          <button type="submit" class="btn btn-primary">Guardar</button>
          <button type="button" class="btn btn-secondary" id="ajProbar">Probar conexión con Telnyx</button>
        </div>
      </form>`;
    $('#vozAjustesForm', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const alerta = $('#ajAlerta', box);
      const horario = textoAHorario($('#ajHorario', box).value);
      if (horario.errores.length) { alerta.innerHTML = `<div class="alert alert-error">No entendí estas líneas del horario: ${escapeHtml(horario.errores.join(' · '))}</div>`; return; }
      const cuerpo = {
        activo: $('#ajActivo', box).checked, nombreAgente: $('#ajNombre', box).value, voz: $('#ajVoz', box).value,
        saludo: $('#ajSaludo', box).value, numeroDesvio: $('#ajDesvio', box).value.trim() || null, horarioAsesores: horario.franjas,
        grabar: $('#ajGrabar', box).checked, retencionDias: Number($('#ajRetencion', box).value), topeMinutosDia: Number($('#ajTopeDia', box).value),
        topeMinutosMes: Number($('#ajTopeMes', box).value), maxMinutosLlamada: Number($('#ajMax', box).value), costoMinutoUsd: Number($('#ajCosto', box).value),
        maxMinutosTransferencia: Number($('#ajMaxTransfer', box).value), maxLlamadasNumeroDia: Number($('#ajPorNumero', box).value),
        topeSimulacionesDia: Number($('#ajSim', box).value),
      };
      try {
        await pedir('/api/tools/voz/ajustes', { method: 'PUT', body: JSON.stringify(cuerpo) });
        alerta.innerHTML = '';
        toast('Ajustes guardados');
        box.dataset.pintado = '';
        cargarEstado();
      } catch {
        alerta.innerHTML = '<div class="alert alert-error">No se pudieron guardar los ajustes.</div>';
      }
    });
    const probar = $('#ajProbar', box);
    probar.addEventListener('click', async () => {
      probar.disabled = true;
      try {
        const r = await pedir('/api/tools/voz/probar', { method: 'POST' });
        $('#ajAlerta', box).innerHTML = `<div class="alert ${r.ok ? 'alert-success' : 'alert-error'}">${escapeHtml(r.message)}</div>`;
      } catch {
        $('#ajAlerta', box).innerHTML = '<div class="alert alert-error">No se pudo probar la conexión.</div>';
      } finally { probar.disabled = false; }
    });
  }

  const cargarTodo = () => Promise.all([cargarEstado(), cargarDevoluciones(), cargarRegistro()]);
  $('#vozRefrescar', main).addEventListener('click', cargarTodo);
  $('#vozConSimuladas', main).addEventListener('change', cargarRegistro);
  setPullToRefresh(cargarTodo);
  await cargarTodo();
}

export { renderLlamadas };
