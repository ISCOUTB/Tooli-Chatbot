import { api } from './api.js';
import { $, haptic } from './dom.js';
import { icon } from './icons.js';

/* ============= MODO SIN CONEXIÓN ============= */
/* Cache del app shell vía Service Worker (ver sw.js) para que la app cargue
   rápido y siga disponible con mala conexión. Los datos (todo lo que pasa
   por /api/) nunca se cachean — cuando no hay red, cada pantalla ya muestra
   su propio estado de error, esto solo evita que la app en sí quede en blanco. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
  });

  // El service worker avisa cuando el panel cambió en el servidor. No se recarga
  // solo: alguien puede tener un mensaje a medio escribir. Se ofrece y decide.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'shell-actualizado' || $('#versionNueva')) return;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.id = 'versionNueva';
    pill.className = 'version-nueva';
    pill.innerHTML = `${icon('refresh', 14)} Hay una versión nueva del panel · Recargar`;
    pill.addEventListener('click', () => { haptic(12); location.reload(); });
    document.body.appendChild(pill);
  });
}

function updateOfflineBanner() {
  let banner = $('#offlineBanner');
  if (navigator.onLine) {
    banner?.classList.remove('show');
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.className = 'offline-banner';
    banner.innerHTML = `<span class="pulse-dot down"></span> Sin conexión — los datos del panel requieren internet`;
    document.body.appendChild(banner);
  }
  requestAnimationFrame(() => banner.classList.add('show'));
}
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
updateOfflineBanner();

