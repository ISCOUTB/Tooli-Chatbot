/* ============= INICIO =============
   Responde lo primero que necesita cada rol, con una sola petición
   (GET /api/tools/inicio):
   - asesor: "¿qué debo resolver ahora?" → quién espera, su seguimiento, y un
     aviso solo si algo le impide trabajar;
   - admin: "¿dónde está el riesgo del equipo?" → pendientes, carga por asesor
     y estado técnico.
   Cada bloque trae su propio estado: un bloque que falla muestra su error y
   "Reintentar", nunca un cero ni un "todo al día" que no se comprobó. El menú
   ya lleva a cada sección, así que aquí no hay accesos rápidos. */

import { api } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';

const ETAPAS = [
  ['nuevo', 'Nuevos'], ['contactado', 'Contactados'], ['interesado', 'Interesados'],
  ['inscrito', 'Inscritos'], ['descartado', 'Descartados'],
];
let limpiarInicioActivo = null;

/* Cuánto lleva esperando alguien (una duración, no "hace X"). */
function textoEspera(minutos) {
  if (minutos === null || minutos === undefined || !Number.isFinite(Number(minutos))) return '—';
  const valor = Math.max(0, Math.floor(Number(minutos)));
  if (valor < 60) return `${valor} min`;
  return `${Math.floor(valor / 60)} h`;
}

/* La espera se pinta en amarillo desde 15 minutos y en rojo desde 30. */
function nivelEspera(minutos) {
  const valor = Number(minutos);
  if (!Number.isFinite(valor)) return 'normal';
  if (valor >= 30) return 'alta';
  if (valor >= 15) return 'media';
  return 'normal';
}

function formatoMetrica(valor) {
  return valor === null || valor === undefined || !Number.isFinite(Number(valor)) ? '—' : Number(valor).toLocaleString('es-CO');
}

function estadoAsesor(estado) {
  const estados = {
    disponible: { texto: 'Disponible', clase: 'is-disponible' },
    ocupado: { texto: 'Ocupado', clase: 'is-ocupado' },
    ausente: { texto: 'Ausente', clase: 'is-ausente' },
    desconectado: { texto: 'Desconectado', clase: 'is-desconectado' },
  };
  return estados[estado] ?? estados.desconectado;
}

/* Al asesor, el aviso de servicios va justo debajo de la cola: explica por qué
   algo puede fallar antes de que lo intente. Seguimiento y Hoy comparten fila. */
function bloquesVisibles(rol, datos) {
  if (rol === 'admin') return ['pendiente', 'carga', 'servicios', 'hoy'];
  const bloques = ['atencion'];
  if (datos?.servicios?.estado === 'error' || datos?.servicios?.afectados?.length) bloques.push('servicios');
  bloques.push('seguimiento', 'hoy');
  return bloques;
}

const icono = (nombre, tamano = 18) => `<span class="ini-icon" aria-hidden="true">${icon(nombre, tamano)}</span>`;
const plural = (cantidad, singular, pluralTexto) => cantidad === 1 ? singular : pluralTexto;

function errorBloque(mensaje) {
  return `<div class="ini-error" role="alert"><span>${escapeHtml(mensaje)}</span><button type="button" class="ini-btn ini-btn-subtle" data-ini-retry>${icono('refresh', 16)} Reintentar</button></div>`;
}

function tarjeta(id, titulo, contenido, clases = '') {
  return `<section class="ini-card ${clases}" aria-labelledby="${id}"><div class="ini-card-head"><h2 id="${id}">${titulo}</h2></div>${contenido}</section>`;
}

