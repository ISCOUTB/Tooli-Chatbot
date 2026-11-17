import { api } from '../core/api.js';
import { MAX_POR_ENVIO, SECTORES, enLotes, fechaEvento } from '../core/asistencia.js';
import { entradaEscalonada } from '../core/animar.js';
import { escapeHtml, haptic, toast } from '../core/dom.js';
import { colorTextoLegible, formatTelefono, relativeTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import {
  CATEGORIAS, TIPOS_DATO, armarDestinatarios, claveDePlantilla, errorDeVariables, estadoEnvio, estadoPlantilla,
  insertarVariable, motivoNoEnviable, nombreTecnico, normalizarVariables, partesPlantilla,
  plantillaDesdeFormulario, ranurasDePlantilla, significadosDeFormulario, valoresDeEjemplo, variablesDePlantilla,
} from '../core/plantillas.js';
import { parametrosRuta } from '../core/router.js';
import { screenInterval, setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { abrirDialogo } from '../ui/dialog.js';
import { burbujaHtml } from '../ui/plantilla-burbuja.js';

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

async function renderPlantillas(main) {
  const esAdmin = sesion.user?.role === 'admin';
  const eventoInicial = parametrosRuta().get('evento') ?? '';

  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('megaphone', 26)} Plantillas</h1><div class="subtitle">Mensajes aprobados por Meta: lo único que WhatsApp deja enviar a quien no ha escrito en las últimas 24 horas</div></div>
      <div class="asis-acciones">
        <button type="button" class="btn btn-secondary" id="pltRefresh"><span class="refresh-icon">${icon('refresh', 16)}</span> Actualizar</button>
        <a class="btn btn-secondary plt-meta" href="${ADMINISTRADOR_META}" target="_blank" rel="noopener noreferrer">${icon('external', 16)} Abrir Meta</a>
        <button type="button" class="btn btn-primary" id="pltNueva">${icon('plus', 16)} Nueva plantilla</button>
      </div>
    </div>
    <div class="plt-layout">
      <section class="card plt-lista" aria-labelledby="pltListaTitulo">
        <h2 id="pltListaTitulo">Plantillas</h2>
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
  let contactables = null;       // { eventoId, asistentes, total } del evento elegido
  let numerosTexto = '';
  let origenes = {};             // clave de la variable → { origen, texto }
  let porPersona = false;        // números: cada línea trae sus propios datos
  let pendienteDeElegir = '';    // la plantilla recién creada, para mostrarla al recargar
  let errorEnvio = '';           // del último envío; se borran al empezar otro
  let avisoEnvio = '';
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
          <div class="empty-state-title">Todavía no hay plantillas</div>
          <div class="empty-state-sub">Crea la primera con <strong>Nueva plantilla</strong>. Meta la revisa y, cuando la apruebe, se puede enviar desde aquí.</div>
        </div>`;
      return;
    }
    const item = (t) => {
      const i = plantillas.indexOf(t);
      const categoria = CATEGORIAS[String(t.category).toUpperCase()] ?? { label: t.category || 'Otra', color: '#475163' };
      const activa = elegida && claveDePlantilla(elegida) === claveDePlantilla(t);
      const estado = estadoPlantilla(t);
      let datos = 0;
      try { datos = ranurasDePlantilla(t).length; } catch { datos = variablesDePlantilla(t); }
      return `
        <button type="button" class="plt-item${activa ? ' activa' : ''}${estado.aprobada ? '' : ' no-aprobada'}" data-idx="${i}" aria-pressed="${activa}">
          <span class="plt-item-nombre">${escapeHtml(t.name)}</span>
          <span class="plt-item-meta">
            ${estado.aprobada ? '' : `<span class="badge plt-tono-${estado.tono}">${escapeHtml(estado.texto)}</span>`}
            <span class="badge" style="background:${categoria.color}1f;color:${colorTextoLegible(categoria.color)};">${escapeHtml(categoria.label)}</span>
            <span>${escapeHtml(t.language)}</span>
            ${datos ? `<span class="plt-item-variables">${datos} dato${datos === 1 ? '' : 's'} por llenar</span>` : ''}
          </span>
        </button>`;
    };
    const aprobadas = plantillas.filter(t => estadoPlantilla(t).aprobada);
    const otras = plantillas.filter(t => !estadoPlantilla(t).aprobada);
    listaEl.innerHTML = `
      ${aprobadas.length ? aprobadas.map(item).join('') : '<div class="widget-empty">Todavía no hay plantillas aprobadas.</div>'}
      ${otras.length ? `<div class="plt-lista-grupo">En revisión o sin aprobar</div>${otras.map(item).join('')}` : ''}`;
    listaEl.querySelectorAll('.plt-item').forEach(boton => boton.addEventListener('click', () => {
      elegir(plantillas[Number(boton.dataset.idx)]);
      haptic(10);
      pintarLista();
      pintarPrevia();
      // Solo al cambiar de plantilla: escribir en los datos repinta sin animar.
      previaEl.querySelector('.plt-chat')?.classList.add('plt-cambio');
      pintarEnvio();
    }));
  }

  function pintarPrevia() {
    if (!elegida) { previaEl.innerHTML = '<div class="widget-empty">Elige una plantilla para verla.</div>'; return; }
    const { encabezadoMedia, encabezadoEjemplo } = partesPlantilla(elegida);
    previaEl.innerHTML = `<div class="plt-chat">${burbujaHtml(elegida, valoresDeMuestra())}</div>
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
      const r = await api('/api/tools/broadcast/templates/todas');
      if (!listaEl.isConnected || !r) return;
      if (!r.ok) throw new Error((await leerJson(r)).message || 'No se pudieron consultar las plantillas de Meta');
      const data = await r.json();
      if (!listaEl.isConnected) return;
      plantillas = Array.isArray(data.templates) ? data.templates : [];
      if (elegida) elegida = plantillas.find(t => claveDePlantilla(t) === claveDePlantilla(elegida)) ?? null;
      if (!elegida && plantillas.length === 1) elegir(plantillas[0]);
      if (pendienteDeElegir) {
        const creada = plantillas.find(t => claveDePlantilla(t) === pendienteDeElegir);
        if (creada) elegir(creada);
        pendienteDeElegir = '';
      }
      pintarLista();
      if (!listaEl.dataset.animado) { listaEl.dataset.animado = '1'; entradaEscalonada(listaEl); }
      pintarPrevia();
      pintarEnvio();
    } catch (err) {
      if (!listaEl.isConnected) return;
      listaEl.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err?.message || 'No se pudieron cargar las plantillas')}. <button type="button" class="btn btn-secondary" id="pltRetry">Reintentar</button></div>`;
      listaEl.querySelector('#pltRetry')?.addEventListener('click', cargarPlantillas);
    }
  }

  /* ── Destinatarios ── */

  /** Cambia de plantilla; los datos escritos para otra no sirven y se sugieren los de esta. */
  function elegir(plantilla) {
    if (!elegida || claveDePlantilla(elegida) !== claveDePlantilla(plantilla)) {
      origenes = origenesSugeridos(plantilla);
      porPersona = false;
    }
    elegida = plantilla;
  }

  /* Si la plantilla se creó en el panel se sabe qué dato es cada variable:
     el nombre o el programa salen de cada asistente sin que nadie lo elija. */
  function origenesSugeridos(plantilla) {
    const desde = { primer_nombre: 'primer_nombre', nombre_completo: 'nombre', programa: 'programa' };
    const out = {};
    for (const [clave, tipo] of Object.entries(plantilla?.significados ?? {})) {
      if (desde[tipo]) out[clave] = { origen: desde[tipo], texto: '' };
    }
    return out;
  }

  function etiquetaRanura(r) {
    const tipo = elegida?.significados?.[r.clave];
    return tipo && TIPOS_DATO[tipo] ? `${TIPOS_DATO[tipo].etiqueta} · ${r.etiqueta}` : r.etiqueta;
  }

  function ranurasElegida() {
    if (!elegida) return [];
    try { return ranurasDePlantilla(elegida); } catch { return []; }
  }

  /** { listos: [{ telefono, parametros }], incompletos, invalidos, repetidos } */
  function calcular() {
    const ranuras = ranurasElegida();
    const asistentes = fuente === 'evento' && contactables?.eventoId === eventoId ? contactables.asistentes : [];
    return armarDestinatarios({ ranuras, origenes, fuente, asistentes, texto: numerosTexto, porPersona });
  }

  /** Los valores de la primera persona lista, o lo escrito, para la vista previa. */
  function valoresDeMuestra() {
    const ranuras = ranurasElegida();
    if (!ranuras.length) return null;
    const primero = calcular().listos[0];
    return Object.fromEntries(ranuras.map((r, i) => [r.clave, primero?.parametros[i] ?? String(origenes[r.clave]?.texto ?? '').trim()]));
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
      // Solo quien autorizó el contacto y tiene un número al que Meta entrega.
      const aptos = asistentes.filter(a => a.consentimiento && /^[1-9]\d{9,14}$/.test(String(a.whatsapp ?? '')));
      contactables = { eventoId, asistentes: aptos, total: asistentes.length };
    } catch {
      if (!envioEl.isConnected || seq !== secuenciaEvento) return;
      contactables = { eventoId, asistentes: [], total: 0, error: true };
    }
    pintarResumen();
    pintarPrevia();
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
        const { listos, incompletos } = calcular();
        total = listos.length;
        const aptos = contactables.asistentes.length;
        texto = aptos
          ? `<strong>${total}</strong> de ${contactables.total} asistente${contactables.total === 1 ? '' : 's'} recibirá${total === 1 ? '' : 'n'} la plantilla. ${aptos < contactables.total ? 'Los demás no tienen WhatsApp registrado o no autorizaron el contacto.' : ''}`
          : `Ninguno de los ${contactables.total} asistentes tiene WhatsApp y autorización de contacto.`;
        if (incompletos) texto += ` <span class="plt-resumen-falta">${incompletos === 1 ? '1 queda por fuera porque le falta' : `${incompletos} quedan por fuera porque les falta`} un dato del mensaje (por ejemplo, el nombre o el programa).</span>`;
      }
    } else {
      const { listos, invalidos, repetidos, incompletos } = calcular();
      total = listos.length;
      const notas = [
        invalidos ? `${invalidos} no ${invalidos === 1 ? 'es un número válido' : 'son números válidos'}` : '',
        repetidos ? `${repetidos} repetido${repetidos === 1 ? '' : 's'}` : '',
        incompletos ? `${incompletos} sin todos los datos del mensaje` : '',
      ].filter(Boolean).join(' · ');
      texto = total ? `<strong>${total}</strong> persona${total === 1 ? '' : 's'} lista${total === 1 ? '' : 's'}.${notas ? ` ${notas}.` : ''}` : (notas || 'Escribe al menos un número.');
    }
    if (total && ranurasElegida().some(r => !String(origenes[r.clave]?.texto ?? '').trim() && (origenes[r.clave]?.origen ?? 'fijo') === 'fijo') && !(fuente === 'numeros' && porPersona)) {
      texto = 'Llena los datos del mensaje.';
      total = 0;
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
      <div id="pltVariables"></div>
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
      const ranuras = ranurasElegida();
      const lineaEjemplo = ['3001234567', ...ranuras.map(r => r.ejemplo || r.etiqueta.split(' ')[0])].join('; ');
      cuerpo.innerHTML = `
        ${ranuras.length ? `<label class="asis-check plt-por-persona"><input type="checkbox" id="pltPorPersona"${porPersona ? ' checked' : ''}> <span>Cada número lleva sus propios datos</span></label>` : ''}
        <div class="field"><label for="pltNumeros">${porPersona && ranuras.length ? 'Una persona por línea' : 'Números de WhatsApp'}</label>
          <textarea id="pltNumeros" rows="4" placeholder="${porPersona && ranuras.length ? escapeHtml(lineaEjemplo) : '3001234567&#10;573009876543'}">${escapeHtml(numerosTexto)}</textarea>
          <div class="field-help">${porPersona && ranuras.length
            ? `Número y luego cada dato en orden (${ranuras.map(r => escapeHtml(elegida?.significados?.[r.clave] ? TIPOS_DATO[elegida.significados[r.clave]].etiqueta.toLowerCase() : r.etiqueta.split(' ')[0] === 'Final' ? 'final del enlace' : r.etiqueta.split(' ')[0])).join(', ')}), separados por punto y coma. Puedes pegar las columnas desde Excel.`
            : 'Uno por línea o separados por comas.'} Asegúrate de que autorizaron que la UTB los contacte.</div>
        </div>`;
      cuerpo.querySelector('#pltNumeros').addEventListener('input', (event) => { numerosTexto = event.target.value; pintarResumen(); pintarPrevia(); });
      cuerpo.querySelector('#pltPorPersona')?.addEventListener('change', (event) => { porPersona = event.target.checked; pintarEnvio(); pintarPrevia(); });
    }
    pintarVariables();
    envioEl.querySelector('#pltEnviar').addEventListener('click', confirmarEnvio);
    pintarResumen();
    pintarProgreso();
  }

  /* Un campo por cada variable de la plantilla. Con asistentes, el nombre
     puede salir de cada persona; lo demás es igual para todos. */
  function pintarVariables() {
    const caja = envioEl.querySelector('#pltVariables');
    if (!caja) return;
    const ranuras = ranurasElegida();
    if (!ranuras.length || (fuente === 'numeros' && porPersona)) { caja.innerHTML = ''; return; }
    caja.innerHTML = `
      <fieldset class="plt-variables">
        <legend>Datos del mensaje</legend>
        ${ranuras.map(r => {
          const actual = origenes[r.clave] ?? { origen: 'fijo', texto: '' };
          const id = `pltVar_${r.clave.replace(':', '_')}`;
          return `
            <div class="plt-variable-campo">
              <label for="${id}">${escapeHtml(etiquetaRanura(r))}</label>
              <div class="plt-variable-fila">
                ${fuente === 'evento' && r.lugar !== 'boton' ? `
                  <select data-origen="${escapeHtml(r.clave)}" aria-label="De dónde sale ${escapeHtml(r.etiqueta)}">
                    <option value="fijo"${actual.origen === 'fijo' ? ' selected' : ''}>Igual para todos</option>
                    <option value="primer_nombre"${actual.origen === 'primer_nombre' ? ' selected' : ''}>Primer nombre de cada asistente</option>
                    <option value="nombre"${actual.origen === 'nombre' ? ' selected' : ''}>Nombre completo de cada asistente</option>
                    <option value="programa"${actual.origen === 'programa' ? ' selected' : ''}>Programa de cada asistente</option>
                  </select>` : ''}
                <input type="text" id="${id}" data-texto="${escapeHtml(r.clave)}" maxlength="200" value="${escapeHtml(actual.texto ?? '')}"
                  placeholder="${r.ejemplo ? `Ej.: ${escapeHtml(r.ejemplo)}` : ''}"${fuente === 'evento' && actual.origen !== 'fijo' ? ' hidden' : ''}>
              </div>
              ${r.lugar === 'boton' ? `<div class="field-help">Se agrega al final de ${escapeHtml(r.base)}</div>` : ''}
            </div>`;
        }).join('')}
      </fieldset>`;
    caja.querySelectorAll('[data-origen]').forEach(select => select.addEventListener('change', () => {
      const clave = select.dataset.origen;
      origenes[clave] = { ...(origenes[clave] ?? { texto: '' }), origen: select.value };
      const input = caja.querySelector(`[data-texto="${clave}"]`);
      if (input) input.hidden = select.value !== 'fijo';
      pintarResumen();
      pintarPrevia();
    }));
    caja.querySelectorAll('[data-texto]').forEach(input => input.addEventListener('input', () => {
      const clave = input.dataset.texto;
      origenes[clave] = { origen: origenes[clave]?.origen ?? 'fijo', texto: input.value };
      pintarResumen();
      pintarPrevia();
    }));
  }

  /* Antes de enviar se muestra exactamente qué va a llegar y a quién: el
     mensaje no se puede retirar una vez sale. */
  function confirmarEnvio() {
    const ranuras = ranurasElegida();
    const listos = calcular().listos;
    if (!elegida || !listos.length || enviando) return;
    const plantilla = elegida;
    const total = listos.length;
    const personas = `${total} persona${total === 1 ? '' : 's'}`;
    const { encabezadoMedia } = partesPlantilla(plantilla);
    const categoria = CATEGORIAS[String(plantilla.category).toUpperCase()] ?? { label: plantilla.category || 'Otra', color: '#475163' };
    const lotes = Math.ceil(total / MAX_POR_ENVIO);
    const muestra = listos.slice(0, 6).map(d => `<li><span>${escapeHtml(formatTelefono(d.telefono))}</span>${d.parametros.length ? `<span class="plt-confirmar-datos-persona">${escapeHtml(d.parametros.join(' · '))}</span>` : ''}</li>`).join('');
    const valoresPrimero = Object.fromEntries(ranuras.map((r, i) => [r.clave, listos[0].parametros[i]]));
    const avisos = [
      encabezadoMedia ? `Va con ${encabezadoMedia === 'IMAGE' ? 'la imagen' : 'el archivo'} con que Meta aprobó la plantilla; si pesa más de lo que WhatsApp admite, se envía una versión más liviana.` : '',
      String(plantilla.category).toUpperCase() === 'MARKETING' ? 'Es de marketing: Meta puede no entregarla a quien ya recibió varias plantillas de marketing hace poco. Esos casos aparecen como fallidos en el historial.' : '',
      lotes > 1 ? `Se hará en ${lotes} envíos de hasta ${MAX_POR_ENVIO} personas.` : '',
    ].filter(Boolean);
    const dialogo = abrirDialogo({
      titulo: 'Revisa antes de enviar',
      ancho: true,
      cuerpo: `
        <div class="plt-confirmar">
          <div class="plt-chat">${burbujaHtml(plantilla, valoresPrimero)}${total > 1 && ranuras.length ? '<p class="plt-previa-nota">Así le llega a la primera persona de la lista.</p>' : ''}</div>
          <div class="plt-confirmar-datos">
            <dl class="plt-detalle">
              <div><dt>Plantilla</dt><dd>${escapeHtml(plantilla.name)} <span class="badge" style="background:${categoria.color}1f;color:${colorTextoLegible(categoria.color)};">${escapeHtml(categoria.label)}</span></dd></div>
              <div><dt>Para</dt><dd>${escapeHtml(personas)}<span class="asis-sub">${escapeHtml(etiquetaEnvio())}</span></dd></div>
            </dl>
            <ul class="plt-confirmar-numeros" aria-label="Destinatarios">${muestra}${total > 6 ? `<li class="plt-confirmar-mas">y ${total - 6} más</li>` : ''}</ul>
            ${avisos.length ? `<ul class="plt-confirmar-avisos">${avisos.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : ''}
          </div>
        </div>
        <p class="plt-confirmar-final">${icon('alert', 15)} El mensaje sale por WhatsApp apenas confirmes y no se puede retirar.</p>
        <div class="password-dialog-actions">
          <button type="button" class="btn btn-ghost" data-cerrar>Cancelar</button>
          <button type="button" class="btn btn-primary" id="pltConfirmarEnvio" autofocus>${icon('send', 16)} Enviar a ${escapeHtml(personas)}</button>
        </div>`,
    });
    dialogo.el.querySelector('#pltConfirmarEnvio').addEventListener('click', () => {
      dialogo.cerrar();
      void enviar(listos, ranuras.length > 0);
    });
  }

  async function enviar(listos, conDatos) {
    enviando = true;
    errorEnvio = '';
    avisoEnvio = '';
    pintarResumen();
    const progreso = envioEl.querySelector('#pltProgreso');
    const lotes = enLotes(listos);
    const etiqueta = etiquetaEnvio();
    const creados = [];
    let repetidos = 0;
    let error = '';
    for (let i = 0; i < lotes.length; i++) {
      if (progreso) progreso.innerHTML = `<div class="plt-progreso-linea"><span class="spinner"></span> Creando el envío${lotes.length > 1 ? ` ${i + 1} de ${lotes.length}` : ''}…</div>`;
      try {
        const r = await api('/api/tools/broadcast/send', {
          method: 'POST',
          body: JSON.stringify({
            templateName: elegida.name, language: elegida.language, etiqueta,
            ...(conDatos ? { destinatarios: lotes[i] } : { telefonos: lotes[i].map(d => d.telefono) }),
          }),
        });
        if (!r) return;
        const data = await leerJson(r);
        if (!r.ok || !data.job?.id) { error = data.message || `No se pudo crear el envío (HTTP ${r.status})`; break; }
        if (data.repetido) repetidos++;
        creados.push(data.job.id);
      } catch {
        error = 'Se perdió la conexión al crear el envío.';
        break;
      }
    }
    enviando = false;
    if (!envioEl.isConnected) return;
    // Un envío repetido devuelve el mismo trabajo: se muestra una sola vez.
    trabajos = [...new Set([...creados, ...trabajos])].slice(0, 10);
    if (creados.length > repetidos) {
      haptic([10, 20, 10]);
      toast(creados.length === lotes.length ? 'Envío en marcha: puedes seguir trabajando' : 'Solo se creó una parte del envío');
    }
    const aviso = repetidos
      ? `Hoy ya enviaste esta plantilla con los mismos datos a ${repetidos === lotes.length ? 'estas personas' : 'parte de estas personas'}, así que no se volvió a enviar. Para repetirla hay que esperar 24 horas o cambiar algún dato.`
      : '';
    errorEnvio = error;
    avisoEnvio = aviso;
    pintarResumen();
    pintarProgreso();
    void cargarHistorial();
  }

  let avance = new Map();   // id → resumen del envío
  const estadosVistos = new Map();   // id → estado ya mostrado, para animar al completarse

  function pintarProgreso() {
    const error = errorEnvio;
    const aviso = avisoEnvio;
    const progreso = envioEl.querySelector('#pltProgreso');
    if (!progreso) return;
    const lineas = trabajos.map(id => avance.get(id)).filter(Boolean).map(job => {
      const estado = estadoEnvio(job);
      const revisados = job.enviados + job.fallidos;
      const recien = estadosVistos.has(job.id) && estadosVistos.get(job.id) !== 'completado' && job.estado === 'completado';
      estadosVistos.set(job.id, job.estado);
      return `<div class="plt-progreso-linea plt-tono-${estado.tono}${recien ? ' recien-completo' : ''}">
        ${job.estado === 'completado' ? icon(job.fallidos && !job.enviados ? 'x' : 'check', 15) : '<span class="spinner"></span>'}
        <span><strong>${escapeHtml(job.templateName)}</strong> · ${job.estado === 'completado' ? `${job.enviados} de ${job.solicitados} enviados${job.fallidos ? `, ${job.fallidos} con fallo` : ''}` : `${revisados} de ${job.solicitados} revisados`}</span>
      </div>`;
    });
    progreso.innerHTML = `${error ? `<div class="alert alert-error" role="alert">${escapeHtml(error)}</div>` : ''}${aviso ? `<div class="alert alert-info" role="status">${escapeHtml(aviso)}</div>` : ''}${lineas.join('')}`;
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

  main.querySelector('#pltNueva').addEventListener('click', () => abrirNuevaPlantilla((creada) => {
    pendienteDeElegir = `${creada.name}|${creada.language}`;
    void cargarPlantillas();
  }));
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

/* ───────────────────────── Nueva plantilla ───────────────────────── */

/** Una foto del celular puede pesar 8 MB: se achica aquí para no subirla entera. */
async function imagenLigera(archivo) {
  const LADO = 1600;
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.86);
}

