import { api } from '../core/api.js';
import { $, $$, escapeHtml, haptic, toast } from '../core/dom.js';
import { icon } from '../core/icons.js';
import {
  burbujaDeOpcion, contenidoMensaje, contenidoNota, estabaAbajo, etiquetaPaso, horaCorta, telefonoSimuladoBonito,
} from '../core/simulador-whatsapp.js';

/* ============= PROBAR EL BOT (simulador de WhatsApp) =============
   El administrador escribe como si fuera un estudiante y ve las respuestas
   reales del bot: el mismo flujo de WhatsApp (sesiones reales en Redis),
   con un número de la zona de pruebas (57 0000…) que nunca sale a Meta.
   Lo que el bot habría hecho fuera (Sheets, Chatwoot, HubSpot, correos…)
   aparece como nota de prueba en la conversación.

   La conversación vive en memoria del módulo: si el administrador va a otra
   pantalla y vuelve, la encuentra igual. */

const PERFILES = [
  { valor: 'nuevo', titulo: 'Aspirante nuevo', ayuda: 'Nunca le ha escrito al bot.' },
  { valor: 'conocido', titulo: 'Aspirante que vuelve', ayuda: 'Ya autorizó sus datos y dio su nombre (Laura Prueba).' },
  { valor: 'estudiante', titulo: 'Estudiante verificado', ayuda: 'Correo UTB ya verificado (uno ficticio de prueba).' },
];

const PRUEBAS_RAPIDAS = [
  'Hola', 'Busco la maestría en finanzas', '¿Cuánto cuesta y cuándo empieza?', 'Me llamo Laura',
  'Quiero hablar con un asesor', 'Llámenme en la tarde', 'agendar', 'mi semestre', 'menu', 'BAJA',
];

const estado = {
  telefono: null,
  perfil: 'nuevo',
  paso: null,
  /** { id, lado: 'yo' | 'bot' | 'nota' | 'aviso', ts, ...mensaje } */
  mensajes: [],
  ocupado: false,
  sondeo: null,
};
let secuencia = 0;
const nuevoId = () => `l${Date.now().toString(36)}${(secuencia += 1)}`;
const sinMovimiento = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

async function pedir(path, opts) {
  const r = await api(path, opts);
  if (!r) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.message || data.error || 'error'), { status: r.status, data });
  return data;
}

