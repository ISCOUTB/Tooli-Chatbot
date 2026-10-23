import { api, doLogout } from './api.js';
import { $, $$, haptic } from './dom.js';
import { icon } from './icons.js';
import { clearScreenTimers, setPullToRefresh } from './screen.js';
import { sesion } from './session.js';
import { ActionSheet } from '../ui/sheet.js';

/* ============= Tab bar móvil ============= */
const TAB_ROUTES = [
  { route: 'home', icon: 'home', label: 'Inicio' },
  { route: 'turno', icon: 'clipboard', label: 'Turno' },
  { route: 'recibo', icon: 'receipt', label: 'Recibo' },
  { route: 'posgrados', icon: 'cap', label: 'Posgrados' },
];
function moreRoutes() {
  const routes = [
    { route: 'metricas', icon: 'chart', label: 'Métricas' },
    { route: 'conversaciones', icon: 'message', label: 'Conversaciones' },
    { route: 'registros', icon: 'users', label: 'Registros BD' },
    { route: 'evento-posgrado', icon: 'bell', label: 'Evento posgrados' },
    { route: 'recordatorios', icon: 'clock', label: 'Recordatorios' },
    { route: 'health', icon: 'pulse', label: 'Estado del sistema' },
  ];
  if (sesion.user?.role === 'admin') {
    routes.push({ route: 'actividad', icon: 'chart', label: 'Actividad de asesores' });
    routes.push({ route: 'usuarios', icon: 'users', label: 'Asesores' });
  }
  return routes;
}

function renderTabBar() {
  const bar = $('#tabBar');
  if (!bar) return;
  const tabs = [...TAB_ROUTES, { route: '__more', icon: 'more', label: 'Más' }];
  bar.innerHTML = tabs.map(t => `
    <button type="button" class="tab-item" data-tab="${t.route}">
      <span class="tab-notch"></span>
      <span class="tab-icon">${icon(t.icon, 23)}</span>
      <span class="tab-label">${t.label}</span>
    </button>
  `).join('');
  $$('.tab-item', bar).forEach(btn => btn.addEventListener('click', () => {
    haptic(10);
    if (btn.dataset.tab === '__more') return openMoreSheet();
    navigate(btn.dataset.tab);
  }));
  updateTabBar(location.hash.slice(1) || 'home');
}

function updateTabBar(route) {
  const bar = $('#tabBar');
  if (!bar) return;
  const isMore = moreRoutes().some(r => r.route === route);
  $$('.tab-item', bar).forEach(btn => {
    const active = btn.dataset.tab === route || (btn.dataset.tab === '__more' && isMore);
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function openMoreSheet() {
  const actions = moreRoutes().map(r => ({ label: r.label, icon: icon(r.icon, 16), onClick: () => navigate(r.route) }));
  actions.push({ label: 'Cerrar sesión', icon: icon('logout', 16), destructive: true, onClick: doLogout });
  ActionSheet.open({
    title: sesion.user?.fullName ?? 'Más',
    subtitle: sesion.user?.role === 'admin' ? 'Administrador' : 'Asesor',
    groups: [actions, [{ label: 'Cancelar', cancel: true }]],
  });
}


const NAV_ROUTES = [
  { route: 'home', icon: 'home', label: 'Inicio' },
  { route: 'turno', icon: 'clipboard', label: 'Consultar turno' },
  { route: 'recibo', icon: 'receipt', label: 'Descargar recibo' },
  { route: 'metricas', icon: 'chart', label: 'Métricas' },
  { route: 'conversaciones', icon: 'message', label: 'Conversaciones' },
  { route: 'posgrados', icon: 'cap', label: 'Posgrados' },
  { route: 'registros', icon: 'users', label: 'CRM · Prospectos' },
  { route: 'evento-posgrado', icon: 'bell', label: 'Evento posgrados' },
  { route: 'recordatorios', icon: 'clock', label: 'Recordatorios' },
  { route: 'health', icon: 'pulse', label: 'Estado del sistema' },
];

function renderSidebarNav() {
  const nav = $('#nav');
  nav.innerHTML = NAV_ROUTES.map(r => `<a href="#${r.route}" data-route="${r.route}">${icon(r.icon)}${r.label}</a>`).join('')
    + (sesion.user?.role === 'admin' ? `<a href="#actividad" data-route="actividad">${icon('pulse')}Actividad de asesores</a><a href="#usuarios" data-route="usuarios" id="navUsuarios">${icon('users')}Asesores</a>` : '');
  $$('#nav a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    navigate(a.dataset.route);
  }));
}

async function init() {
  let data;
  try {
    const r = await api('/api/auth/me');
    if (!r) return;
    if (!r.ok) throw new Error('Sesión no disponible');
    data = await r.json();
    if (!data?.user?.fullName || !data.user.role) throw new Error('Respuesta de sesión inválida');
  } catch {
    $('#main').innerHTML = '<div class="card" role="alert"><h1>No se pudo abrir el panel</h1><p>Revisa tu conexión e intenta de nuevo.</p><button type="button" class="btn btn-primary" id="retrySession">Reintentar</button></div>';
    $('#retrySession').addEventListener('click', init);
    return;
  }
  sesion.user = data.user;
  if (data.urls) sesion.urls = data.urls;
  if (data.capabilities) sesion.caps = data.capabilities;
  $('#userName').textContent = sesion.user.fullName;
  $('#userRole').textContent = sesion.user.role === 'admin' ? 'Administrador' : 'Asesor';
  renderSidebarNav();

  $('#logoutBtn').innerHTML = `${icon('logout', 15)}<span>Cerrar sesión</span>`;
  $('#logoutBtn').addEventListener('click', doLogout);

  renderTabBar();
  navigate(location.hash.slice(1) || 'home');
  window.addEventListener('hashchange', () => {
    const route = location.hash.slice(1) || 'home';
    if (route === currentRoute) return; // ya renderizada por navigate() al fijar el hash — evita doble render
    navigate(route);
  });
}

let currentRoute = null;
/* El router no importa las pantallas: cada pantalla necesita `navigate` y eso
   crearía un ciclo de imports. En su lugar app.js las registra aquí al arrancar,
   así el router solo sabe de rutas y la dependencia va en un solo sentido. */
const PANTALLAS = {};
function registrarPantallas(mapa) {
  Object.assign(PANTALLAS, mapa);
}

function navigate(route) {
  currentRoute = route;
  ActionSheet.close();
  setPullToRefresh(null);   // cada pantalla vuelve a registrarse si puede recargarse
  clearScreenTimers();
  $$('#nav a').forEach(a => {
    const active = a.dataset.route === route;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  updateTabBar(route);
  location.hash = route;
  const main = $('#main');
  main.classList.remove('page-enter');
  const render = PANTALLAS[route];
  const result = render ? render(main) : (main.innerHTML = '<div class="card">Página no encontrada</div>');
  requestAnimationFrame(() => main.classList.add('page-enter'));
  return result;
}

export { registrarPantallas, navigate, init, renderSidebarNav, renderTabBar, updateTabBar, moreRoutes, openMoreSheet };
