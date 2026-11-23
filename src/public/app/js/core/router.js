import { api, doLogout } from './api.js';
import { $, $$, escapeHtml, haptic } from './dom.js';
import { avatarTone, initialsFor } from './format.js';
import { icon } from './icons.js';
import { newPasswordError } from './password.js';
import { clearScreenTimers, setPullToRefresh } from './screen.js';
import { sesion } from './session.js';
import { iniciarTiempoReal } from './realtime.js';
import { ActionSheet } from '../ui/sheet.js';

/* Una sola fuente mantiene iguales el orden, los nombres y los iconos del
   menú lateral y de "Más". Inicio queda fuera porque no pertenece a un área. */
const NAV_SECTIONS = [
  { title: 'Atender', routes: [
    { route: 'atencion', icon: 'headset', label: 'Atención' },
    { route: 'conversaciones', icon: 'message', label: 'Conversaciones' },
    // `cap`: solo aparece si el servidor la tiene encendida (AGENDA_ACTIVA; ver agendaActivaEnServidor).
    { route: 'agenda', icon: 'calendar', label: 'Agenda', cap: 'agenda' },
    { route: 'recordatorios', icon: 'clock', label: 'Recordatorios' },
    { route: 'plantillas', icon: 'megaphone', label: 'Plantillas' },
    { route: 'llamadas', icon: 'phone', label: 'Llamadas' },
    // Simulador de WhatsApp: corre el bot real con números de prueba (la API también exige administrador).
    { route: 'probar-bot', icon: 'bot', label: 'Probar el bot', admin: true },
  ] },
  { title: 'Prospectos', routes: [
    { route: 'registros', icon: 'users', label: 'CRM' },
    { route: 'evento-posgrado', icon: 'calendar', label: 'Evento posgrados' },
    { route: 'asistencia', icon: 'qr', label: 'Asistencia' },
  ] },
  { title: 'Estudiantes', routes: [
    { route: 'recibo', icon: 'receipt', label: 'Descargar recibo' },
  ] },
  { title: 'Análisis', routes: [
    { route: 'metricas', icon: 'chart', label: 'Métricas' },
    { route: 'posgrados', icon: 'funnel', label: 'Embudo de posgrados' },
    { route: 'actividad', icon: 'activity', label: 'Actividad de asesores', admin: true },
    { route: 'informes', icon: 'report', label: 'Informes de atención', admin: true },
  ] },
  { title: 'Administración', admin: true, routes: [
    { route: 'usuarios', icon: 'shield', label: 'Asesores', admin: true },
    { route: 'health', icon: 'pulse', label: 'Estado del sistema', admin: true },
  ] },
];
const HOME_ROUTE = { route: 'home', icon: 'home', label: 'Inicio' };
const TAB_ROUTES = [
  HOME_ROUTE,
  { route: 'atencion', icon: 'headset', label: 'Atención' },
  { route: 'conversaciones', icon: 'message', label: 'Chats' },
  { route: 'registros', icon: 'users', label: 'CRM' },
];

const rutaVisible = (route, { esAdmin, caps }) => (!route.admin || esAdmin) && (!route.cap || caps?.[route.cap] === true);

/** Secciones del menú para un rol y unas capacidades del servidor. Pura, para poder probarla. */
function filtrarSecciones(secciones, permisos) {
  return secciones
    .filter(section => !section.admin || permisos.esAdmin)
    .map(section => ({ ...section, routes: section.routes.filter(route => rutaVisible(route, permisos)) }))
    .filter(section => section.routes.length);
}

/** false si la ruta está en el menú pero esta sesión no la ve (rol o función apagada). */
function rutaDisponible(routeName, permisos) {
  const ruta = NAV_SECTIONS.flatMap(section => section.routes).find(item => item.route === routeName);
  return !ruta || rutaVisible(ruta, permisos);
}

const permisosSesion = () => ({ esAdmin: sesion.user?.role === 'admin', caps: sesion.caps });

function seccionesVisibles() {
  return filtrarSecciones(NAV_SECTIONS, permisosSesion());
}

/* La agenda puede estar apagada en el servidor (AGENDA_ACTIVA=false): entonces su
   API responde 404 y la pestaña no se muestra. Ante cualquier duda, apagada. */
async function agendaActivaEnServidor() {
  try {
    const response = await api('/api/tools/agenda/estado');
    if (!response?.ok) return false;
    const data = await response.json();
    return data?.activa === true;
  } catch {
    return false;
  }
}

function moreRoutes() {
  const fijas = new Set(TAB_ROUTES.map(item => item.route));
  return seccionesVisibles().flatMap(section => section.routes.filter(item => !fijas.has(item.route)));
}