const ticks = (leido) => `<span class="wsim-ticks${leido ? ' leido' : ''}" aria-label="${leido ? 'Leído' : 'Enviado'}"><svg viewBox="0 0 18 12" width="16" height="11" aria-hidden="true"><path d="M1 6.5 4.5 10 11 2.5M7 9.5l.6.5L14.5 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

function filaHtml(m) {
  if (m.lado === 'nota') {
    return `<div class="wsim-fila-nota" data-linea="${m.id}"><div class="wsim-nota">${contenidoNota(m)}</div></div>`;
  }
  if (m.lado === 'aviso') {
    return `<div class="wsim-fila-nota" data-linea="${m.id}"><div class="wsim-nota wsim-nota-error" role="alert">${escapeHtml(m.texto)}</div></div>`;
  }
  if (m.lado === 'yo') {
    return `<div class="wsim-fila yo" data-linea="${m.id}">
      <div class="wsim-burbuja yo">
        <div class="wsim-texto">${escapeHtml(m.texto)}</div>
        <span class="wsim-meta">${escapeHtml(horaCorta(m.ts))}${ticks(m.leido)}</span>
      </div></div>`;
  }
  const botones = m.tipo === 'botones'
    ? `<div class="wsim-botones" role="group" aria-label="Respuestas rápidas">${(m.botones ?? []).map(b => `
        <button type="button" class="wsim-boton" data-opcion="${escapeHtml(b.id)}" data-texto="${escapeHtml(b.texto)}">${escapeHtml(b.texto)}</button>`).join('')}</div>`
    : m.tipo === 'lista'
      ? `<div class="wsim-botones"><button type="button" class="wsim-boton wsim-boton-lista" data-lista="${m.id}" aria-haspopup="dialog">${icon('more', 16)}<span>${escapeHtml(m.boton || 'Ver opciones')}</span></button></div>`
      : '';
  return `<div class="wsim-fila bot" data-linea="${m.id}">
    <div class="wsim-grupo${botones ? ' con-botones' : ''}">
      <div class="wsim-burbuja bot${m.tipo === 'imagen' && m.src ? ' con-imagen' : ''}">
        ${contenidoMensaje(m)}
        <span class="wsim-meta">${escapeHtml(horaCorta(m.ts))}</span>
      </div>
      ${botones}
    </div></div>`;
}

async function renderProbarBot(main) {
  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('bot', 26)} Probar el bot</h1>
      <div class="subtitle">Escribe como un estudiante y mira lo que respondería el bot de WhatsApp. Es el flujo real, pero nada sale a WhatsApp, Sheets, HubSpot ni Chatwoot.</div></div>
    </div>
    <div class="wsim">
      <div class="card wsim-control">
        <h2 id="wsimPerfilTitulo">Quién escribe</h2>
        <div class="wsim-perfiles" role="radiogroup" aria-labelledby="wsimPerfilTitulo">
          ${PERFILES.map(p => `
            <label class="wsim-perfil">
              <input type="radio" name="wsimPerfil" value="${p.valor}" ${p.valor === estado.perfil ? 'checked' : ''}>
              <span><strong>${escapeHtml(p.titulo)}</strong><small>${escapeHtml(p.ayuda)}</small></span>
            </label>`).join('')}
        </div>
        <div class="wsim-control-pie">
          <dl class="wsim-datos">
            <div><dt>Paso del flujo</dt><dd id="wsimPaso">—</dd></div>
            <div><dt>Número de prueba</dt><dd id="wsimNumeroDato">—</dd></div>
          </dl>
          <button type="button" class="btn btn-secondary wsim-reiniciar" id="wsimReiniciar">${icon('refresh', 16)} Empezar de nuevo</button>
        </div>
      </div>

      <section class="wsim-telefono" aria-label="Conversación simulada de WhatsApp">
        <header class="wsim-cabecera">
          <div class="wsim-avatar" aria-hidden="true">${icon('bot', 20)}</div>
          <div class="wsim-quien"><strong>Tooli UTB</strong><span id="wsimLinea">en línea</span></div>
          <span class="wsim-chip-prueba" title="Zona de pruebas: nada sale a WhatsApp">Prueba</span>
        </header>
        <div class="wsim-hilo" id="wsimHilo" role="log" aria-live="polite" aria-label="Mensajes de la conversación" tabindex="0">
          <div class="wsim-hilo-inicio">
            <span class="wsim-fecha">Hoy</span>
            <p class="wsim-aviso-zona">🧪 Zona de pruebas. Esta conversación usa el bot real con un número que no existe: <strong>nunca sale a WhatsApp</strong> y no queda en Sheets, HubSpot, Chatwoot, el CRM ni las métricas.</p>
          </div>
          <div id="wsimLineas"></div>
          <div class="wsim-fila bot hidden" id="wsimEscribiendo" aria-hidden="true">
            <div class="wsim-burbuja bot wsim-puntos"><span></span><span></span><span></span></div>
          </div>
        </div>
        <button type="button" class="wsim-bajar hidden" id="wsimBajar" aria-label="Ir a los mensajes nuevos">${icon('chevronLeft', 18)}<span id="wsimBajarN"></span></button>
        <form class="wsim-redactor" id="wsimForm" novalidate>
          <label class="sr-only" for="wsimTexto">Mensaje como estudiante</label>
          <textarea id="wsimTexto" rows="1" maxlength="1024" placeholder="Escribe un mensaje" autocomplete="off" enterkeyhint="send"></textarea>
          <button type="submit" class="wsim-enviar" id="wsimEnviar" aria-label="Enviar mensaje">${icon('send', 20)}</button>
        </form>
        <div class="wsim-hoja-fondo hidden" id="wsimHojaFondo"></div>
      </section>

      <div class="wsim-lado">
        <div class="card wsim-bot" id="wsimBot" aria-live="polite"><h2>Cómo está el bot</h2><p class="field-help">Cargando…</p></div>
        <div class="card">
          <h2>Prueba rápida</h2>
          <p class="field-help">Toca una frase para mandarla tal cual.</p>
          <div class="wsim-rapidas">${PRUEBAS_RAPIDAS.map(t => `<button type="button" class="chip wsim-rapida" data-rapida="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>
        </div>
        <div class="card wsim-salta">
          <h2>Qué se salta</h2>
          <p class="field-help">Corre el flujo real con sesiones reales. Lo que escribiría fuera no se hace y aparece como nota 🧪 en el chat:</p>
          <ul>
            <li>WhatsApp (Meta o Evolution): nada sale, ni a este número ni a otro.</li>
            <li>Google Sheets, HubSpot, CRM del panel y métricas.</li>
            <li>Chatwoot: el paso al asesor llega hasta «Un asesor te responderá», sin crear la conversación.</li>
            <li>Correos: el código de verificación aparece aquí.</li>
            <li>Agenda: lee los horarios reales; la cita de prueba no se guarda.</li>
          </ul>
          <p class="field-help">La IA sí se usa (gasta como una conversación normal) y las sesiones de prueba viven en Redis hasta que empieces de nuevo.</p>
        </div>
      </div>
    </div>`;

  const hilo = $('#wsimHilo', main);
  const lineas = $('#wsimLineas', main);
  const form = $('#wsimForm', main);
  const entrada = $('#wsimTexto', main);
  const botonEnviar = $('#wsimEnviar', main);
  const bajar = $('#wsimBajar', main);
  let sinLeer = 0;

  // ── Pintar ──
  const pintarDatos = () => {
    $('#wsimPaso', main).textContent = etiquetaPaso(estado.paso);
    $('#wsimNumeroDato', main).textContent = estado.telefono ? telefonoSimuladoBonito(estado.telefono) : 'Se asigna al escribir';
  };
  const marcarBajar = () => {
    bajar.classList.toggle('hidden', sinLeer === 0);
    $('#wsimBajarN', main).textContent = sinLeer > 0 ? String(sinLeer) : '';
  };
  const irAbajo = (suave) => {
    hilo.scrollTo({ top: hilo.scrollHeight, behavior: suave && !sinMovimiento() ? 'smooth' : 'auto' });
    sinLeer = 0;
    marcarBajar();
  };
  const agregar = (m, { seguir } = {}) => {
    const abajo = seguir ?? estabaAbajo(hilo);
    estado.mensajes.push(m);
    lineas.insertAdjacentHTML('beforeend', filaHtml(m));
    if (abajo || m.lado === 'yo') irAbajo(true);
    else { sinLeer += 1; marcarBajar(); }
  };
  const repintar = () => {
    lineas.innerHTML = estado.mensajes.map(filaHtml).join('');
    pintarDatos();
    requestAnimationFrame(() => irAbajo(false));
  };
  const escribiendo = (si) => {
    const abajo = estabaAbajo(hilo);
    $('#wsimEscribiendo', main).classList.toggle('hidden', !si);
    $('#wsimLinea', main).textContent = si ? 'escribiendo…' : 'en línea';
    $('#wsimLinea', main).classList.toggle('activo', si);
    if (si && abajo) irAbajo(true);
  };
  const ocupar = (si) => {
    estado.ocupado = si;
    botonEnviar.disabled = si;
    $$('.wsim-boton, .wsim-rapida', main).forEach(b => { b.setAttribute('aria-disabled', String(si)); });
  };
  const marcarLeidos = () => {
    estado.mensajes.forEach(m => { if (m.lado === 'yo') m.leido = true; });
    $$('.wsim-fila.yo .wsim-ticks', lineas).forEach(t => { t.classList.add('leido'); t.setAttribute('aria-label', 'Leído'); });
  };

  // Lo que manda el bot entra de a uno, como en el teléfono (sin animación si el sistema lo pide).
  const recibir = async (mensajes = []) => {
    for (const [i, m] of mensajes.entries()) {
      if (!lineas.isConnected) return;
      if (i > 0 && m.tipo !== 'nota' && !sinMovimiento()) await esperar(260);
      agregar({ ...m, id: nuevoId(), lado: m.tipo === 'nota' ? 'nota' : 'bot' });
    }
  };

  // ── Hablar con la API ──
  const cargarEstadoBot = async () => {
    const caja = $('#wsimBot', main);
    try {
      const e = await pedir('/api/tools/simulador-whatsapp/estado');
      if (!e || !caja.isConnected) return;
      const fila = (encendido, texto, ayuda = '') => `<li class="${encendido ? 'si' : 'no'}"><span class="wsim-punto" aria-hidden="true"></span><span>${escapeHtml(texto)}<span class="sr-only">: ${encendido ? 'encendido' : 'apagado'}</span>${ayuda ? `<small>${escapeHtml(ayuda)}</small>` : ''}</span></li>`;
      caja.innerHTML = `
        <h2>Cómo está el bot</h2>
        ${e.ia ? '' : '<div class="alert alert-warning wsim-sin-ia" role="status"><strong>Sin IA.</strong> El servidor no tiene OPENAI_API_KEY: el bot responde solo con sus reglas y las preguntas abiertas reciben la respuesta de respaldo.</div>'}
        <ul class="wsim-interruptores">
          ${fila(e.ia, 'Asistente con IA', e.ia ? 'Responde preguntas abiertas.' : 'Apagado: solo reglas.')}
          ${fila(e.conversacional, 'Inicio conversacional', e.conversacional ? 'Saludo abierto con botones.' : 'Arranca con la lista «Tu relación con la UTB».')}
          ${fila(e.agenda, 'Agenda con asesores', 'Escribe «agendar» para probarla.')}
          ${fila(e.miSemestre, '«Mi semestre»', 'Para el estudiante verificado.')}
          ${fila(e.flyers, 'Flyers de programas', 'Solo salen con Meta.')}
          ${fila(e.eventoPosgrados, 'Flujo del evento de posgrados', e.eventoPosgrados ? 'Los mensajes van primero a ese flujo.' : 'Apagado: va directo al flujo normal.')}
        </ul>
        <p class="field-help">Mensajería: ${escapeHtml(e.adaptador === 'meta' ? 'Meta (Cloud API)' : 'Evolution')}. Para cambiar algo de esto se edita el .env del servidor.</p>`;
    } catch (err) {
      if (!caja.isConnected) return;
      caja.innerHTML = err?.status === 403
        ? '<div class="alert alert-error">Solo un administrador puede usar el simulador.</div>'
        : '<div class="alert alert-error">No se pudo cargar el estado del bot.</div>';
    }
  };

  const nuevaConversacion = async () => {
    const r = await pedir('/api/tools/simulador-whatsapp/conversaciones', { method: 'POST', body: JSON.stringify({ perfil: estado.perfil }) });
    if (!r) return false;
    estado.telefono = r.telefono;
    estado.paso = r.paso ?? null;
    pintarDatos();
    await recibir(r.mensajes);
    return true;
  };

  const detenerSondeo = () => { if (estado.sondeo) { clearTimeout(estado.sondeo); estado.sondeo = null; } };
  // Si el bot tardó más que el plazo del servidor, lo que llegue después se recoge aquí (máximo 2 minutos).
  const sondear = (intentos = 40) => {
    detenerSondeo();
    if (!intentos || !estado.telefono) return;
    estado.sondeo = setTimeout(async () => {
      if (!lineas.isConnected) return detenerSondeo();
      try {
        const r = await pedir(`/api/tools/simulador-whatsapp/mensajes?telefono=${encodeURIComponent(estado.telefono)}`);
        if (r?.mensajes?.length) { escribiendo(false); marcarLeidos(); await recibir(r.mensajes); }
        if (r) { estado.paso = r.paso ?? estado.paso; pintarDatos(); }
        if (!r?.mensajes?.length) sondear(intentos - 1);
      } catch { sondear(intentos - 1); }
    }, 3000);
  };

  const fallo = (err) => {
    if (err?.status === 429) toast('Vas muy rápido. Espera un momento y vuelve a intentar.');
    else if (err?.status === 403) toast('Solo un administrador puede usar el simulador.');
    else agregar({ id: nuevoId(), lado: 'aviso', ts: Date.now(), texto: 'El bot falló en este paso. Lo de arriba es lo que alcanzó a responder; el detalle quedó en el registro del servidor.' }, { seguir: true });
  };

  const enviar = async (enviarTexto, mostrar = enviarTexto) => {
    const texto = String(enviarTexto ?? '').trim();
    if (!texto || estado.ocupado) return false;
    ocupar(true);
    detenerSondeo();
    try {
      if (!estado.telefono && !(await nuevaConversacion())) return false;
      haptic(8);
      agregar({ id: nuevoId(), lado: 'yo', ts: Date.now(), texto: mostrar, leido: false });
      escribiendo(true);
      try {
        const r = await pedir('/api/tools/simulador-whatsapp/mensajes', { method: 'POST', body: JSON.stringify({ telefono: estado.telefono, texto }) });
        escribiendo(false);
        if (!r) return false;
        marcarLeidos();
        estado.paso = r.paso ?? null;
        pintarDatos();
        await recibir(r.mensajes);
        if (r.pendiente) { escribiendo(true); sondear(); }
      } catch (err) {
        escribiendo(false);
        if (err?.data?.mensajes?.length) await recibir(err.data.mensajes);
        fallo(err);
      }
      return true;
    } catch (err) {
      fallo(err);
      return false;
    } finally {
      ocupar(false);
    }
  };

  const reiniciar = async ({ avisar = true } = {}) => {
    detenerSondeo();
    const anterior = estado.telefono;
    estado.telefono = null;
    estado.paso = null;
    estado.mensajes = [];
    repintar();
    escribiendo(false);
    if (anterior) {
      try { await pedir(`/api/tools/simulador-whatsapp/conversaciones/${encodeURIComponent(anterior)}`, { method: 'DELETE' }); } catch { /* se borra sola en un día */ }
    }
    if (avisar) toast('Conversación nueva: escribe el primer mensaje');
    entrada.focus();
  };

  // ── Lista desplegable (como la hoja de WhatsApp) ──
  const abrirLista = (boton) => {
    const m = estado.mensajes.find(x => x.id === boton.dataset.lista);
    if (!m) return;
    const fondo = $('#wsimHojaFondo', main);
    const idTitulo = `wsimHoja${nuevoId()}`;
    fondo.innerHTML = `
      <div class="wsim-hoja" role="dialog" aria-modal="true" aria-labelledby="${idTitulo}">
        <div class="wsim-hoja-cabeza">
          <button type="button" class="wsim-hoja-cerrar" data-cerrar aria-label="Cerrar">${icon('x', 20)}</button>
          <h3 id="${idTitulo}">${escapeHtml(m.boton || 'Opciones')}</h3>
        </div>
        <form class="wsim-hoja-cuerpo" novalidate>
          ${(m.secciones ?? []).map((s, i) => `
            <fieldset class="wsim-seccion">
              <legend>${escapeHtml(s.titulo || `Opciones ${i + 1}`)}</legend>
              ${s.filas.map(f => `
                <label class="wsim-opcion">
                  <span class="wsim-opcion-txt"><strong>${escapeHtml(f.titulo)}</strong>${f.descripcion ? `<small>${escapeHtml(f.descripcion)}</small>` : ''}</span>
                  <input type="radio" name="wsimOpcion" value="${escapeHtml(f.id)}" data-texto="${escapeHtml(f.titulo)}">
                  <span class="wsim-radio" aria-hidden="true"></span>
                </label>`).join('')}
            </fieldset>`).join('')}
          <div class="wsim-hoja-pie"><button type="submit" class="wsim-hoja-enviar" disabled>${icon('send', 18)}<span>Enviar</span></button></div>
        </form>
      </div>`;
    fondo.classList.remove('hidden');
    const hoja = $('.wsim-hoja', fondo);
    const formLista = $('form', hoja);
    const enviarLista = $('.wsim-hoja-enviar', hoja);
    requestAnimationFrame(() => hoja.classList.add('abierta'));
    const cerrar = () => {
      document.removeEventListener('keydown', teclas);
      fondo.classList.add('hidden');
      fondo.innerHTML = '';
      if (boton.isConnected) boton.focus({ preventScroll: true });
    };
    const teclas = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
      if (e.key !== 'Tab') return;
      // Foco atrapado: Tab no se escapa al chat que queda detrás de la hoja.
      // Un grupo de radios es una sola parada de Tab (la elegida, o la primera): las flechas se mueven dentro.
      const radios = $$('input[name="wsimOpcion"]', hoja);
      const focos = [$('[data-cerrar]', hoja), radios.find(x => x.checked) ?? radios[0], enviarLista].filter(el => el && !el.disabled);
      const primero = focos[0];
      const ultimo = focos[focos.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };
    document.addEventListener('keydown', teclas);
    fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); }, { once: true });
    $('[data-cerrar]', hoja).addEventListener('click', cerrar);
    formLista.addEventListener('change', () => { enviarLista.disabled = !$('input:checked', formLista); });
    formLista.addEventListener('submit', (e) => {
      e.preventDefault();
      const elegida = $('input:checked', formLista);
      if (!elegida) return;
      cerrar();
      const { enviar: id, mostrar } = burbujaDeOpcion({ id: elegida.value, titulo: elegida.dataset.texto });
      enviar(id, mostrar);
    });
    const primera = $('input[name="wsimOpcion"]', hoja);
    setTimeout(() => (primera ?? $('[data-cerrar]', hoja))?.focus({ preventScroll: true }), 40);
  };

  // ── Eventos ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = entrada.value.trim();
    if (!texto || estado.ocupado) return;
    entrada.value = '';
    ajustarAlto();
    const ok = await enviar(texto);
    if (!ok && !entrada.value) entrada.value = texto;
    entrada.focus({ preventScroll: true });
  });
  const ajustarAlto = () => {
    entrada.style.height = 'auto';
    entrada.style.height = `${Math.min(entrada.scrollHeight, 120)}px`;
  };
  entrada.addEventListener('input', ajustarAlto);
  entrada.addEventListener('keydown', (e) => {
    // Enter envía; Mayús+Enter es una línea nueva (como WhatsApp Web).
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  lineas.addEventListener('click', (e) => {
    const boton = e.target.closest('.wsim-boton');
    if (!boton || estado.ocupado) return;
    if (boton.dataset.lista) { abrirLista(boton); return; }
    const { enviar: id, mostrar } = burbujaDeOpcion({ id: boton.dataset.opcion, texto: boton.dataset.texto });
    enviar(id, mostrar);
  });
  hilo.addEventListener('scroll', () => { if (estabaAbajo(hilo)) { sinLeer = 0; marcarBajar(); } }, { passive: true });
  bajar.addEventListener('click', () => irAbajo(true));
  $$('.wsim-rapida', main).forEach(b => b.addEventListener('click', () => enviar(b.dataset.rapida)));
  $('#wsimReiniciar', main).addEventListener('click', () => reiniciar());
  $$('input[name="wsimPerfil"]', main).forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    estado.perfil = r.value;
    const p = PERFILES.find(x => x.valor === r.value);
    // El perfil se prepara al crear el número: cambiarlo empieza otra conversación.
    reiniciar({ avisar: false }).then(() => toast(`Conversación nueva como «${p?.titulo ?? r.value}»`));
  }));

  repintar();
  cargarEstadoBot();
}

export { renderProbarBot };