function metricasHoy(hoy, clases = 'ini-card-compact') {
  if (hoy.estado === 'error') return tarjeta('ini-hoy-title', 'Hoy en el bot', errorBloque('No se pudieron consultar los contadores de hoy.'), clases);
  const metricas = [
    ['Interacciones con el bot', 'interaccionesBot'], ['Derivados a asesor', 'derivadosAsesor'],
    ['Prospectos nuevos', 'prospectosNuevos'], ['Preguntas a la IA', 'preguntasIa'],
  ];
  // Ayer va completo y hoy va por la mitad: se muestra la cifra de referencia,
  // no un porcentaje que haría parecer malo cualquier día a media mañana.
  const ayer = hoy.ayer ?? null;
  return tarjeta('ini-hoy-title', 'Hoy en el bot', `${ayer ? '<p class="ini-sub">Comparado con el total de ayer</p>' : ''}<div class="ini-metrics">${metricas.map(([label, clave]) => `
    <div class="ini-metric"><span class="ini-metric-value"${hoy[clave] === null ? ' title="Sin datos"' : ''}>${escapeHtml(formatoMetrica(hoy[clave]))}</span><span>${escapeHtml(label)}</span>${ayer ? `<small class="ini-metric-ayer">Ayer: ${escapeHtml(formatoMetrica(ayer[clave]))}</small>` : ''}</div>
  `).join('')}</div>`, clases);
}

function filaConversacion(item, { conEspera }) {
  const nivel = nivelEspera(item.esperaMin);
  return `<li class="ini-cola-fila${conEspera ? '' : ' ini-cola-fila-simple'}">
    <div class="ini-cola-texto"><strong>${escapeHtml(item.nombre)}${item.equipo ? ` <small>· ${escapeHtml(item.equipo)}</small>` : ''}</strong><span>${escapeHtml(item.vista || 'Sin texto (audio, imagen o sticker)')}</span></div>
    ${conEspera ? `<span class="ini-espera ini-espera-${nivel}">${escapeHtml(textoEspera(item.esperaMin))}</span>` : ''}
    <button type="button" class="ini-btn ini-btn-subtle ini-btn-sm" data-ini-abrir="${escapeHtml(item.id)}" aria-label="${conEspera ? 'Abrir' : 'Responder'} la conversación de ${escapeHtml(item.nombre)}">${conEspera ? 'Abrir' : 'Responder'}</button>
  </li>`;
}

function atencionAsesor(atencion) {
  if (atencion.estado === 'error') return tarjeta('ini-atencion-title', 'Para atender ahora', errorBloque('No se pudo comprobar quién espera atención.'), 'ini-card-main');
  if (atencion.estado === 'no_configurado') return tarjeta('ini-atencion-title', 'Para atender ahora', '<div class="ini-state"><strong>Atención no está configurada.</strong><span>No es posible comprobar si hay personas esperando.</span></div>', 'ini-card-main');
  const vacio = atencion.sinAsignar === 0 && atencion.misSinLeer === 0;
  const cola = Array.isArray(atencion.cola) ? atencion.cola : null;
  const sinLeer = Array.isArray(atencion.sinLeer) ? atencion.sinLeer : [];
  // Con la cola a la vista, el encabezado cita la misma cifra que su primera fila.
  const esperaMax = cola?.length ? cola[0].esperaMin : atencion.esperaMasLargaMin;
  const nivel = atencion.sinAsignar > 0 ? nivelEspera(esperaMax) : 'normal';
  const partes = [];

  if (vacio) partes.push(`<div class="ini-empty">${icono('check', 22)}<strong>Nadie espera a un asesor</strong></div>`);
  if (atencion.sinAsignar > 0) {
    partes.push(`<div class="ini-cola-head"><p class="ini-cola-total"><strong>${escapeHtml(atencion.sinAsignar)}</strong> ${plural(atencion.sinAsignar, 'persona espera', 'personas esperan')} un asesor</p><span class="ini-espera ini-espera-${nivel}">${icono('clock', 14)} ${plural(atencion.sinAsignar, 'Lleva', 'La más antigua lleva')} ${escapeHtml(textoEspera(esperaMax))}</span></div>`);
    if (cola?.length) {
      const restantes = atencion.sinAsignar - cola.length;
      partes.push(`<ol class="ini-cola" aria-label="Personas en espera, de la que más lleva a la que menos">${cola.map((item) => filaConversacion(item, { conEspera: true })).join('')}</ol>`);
      if (restantes > 0) partes.push(`<p class="ini-sub ini-cola-mas">y ${escapeHtml(restantes)} más en la cola</p>`);
    }
  }
  if (sinLeer.length) {
    partes.push(`<div class="ini-sinleer"><p class="ini-sinleer-title">${icono('message', 16)} ${plural(atencion.misSinLeer, 'Tuya sin leer', `${escapeHtml(atencion.misSinLeer)} tuyas sin leer`)}</p><ol class="ini-cola">${sinLeer.map((item) => filaConversacion(item, { conEspera: false })).join('')}</ol></div>`);
  } else if (atencion.misSinLeer > 0) {
    partes.push(`<p class="ini-sub">${escapeHtml(atencion.misSinLeer)} ${plural(atencion.misSinLeer, 'conversación tuya sin leer', 'conversaciones tuyas sin leer')}</p>`);
  }
  if (!vacio && atencion.sinAsignar > 0 && !cola) {
    partes.push(`<div class="ini-priority-grid"><div><strong>${escapeHtml(atencion.sinAsignar)}</strong><span>Sin asignar</span></div><div><strong>${escapeHtml(atencion.misSinLeer)}</strong><span>Tuyas sin leer</span></div><div><strong>${escapeHtml(textoEspera(atencion.esperaMasLargaMin))}</strong><span>Espera más larga</span></div></div>`);
  }

  // Con la cola a la vista, la acción principal es abrir a quien más lleva.
  const acciones = [
    cola?.length ? `<button type="button" class="ini-btn ini-btn-primary" data-ini-abrir="${escapeHtml(cola[0].id)}">${icono('headset')} Abrir la que más lleva</button>` : '',
    atencion.sinAsignar > 0 ? `<button type="button" class="ini-btn ${cola?.length ? 'ini-btn-secondary' : 'ini-btn-primary'}" data-ini-action="tomar">${cola?.length ? `Ver las ${escapeHtml(atencion.sinAsignar)} en espera` : `${icono('headset')} Tomar una`}</button>` : '',
    atencion.vinculado ? `<button type="button" class="ini-btn ${atencion.sinAsignar > 0 ? 'ini-btn-secondary' : 'ini-btn-primary'}" data-ini-action="mias">Ver las mías ${icono('chevronRight', 15)}</button>` : '',
  ].join('');
  partes.push(acciones ? `<div class="ini-actions">${acciones}</div>` : '');
  if (!atencion.vinculado) partes.push('<p class="ini-help">Tu usuario no tiene cuenta de Atención vinculada, así que no puedes tener conversaciones propias. Pídele a un administrador que la cree.</p>');
  return tarjeta('ini-atencion-title', 'Para atender ahora', partes.join(''), `ini-card-main ini-nivel-${nivel}`);
}