function rutaDelHash(hash = location.hash) {
  return hash.replace(/^#/, '').split('?')[0] || 'home';
}

function parametrosRuta() {
  const query = location.hash.replace(/^#/, '').split('?').slice(1).join('?');
  return new URLSearchParams(query);
}

function renderTabBar() {
  const bar = $('#tabBar');
  if (!bar) return;
  const tabs = [...TAB_ROUTES, { route: '__more', icon: 'more', label: 'Más' }];
  bar.innerHTML = tabs.map(tab => `
    <button type="button" class="tab-item" data-tab="${tab.route}" aria-label="${escapeHtml(tab.label)}">
      <span class="tab-notch"></span><span class="tab-icon">${icon(tab.icon, 23)}</span>
      <span class="tab-label">${escapeHtml(tab.label)}</span>
    </button>`).join('');
  $$('.tab-item', bar).forEach(btn => btn.addEventListener('click', () => {
    haptic(10);
    if (btn.dataset.tab === '__more') return openMoreSheet();
    navigate(btn.dataset.tab);
  }));
  updateTabBar(rutaDelHash());
}

function updateTabBar(route) {
  const routeName = String(route).split('?')[0];
  const bar = $('#tabBar');
  if (!bar) return;
  const isMore = moreRoutes().some(item => item.route === routeName);
  $$('.tab-item', bar).forEach(btn => {
    const active = btn.dataset.tab === routeName || (btn.dataset.tab === '__more' && isMore);
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function accionesCuenta() {
  return [
    { label: 'Cambiar contraseña', icon: icon('key', 17), onClick: openPasswordDialog },
    { label: 'Cerrar sesión', icon: icon('logout', 17), destructive: true, onClick: doLogout },
  ];
}

function openMoreSheet() {
  const fijas = new Set(TAB_ROUTES.map(item => item.route));
  const groups = seccionesVisibles().map(section => ({
    title: section.title,
    actions: section.routes.filter(item => !fijas.has(item.route)).map(item => ({
      label: item.label, icon: icon(item.icon, 17), onClick: () => navigate(item.route),
    })),
  })).filter(group => group.actions.length);
  groups.push({ title: 'Cuenta', actions: accionesCuenta() });
  groups.push([{ label: 'Cancelar', cancel: true }]);
  ActionSheet.open({
    title: sesion.user?.fullName ?? 'Más',
    subtitle: sesion.user?.role === 'admin' ? 'Administrador' : 'Asesor',
    groups,
  });
}

const AREAS_PERFIL = { all: 'Todas las áreas', admisiones: 'Admisiones', ti: 'TI', posgrados: 'Posgrados' };

/* El perfil muestra quién tiene la sesión abierta y lo que define qué puede
   hacer: rol, área y si tiene cuenta de Atención (sin ella no recibe chats). */
function perfilAsesor() {
  const u = sesion.user ?? {};
  const rol = u.role === 'admin' ? 'Administrador' : 'Asesor';
  const filas = [
    u.email ? ['mail', 'Correo', u.email] : null,
    ['users', 'Área', AREAS_PERFIL[u.area ?? 'all'] ?? u.area],
    ['headset', 'Atención', u.chatwootUserId ? 'Cuenta vinculada' : 'Sin cuenta: no recibe conversaciones'],
  ].filter(Boolean);
  const el = document.createElement('div');
  el.className = 'perfil';
  el.innerHTML = `
    <div class="perfil-id">
      <span class="perfil-avatar" style="background:${avatarTone(u.username ?? '')}" aria-hidden="true">${escapeHtml(initialsFor('', u.fullName ?? u.username ?? ''))}</span>
      <div class="perfil-nombre"><strong>${escapeHtml(u.fullName ?? '')}</strong><span><span class="perfil-rol">${rol}</span>@${escapeHtml(u.username ?? '')}</span></div>
    </div>
    <dl class="perfil-datos">${filas.map(([nombre, clave, valor]) => `<div>${icon(nombre, 16)}<dt>${clave}</dt><dd>${escapeHtml(valor)}</dd></div>`).join('')}</dl>`;
  return el;
}

function openAccountSheet() {
  ActionSheet.open({
    title: 'Tu perfil',
    clase: 'perfil-sheet',
    contenido: perfilAsesor(),
    groups: [accionesCuenta(), [{ label: 'Cerrar', cancel: true }]],
  });
}

function openPasswordDialog() {
  const focoPrevio = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'password-dialog-backdrop';
  overlay.innerHTML = `
    <div class="password-dialog" role="dialog" aria-modal="true" aria-labelledby="passwordDialogTitle">
      <button type="button" class="password-dialog-close" aria-label="Cerrar">${icon('x', 18)}</button>
      <h2 id="passwordDialogTitle">Cambiar contraseña</h2>
      <p class="password-dialog-help">Al guardarla tendrás que iniciar sesión de nuevo.</p>
      <form id="passwordForm" novalidate>
        <div class="field"><label for="currentPassword">Contraseña actual</label><input type="password" id="currentPassword" autocomplete="current-password" required></div>
        <div class="field"><label for="newPassword">Nueva contraseña</label><input type="password" id="newPassword" autocomplete="new-password" minlength="12" maxlength="72" aria-describedby="passwordHelp" required><div class="field-help" id="passwordHelp">Mínimo 12 caracteres y máximo 72 bytes.</div></div>
        <div class="field"><label for="confirmPassword">Confirmar contraseña</label><input type="password" id="confirmPassword" autocomplete="new-password" minlength="12" maxlength="72" required></div>
        <div class="password-dialog-message" id="passwordMessage" role="alert" aria-live="polite"></div>
        <div class="password-dialog-actions"><button type="button" class="btn btn-ghost" id="cancelPassword">Cancelar</button><button type="submit" class="btn btn-primary" id="savePassword">Cambiar contraseña</button></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector('.password-dialog');
  const form = overlay.querySelector('#passwordForm');
  const message = overlay.querySelector('#passwordMessage');
  let cerrando = false;
  const close = () => {
    if (cerrando) return;
    cerrando = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    if (focoPrevio?.isConnected) focoPrevio.focus({ preventScroll: true });
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const focos = $$('button:not(:disabled), input:not(:disabled)', dialog);
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    if (event.shiftKey && document.activeElement === primero) { event.preventDefault(); ultimo.focus(); }
    else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primero.focus(); }
  };
  document.addEventListener('keydown', onKeydown);
  overlay.querySelector('.password-dialog-close').addEventListener('click', close);
  overlay.querySelector('#cancelPassword').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const currentPassword = overlay.querySelector('#currentPassword').value;
    const newPassword = overlay.querySelector('#newPassword').value;
    const confirmation = overlay.querySelector('#confirmPassword').value;
    const error = newPasswordError(newPassword);
    if (!currentPassword) { message.textContent = 'Escribe tu contraseña actual.'; overlay.querySelector('#currentPassword').focus(); return; }
    if (error) { message.textContent = error; overlay.querySelector('#newPassword').focus(); return; }
    if (newPassword !== confirmation) { message.textContent = 'Las contraseñas nuevas no coinciden.'; overlay.querySelector('#confirmPassword').focus(); return; }
    const save = overlay.querySelector('#savePassword');
    save.disabled = true;
    message.textContent = '';
    try {
      const response = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      if (!response) return;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        message.textContent = data.message || (data.error === 'wrong_current_password' ? 'La contraseña actual no es correcta' : 'No se pudo cambiar la contraseña.');
        if (data.error === 'wrong_current_password') overlay.querySelector('#currentPassword').focus();
        save.disabled = false;
        return;
      }
      message.classList.add('success');
      message.textContent = 'Contraseña cambiada. Te llevaremos a iniciar sesión.';
      form.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
      setTimeout(() => { window.location.href = '/app/login.html'; }, 1200);
    } catch {
      message.textContent = 'No se pudo cambiar la contraseña. Revisa tu conexión.';
      save.disabled = false;
    }
  });
  requestAnimationFrame(() => overlay.classList.add('open'));
  setTimeout(() => overlay.querySelector('#currentPassword')?.focus({ preventScroll: true }), 60);
}

function renderSidebarNav() {
  const nav = $('#nav');
  const sections = seccionesVisibles().map(section => `
    <div class="nav-section"><div class="nav-section-title">${escapeHtml(section.title)}</div>
      ${section.routes.map(item => `<a href="#${item.route}" data-route="${item.route}">${icon(item.icon)}<span>${escapeHtml(item.label)}</span></a>`).join('')}
    </div>`).join('');
  nav.innerHTML = `<span class="nav-indicador" aria-hidden="true"></span><a href="#home" data-route="home" class="nav-home">${icon('home')}<span>Inicio</span></a>${sections}`;
  indicadorListo = false;
  $$('#nav a').forEach(anchor => anchor.addEventListener('click', event => {
    event.preventDefault(); navigate(anchor.dataset.route);
  }));
}

async function init() {
  let data;
  try {
    const response = await api('/api/auth/me');
    if (!response) return;
    if (!response.ok) throw new Error('Sesión no disponible');
    data = await response.json();
    if (!data?.user?.fullName || !data.user.role) throw new Error('Respuesta de sesión inválida');
  } catch {
    $('#main').innerHTML = '<div class="card" role="alert"><h1>No se pudo abrir el panel</h1><p>Revisa tu conexión e intenta de nuevo.</p><button type="button" class="btn btn-primary" id="retrySession">Reintentar</button></div>';
    $('#retrySession').addEventListener('click', init);
    return;
  }
  sesion.user = data.user;
  if (data.urls) sesion.urls = data.urls;
  if (data.capabilities) sesion.caps = data.capabilities;
  sesion.caps = { ...sesion.caps, agenda: await agendaActivaEnServidor() };
  $('#userName').textContent = sesion.user.fullName;
  $('#userRole').textContent = sesion.user.role === 'admin' ? 'Administrador' : 'Asesor';
  const avatar = $('#userAvatar');
  if (avatar) {
    avatar.textContent = initialsFor('', sesion.user.fullName || sesion.user.username);
    avatar.style.background = avatarTone(sesion.user.username);
  }
  renderSidebarNav();
  // Al cambiar el tamaño de la ventana el menú se reacomoda: el indicador se recoloca sin animar.
  window.addEventListener('resize', () => { indicadorListo = false; moverIndicador(); });
  const accountBtn = $('#accountMenuBtn');
  accountBtn.innerHTML = `${icon('more', 18)}<span class="sr-only">Abrir menú de cuenta</span>`;
  accountBtn.addEventListener('click', openAccountSheet);
  renderTabBar();
  iniciarTiempoReal();
  navigate(location.hash.slice(1) || 'home');
  window.addEventListener('hashchange', () => {
    const hash = location.hash.slice(1) || 'home';
    if (hash === currentHash) return; // navigate ya renderizó este hash
    navigate(hash);
  });
}

/* La pastilla turquesa del menú se desliza hasta la sección activa en vez de
   saltar. La primera vez se coloca sin animar. */
let indicadorListo = false;
function moverIndicador() {
  const nav = $('#nav');
  const indicador = nav?.querySelector('.nav-indicador');
  if (!indicador) return;
  const activo = nav.querySelector('a.active');
  if (!activo || !activo.offsetHeight) {
    indicador.style.opacity = '0';
    nav.classList.remove('con-indicador');
    return;
  }
  const inmediato = !indicadorListo;
  if (inmediato) indicador.classList.add('sin-transicion');
  indicador.style.transform = `translateY(${activo.offsetTop}px)`;
  indicador.style.height = `${activo.offsetHeight}px`;
  indicador.style.opacity = '1';
  nav.classList.add('con-indicador');
  if (inmediato) {
    void indicador.offsetWidth;
    indicador.classList.remove('sin-transicion');
    indicadorListo = true;
  }
}

let currentHash = null;
/* El router no importa las pantallas: app.js las registra al arrancar y evita
   así un ciclo de imports entre navegación y pantallas. */
const PANTALLAS = {};
function registrarPantallas(mapa) { Object.assign(PANTALLAS, mapa); }

function navigate(route, params) {
  const routeName = String(route || 'home').replace(/^#/, '').split('?')[0] || 'home';
  let query = '';
  if (params && typeof params === 'object') {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    });
    query = search.toString();
  } else {
    query = String(route || '').replace(/^#/, '').split('?').slice(1).join('?');
  }
  const targetHash = `${routeName}${query ? `?${query}` : ''}`;
  currentHash = targetHash;
  ActionSheet.close();
  setPullToRefresh(null);   // cada pantalla vuelve a registrarse si puede recargarse
  clearScreenTimers();
  if (location.hash.slice(1) !== targetHash) location.hash = targetHash;
  $$('#nav a').forEach(anchor => {
    const active = anchor.dataset.route === routeName;
    anchor.classList.toggle('active', active);
    if (active) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  });
  moverIndicador();
  updateTabBar(routeName);
  const main = $('#main');
  main.classList.remove('page-enter');
  const render = rutaDisponible(routeName, permisosSesion()) ? PANTALLAS[routeName] : null;
  const result = render ? render(main) : (main.innerHTML = '<div class="card">Página no encontrada</div>');
  requestAnimationFrame(() => main.classList.add('page-enter'));
  return result;
}

export {
  NAV_SECTIONS, filtrarSecciones, rutaDisponible, registrarPantallas, navigate, parametrosRuta, init,
  renderSidebarNav, renderTabBar, updateTabBar, moreRoutes, openMoreSheet,
};
