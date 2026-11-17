import { api } from '../core/api.js';
import {
  MAX_POR_ENVIO, SECTORES, enLotes, fechaEvento, parseNumerosPegados, telefonosContactables,
} from '../core/asistencia.js';
import { escapeHtml, haptic, toast } from '../core/dom.js';
import { colorTextoLegible, formatTelefono, formatWhatsApp, relativeTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import {
  CATEGORIAS, claveDePlantilla, estadoEnvio, motivoNoEnviable, partesPlantilla, variablesDePlantilla,
} from '../core/plantillas.js';
import { parametrosRuta } from '../core/router.js';
import { screenInterval, setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { abrirDialogo } from '../ui/dialog.js';
import { ActionSheet } from '../ui/sheet.js';

/* ============= PLANTILLAS DE WHATSAPP =============
   Fuera de las 24 h desde el último mensaje de una persona, Meta solo deja
   enviarle una plantilla aprobada. Esta pantalla muestra cuáles hay, cómo se
   ven y permite enviarlas a los asistentes de un evento o a una lista de
   números. El envío lo hace la cola del servidor (broadcastJobService.ts):
   aquí solo se crea el trabajo y se sigue su avance. */

/* Donde se crean las plantillas y se ve si Meta ya las aprobó. Pide iniciar
   sesión con la cuenta de Meta que administra el número de WhatsApp. */
const ADMINISTRADOR_META = 'https://business.facebook.com/wa/manage/message-templates/';

async function leerJson(respuesta) {
  return respuesta.json().catch(() => ({}));
}

/** El cuerpo con formato de WhatsApp y las variables resaltadas. */
function cuerpoHtml(texto) {
  return formatWhatsApp(escapeHtml(texto)).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, '<span class="plt-variable">{{$1}}</span>');
}

function burbujaHtml(plantilla) {
  const p = partesPlantilla(plantilla);
  return `
    <div class="plt-burbuja">
      ${p.encabezadoMedia === 'IMAGE' && p.encabezadoEjemplo
        ? `<img class="plt-media-img" src="${escapeHtml(p.encabezadoEjemplo)}" alt="Imagen que acompaña la plantilla" loading="lazy" referrerpolicy="no-referrer">`
        : p.encabezadoMedia ? `<div class="plt-media">${icon('paperclip', 16)} ${p.encabezadoMedia === 'VIDEO' ? 'Video' : p.encabezadoMedia === 'DOCUMENT' ? 'Documento' : 'Archivo'}</div>` : ''}
      ${p.encabezado ? `<div class="plt-encabezado">${cuerpoHtml(p.encabezado)}</div>` : ''}
      <div class="plt-cuerpo">${p.cuerpo ? cuerpoHtml(p.cuerpo) : '<em>Sin texto</em>'}</div>
      ${p.pie ? `<div class="plt-pie">${escapeHtml(p.pie)}</div>` : ''}
    </div>
    ${p.botones.length ? `<div class="plt-botones">${p.botones.map(b => `<span>${b.tipo === 'URL' ? icon('external', 13) : b.tipo === 'PHONE_NUMBER' ? icon('phone', 13) : ''} ${escapeHtml(b.texto)}</span>`).join('')}</div>` : ''}`;
}

async function renderPlantillas(main) {
  const esAdmin = sesion.user?.role === 'admin';
  const eventoInicial = parametrosRuta().get('evento') ?? '';

  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('megaphone', 26)} Plantillas</h1><div class="subtitle">Mensajes aprobados por Meta: lo único que WhatsApp deja enviar a quien no ha escrito en las últimas 24 horas</div></div>
      <div class="asis-acciones">
        <a class="btn btn-secondary plt-meta" href="${ADMINISTRADOR_META}" target="_blank" rel="noopener noreferrer">${icon('external', 16)} Crear o editar en Meta</a>
        <button type="button" class="btn btn-secondary" id="pltRefresh"><span class="refresh-icon">${icon('refresh', 16)}</span> Actualizar</button>
      </div>
    </div>
    <div class="plt-layout">
      <section class="card plt-lista" aria-labelledby="pltListaTitulo">
        <h2 id="pltListaTitulo">Plantillas aprobadas</h2>
        <div id="pltLista">${Array.from({ length: 3 }).map(() => '<div class="skeleton skeleton-line" style="height:44px;margin:8px 0;"></div>').join('')}</div>
      </section>
      <div class="plt-derecha">
        <section class="card plt-previa" aria-labelledby="pltPreviaTitulo">
          <h2 id="pltPreviaTitulo">Así le llega a la persona</h2>
          <div id="pltPrevia"><div class="widget-empty">Elige una plantilla para verla.</div></div>
        </section>
        <section class="card plt-envio" aria-labelledby="pltEnvioTitulo">
          <h2 id="pltEnvioTitulo">Enviar</h2>
          <div id="pltEnvio"></div>
        </section>
      </div>
    </div>
    <section class="card plt-historial" aria-labelledby="pltHistorialTitulo">
      <h2 id="pltHistorialTitulo">${esAdmin ? 'Envíos recientes' : 'Tus envíos recientes'}</h2>
      <p class="desc">Los últimos siete días${esAdmin ? ', de todo el equipo' : ''}. Toca un envío para ver a quién no le llegó.</p>
      <div id="pltHistorial"><div class="skeleton skeleton-line" style="height:14px;margin:10px 0;width:70%;"></div></div>
    </section>`;

  let plantillas = [];
  let elegida = null;
  let eventos = [];
  let fuente = 'evento';
  let eventoId = eventoInicial;
  let contactables = null;       // { eventoId, telefonos, total } del evento elegido
  let numerosTexto = '';
  let enviando = false;
  let trabajos = [];             // ids de los envíos creados en esta visita
  let secuenciaEvento = 0;

  const listaEl = main.querySelector('#pltLista');
  const previaEl = main.querySelector('#pltPrevia');
  const envioEl = main.querySelector('#pltEnvio');
  const historialEl = main.querySelector('#pltHistorial');

  /* ── Plantillas ── */

  function pintarLista() {
    if (!plantillas.length) {
      listaEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${icon('megaphone', 40)}</div>
          <div class="empty-state-title">No hay plantillas aprobadas</div>
          <div class="empty-state-sub">Se crean en el <a href="${ADMINISTRADOR_META}" target="_blank" rel="noopener noreferrer">administrador de WhatsApp de Meta</a>. Cuando Meta apruebe una, aparece aquí sola.</div>
        </div>`;
      return;
    }
    listaEl.innerHTML = plantillas.map((t, i) => {
      const categoria = CATEGORIAS[String(t.category).toUpperCase()] ?? { label: t.category || 'Otra', color: '#475163' };
      const activa = elegida && claveDePlantilla(elegida) === claveDePlantilla(t);
      const variables = variablesDePlantilla(t);
      return `
        <button type="button" class="plt-item${activa ? ' activa' : ''}" data-idx="${i}" aria-pressed="${activa}">
          <span class="plt-item-nombre">${escapeHtml(t.name)}</span>
          <span class="plt-item-meta">
            <span class="badge" style="background:${categoria.color}1f;color:${colorTextoLegible(categoria.color)};">${escapeHtml(categoria.label)}</span>
            <span>${escapeHtml(t.language)}</span>
            ${variables ? `<span class="plt-item-variables">${variables} variable${variables === 1 ? '' : 's'}</span>` : ''}
          </span>
        </button>`;
    }).join('');
    listaEl.querySelectorAll('.plt-item').forEach(boton => boton.addEventListener('click', () => {
      elegida = plantillas[Number(boton.dataset.idx)];
      haptic(10);
      pintarLista();
      pintarPrevia();
      pintarEnvio();
    }));
  }

  function pintarPrevia() {
    if (!elegida) { previaEl.innerHTML = '<div class="widget-empty">Elige una plantilla para verla.</div>'; return; }
    const { encabezadoMedia, encabezadoEjemplo } = partesPlantilla(elegida);
    previaEl.innerHTML = `<div class="plt-chat">${burbujaHtml(elegida)}</div>
      ${encabezadoMedia && encabezadoEjemplo ? `<p class="plt-previa-nota">Se envía con ${encabezadoMedia === 'IMAGE' ? 'la misma imagen' : 'el mismo archivo'} con que Meta aprobó la plantilla.</p>` : ''}`;
    // Si la imagen no carga (dirección vencida), queda el marcador en su lugar.
    previaEl.querySelector('.plt-media-img')?.addEventListener('error', (event) => {
      const marcador = document.createElement('div');
      marcador.className = 'plt-media';
      marcador.innerHTML = `${icon('paperclip', 16)} Imagen`;
      event.target.replaceWith(marcador);
    });
  }

  async function cargarPlantillas() {
    try {
      const r = await api('/api/tools/broadcast/templates');
      if (!listaEl.isConnected || !r) return;
      if (!r.ok) throw new Error((await leerJson(r)).message || 'No se pudieron consultar las plantillas de Meta');
      const data = await r.json();
      if (!listaEl.isConnected) return;
      plantillas = Array.isArray(data.templates) ? data.templates : [];
      if (elegida) elegida = plantillas.find(t => claveDePlantilla(t) === claveDePlantilla(elegida)) ?? null;
      if (!elegida && plantillas.length === 1) elegida = plantillas[0];
      pintarLista();
      pintarPrevia();
      pintarEnvio();
    } catch (err) {
      if (!listaEl.isConnected) return;
      listaEl.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err?.message || 'No se pudieron cargar las plantillas')}. <button type="button" class="btn btn-secondary" id="pltRetry">Reintentar</button></div>`;
      listaEl.querySelector('#pltRetry')?.addEventListener('click', cargarPlantillas);
    }
  }

  /* ── Destinatarios ── */

  function destinatarios() {
    if (fuente === 'evento') return contactables && contactables.eventoId === eventoId ? contactables.telefonos : [];
    return parseNumerosPegados(numerosTexto).validos;
  }

  function etiquetaEnvio() {
    if (fuente !== 'evento') return 'Números escritos a mano';
    const evento = eventos.find(e => e.id === eventoId);
    return evento ? `Asistentes: ${evento.nombre}` : 'Asistentes de un evento';
  }

  async function cargarContactables() {
    const seq = ++secuenciaEvento;
    contactables = null;
    if (!eventoId) { pintarResumen(); return; }
    pintarResumen();
    try {
      const r = await api(`/api/tools/asistencia/eventos/${encodeURIComponent(eventoId)}`);
      if (!envioEl.isConnected || seq !== secuenciaEvento || !r) return;
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!envioEl.isConnected || seq !== secuenciaEvento) return;
      const asistentes = Array.isArray(data.asistentes) ? data.asistentes : [];
      contactables = { eventoId, telefonos: telefonosContactables(asistentes), total: asistentes.length };
    } catch {
      if (!envioEl.isConnected || seq !== secuenciaEvento) return;
      contactables = { eventoId, telefonos: [], total: 0, error: true };
    }
    pintarResumen();
  }

  function pintarResumen() {
    const resumen = envioEl.querySelector('#pltResumen');
    const boton = envioEl.querySelector('#pltEnviar');
    if (!resumen || !boton) return;
    const motivo = elegida ? motivoNoEnviable(elegida) : '';
    let texto = '';
    let total = 0;
    if (fuente === 'evento') {
      if (!eventos.length) texto = 'Aún no hay eventos de asistencia. Crea uno en <strong>Asistencia</strong>.';
      else if (!eventoId) texto = 'Elige un evento.';
      else if (!contactables || contactables.eventoId !== eventoId) texto = '<span class="spinner"></span> Contando asistentes…';
      else if (contactables.error) texto = 'No se pudo cargar la lista de ese evento.';
      else {
        total = contactables.telefonos.length;
        texto = total
          ? `<strong>${total}</strong> de ${contactables.total} asistente${contactables.total === 1 ? '' : 's'} recibirá${total === 1 ? '' : 'n'} la plantilla. Los demás no tienen WhatsApp registrado o no autorizaron el contacto.`
          : `Ninguno de los ${contactables.total} asistentes tiene WhatsApp y autorización de contacto.`;
      }
    } else {
      const { validos, invalidos, repetidos } = parseNumerosPegados(numerosTexto);
      total = validos.length;
      const notas = [
        invalidos ? `${invalidos} no ${invalidos === 1 ? 'es un número válido' : 'son números válidos'}` : '',
        repetidos ? `${repetidos} repetido${repetidos === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' · ');
      texto = total ? `<strong>${total}</strong> número${total === 1 ? '' : 's'} válido${total === 1 ? '' : 's'}.${notas ? ` ${notas}.` : ''}` : (notas || 'Escribe al menos un número.');
    }
    const lotes = Math.ceil(total / MAX_POR_ENVIO);
    resumen.innerHTML = `${texto}${lotes > 1 ? ` Se hará en ${lotes} envíos de hasta ${MAX_POR_ENVIO}.` : ''}`;
    boton.disabled = enviando || !elegida || !!motivo || total === 0;
    boton.innerHTML = `${icon('send', 16)} ${elegida && total ? `Enviar a ${total} persona${total === 1 ? '' : 's'}` : 'Enviar plantilla'}`;
  }

  function pintarEnvio() {
    const motivo = elegida ? motivoNoEnviable(elegida) : '';
    envioEl.innerHTML = `
      ${elegida ? `<p class="plt-elegida">Plantilla: <strong>${escapeHtml(elegida.name)}</strong> (${escapeHtml(elegida.language)})</p>` : '<p class="plt-elegida">Elige primero una plantilla de la lista.</p>'}
      ${motivo ? `<div class="alert alert-warning" role="status">${escapeHtml(motivo)}</div>` : ''}
      <div class="plt-fuente" id="pltFuente"></div>
      <div id="pltFuenteCuerpo"></div>
      <p class="plt-resumen" id="pltResumen" role="status" aria-live="polite"></p>
      <button type="button" class="btn btn-primary" id="pltEnviar" disabled>${icon('send', 16)} Enviar plantilla</button>
      <div id="pltProgreso"></div>`;
    envioEl.querySelector('#pltFuente').appendChild(buildSegmented(
      [{ value: 'evento', label: 'Asistentes de un evento' }, { value: 'numeros', label: 'Números' }],
      fuente,
      (valor) => { fuente = valor; pintarEnvio(); },
    ));
    const cuerpo = envioEl.querySelector('#pltFuenteCuerpo');
    if (fuente === 'evento') {
      cuerpo.innerHTML = `
        <div class="field"><label for="pltEvento">Evento</label>
          <select id="pltEvento">
            <option value="">${eventos.length ? 'Elige un evento…' : 'No hay eventos todavía'}</option>
            ${eventos.map(e => `<option value="${escapeHtml(e.id)}"${e.id === eventoId ? ' selected' : ''}>${escapeHtml(e.nombre)} · ${escapeHtml(SECTORES[e.sector]?.label ?? e.sector)}${e.fecha ? ` · ${escapeHtml(fechaEvento(e.fecha))}` : ''} (${e.asistentes})</option>`).join('')}
          </select>
        </div>`;
      cuerpo.querySelector('#pltEvento').addEventListener('change', (event) => { eventoId = event.target.value; void cargarContactables(); });
    } else {
      cuerpo.innerHTML = `
        <div class="field"><label for="pltNumeros">Números de WhatsApp</label>
          <textarea id="pltNumeros" rows="4" placeholder="3001234567&#10;573009876543">${escapeHtml(numerosTexto)}</textarea>
          <div class="field-help">Uno por línea o separados por comas. Asegúrate de que autorizaron que la UTB los contacte.</div>
        </div>`;
      cuerpo.querySelector('#pltNumeros').addEventListener('input', (event) => { numerosTexto = event.target.value; pintarResumen(); });
    }
    envioEl.querySelector('#pltEnviar').addEventListener('click', confirmarEnvio);
    pintarResumen();
    pintarProgreso();
  }

  function confirmarEnvio() {
    const telefonos = destinatarios();
    if (!elegida || !telefonos.length || enviando) return;
    ActionSheet.open({
      title: `¿Enviar "${elegida.name}" a ${telefonos.length} persona${telefonos.length === 1 ? '' : 's'}?`,
      subtitle: `${etiquetaEnvio()}. Los mensajes salen por WhatsApp y no se pueden retirar.`,
      groups: [
        [{ label: `Enviar a ${telefonos.length}`, icon: icon('send', 16), onClick: () => enviar(telefonos) }],
        [{ label: 'Cancelar', cancel: true }],
      ],
    });
  }

  async function enviar(telefonos) {
    enviando = true;
    pintarResumen();
    const progreso = envioEl.querySelector('#pltProgreso');
    const lotes = enLotes(telefonos);
    const etiqueta = etiquetaEnvio();
    const creados = [];
    let error = '';
    for (let i = 0; i < lotes.length; i++) {
      if (progreso) progreso.innerHTML = `<div class="plt-progreso-linea"><span class="spinner"></span> Creando el envío${lotes.length > 1 ? ` ${i + 1} de ${lotes.length}` : ''}…</div>`;
      try {
        const r = await api('/api/tools/broadcast/send', {
          method: 'POST',
          body: JSON.stringify({ templateName: elegida.name, language: elegida.language, telefonos: lotes[i], etiqueta }),
        });
        if (!r) return;
        const data = await leerJson(r);
        if (!r.ok || !data.job?.id) { error = data.message || `No se pudo crear el envío (HTTP ${r.status})`; break; }
        creados.push(data.job.id);
      } catch {
        error = 'Se perdió la conexión al crear el envío.';
        break;
      }
    }
    enviando = false;
    if (!envioEl.isConnected) return;
    trabajos = [...creados, ...trabajos].slice(0, 10);
    if (creados.length) {
      haptic([10, 20, 10]);
      toast(creados.length === lotes.length ? 'Envío en marcha: puedes seguir trabajando' : 'Solo se creó una parte del envío');
    }
    pintarResumen();
    pintarProgreso(error);
    void cargarHistorial();
  }

  let avance = new Map();   // id → resumen del envío

  function pintarProgreso(error = '') {
    const progreso = envioEl.querySelector('#pltProgreso');
    if (!progreso) return;
    const lineas = trabajos.map(id => avance.get(id)).filter(Boolean).map(job => {
      const estado = estadoEnvio(job);
      const revisados = job.enviados + job.fallidos;
      return `<div class="plt-progreso-linea plt-tono-${estado.tono}">
        ${job.estado === 'completado' ? icon(job.fallidos && !job.enviados ? 'x' : 'check', 15) : '<span class="spinner"></span>'}
        <span><strong>${escapeHtml(job.templateName)}</strong> · ${job.estado === 'completado' ? `${job.enviados} de ${job.solicitados} enviados${job.fallidos ? `, ${job.fallidos} con fallo` : ''}` : `${revisados} de ${job.solicitados} revisados`}</span>
      </div>`;
    });
    progreso.innerHTML = `${error ? `<div class="alert alert-error" role="alert">${escapeHtml(error)}</div>` : ''}${lineas.join('')}`;
  }

  /* ── Historial ── */

  function pintarHistorial(jobs) {
    if (!historialEl) return;
    if (!jobs.length) {
      historialEl.innerHTML = `<div class="widget-empty">${esAdmin ? 'Todavía no se ha enviado ninguna plantilla esta semana.' : 'Todavía no has enviado ninguna plantilla esta semana.'}</div>`;
      return;
    }
    historialEl.innerHTML = `
      <div class="asis-tabla-wrap">
        <table>
          <caption class="sr-only">Envíos de plantillas de los últimos siete días</caption>
          <thead><tr><th scope="col">Cuándo</th><th scope="col">Plantilla</th><th scope="col">Destinatarios</th><th scope="col">Enviados</th><th scope="col">Estado</th><th scope="col">Por</th></tr></thead>
          <tbody>${jobs.map(job => {
            const estado = estadoEnvio(job);
            return `<tr class="plt-fila" data-job="${escapeHtml(job.id)}" tabindex="0" role="button" aria-label="Ver el envío de ${escapeHtml(job.templateName)}">
              <td title="${escapeHtml(new Date(job.createdAt).toLocaleString('es-CO'))}">${escapeHtml(relativeTime(job.createdAt))}</td>
              <td><strong>${escapeHtml(job.templateName)}</strong><span class="asis-sub">${escapeHtml(job.language)}</span></td>
              <td>${escapeHtml(job.etiqueta || 'Prospectos del CRM')}</td>
              <td>${job.enviados} de ${job.solicitados}${job.fallidos ? `<span class="asis-sub">${job.fallidos} con fallo</span>` : ''}</td>
              <td><span class="badge plt-tono-${estado.tono}">${estado.texto}</span></td>
              <td>${escapeHtml(job.createdBy)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
    historialEl.querySelectorAll('.plt-fila').forEach(fila => {
      const abrir = () => abrirDetalleEnvio(fila.dataset.job);
      fila.addEventListener('click', abrir);
      fila.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); abrir(); } });
    });
  }

  async function cargarHistorial() {
    if (!historialEl) return;
    try {
      const r = await api('/api/tools/broadcast/jobs');
      if (!historialEl.isConnected || !r) return;
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!historialEl.isConnected) return;
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      avance = new Map(jobs.map(job => [job.id, job]));
      pintarHistorial(jobs);
      pintarProgreso();
    } catch {
      if (historialEl.isConnected && !avance.size) {
        historialEl.innerHTML = '<div class="alert alert-error" role="alert">No se pudo cargar el historial de envíos.</div>';
      }
    }
  }

  async function abrirDetalleEnvio(id) {
    const dialogo = abrirDialogo({ titulo: 'Detalle del envío', cuerpo: '<div class="asis-leyendo"><span class="spinner"></span> Cargando…</div>', ancho: true });
    const cuerpo = dialogo.el.querySelector('.dialogo-cuerpo');
    try {
      const r = await api(`/api/tools/broadcast/jobs/${encodeURIComponent(id)}`);
      if (!r || !dialogo.abierto()) return;
      if (!r.ok) throw new Error();
      const { job } = await r.json();
      if (!dialogo.abierto()) return;
      const enviados = Array.isArray(job.enviados) ? job.enviados : [];
      const fallidos = Array.isArray(job.fallidos) ? job.fallidos : [];
      cuerpo.innerHTML = `
        <dl class="plt-detalle">
          <div><dt>Plantilla</dt><dd>${escapeHtml(job.templateName)} (${escapeHtml(job.language)})</dd></div>
          <div><dt>Destinatarios</dt><dd>${escapeHtml(job.etiqueta || 'Prospectos del CRM')}</dd></div>
          <div><dt>Creado</dt><dd>${escapeHtml(new Date(job.createdAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }))} por ${escapeHtml(job.createdBy)}</dd></div>
          <div><dt>Resultado</dt><dd>${enviados.length} enviados de ${escapeHtml(job.solicitados)}${job.duplicadosOmitidos ? ` · ${escapeHtml(job.duplicadosOmitidos)} repetidos omitidos` : ''}${job.estado !== 'completado' ? ' · todavía en proceso' : ''}</dd></div>
        </dl>
        ${fallidos.length ? `
          <h3 class="plt-detalle-titulo">No se entregó a ${fallidos.length}</h3>
          <ul class="plt-fallidos">${fallidos.map(f => `<li><span>${escapeHtml(formatTelefono(f.numero) || f.numero || '—')}</span><span>${escapeHtml(f.error)}</span></li>`).join('')}</ul>
          <p class="field-help">Un resultado «no confirmado» puede haber llegado: revisa la conversación antes de reenviar.</p>` : '<div class="alert alert-success" role="status">No hubo fallos.</div>'}
        <div class="password-dialog-actions"><button type="button" class="btn btn-primary" data-cerrar>Cerrar</button></div>`;
    } catch {
      if (dialogo.abierto()) cuerpo.innerHTML = '<div class="alert alert-error" role="alert">No se pudo cargar este envío. Puede que ya haya caducado.</div>';
    }
  }

  /* ── Arranque ── */

  async function cargarEventos() {
    try {
      const r = await api('/api/tools/asistencia/eventos');
      if (!envioEl.isConnected || !r?.ok) throw new Error();
      const data = await r.json();
      eventos = Array.isArray(data.eventos) ? data.eventos : [];
    } catch {
      eventos = [];
    }
    if (!envioEl.isConnected) return;
    if (eventoId && !eventos.some(e => e.id === eventoId)) eventoId = '';
    pintarEnvio();
    if (eventoId) void cargarContactables();
  }

  async function cargarTodo() {
    await Promise.all([cargarPlantillas(), cargarEventos(), cargarHistorial()]);
  }

  main.querySelector('#pltRefresh').addEventListener('click', () => {
    main.querySelector('#pltRefresh .refresh-icon')?.classList.add('spin-once');
    void cargarTodo();
  });
  pintarEnvio();
  setPullToRefresh(cargarTodo);
  await cargarTodo();
  // Un envío en curso avanza solo en el servidor: el historial lo va reflejando.
  screenInterval(() => {
    if (!envioEl.isConnected || document.hidden) return;
    if ([...avance.values()].some(job => job.estado !== 'completado')) void cargarHistorial();
  }, 4000);
}

export { renderPlantillas };