function tareaSeguimiento(iconoNombre, texto, atributos, tono = '') {
  return `<button type="button" class="ini-tarea ${tono}" ${atributos}>${icono(iconoNombre, 17)}<span>${texto}</span>${icono('chevronRight', 15)}</button>`;
}

function seguimientoAsesor(seguimiento, recordatorios) {
  const partes = [];
  if (seguimiento.estado === 'error') partes.push(errorBloque('No se pudo consultar tu seguimiento.'));
  else {
    const mios = seguimiento.mios;
    const total = ETAPAS.reduce((suma, [estado]) => suma + (mios[estado] || 0), 0);
    if (!total) partes.push('<div class="ini-empty ini-empty-small">No tienes prospectos asignados.</div>');
    else {
      const tareas = [];
      if (mios.nuevo > 0) tareas.push(tareaSeguimiento('user', `<strong>${escapeHtml(mios.nuevo)}</strong> ${plural(mios.nuevo, 'nuevo sin contactar', 'nuevos sin contactar')}`, 'data-ini-etapa="nuevo"'));
      if (seguimiento.estancados > 0) tareas.push(tareaSeguimiento('clock', `<strong>${escapeHtml(seguimiento.estancados)}</strong> sin movimiento hace más de ${escapeHtml(seguimiento.diasSinMovimiento ?? 5)} días`, 'data-ini-etapa="contactado"', 'ini-tarea-aviso'));
      if (recordatorios.estado !== 'error' && recordatorios.programadosHoy > 0) tareas.push(tareaSeguimiento('bell', `<strong>${escapeHtml(recordatorios.programadosHoy)}</strong> ${plural(recordatorios.programadosHoy, 'recordatorio sale hoy', 'recordatorios salen hoy')}`, 'data-ini-action="recordatorios-hoy"'));
      partes.push(tareas.length ? `<div class="ini-tareas">${tareas.join('')}</div>` : `<div class="ini-empty ini-empty-small">${icono('check', 18)} Nada pendiente para hoy.</div>`);
      // El embudo resume la cartera; cada etapa sigue llevando a su lista.
      const presentes = ETAPAS.filter(([estado]) => mios[estado] > 0);
      partes.push(`<div class="ini-embudo" aria-hidden="true">${presentes.map(([estado]) => `<span class="ini-embudo-${estado}" style="flex:${mios[estado]}"></span>`).join('')}</div>
        <div class="ini-embudo-leyenda">${presentes.map(([estado, label]) => `<button type="button" data-ini-etapa="${estado}" aria-label="Ver ${escapeHtml(mios[estado])} prospectos ${label.toLowerCase()}"><i class="ini-punto ini-embudo-${estado}"></i>${escapeHtml(mios[estado])} ${mios[estado] === 1 ? estado : label.toLowerCase()}</button>`).join('')}</div>`);
    }
  }
  if (recordatorios.estado === 'error') partes.push(errorBloque('No se pudieron comprobar tus recordatorios.'));
  else if (recordatorios.fallidos > 0) partes.push(`<button type="button" class="ini-notice ini-notice-danger" data-ini-action="recordatorios">${icono('bell')}<span><strong>${escapeHtml(recordatorios.fallidos)} ${plural(recordatorios.fallidos, 'recordatorio falló', 'recordatorios fallaron')}</strong><small>Revisar envíos</small></span>${icono('chevronRight', 16)}</button>`);
  return tarjeta('ini-seguimiento-title', 'Tu seguimiento de hoy', partes.join(''), 'ini-card-half');
}

