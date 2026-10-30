// Service worker del panel de asesores. Objetivo puntual: que el shell de la
// app (HTML/CSS) cargue rápido y siga disponible con mala conexión o sin
// internet — nunca cachear /api/* ni el login, porque esos datos deben ser
// siempre frescos y la sesión depende de cookies validadas por el servidor.
const CACHE_NAME = 'tooli-asesores-shell-v4';
const CACHE_PREFIX = 'tooli-asesores-shell-';
const SHELL_URLS = ['/app/index.html', '/app/styles.css', '/app/inicio.css', '/app/js/app.js'];
// El panel dejó de ser un único archivo: ahora son módulos ES bajo /app/js/.
// Se cachean igual que el shell (mismo stale-while-revalidate), porque sin
// ellos el HTML cacheado cargaría una página en blanco al quedarse sin red.
const SHELL_PREFIX = '/app/js/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return; // nunca cachear datos
  if (url.pathname.endsWith('/login.html')) return; // el login siempre debe ir a red

  const isShell = SHELL_URLS.some((p) => url.pathname.endsWith(p)) || url.pathname.startsWith(SHELL_PREFIX);
  if (!isShell) return; // fuentes, CDNs externos, etc. — comportamiento normal del navegador

  // Stale-while-revalidate: responde con la copia en caché al instante (rápido
  // y funciona sin internet) y en paralelo actualiza la caché desde la red
  // para que la próxima carga ya tenga la versión nueva.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then(async (res) => {
          if (!res.ok) return res;
          // Si la copia en red es distinta a la que acabamos de servir, la
          // pestaña abierta está mostrando la versión anterior. En vez de
          // recargarla por sorpresa (se perdería un mensaje a medio escribir),
          // se le avisa para que ofrezca recargar cuando la persona quiera.
          if (cached && haCambiado(cached, res)) avisarClientes();
          await cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);
      // Cuando hay copia local, respondemos enseguida. Mantener vivo el worker
      // hasta que termine la actualización evita que el navegador la descarte.
      if (cached) event.waitUntil(network);
      return cached || (await network) || new Response('Sin conexión', { status: 503, statusText: 'Offline' });
    })
  );
});

/** Compara por ETag, y si el servidor no la manda, por Last-Modified. */
function haCambiado(cached, fresca) {
  const etagA = cached.headers.get('etag');
  const etagB = fresca.headers.get('etag');
  if (etagA && etagB) return etagA !== etagB;
  const lmA = cached.headers.get('last-modified');
  const lmB = fresca.headers.get('last-modified');
  if (lmA && lmB) return lmA !== lmB;
  return false;   // sin forma de comparar, no molestar con avisos falsos
}

async function avisarClientes() {
  const clientes = await self.clients.matchAll({ type: 'window' });
  clientes.forEach((c) => c.postMessage({ type: 'shell-actualizado' }));
}