function abrirNuevaPlantilla(alCrear) {
  const f = {
    nombre: '', categoria: 'MARKETING', idioma: 'es', encabezado: 'ninguno', titulo: '', tituloVariable: null,
    imagen: '', cuerpo: '', variables: [], pie: '', botones: [],
  };
  const chips = (destino, max) => `
    <div class="np-datos-chips" data-destino="${destino}"${max ? ` data-max="${max}"` : ''}>
      <span class="np-datos-titulo">${icon('plus', 13)} Dato de cada persona:</span>
      ${Object.entries(TIPOS_DATO).map(([tipo, d]) => `<button type="button" class="np-chip" data-tipo="${tipo}">${escapeHtml(d.etiqueta)}</button>`).join('')}
    </div>`;
  const dialogo = abrirDialogo({
    titulo: 'Nueva plantilla',
    ayuda: 'Meta la revisa antes de que se pueda enviar; suele tardar de minutos a 24 horas.',
    ancho: true,
    cuerpo: `
      <form id="npForm" class="np" novalidate>
        <div class="np-campos">
          <div class="field"><label for="npNombre">Nombre</label>
            <input type="text" id="npNombre" maxlength="80" placeholder="Invitación Feria de Posgrados" autocomplete="off" required>
            <div class="field-help" id="npNombreAyuda">Solo para identificarla en el panel; quien la recibe no lo ve.</div>
          </div>
          <div class="field"><div class="np-etiqueta" id="npCategoriaEtiqueta">Tipo de mensaje</div><div id="npCategoria" role="group" aria-labelledby="npCategoriaEtiqueta"></div>
            <div class="field-help" id="npCategoriaAyuda"></div>
          </div>
          <div class="field"><label for="npIdioma">Idioma</label>
            <select id="npIdioma"><option value="es">Español</option><option value="es_CO">Español (Colombia)</option><option value="en_US">Inglés</option></select>
          </div>
          <div class="field"><div class="np-etiqueta" id="npEncEtiqueta">Encabezado (opcional)</div><div id="npEncabezado" role="group" aria-labelledby="npEncEtiqueta"></div>
            <div id="npEncCampo"></div>
          </div>
          <div class="field"><label for="npCuerpo">Mensaje</label>
            <textarea id="npCuerpo" rows="6" maxlength="1024" placeholder="¡Hola! 👋 Te invitamos a…" required></textarea>
            ${chips('cuerpo')}
            <div class="field-help"><span id="npCuenta">0</span>/1.024 · *negrita*, _cursiva_. Los datos aparecen como {{1}}, {{2}}… y se llenan con lo de cada persona al enviar.</div>
            <div id="npDatos"></div>
          </div>
          <div class="field"><label for="npPie">Pie (opcional)</label>
            <input type="text" id="npPie" maxlength="60" placeholder="Posgrados UTB">
          </div>
          <div class="field"><div class="np-etiqueta">Botones (opcional)</div>
            <div id="npBotones"></div>
            <div class="np-botones-acciones">
              <button type="button" class="btn btn-secondary crm-mini-btn" id="npAddRespuesta">${icon('plus', 13)} Respuesta rápida</button>
              <button type="button" class="btn btn-secondary crm-mini-btn" id="npAddEnlace">${icon('link', 13)} Botón con enlace</button>
            </div>
          </div>
        </div>
        <div class="np-previa">
          <div class="np-etiqueta">Así le llegará</div>
          <div class="plt-chat" id="npPrevia"></div>
          <p class="plt-previa-nota" id="npPreviaNota" hidden>Con los ejemplos; a cada persona le llegan sus datos.</p>
        </div>
        <div class="np-pie">
          <div class="password-dialog-message" id="npMensaje" role="alert" aria-live="polite"></div>
          <div class="password-dialog-actions"><button type="button" class="btn btn-ghost" data-cerrar>Cancelar</button><button type="submit" class="btn btn-primary" id="npEnviar">${icon('send', 15)} Enviar a revisión</button></div>
        </div>
      </form>`,
  });
  const el = dialogo.el;
  const $f = (sel) => el.querySelector(sel);
  const AYUDA_CATEGORIA = {
    MARKETING: 'Invitaciones, eventos, convocatorias y novedades. Meta limita cuántas recibe cada persona.',
    UTILITY: 'Avisos sobre algo que la persona ya pidió o inició: su inscripción, una cita, un trámite. Si suena promocional, Meta la pasa a marketing.',
  };
  const opcionesTipo = (actual) => Object.entries(TIPOS_DATO).map(([tipo, d]) => `<option value="${tipo}"${tipo === actual ? ' selected' : ''}>${escapeHtml(d.etiqueta)}</option>`).join('');

  function pintarPrevia() {
    $f('#npPrevia').innerHTML = burbujaHtml(plantillaDesdeFormulario(f), valoresDeEjemplo(f));
    $f('#npPreviaNota').hidden = !(f.variables.length || f.tituloVariable);
    const nombre = nombreTecnico(f.nombre);
    $f('#npNombreAyuda').textContent = nombre ? `Se guardará en Meta como «${nombre}». Quien la recibe no ve el nombre.` : 'Solo para identificarla en el panel; quien la recibe no lo ve.';
    $f('#npCategoriaAyuda').textContent = AYUDA_CATEGORIA[f.categoria];
  }

  /* Un renglón por dato del mensaje: qué es y el ejemplo que verá Meta. */
  function pintarDatos() {
    const caja = $f('#npDatos');
    caja.innerHTML = f.variables.length ? `
      <div class="np-datos">
        <div class="np-datos-cabeza">Ejemplos para Meta <span>Meta los usa para revisar; no se envían a nadie.</span></div>
        ${f.variables.map((v, i) => `
          <div class="np-dato">
            <span class="np-dato-num">{{${i + 1}}}</span>
            <select data-dato="${i}" aria-label="Qué dato es {{${i + 1}}}">${opcionesTipo(v.tipo)}</select>
            <input type="text" data-ejemplo="${i}" maxlength="200" value="${escapeHtml(v.ejemplo)}" placeholder="Ejemplo" aria-label="Ejemplo de {{${i + 1}}}">
          </div>`).join('')}
      </div>` : '';
    caja.querySelectorAll('[data-dato]').forEach(select => select.addEventListener('change', () => {
      const v = f.variables[Number(select.dataset.dato)];
      // Si el ejemplo era el sugerido, se cambia por el del nuevo tipo.
      const sugerido = Object.values(TIPOS_DATO).some(d => d.ejemplo === v.ejemplo);
      v.tipo = select.value;
      if (!v.ejemplo || sugerido) v.ejemplo = TIPOS_DATO[v.tipo].ejemplo;
      pintarDatos();
      pintarPrevia();
    }));
    caja.querySelectorAll('[data-ejemplo]').forEach(input => input.addEventListener('input', () => {
      f.variables[Number(input.dataset.ejemplo)].ejemplo = input.value;
      pintarPrevia();
    }));
  }

  function conectarChips(contenedor, alElegir) {
    contenedor?.querySelectorAll('.np-chip').forEach(boton => {
      // Sin esto, el clic le quita el cursor al texto antes de saber dónde insertar.
      boton.addEventListener('mousedown', (e) => e.preventDefault());
      boton.addEventListener('click', () => alElegir(boton.dataset.tipo));
    });
  }

  conectarChips(el.querySelector('[data-destino="cuerpo"]'), (tipo) => {
    const area = $f('#npCuerpo');
    const r = insertarVariable(area.value, area.selectionStart ?? area.value.length, f.variables, tipo);
    if (r.texto.length > 1024) { $f('#npMensaje').textContent = 'El mensaje llegó al máximo de 1.024 caracteres.'; return; }
    area.value = r.texto;
    f.cuerpo = r.texto;
    f.variables = r.variables;
    area.focus();
    area.setSelectionRange(r.cursor, r.cursor);
    $f('#npCuenta').textContent = r.texto.length;
    pintarDatos();
    pintarPrevia();
  });

  function pintarEncabezado() {
    const campo = $f('#npEncCampo');
    if (f.encabezado === 'texto') {
      campo.innerHTML = `
        <input type="text" id="npTitulo" maxlength="60" placeholder="Feria de Posgrados UTB" aria-label="Título del mensaje">
        <div id="npTituloDato"></div>
        <div class="field-help">Hasta 60 caracteres, en una línea. Admite un dato de cada persona.</div>`;
      const input = $f('#npTitulo');
      input.value = f.titulo;
      const pintarDatoTitulo = () => {
        const caja = $f('#npTituloDato');
        if (f.tituloVariable) {
          caja.innerHTML = `
            <div class="np-dato np-dato-titulo">
              <span class="np-dato-num">{{1}}</span>
              <select id="npTituloTipo" aria-label="Qué dato va en el título">${opcionesTipo(f.tituloVariable.tipo)}</select>
              <input type="text" id="npTituloEjemplo" maxlength="200" value="${escapeHtml(f.tituloVariable.ejemplo)}" placeholder="Ejemplo" aria-label="Ejemplo del dato del título">
            </div>`;
          $f('#npTituloTipo').addEventListener('change', (e) => {
            const sugerido = Object.values(TIPOS_DATO).some(d => d.ejemplo === f.tituloVariable.ejemplo);
            f.tituloVariable.tipo = e.target.value;
            if (!f.tituloVariable.ejemplo || sugerido) f.tituloVariable.ejemplo = TIPOS_DATO[e.target.value].ejemplo;
            pintarDatoTitulo();
            pintarPrevia();
          });
          $f('#npTituloEjemplo').addEventListener('input', (e) => { f.tituloVariable.ejemplo = e.target.value; pintarPrevia(); });
        } else {
          caja.innerHTML = chips('titulo', 1);
          conectarChips(caja, (tipo) => {
            const r = insertarVariable(input.value, input.selectionStart ?? input.value.length, [], tipo);
            if (r.texto.length > 60) { $f('#npMensaje').textContent = 'El título llegó al máximo de 60 caracteres.'; return; }
            input.value = r.texto;
            f.titulo = r.texto;
            f.tituloVariable = r.variables[0];
            input.focus();
            input.setSelectionRange(r.cursor, r.cursor);
            pintarDatoTitulo();
            pintarPrevia();
          });
        }
      };
      input.addEventListener('input', () => {
        f.titulo = input.value;
        // Si borró el dato del título, deja de pedir su ejemplo.
        if (f.tituloVariable && !/\{\{1\}\}/.test(f.titulo)) { f.tituloVariable = null; pintarDatoTitulo(); }
        pintarPrevia();
      });
      pintarDatoTitulo();
    } else if (f.encabezado === 'imagen') {
      campo.innerHTML = '<input type="file" id="npImagen" accept="image/jpeg,image/png" aria-label="Imagen del encabezado"><div class="field-help">JPG o PNG. Se achica sola si es muy pesada.</div>';
      $f('#npImagen').addEventListener('change', async (e) => {
        const archivo = e.target.files?.[0];
        f.imagen = '';
        if (archivo) {
          try { f.imagen = await imagenLigera(archivo); } catch { $f('#npMensaje').textContent = 'No se pudo leer esa imagen. Prueba con otra.'; }
        }
        pintarPrevia();
      });
    } else {
      campo.innerHTML = '';
    }
    pintarPrevia();
  }

  function pintarBotones() {
    const caja = $f('#npBotones');
    caja.innerHTML = f.botones.map((b, i) => `
      <div class="np-boton">
        <span class="np-boton-tipo">${b.tipo === 'enlace' ? icon('link', 14) : icon('message', 14)}</span>
        <input type="text" data-boton="${i}" data-campo="texto" maxlength="25" value="${escapeHtml(b.texto)}" placeholder="${b.tipo === 'enlace' ? 'Ver programas' : 'Quiero más información'}" aria-label="Texto del botón">
        ${b.tipo === 'enlace' ? `<input type="url" data-boton="${i}" data-campo="url" value="${escapeHtml(b.url ?? '')}" placeholder="https://www.utb.edu.co/…" aria-label="Enlace del botón">` : ''}
        <button type="button" class="btn btn-ghost np-quitar" data-quitar="${i}" aria-label="Quitar botón">${icon('x', 14)}</button>
        ${b.tipo === 'enlace' ? `
          <label class="asis-check np-dinamico"><input type="checkbox" data-dinamico="${i}"${b.dinamico ? ' checked' : ''}> <span>El final del enlace cambia por persona (por ejemplo, el evento al que se inscribió)</span></label>
          ${b.dinamico ? `<div class="np-dato np-dato-enlace"><span class="np-dato-num">{{1}}</span><span class="np-enlace-base">${escapeHtml(b.url || 'https://…/')}</span><input type="text" data-boton="${i}" data-campo="ejemplo" value="${escapeHtml(b.ejemplo ?? '')}" placeholder="feria-posgrados" aria-label="Ejemplo del final del enlace"></div>` : ''}` : ''}
      </div>`).join('');
    caja.querySelectorAll('[data-boton]').forEach(input => input.addEventListener('input', () => {
      f.botones[Number(input.dataset.boton)][input.dataset.campo] = input.value;
      if (input.dataset.campo === 'url') { const base = caja.querySelector('.np-enlace-base'); if (base) base.textContent = input.value || 'https://…/'; }
      pintarPrevia();
    }));
    caja.querySelectorAll('[data-dinamico]').forEach(check => check.addEventListener('change', () => {
      f.botones[Number(check.dataset.dinamico)].dinamico = check.checked;
      pintarBotones();
    }));
    caja.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', () => {
      f.botones.splice(Number(b.dataset.quitar), 1);
      pintarBotones();
    }));
    $f('#npAddRespuesta').disabled = f.botones.filter(b => b.tipo === 'respuesta').length >= 3;
    $f('#npAddEnlace').disabled = f.botones.some(b => b.tipo === 'enlace');
    pintarPrevia();
  }

  $f('#npCategoria').appendChild(buildSegmented(
    [{ value: 'MARKETING', label: 'Marketing' }, { value: 'UTILITY', label: 'Utilidad' }],
    f.categoria, (v) => { f.categoria = v; pintarPrevia(); },
  ));
  $f('#npEncabezado').appendChild(buildSegmented(
    [{ value: 'ninguno', label: 'Ninguno' }, { value: 'texto', label: 'Título' }, { value: 'imagen', label: 'Imagen' }],
    f.encabezado, (v) => { f.encabezado = v; if (v !== 'texto') { f.titulo = ''; f.tituloVariable = null; } pintarEncabezado(); },
  ));
  $f('#npNombre').addEventListener('input', (e) => { f.nombre = e.target.value; pintarPrevia(); });
  $f('#npIdioma').addEventListener('change', (e) => { f.idioma = e.target.value; });
  $f('#npCuerpo').addEventListener('input', (e) => {
    const area = e.target;
    // Mantiene {{1}}, {{2}}… seguidos aunque se borre o mueva un dato.
    const r = normalizarVariables(area.value, f.variables);
    if (r.texto !== area.value) {
      const cursor = area.selectionStart;
      area.value = r.texto;
      area.setSelectionRange(cursor, cursor);
    }
    const cambiaron = r.variables.length !== f.variables.length || r.variables.some((v, i) => v !== f.variables[i]);
    f.cuerpo = r.texto;
    f.variables = r.variables;
    $f('#npCuenta').textContent = r.texto.length;
    if (cambiaron) pintarDatos();
    pintarPrevia();
  });
  $f('#npPie').addEventListener('input', (e) => { f.pie = e.target.value; pintarPrevia(); });
  $f('#npAddRespuesta').addEventListener('click', () => { f.botones.push({ tipo: 'respuesta', texto: '' }); pintarBotones(); });
  $f('#npAddEnlace').addEventListener('click', () => { f.botones.push({ tipo: 'enlace', texto: '', url: '', dinamico: false, ejemplo: '' }); pintarBotones(); });
  pintarEncabezado();
  pintarBotones();

  $f('#npForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const mensaje = $f('#npMensaje');
    mensaje.textContent = '';
    if (nombreTecnico(f.nombre).length < 3) { mensaje.textContent = 'Ponle un nombre a la plantilla.'; $f('#npNombre').focus(); return; }
    if (!f.cuerpo.trim()) { mensaje.textContent = 'Escribe el mensaje.'; $f('#npCuerpo').focus(); return; }
    if (f.encabezado === 'texto' && !f.titulo.trim()) { mensaje.textContent = 'Escribe el título o elige «Ninguno».'; $f('#npTitulo')?.focus(); return; }
    if (f.encabezado === 'imagen' && !f.imagen) { mensaje.textContent = 'Elige la imagen del encabezado.'; $f('#npImagen')?.focus(); return; }
    const problema = errorDeVariables(f);
    if (problema) { mensaje.textContent = problema; return; }
    const boton = $f('#npEnviar');
    boton.disabled = true;
    try {
      const r = await api('/api/tools/broadcast/templates', {
        method: 'POST',
        body: JSON.stringify({
          nombre: f.nombre, categoria: f.categoria, idioma: f.idioma, cuerpo: f.cuerpo, pie: f.pie,
          ejemplosCuerpo: f.variables.map(v => v.ejemplo),
          significados: significadosDeFormulario(f),
          encabezado: f.encabezado === 'texto'
            ? { tipo: 'texto', texto: f.titulo, ...(f.tituloVariable ? { ejemplo: f.tituloVariable.ejemplo } : {}) }
            : { tipo: f.encabezado },
          botones: f.botones.filter(b => b.texto.trim() || b.url),
          ...(f.encabezado === 'imagen' ? { imagen: { base64: f.imagen.split(',')[1] ?? '', mime: 'image/jpeg' } } : {}),
        }),
      });
      if (!r || !dialogo.abierto()) return;
      const data = await leerJson(r);
      if (!r.ok) { mensaje.textContent = data.message || 'No se pudo crear la plantilla.'; boton.disabled = false; return; }
      haptic([10, 20, 10]);
      toast('Plantilla enviada a Meta para revisión ✓', 3500);
      dialogo.cerrar();
      alCrear?.(data.plantilla);
    } catch {
      if (dialogo.abierto()) { mensaje.textContent = 'No se pudo crear la plantilla. Revisa tu conexión.'; boton.disabled = false; }
    }
  });
}

export { renderPlantillas };