/* Nombre que reconoce un asesor para cada servicio que revisa /health/deep. */
const NOMBRES_SERVICIO = {
  iceberg: 'Portal Iceberg', sheets: 'Google Sheets', google_sheets: 'Google Sheets', meta: 'WhatsApp',
  meta_whatsapp: 'WhatsApp', chatwoot: 'Atención', redis: 'Base de datos del panel', openai: 'IA del bot',
};

function serviciosAsesor(servicios) {
  if (servicios.estado === 'error') return tarjeta('ini-servicios-title', 'Estado de los servicios', errorBloque('No se pudo comprobar si los servicios están disponibles.'), 'ini-card-alert');
  const titulo = servicios.afectados.length === 1 ? 'Un servicio tiene fallas' : 'Hay servicios con fallas';
  return tarjeta('ini-servicios-title', titulo, `<ul class="ini-service-list">${servicios.afectados.map((item) => `<li class="ini-service ${item.nivel === 'caido' ? 'ini-service-caido' : 'ini-service-degradado'}">${icono('bolt', 15)}<span><strong>${escapeHtml(NOMBRES_SERVICIO[item.servicio] ?? item.servicio.replaceAll('_', ' '))}${item.nivel === 'caido' ? ' no responde' : ' va lento'}.</strong> ${escapeHtml(item.mensaje)}.</span></li>`).join('')}</ul>`, 'ini-card-alert');
}

function pendienteAdmin(datos) {
  const { atencion, seguimiento, recordatorios } = datos;
  const filas = [];
  if (atencion.estado === 'error') filas.push(errorBloque('No se pudo comprobar la bandeja de Atención.'));
  else if (atencion.estado === 'no_configurado') filas.push('<div class="ini-state"><strong>Atención no está configurada.</strong><span>No se puede conocer la espera del equipo.</span></div>');
  else filas.push(`<button type="button" class="ini-pending-row" data-ini-action="tomar"><span>${icono('headset')}<span><strong>${escapeHtml(atencion.sinAsignar)} sin asignar</strong><small>Espera más larga: ${escapeHtml(textoEspera(atencion.esperaMasLargaMin))}</small></span></span>${icono('chevronRight', 16)}</button>`);
  if (seguimiento.estado === 'error') filas.push(errorBloque('No se pudo comprobar el seguimiento del CRM.'));
  else filas.push(`<button type="button" class="ini-pending-row" data-ini-action="sin-asignar"><span>${icono('users')}<span><strong>${escapeHtml(seguimiento.sinAsignar)} en seguimiento sin asesor</strong><small>Contactados o interesados</small></span></span>${icono('chevronRight', 16)}</button>`);
  if (recordatorios.estado === 'error') filas.push(errorBloque('No se pudieron comprobar los recordatorios.'));
  else filas.push(`<button type="button" class="ini-pending-row" data-ini-action="recordatorios"><span>${icono('bell')}<span><strong>${escapeHtml(recordatorios.fallidos)} ${plural(recordatorios.fallidos, 'recordatorio fallido', 'recordatorios fallidos')}</strong><small>${escapeHtml(recordatorios.programadosHoy)} programados para hoy</small></span></span>${icono('chevronRight', 16)}</button>`);
  return tarjeta('ini-pendiente-title', 'Pendiente del equipo', `<div class="ini-pending">${filas.join('')}</div>`, 'ini-card-main');
}

