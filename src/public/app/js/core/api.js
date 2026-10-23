import { toast } from './dom.js';

async function doLogout() {
  try {
    const response = await api('/api/auth/logout', { method: 'POST' });
    if (!response) return;
    if (!response.ok) throw new Error('Logout failed');
    window.location.href = '/app/login.html';
  } catch {
    toast('No se pudo cerrar sesión. Revisa tu conexión.');
  }
}

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (res.status === 401) { window.location.href = '/app/login.html'; return; }
  return res;
}

export { api, doLogout };
