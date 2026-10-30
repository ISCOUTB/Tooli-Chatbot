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

function textoEspera(minutos) {
  if (minutos === null || minutos === undefined || !Number.isFinite(Number(minutos))) return '—';
  const valor = Math.max(0, Math.floor(Number(minutos)));
  if (valor < 60) return `hace ${valor} min`;
  return `hace ${Math.floor(valor / 60)} h`;
}

function formatoMetrica(valor) {
  return valor === null || valor === undefined || !Number.isFinite(Number(valor)) ? '—' : Number(valor).toLocaleString('es-CO');
}

function bloquesVisibles(rol, datos) {
  if (rol === 'admin') return ['pendiente', 'carga', 'servicios', 'hoy'];
  const bloques = ['atencion', 'seguimiento'];
  if (datos?.servicios?.estado === 'error' || datos?.servicios?.afectados?.length) bloques.push('servicios');
  bloques.push('hoy');
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

function metricasHoy(hoy) {
  if (hoy.estado === 'error') return tarjeta('ini-hoy-title', 'Hoy en el bot', errorBloque('No se pudieron consultar los contadores de hoy.'));
  const metricas = [
    ['Interacciones con el bot', hoy.interaccionesBot], ['Derivados a asesor', hoy.derivadosAsesor],
    ['Prospectos nuevos', hoy.prospectosNuevos], ['Preguntas a la IA', hoy.preguntasIa],
  ];
  return tarjeta('ini-hoy-title', 'Hoy en el bot', `<div class="ini-metrics">${metricas.map(([label, valor]) => `
    <div class="ini-metric"><span class="ini-metric-value"${valor === null ? ' title="Sin datos"' : ''}>${escapeHtml(formatoMetrica(valor))}</span><span>${escapeHtml(label)}</span></div>
  `).join('')}</div>`, 'ini-card-compact');
}

function atencionAsesor(atencion) {
  if (atencion.estado === 'error') return tarjeta('ini-atencion-title', 'Para atender ahora', errorBloque('No se pudo comprobar quién espera atención.'), 'ini-card-main');
  if (atencion.estado === 'no_configurado') return tarjeta('ini-atencion-title', 'Para atender ahora', '<div class="ini-state"><strong>Atención no está configurada.</strong><span>No es posible comprobar si hay personas esperando.</span></div>', 'ini-card-main');
  const vacio = atencion.sinAsignar === 0 && atencion.misSinLeer === 0;
  // "Tomar una" solo si hay a quién tomar; con la bandeja vacía basta con ir a las propias.
  const acciones = [
    atencion.sinAsignar > 0 ? `<button type="button" class="ini-btn ini-btn-primary" data-ini-action="tomar">${icono('headset')} Tomar una</button>` : '',
    atencion.vinculado ? `<button type="button" class="ini-btn ${atencion.sinAsignar > 0 ? 'ini-btn-secondary' : 'ini-btn-primary'}" data-ini-action="mias">Ver las mías ${icono('chevronRight', 15)}</button>` : '',
  ].join('');
  return tarjeta('ini-atencion-title', 'Para atender ahora', `
    ${vacio ? `<div class="ini-empty">${icono('check', 22)}<strong>Nadie espera a un asesor</strong></div>` : `
      <div class="ini-priority-grid"><div><strong>${escapeHtml(atencion.sinAsignar)}</strong><span>Sin asignar</span></div><div><strong>${escapeHtml(atencion.misSinLeer)}</strong><span>Tuyas sin leer</span></div><div><strong>${escapeHtml(textoEspera(atencion.esperaMasLargaMin))}</strong><span>Espera más larga</span></div></div>`}
    ${acciones ? `<div class="ini-actions">${acciones}</div>` : ''}
    ${atencion.vinculado ? '' : '<p class="ini-help">Tu usuario no tiene cuenta de Atención vinculada, así que no puedes tener conversaciones propias. Pídele a un administrador que la cree.</p>'}
  `, 'ini-card-main');
}

function seguimientoAsesor(seguimiento, recordatorios) {
  const partes = [];
  if (seguimiento.estado === 'error') partes.push(errorBloque('No se pudo consultar tu seguimiento.'));
  else {
    const botones = ETAPAS.filter(([estado]) => seguimiento.mios[estado] > 0).map(([estado, label]) => {
      const cantidad = seguimiento.mios[estado];
      return `<button type="button" class="ini-stage" data-ini-etapa="${estado}" aria-label="Ver ${escapeHtml(cantidad)} prospectos ${label.toLowerCase()}"><strong>${escapeHtml(cantidad)}</strong><span>${label}</span>${icono('chevronRight', 14)}</button>`;
    });
    partes.push(botones.length ? `<div class="ini-stages">${botones.join('')}</div>` : '<div class="ini-empty ini-empty-small">No tienes prospectos asignados.</div>');
  }
  if (recordatorios.estado === 'error') partes.push(errorBloque('No se pudieron comprobar tus recordatorios.'));
  else if (recordatorios.fallidos > 0) partes.push(`<button type="button" class="ini-notice ini-notice-danger" data-ini-action="recordatorios">${icono('bell')}<span><strong>${escapeHtml(recordatorios.fallidos)} ${plural(recordatorios.fallidos, 'recordatorio falló', 'recordatorios fallaron')}</strong><small>Revisar envíos</small></span>${icono('chevronRight', 16)}</button>`);
  return tarjeta('ini-seguimiento-title', 'Tu seguimiento', partes.join(''), 'ini-card-compact');
}

function serviciosAsesor(servicios) {
  if (servicios.estado === 'error') return tarjeta('ini-servicios-title', 'Disponibilidad', errorBloque('No se pudo comprobar si los servicios están disponibles.'));
  return tarjeta('ini-servicios-title', 'Esto puede afectar tu trabajo', `<ul class="ini-service-list">${servicios.afectados.map((item) => `<li class="ini-service ${item.nivel === 'caido' ? 'ini-service-caido' : 'ini-service-degradado'}">${icono('bolt')}<span>${escapeHtml(item.mensaje)}</span></li>`).join('')}</ul>`, 'ini-card-alert');
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
    contenido = asesores.length ? `<div class="ini-advisors">${asesores.map((asesor) => `<div class="ini-advisor"><span class="ini-availability ${asesor.disponible ? 'is-online' : ''}" aria-label="${asesor.disponible ? 'Disponible' : 'No disponible'}"></span><span><strong>${escapeHtml(asesor.nombre)}</strong><small>${asesor.disponible ? 'Disponible' : 'No disponible'}</small></span><b>${escapeHtml(asesor.abiertas)} ${plural(asesor.abiertas, 'abierta', 'abiertas')}</b></div>`).join('')}</div>` : '<div class="ini-empty ini-empty-small">No hay asesores en el equipo.</div>';
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
  const acciones = {
    tomar: () => navigate('atencion', { asignado: 'sin_asignar' }), mias: () => navigate('atencion', { asignado: 'mias' }),
    recordatorios: () => navigate('recordatorios', { estado: 'fallido' }), 'sin-asignar': () => navigate('registros', { sinAsignar: '1' }),
    health: () => navigate('health'), actividad: () => navigate('actividad'),
  };
  contenedor.querySelectorAll('[data-ini-action]').forEach((boton) => boton.addEventListener('click', acciones[boton.dataset.iniAction]));
}

async function renderHome(main) {
  limpiarInicioActivo?.();
  const rol = sesion.user.role === 'admin' ? 'admin' : 'asesor';
  const nombres = rol === 'admin' ? ['Pendiente del equipo', 'Carga por asesor', 'Estado técnico', 'Hoy en el bot'] : ['Para atender ahora', 'Tu seguimiento', 'Hoy en el bot'];
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
        atencion: () => atencionAsesor(datos.atencion), seguimiento: () => seguimientoAsesor(datos.seguimiento, datos.recordatorios), servicios: () => serviciosAsesor(datos.servicios), hoy: () => metricasHoy(datos.hoy),
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

export { bloquesVisibles, formatoMetrica, renderHome, textoEspera };