function cargaAdmin(atencion) {
  let contenido;
  if (atencion.estado === 'error') contenido = errorBloque('No se pudo consultar la carga del equipo.');
  else if (atencion.estado === 'no_configurado') contenido = '<div class="ini-state">Atención no está configurada.</div>';
  else {
    const asesores = atencion.porAsesor ?? [];
    contenido = asesores.length ? `<div class="ini-advisors">${asesores.map((asesor) => {
      const estado = estadoAsesor(asesor.estado);
      return `<div class="ini-advisor"><span class="ini-availability ${estado.clase}" aria-label="${estado.texto}"></span><span><strong>${escapeHtml(asesor.nombre)}</strong><small>${estado.texto}</small></span><b>${escapeHtml(asesor.abiertas)} ${plural(asesor.abiertas, 'abierta', 'abiertas')}</b></div>`;
    }).join('')}</div>` : '<div class="ini-empty ini-empty-small">No hay asesores en el equipo.</div>';
  }
  contenido += '<button type="button" class="ini-link" data-ini-action="actividad">Ver Actividad de asesores</button>';
  return tarjeta('ini-carga-title', 'Carga por asesor', contenido);
}

function serviciosAdmin(servicios) {
  let contenido;
  if (servicios.estado === 'error') contenido = errorBloque('No se pudo comprobar el estado técnico.');
  else if (!servicios.afectados.length) contenido = `<div class="ini-technical-ok">${icono('check')}<strong>Todo funciona</strong></div>`;
  else contenido = `<ul class="ini-technical">${servicios.afectados.map((item) => `<li><strong>${escapeHtml(item.servicio.replaceAll('_', ' '))}</strong>: ${escapeHtml(item.mensaje)}${item.detalle ? `<small>${escapeHtml(item.detalle)}</small>` : ''}</li>`).join('')}</ul>`;
  contenido += '<button type="button" class="ini-link" data-ini-action="health">Ver Estado del sistema</button>';
  return tarjeta('ini-tecnico-title', 'Estado técnico', contenido);
}

function esqueleto(nombre, indice) {
  return `<section class="ini-card ${indice === 0 ? 'ini-card-main' : ''}" aria-busy="true" aria-labelledby="ini-skeleton-${indice}"><h2 id="ini-skeleton-${indice}">${nombre}</h2><span class="ini-sr-only" role="status">Cargando ${nombre}</span><div class="ini-skeleton" aria-hidden="true"><i></i><i></i><i></i></div></section>`;
}

function saludo() {
  const nombre = sesion.user.fullName.trim().split(/\s+/)[0];
  // "vie, 30 de oct" → "Vie, 30 de oct": solo la primera letra en mayúscula.
  const fechaCruda = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  const fecha = fechaCruda.charAt(0).toUpperCase() + fechaCruda.slice(1);
  return `<header class="ini-header"><h1>Hola, ${escapeHtml(nombre)} <span>· ${escapeHtml(fecha)}</span></h1></header>`;
}

function conectarAcciones(contenedor, recargar) {
  contenedor.querySelectorAll('[data-ini-retry]').forEach((boton) => boton.addEventListener('click', recargar));
  contenedor.querySelectorAll('[data-ini-etapa]').forEach((boton) => boton.addEventListener('click', () => navigate('registros', { etapa: boton.dataset.iniEtapa, mios: '1' })));
  // Atención abre la conversación que quede en 'atencion.abrir' (el mismo
  // camino que usan los avisos), esté en la lista filtrada o no.
  contenedor.querySelectorAll('[data-ini-abrir]').forEach((boton) => boton.addEventListener('click', () => {
    try { sessionStorage.setItem('atencion.abrir', boton.dataset.iniAbrir); } catch { /* sin almacenamiento solo se abre la bandeja */ }
    navigate('atencion', { asignado: 'todas' });
  }));
  const acciones = {
    tomar: () => navigate('atencion', { asignado: 'sin_asignar' }), mias: () => navigate('atencion', { asignado: 'mias' }),
    recordatorios: () => navigate('recordatorios', { estado: 'fallido' }), 'recordatorios-hoy': () => navigate('recordatorios', { estado: 'programado' }),
    'sin-asignar': () => navigate('registros', { sinAsignar: '1' }),
    health: () => navigate('health'), actividad: () => navigate('actividad'),
  };
  contenedor.querySelectorAll('[data-ini-action]').forEach((boton) => boton.addEventListener('click', acciones[boton.dataset.iniAction]));
}

async function renderHome(main) {
  limpiarInicioActivo?.();
  const rol = sesion.user.role === 'admin' ? 'admin' : 'asesor';
  const nombres = rol === 'admin' ? ['Pendiente del equipo', 'Carga por asesor', 'Estado técnico', 'Hoy en el bot'] : ['Para atender ahora', 'Tu seguimiento de hoy', 'Hoy en el bot'];
  main.innerHTML = `<div class="ini-page" id="inicioPanel">${saludo()}<div class="ini-layout">${nombres.map(esqueleto).join('')}</div></div>`;
  const panel = main.querySelector('#inicioPanel');
  let solicitud = 0;

  const cargar = async () => {
    const actual = ++solicitud;
    panel?.setAttribute('aria-busy', 'true');
    try {
      const respuesta = await api('/api/tools/inicio');
      if (!respuesta?.ok) throw new Error('inicio_no_disponible');
      const datos = await respuesta.json();
      if (actual !== solicitud || !panel?.isConnected) return;
      const bloques = bloquesVisibles(rol, datos);
      const vistas = rol === 'admin' ? {
        pendiente: () => pendienteAdmin(datos), carga: () => cargaAdmin(datos.atencion), hoy: () => metricasHoy(datos.hoy), servicios: () => serviciosAdmin(datos.servicios),
      } : {
        atencion: () => atencionAsesor(datos.atencion), seguimiento: () => seguimientoAsesor(datos.seguimiento, datos.recordatorios), servicios: () => serviciosAsesor(datos.servicios), hoy: () => metricasHoy(datos.hoy, 'ini-card-half'),
      };
      panel.querySelector('.ini-layout').innerHTML = bloques.map((bloque) => vistas[bloque]()).join('');
      panel.removeAttribute('aria-busy');
      conectarAcciones(panel, cargar);
    } catch {
      if (actual !== solicitud || !panel?.isConnected) return;
      panel.querySelector('.ini-layout').innerHTML = `<section class="ini-card ini-general-error" role="alert"><h2>No pudimos cargar Inicio</h2><p>Revisa tu conexión e intenta de nuevo.</p><button type="button" class="ini-btn ini-btn-primary" data-ini-retry>${icono('refresh')} Reintentar</button></section>`;
      panel.removeAttribute('aria-busy');
      conectarAcciones(panel, cargar);
    }
  };

  let eventoTimer;
  let observador;
  const limpiar = () => {
    clearTimeout(eventoTimer);
    window.removeEventListener('tooli:atencion', alCambiarAtencion);
    observador?.disconnect();
    if (limpiarInicioActivo === limpiar) limpiarInicioActivo = null;
  };
  const alCambiarAtencion = () => {
    if (!main.querySelector('#inicioPanel')) { limpiar(); return; }
    clearTimeout(eventoTimer);
    eventoTimer = setTimeout(cargar, 1000);
  };
  observador = new MutationObserver(() => { if (!main.querySelector('#inicioPanel')) limpiar(); });
  limpiarInicioActivo = limpiar;
  window.addEventListener('tooli:atencion', alCambiarAtencion);
  observador.observe(main, { childList: true, subtree: true });
  setPullToRefresh(cargar);
  await cargar();
}

export { bloquesVisibles, estadoAsesor, formatoMetrica, nivelEspera, renderHome, textoEspera };
