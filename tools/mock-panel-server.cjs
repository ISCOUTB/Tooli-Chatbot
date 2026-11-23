/* Servidor de PRUEBA para revisar el panel en el navegador sin Redis, sin Meta
   y sin Google Sheets. Solo expone datos sintéticos en localhost. */
const express = require('express');
const path = require('path');
const app = express();
// Un adjunto de 3 MB ocupa cerca de 4 MB al viajar en base64.
app.use(express.json({ limit: '5mb' }));
// Mismas cabeceras que src/middleware/security.ts, para probar el panel bajo
// el CSP real y no descubrir en producción que algo queda bloqueado.
app.use((_q, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join('; '));
  next();
});

const ROL = process.env.MOCK_ROL || 'admin';
const MOCK_FALLA = new Set(String(process.env.MOCK_FALLA || '').split(',').map(x => x.trim()).filter(Boolean));
const RUTAS_FALLA = {
  metrics: '/api/tools/metrics/range',
  crm_fichas: '/api/tools/crm/fichas',
  registros: '/api/tools/registros-posgrado',
  evento: '/api/tools/registros-evento-posgrado',
  audit: '/api/tools/audit/summary',
};
// La falla se decide antes de las rutas normales para poder combinar varios
// servicios en una sola ejecución: MOCK_FALLA=crm_fichas,metrics.
app.use((req, res, next) => {
  const debeFallar = Object.entries(RUTAS_FALLA).some(([clave, ruta]) => MOCK_FALLA.has(clave) && req.method === 'GET' && req.path === ruta);
  if (debeFallar) return res.status(503).json({ error: 'mock_falla' });
  next();
});
let mockAuthenticated = !process.env.MOCK_ANON;
const hoy = Date.now();
const hace = (min) => hoy - min * 60000;

const CONVS = [
  { phone: '573001234567', session: { step: 'registro_email', data: { nombre: 'María José Restrepo' } }, banned: false, aiDisabled: false,
    lastMessage: { ts: hace(4), direction: 'in', text: 'Hola, quiero info de la maestría en Ingeniería' }, unread: 2 },
  { phone: '573009876543', session: { step: 'esperando_codigo', data: { nombre: 'Carlos Pérez' } }, banned: false, aiDisabled: false,
    lastMessage: { ts: hace(38), direction: 'out', text: 'Tu turno de matrícula es el 12 de octubre' }, unread: 0 },
  { phone: '573015550101', session: { step: 'evento_confirmacion', data: { nombre: 'Valentina Ortiz' } }, banned: false, aiDisabled: true,
    lastMessage: { ts: hace(180), direction: 'in', text: '¿El evento es presencial?' }, unread: 1 },
  { phone: '573021110022', session: { step: 'chatting_with_ai', data: {} }, banned: true, aiDisabled: false,
    lastMessage: { ts: hace(1500), direction: 'in', text: 'aaaaa' }, unread: 0 },
];
const MENSAJES = {
  '573001234567': [
    { ts: hace(12), direction: 'in', text: 'Buenas tardes' },
    { ts: hace(11), direction: 'in', text: 'Quiero info de la maestría en Ingeniería' },
    { ts: hace(10), direction: 'out', text: 'Hola 👋 Con gusto. ¿Me confirmas tu *nombre completo*?' },
    { ts: hace(4), direction: 'in', text: 'María José Restrepo' },
  ],
};

const REGISTROS = [
  ['2026-09-11T12:18:00Z', 'María José Restrepo', 'mjrestrepo@gmail.com', '573001234567', 'Maestría en Ingeniería', 'Posgrado'],
  ['2026-09-10T09:02:00Z', 'Sofía Gómez', 'sofia@gmail.com', '573015550101', 'Ingeniería de Sistemas', 'Pregrado'],
  ['2026-09-09T16:40:00Z', 'Carlos Pérez', 'cperez@gmail.com', '573009876543', 'Especialización en Finanzas', 'Posgrado'],
  ['2026-09-08T11:11:00Z', 'Andrés Lugo', 'alugo@gmail.com', '573022220011', 'Doctorado en Ingeniería', 'Posgrado'],
  ['2026-09-07T08:30:00Z', 'Laura Ríos', 'lrios@gmail.com', '573033330022', 'Administración de Empresas', 'Pregrado'],
];

const EVENTO = [
  ['2026-09-10T10:00:00Z', '573001234567', 'María José Restrepo', 'mj@gmail.com', 'Sí', 'Maestría en Ingeniería', 'Sí', 'interesado'],
  ['2026-09-10T11:00:00Z', '573009876543', 'Carlos Pérez', 'cp@gmail.com', 'Sí, con beca', 'Especialización en Finanzas', 'Sí', 'beca'],
  ['2026-09-09T15:00:00Z', '573021110022', 'Pedro Nel', 'pn@gmail.com', 'No', 'Maestría en Marketing', 'No', 'pendiente'],
];

const AUDIT = {
  admin: { login: 12, turno_consultado: 8, recibo_descargado: 3, sesion_reseteada: 2, mensaje_enviado: 21, recordatorio_creado: 4 },
  luis: { login: 9, turno_consultado: 14, recibo_descargado: 6, usuario_baneado: 1, mensaje_enviado: 33 },
  ana: { login: 7, turno_consultado: 2, mensaje_enviado: 12, ficha_actualizada: 9 },
};

const FICHAS = {
  573001234567: { estado: 'contactado', asignadoA: 'luis', etiquetas: ['beca', 'maestría'],
    notas: [{ id: 'n1', autor: 'luis', ts: hace(120), texto: 'Pidió info de financiación. Le envié el link.' }] },
};
const USUARIOS = [
  { username: 'ángel acero', fullName: 'Ángel Acero', role: 'admin', area: 'all', chatwootUserId: 1 },
  { username: 'luis', fullName: 'Luis Pérez', role: 'asesor', area: 'admisiones', chatwootUserId: 2 },
  { username: 'ana', fullName: 'Ana Díaz', role: 'asesor', area: 'posgrados' },
];
let mockAdminUsername = 'ángel acero';
const normalizarUsuario = texto => String(texto ?? '').trim().toLowerCase();
const sugerirUsuario = nombre => normalizarUsuario(nombre).replace(/ñ/g, 'n').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._]/g, '').slice(0, 30);
const validarUsuario = username => {
  const valor = normalizarUsuario(username);
  if (/[ñáéíóúü]/i.test(valor) || valor.normalize('NFD') !== valor) return `El usuario no puede llevar tildes ni ñ${sugerirUsuario(valor) ? `: usa «${sugerirUsuario(valor)}»` : ''}`;
  if (/\s/.test(valor)) return 'El usuario no puede llevar espacios';
  if (valor.length < 3 || valor.length > 30) return 'El usuario debe tener entre 3 y 30 caracteres';
  if (!/^[a-z0-9._]+$/.test(valor)) return 'El usuario solo puede llevar letras a-z, números, punto y guion bajo';
  if (valor.startsWith('.') || valor.endsWith('.')) return 'El usuario no puede empezar ni terminar en punto';
  if (valor.includes('..')) return 'El usuario no puede llevar dos puntos seguidos';
  if (!/[a-z]/.test(valor)) return 'El usuario debe incluir al menos una letra';
  return null;
};
const validarDatosUsuario = ({ fullName, email, role, area }, requiereNombre) => {
  if ((requiereNombre || fullName !== undefined) && (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 200)) return 'El nombre visible es obligatorio y no puede superar 200 caracteres';
  if (email !== undefined && (typeof email !== 'string' || email.length > 254)) return 'El correo no puede superar 254 caracteres';
  if (role !== undefined && !['admin', 'asesor'].includes(role)) return 'El rol no es válido';
  if (area !== undefined && !['all', 'ti', 'admisiones'].includes(area)) return 'El área no es válida';
  return null;
};
const RECORDATORIOS = [
  { id: 'r1', telefono: '573001234567', mensaje: 'Recuerda tu cita de asesoría mañana', scheduledAt: hoy + 864e5, estado: 'programado', createdBy: 'luis' },
  { id: 'r2', telefono: '573009876543', mensaje: 'Vence tu pago de matrícula', scheduledAt: hoy - 864e5, estado: 'enviado', createdBy: 'admin' },
  { id: 'r3', telefono: '573021110022', mensaje: 'Invitación al evento', scheduledAt: hoy - 2 * 864e5, estado: 'fallido', error: 'Fuera de la ventana de 24h', createdBy: 'ana' },
];
// Eventos del flujo conversacional de posgrados (el menú anterior ya no está en producción).
const METRICAS_HOY = {
  conv_inicio: 38, menu_shown: 12, ai_request: 41, agent_handoff: 6, datos_acepta: 27, datos_rechaza: 4,
  reco_inicio: 19, reco_resultados: 17, reco_ficha: 9, reco_asesor: 6, reco_lead_completado: 4,
  reco_util_si: 7, reco_util_no: 2, no_reconocido: 5, incidencia: 2,
};
// Ayer completo, para que Inicio muestre cada cifra de hoy con su referencia.
const METRICAS_AYER = {
  conv_inicio: 33, menu_shown: 10, ai_request: 36, agent_handoff: 4, datos_acepta: 22, datos_rechaza: 3,
};
const SALUD_MOCK = {
  status: 'degraded',
  timestamp: new Date().toISOString(),
  checks: {
    redis: { status: 'ok', latencyMs: 3, timestamp: hoy },
    meta: { status: 'ok', latencyMs: 210, timestamp: hoy },
    sheets: { status: 'degraded', latencyMs: 1800, detail: 'Cuota casi agotada', timestamp: hoy },
    iceberg: { status: 'down', detail: 'El portal no responde', timestamp: hoy },
    chatwoot: { status: 'ok', latencyMs: 96, timestamp: hoy },
  },
};

const j = (res, data) => res.json(data);

// MOCK_ANON=1 simula "sin sesión", para poder ver la pantalla de login.
app.get('/api/auth/me', (_q, res) => !mockAuthenticated
  ? res.status(401).json({ error: 'no autenticado' })
  : j(res, {
  // Mismos campos que toPublic(user) en el backend: área, correo y cuenta de Atención.
  user: { ...USUARIOS.find(u => u.username === (ROL === 'admin' ? mockAdminUsername : 'luis')), email: ROL === 'admin' ? 'angel.acero@utb.edu.co' : 'luis.perez@utb.edu.co', username: ROL === 'admin' ? mockAdminUsername : 'luis', fullName: ROL === 'admin' ? 'Ángel Acero' : 'Luis Pérez', role: ROL },
  urls: { chatwoot: 'https://chat.example.com', grafana: 'https://grafana.example.com' },
  capabilities: { chatwootSso: true, metaWindow: true },
}));
app.post('/api/auth/login', (req, res) => {
  if (req.body.password !== 'demo') return res.status(401).json({ error: 'invalid_credentials' });
  mockAuthenticated = true;
  j(res, { ok: true });
});
// Cambiar contraseña: en el mock la actual es 'demo' (la misma del login).
app.post('/api/auth/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 12) return res.status(400).json({ error: 'invalid_input' });
  if (currentPassword !== 'demo') return res.status(403).json({ error: 'wrong_current_password', message: 'La contraseña actual no es correcta' });
  mockAuthenticated = false; // el servidor real cierra la sesión al cambiarla
  j(res, { ok: true });
});
app.post('/api/auth/logout', (_q, res) => { mockAuthenticated = false; j(res, { ok: true }); });
app.get('/api/auth/users', (_q, res) => j(res, { users: USUARIOS }));
app.post('/api/auth/users', (req, res) => {
  let { username, fullName, email, role, area } = req.body;
  username = normalizarUsuario(username);
  const usernameError = validarUsuario(username);
  if (usernameError) return res.status(400).json({ error: 'invalid_username', message: usernameError });
  const dataError = validarDatosUsuario({ fullName, email, role, area }, true);
  if (dataError) return res.status(400).json({ error: 'invalid_data', message: dataError });
  if (USUARIOS.some(u => u.username === username)) return res.status(409).json({ error: 'username_taken', message: 'El nombre de usuario ya está en uso' });
  const user = { username, fullName: fullName.trim(), email: email?.trim() || undefined, role: role ?? 'asesor', area: area ?? 'all' };
  USUARIOS.push(user);
  j(res, { ok: true, user });
});
app.patch('/api/auth/users/:username', (req, res) => {
  const viejo = req.params.username;
  const user = USUARIOS.find(u => u.username === viejo);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'El usuario no existe' });
  const self = ROL === 'admin' && viejo === mockAdminUsername;
  if (self && req.body.role !== undefined && req.body.role !== 'admin') return res.status(400).json({ error: 'cannot_demote_self', message: 'No puedes quitarte a ti mismo el rol de administrador' });
  const dataError = validarDatosUsuario(req.body, false);
  if (dataError) return res.status(400).json({ error: 'invalid_data', message: dataError });
  if (user.role === 'admin' && req.body.role === 'asesor' && USUARIOS.filter(u => u.role === 'admin').length <= 1) return res.status(400).json({ error: 'last_admin', message: 'Debe quedar al menos un administrador' });
  if (req.body.username !== undefined) {
    if (typeof req.body.username !== 'string') return res.status(400).json({ error: 'invalid_username', message: 'El usuario debe ser texto' });
    const nuevo = normalizarUsuario(req.body.username);
    if (nuevo !== viejo) {
      const usernameError = validarUsuario(nuevo);
      if (usernameError) return res.status(400).json({ error: 'invalid_username', message: usernameError });
      if (USUARIOS.some(u => u.username === nuevo)) return res.status(409).json({ error: 'username_taken', message: 'El nombre de usuario ya está en uso' });
      user.username = nuevo;
      if (self) mockAdminUsername = nuevo;
    }
  }
  if (req.body.fullName !== undefined) user.fullName = req.body.fullName.trim();
  if (req.body.email !== undefined) user.email = req.body.email.trim() || undefined;
  if (req.body.role !== undefined) user.role = req.body.role;
  if (req.body.area !== undefined) user.area = req.body.area;
  j(res, { user });
});
app.delete('/api/auth/users/:username', (req, res) => {
  const i = USUARIOS.findIndex(u => u.username === req.params.username);
  if (i < 0) return res.status(404).json({ error: 'No existe' });
  USUARIOS.splice(i, 1);
  j(res, { ok: true });
});

app.get('/api/tools/bot-users', (_q, res) => j(res, { phones: CONVS.map(c => c.phone) }));
app.post('/api/tools/bot-users/batch', (req, res) => {
  const pedidos = req.body.phones || CONVS.map(c => c.phone);
  j(res, { users: pedidos.map((phone) => {
    const u = CONVS.find(c => c.phone === phone);
    if (!u) return null;
    const msgs = MENSAJES[phone] || [u.lastMessage];
    return { ...u, recentMessages: [...msgs].reverse() };
  }).filter(Boolean) });
});
app.get('/api/tools/bot-users/:phone', (req, res) => {
  const u = CONVS.find(c => c.phone === req.params.phone) || CONVS[0];
  j(res, { ...u, recentMessages: [...(MENSAJES[req.params.phone] || [u.lastMessage])].reverse() });
});
app.post('/api/tools/bot-users/:phone/reply', (req, res) => {
  const u = CONVS.find(c => c.phone === req.params.phone);
  const latestInbound = [...(MENSAJES[req.params.phone] || (u ? [u.lastMessage] : []))]
    .filter(m => m.direction === 'in').reduce((latest, m) => Math.max(latest, m.ts), 0);
  if (!latestInbound || Date.now() - latestInbound >= 24 * 60 * 60 * 1000) {
    return res.status(409).json({ error: 'fuera_de_ventana', message: 'No hay un mensaje entrante reciente verificable. Usa una plantilla aprobada por Meta.' });
  }
  const msgs = MENSAJES[req.params.phone] || (MENSAJES[req.params.phone] = []);
  msgs.push({ ts: Date.now(), direction: 'out', text: req.body.text });
  j(res, { ok: true });
});
app.post('/api/tools/bot-users/:phone/ai-toggle', (req, res) => j(res, { ok: true, aiDisabled: !!req.body.disabled }));
app.post('/api/tools/bot-users/:phone/:action', (_q, res) => j(res, { ok: true }));

app.get('/api/tools/metrics/today', (_q, res) => j(res, { metrics: METRICAS_HOY }));
app.get('/api/tools/metrics/range', (req, res) => {
  const days = Number(req.query.days || 7);
  const out = {};
  for (let i = 0; i < days; i++) {
    const fecha = new Date(hoy - (days - 1 - i) * 864e5).toISOString().slice(0, 10);
    const noEntendio = { carrera: 1 + (i % 2), ia_sin_dato: i % 3, confusion: i % 2, imagen: i % 4 === 0 ? 1 : 0 };
    const errores = { crm: i % 3 === 0 ? 1 : 0, flyer: i % 5 === 0 ? 1 : 0, ia: i % 4 === 1 ? 1 : 0 };
    out[fecha] = { conv_inicio: 24 + i * 3, menu_shown: 8 + (i % 4), ai_request: 30 + i * 2, agent_handoff: 3 + (i % 3),
      datos_acepta: 18 + i * 2, datos_rechaza: 2 + (i % 3), reco_inicio: 12 + i, reco_resultados: 11 + i, reco_ficha: 6 + (i % 4),
      reco_asesor: 3 + (i % 3), reco_lead_completado: 2 + (i % 2), reco_util_si: 3 + (i % 2), reco_util_no: i % 2,
      conv_sugerencia: 8 + i, ai_reutilizada: 9 + i, conv_regreso: 2 + (i % 2), conv_asesor_sugerido: 1 + (i % 2), audio_transcrito: 2 + (i % 3),
      no_reconocido: Object.values(noEntendio).reduce((a, b) => a + b, 0), incidencia: Object.values(errores).reduce((a, b) => a + b, 0) };
    for (const [paso, n] of Object.entries(noEntendio)) if (n) out[fecha][`no_reconocido:paso:${paso}`] = n;
    for (const [tipo, n] of Object.entries(errores)) if (n) out[fecha][`incidencia:tipo:${tipo}`] = n;
  }
  j(res, { days: out });
});
app.get('/api/tools/metrics/no-reconocidos', (_q, res) => j(res, { textos: [
  { paso: 'carrera', texto: 'ciencias nauticas', fecha: new Date(hace(35)).toISOString() },
  { paso: 'nivel', texto: 'la que sea más barata', fecha: new Date(hace(300)).toISOString() },
  { paso: 'resultados', texto: 'mmm', fecha: new Date(hace(1500)).toISOString() },
  { paso: 'carrera', texto: 'tecnico profesional en [número]', fecha: new Date(hace(3000)).toISOString() },
  { paso: 'ia_sin_dato', texto: '¿la maestría en logística tiene doble titulación?', fecha: new Date(hace(90)).toISOString() },
  { paso: 'confusion', texto: 'no entiendo · al preguntar «¿Qué nivel de posgrado te interesa?»', fecha: new Date(hace(600)).toISOString() },
  { paso: 'imagen', texto: 'una imagen', fecha: new Date(hace(2000)).toISOString() },
] }));
app.get('/api/tools/metrics/preguntas-frecuentes', (_q, res) => j(res, { preguntas: [
  { texto: '¿Cuánto cuesta el MBA?', veces: 41 }, { texto: '¿Hay becas?', veces: 33 }, { texto: '¿Qué maestrías virtuales tienen?', veces: 27 },
  { texto: '¿Cuándo inician las clases?', veces: 19 }, { texto: 'Requisitos para la especialización en gerencia de proyectos', veces: 12 },
  { texto: '¿Tienen descuento para egresados?', veces: 9 }, { texto: '¿Cuánto dura la maestría en ciberseguridad?', veces: 4 },
] }));
app.get('/api/tools/metrics/incidencias', (_q, res) => j(res, { incidencias: [
  { tipo: 'crm', detalle: 'No se pudo guardar el prospecto en la hoja de registros · Google Sheets respondió 503', fecha: new Date(hace(45)).toISOString() },
  { tipo: 'flyer', detalle: 'No se pudo enviar el flyer de Maestría en Ciberseguridad; salió en texto', fecha: new Date(hace(400)).toISOString() },
  { tipo: 'ia', detalle: 'La IA no respondió en la conversación (timeout); se ofreció un asesor', fecha: new Date(hace(1800)).toISOString() },
] }));

// ── Atención: conversaciones con asesor (en producción viven en Chatwoot) ──
// MOCK_ATENCION_OFF=1 simula un servidor sin Chatwoot configurado.
const AGENTES = [
  { id: 1, username: 'ángel acero', nombre: 'Ángel Acero', area: 'Administración', estado: 'online' },
  { id: 2, username: 'luis', nombre: 'Luis Pérez', area: 'Admisiones', estado: 'online' },
  { id: 3, username: 'ana', nombre: 'Ana Díaz', area: 'Posgrados', estado: 'offline' },
  { id: 4, username: 'sofia', nombre: 'Sofía Gómez', area: 'Admisiones', estado: 'online' },
];
const PRESENCIAS = [
  { agenteId: 1, conectado: true, estado: 'disponible', chatwootVinculado: true },
  { agenteId: 2, conectado: true, estado: 'ocupado', chatwootVinculado: true },
  { agenteId: 3, conectado: false, estado: 'ausente', chatwootVinculado: false },
  { agenteId: 4, conectado: true, estado: 'disponible', chatwootVinculado: false },
];
app.post('/api/auth/users/:username/atencion', (req, res) => {
  const user = USUARIOS.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'El usuario no existe' });
  if (!user.email) return res.status(400).json({ error: 'invalid_data', message: 'Agrega un correo al asesor para vincularlo a Atención' });
  if (user.chatwootUserId) return j(res, { user, creado: false });

  let agente = AGENTES.find(a => a.username === user.username);
  if (!agente) {
    const id = Math.max(0, ...AGENTES.map(a => a.id)) + 1;
    agente = { id, username: user.username, nombre: user.fullName, area: user.area, estado: 'offline' };
    AGENTES.push(agente);
  }
  user.chatwootUserId = agente.id;
  const presencia = PRESENCIAS.find(p => p.agenteId === agente.id);
  if (presencia) presencia.chatwootVinculado = true;
  else PRESENCIAS.push({ agenteId: agente.id, conectado: false, estado: 'ausente', chatwootVinculado: true });
  j(res, { user, creado: true });
});
let CONFIG_ATENCION = {
  asignacionAutomatica: true,
  maxAbiertasPorAsesor: 8,
  encuestaSatisfaccion: false,
  avisosCorreo: false,
  horario: { activo: true, dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '17:00' },
};
const EQUIPOS = [{ id: 10, nombre: 'Admisiones' }, { id: 11, nombre: 'Soporte TI' }];
const ETIQUETAS_CUENTA = [
  { nombre: 'posgrado-prospecto', color: '#7c3aed', descripcion: 'Interés en posgrados' },
  { nombre: 'pregrado-prospecto', color: '#2563eb', descripcion: 'Interés en pregrados' },
  { nombre: 'beca', color: '#16a34a', descripcion: 'Consulta por apoyo financiero' },
  { nombre: 'ai-no-resolvio', color: '#d97706', descripcion: 'La IA escaló el caso' },
  { nombre: 'fuera-horario', color: '#64748b', descripcion: null },
  { nombre: 'urgente', color: '#dc2626', descripcion: null },
  { nombre: 'inscrito', color: '#0891b2', descripcion: null },
];
let siguienteMacroId = 3;
const MACROS_ATENCION = [
  { id: 1, nombre: 'Pedir documentos', acciones: { mensaje: 'Hola {nombre}, por favor envíanos los documentos pendientes.', etiquetas: ['documentos-pendientes'] }, creadoPor: 'admin', creadoEn: new Date(hace(4000)).toISOString() },
  { id: 2, nombre: 'Cerrar como inscrito', acciones: { nota: 'La persona confirmó que completó su inscripción.', estado: 'resolved' }, creadoPor: 'admin', creadoEn: new Date(hace(3000)).toISOString() },
];
const msg = (id, tipo, texto, min, autor = null) => ({ id, tipo, texto, ts: hace(min), autor, adjuntos: [] });
const ATENCION = [
  { id: 101, estado: 'open', contacto: { nombre: 'María José Restrepo', telefono: '573001234567' }, asignado: null, equipo: { id: 10, nombre: 'Admisiones' },
    etiquetas: ['posgrado-prospecto'], prioridad: 'medium', noLeidos: 2,
    mensajes: [
      msg(1, 'in', '🎓 Posgrado · Maestría en Ingeniería — María José Restrepo\n\n👤 Nombre: María José Restrepo\n📧 Email: mjrestrepo@gmail.com', 15),
      msg(2, 'nota', 'Viene del flujo de recomendación. Le interesa la financiación.', 14, 'Tooli'),
      msg(3, 'in', 'Hola, ¿tienen becas para la maestría?', 3),
      msg(4, 'in', 'Trabajo en el día, ¿hay horario nocturno?', 2),
    ] },
  { id: 102, estado: 'open', contacto: { nombre: 'Carlos Pérez', telefono: '573009876543' }, asignado: { id: 2, nombre: 'Luis Pérez' }, equipo: { id: 10, nombre: 'Admisiones' },
    etiquetas: [], prioridad: null, noLeidos: 0,
    mensajes: [
      msg(5, 'in', '🆘 Soporte Admisiones · Pregrado\n\n📝 Pregunta: ¿Cuándo es mi turno?', 50),
      msg(6, 'sistema', 'Luis Pérez se asignó la conversación', 48),
      msg(7, 'out', 'Hola Carlos, tu turno es el *12 de octubre* a las 9:00.', 40, 'Luis Pérez'),
    ] },
  { id: 103, estado: 'open', contacto: { nombre: 'Valentina Ortiz', telefono: '573015550101' }, asignado: { id: 1, nombre: 'Ángel Acero' }, equipo: { id: 11, nombre: 'Soporte TI' },
    etiquetas: ['ai-no-resolvio'], prioridad: 'urgent', noLeidos: 1,
    mensajes: [msg(8, 'in', '🆘 Soporte TI · SAVIO\n\n📝 Problema: No puedo entrar a SAVIO', 200), msg(9, 'in', '¿Me pueden ayudar?', 190)] },
  { id: 104, estado: 'pending', contacto: { nombre: 'Andrés Lugo', telefono: '573022220011' }, asignado: { id: 3, nombre: 'Ana Díaz' }, equipo: { id: 10, nombre: 'Admisiones' },
    etiquetas: [], prioridad: null, noLeidos: 0,
    mensajes: [msg(10, 'in', 'Les envío el certificado mañana', 1500), msg(11, 'out', 'Perfecto, quedamos atentos.', 1490, 'Ana Díaz')] },
  { id: 105, estado: 'resolved', contacto: { nombre: 'Laura Ríos', telefono: '573033330022' }, asignado: { id: 2, nombre: 'Luis Pérez' }, equipo: { id: 10, nombre: 'Admisiones' },
    etiquetas: [], prioridad: null, noLeidos: 0,
    mensajes: [msg(12, 'in', 'Gracias, ya pude inscribirme', 3000), msg(13, 'sistema', 'Conversación resuelta por Luis Pérez', 2990)] },
];
const yoAtencion = () => (ROL === 'admin' ? 1 : 2);
const resumenAtencion = ({ mensajes, ...c }) => {
  const u = mensajes[mensajes.length - 1];
  return { ...c, ultimoMensaje: u ? { texto: u.texto, ts: u.ts, tipo: u.tipo } : null, actividadTs: u ? u.ts : 0 };
};
app.use('/api/tools/atencion', (_q, res, next) => process.env.MOCK_ATENCION_OFF
  ? res.status(503).json({ error: 'chatwoot_no_configurado', message: 'La bandeja de atención no está configurada en este servidor.' })
  : next());
// En vivo: los paneles abiertos reciben cada cambio por Server-Sent Events.
const clientesSse = new Set();
const emitirAtencion = (evento) => {
  const linea = `event: atencion\ndata: ${JSON.stringify({ ...evento, ts: Date.now() })}\n\n`;
  clientesSse.forEach(res => res.write(linea));
};
const presenciaActual = () => PRESENCIAS.find(p => p.agenteId === yoAtencion());
const equipoPresencia = () => PRESENCIAS.map(p => {
  const agente = AGENTES.find(a => a.id === p.agenteId);
  const conectado = p.agenteId === 1 && ROL === 'admin' ? clientesSse.size > 0 || p.conectado : p.conectado;
  return {
    username: agente.id === 1 ? mockAdminUsername : agente.username,
    nombre: agente.nombre, area: agente.area, conectado, estado: p.estado,
    disponible: conectado && p.estado === 'disponible' && p.chatwootVinculado,
    chatwootVinculado: p.chatwootVinculado,
  };
});
app.get('/api/tools/atencion/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  clientesSse.add(res);
  presenciaActual().conectado = true;
  emitirAtencion({ tipo: 'presencia' });
  req.on('close', () => {
    clientesSse.delete(res);
    if (!clientesSse.size) presenciaActual().conectado = false;
    emitirAtencion({ tipo: 'presencia' });
  });
});
app.get('/api/tools/atencion/presencia', (_q, res) => {
  const actual = presenciaActual();
  j(res, { yo: { estado: actual.estado, conectado: actual.conectado }, equipo: equipoPresencia() });
});
app.post('/api/tools/atencion/presencia', (req, res) => {
  if (!['disponible', 'ocupado', 'ausente'].includes(req.body.estado)) return res.status(400).json({ message: 'El estado de presencia no es válido.' });
  presenciaActual().estado = req.body.estado;
  emitirAtencion({ tipo: 'presencia' });
  j(res, { ok: true, estado: req.body.estado });
});
const configAtencionValida = config => {
  if (!config || typeof config.asignacionAutomatica !== 'boolean' || typeof config.encuestaSatisfaccion !== 'boolean' || typeof config.avisosCorreo !== 'boolean' || !Number.isInteger(config.maxAbiertasPorAsesor) || config.maxAbiertasPorAsesor < 1 || config.maxAbiertasPorAsesor > 50) return false;
  const horario = config.horario;
  if (!horario || typeof horario.activo !== 'boolean' || !Array.isArray(horario.dias) || horario.dias.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return false;
  if (horario.activo && !horario.dias.length) return false;
  const horaValida = valor => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(valor);
  return horaValida(horario.desde) && horaValida(horario.hasta) && horario.desde < horario.hasta;
};
app.get('/api/tools/atencion/config', (_q, res) => ROL === 'admin'
  ? j(res, { config: CONFIG_ATENCION })
  : res.status(403).json({ message: 'Solo un administrador puede consultar esta configuración.' }));
app.put('/api/tools/atencion/config', (req, res) => {
  if (ROL !== 'admin') return res.status(403).json({ message: 'Solo un administrador puede guardar esta configuración.' });
  if (!configAtencionValida(req.body.config)) return res.status(400).json({ message: 'Revisa el máximo, los días y las horas de atención.' });
  CONFIG_ATENCION = { ...req.body.config, horario: { ...req.body.config.horario, dias: [...new Set(req.body.config.horario.dias)].sort((a, b) => a - b) } };
  j(res, { config: CONFIG_ATENCION });
});
// En espera: abiertas sin asesor de Admisiones (10) o Soporte TI (11).
app.get('/api/tools/atencion/en-espera', (_q, res) => ROL === 'admin'
  ? j(res, { enEspera: ATENCION.filter(c => c.estado === 'open' && !c.asignado && [10, 11].includes(c.equipo?.id)).length })
  : res.status(403).json({ message: 'Solo un administrador puede consultar las conversaciones en espera.' }));
const repartirInforme = (total, pesos) => {
  const partes = pesos.map(peso => Math.floor(total * peso));
  let faltan = total - partes.reduce((suma, valor) => suma + valor, 0);
  for (let i = 0; faltan > 0; i = (i + 1) % partes.length) { partes[i]++; faltan--; }
  return partes;
};
app.get('/api/tools/atencion/informes', (req, res) => {
  if (ROL !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Solo un administrador puede consultar los informes de atención.' });
  const dias = Number(req.query.dias);
  if (![7, 30, 90].includes(dias)) return res.status(400).json({ error: 'periodo_invalido', message: 'El período debe ser de 7, 30 o 90 días.' });
  const hasta = new Date();
  hasta.setUTCHours(0, 0, 0, 0);
  const porDia = Array.from({ length: dias }, (_, indice) => {
    const fecha = new Date(hasta);
    fecha.setUTCDate(fecha.getUTCDate() - (dias - indice - 1));
    const recibidas = 4 + (indice * 3 + dias) % 5;
    return { fecha: fecha.toISOString().slice(0, 10), recibidas, resueltas: Math.max(1, recibidas - (indice % 3 === 0 ? 2 : 1)) };
  });
  const recibidas = porDia.reduce((suma, dia) => suma + dia.recibidas, 0);
  const resueltas = porDia.reduce((suma, dia) => suma + dia.resueltas, 0);
  const sinResponder = Math.max(2, Math.round(recibidas * 0.08));
  const respondidas = recibidas - sinResponder;
  const csatRespuestas = Math.max(3, Math.round(resueltas * 0.42));
  const distribuidos = repartirInforme(csatRespuestas, [0.03, 0.06, 0.14, 0.31, 0.46]);
  const csatDistribucion = Object.fromEntries(distribuidos.map((cantidad, indice) => [indice + 1, cantidad]));
  const csatPromedio = distribuidos.reduce((suma, cantidad, indice) => suma + cantidad * (indice + 1), 0) / csatRespuestas;
  const pesos = [0.25, 0.36, 0.27, 0.12];
  const respuestasPorAsesor = repartirInforme(respondidas, pesos);
  const resueltasPorAsesor = repartirInforme(resueltas, pesos);
  const csatPorAsesor = repartirInforme(csatRespuestas, pesos);
  const filas = [
    { username: mockAdminUsername, nombre: USUARIOS.find(u => u.username === mockAdminUsername)?.fullName ?? 'Ángel Acero' },
    { username: 'luis', nombre: 'Luis Pérez' },
    { username: 'ana', nombre: 'Ana Díaz' },
    { username: null, nombre: null },
  ].map((asesor, indice) => ({
    ...asesor,
    respondidas: respuestasPorAsesor[indice], resueltas: resueltasPorAsesor[indice],
    primeraRespuestaMedianaMin: [11, 8, 17, 24][indice] + Math.floor(dias / 30),
    resolucionMedianaMin: [190, 145, 260, 330][indice] + dias,
    csatPromedio: [4.6, 4.8, 4.3, 4.1][indice], csatRespuestas: csatPorAsesor[indice],
  }));
  const desde = porDia[0].fecha;
  j(res, {
    periodo: { dias, desde, hasta: porDia.at(-1).fecha },
    totales: {
      recibidas, respondidas, resueltas, sinResponder,
      primeraRespuestaMedianaMin: 12 + Math.floor(dias / 30), resolucionMedianaMin: 205 + dias,
      csatPromedio: Number(csatPromedio.toFixed(1)), csatRespuestas, csatDistribucion,
    },
    porAsesor: filas, porDia,
    notas: ['Las medianas excluyen conversaciones que todavía no tienen respuesta.', '“Hecho en Chatwoot” reúne acciones realizadas fuera del panel.'],
  });
});
app.get('/api/tools/atencion/resumen', (_q, res) => {
  const abiertas = ATENCION.filter(c => c.estado === 'open');
  const sinAsignar = abiertas.filter(c => !c.asignado).length;
  const misSinLeer = abiertas.filter(c => c.asignado?.id === yoAtencion() && c.noLeidos > 0).length;
  j(res, { sinAsignar, misSinLeer, pendientes: sinAsignar + misSinLeer });
});

// Inicio ensambla las mismas colecciones del mock para que los filtros lleven
// a cifras que la persona puede comprobar en las pantallas de detalle.
app.get('/api/tools/inicio', (_q, res) => {
  const admin = ROL === 'admin';
  const username = admin ? mockAdminUsername : 'luis';
  const abiertas = ATENCION.filter(c => c.estado === 'open');
  const miId = yoAtencion();
  const sinAsignar = abiertas.filter(c => !c.asignado);
  const atencion = process.env.MOCK_ATENCION_OFF ? {
    estado: 'no_configurado', sinAsignar: 0, misSinLeer: 0, mias: 0, vinculado: false, esperaMasLargaMin: null,
  } : {
    estado: 'ok',
    sinAsignar: sinAsignar.length,
    misSinLeer: abiertas.filter(c => c.asignado?.id === miId && c.noLeidos > 0).length,
    mias: abiertas.filter(c => c.asignado?.id === miId).length,
    vinculado: true,
    cola: [], sinLeer: [],
    esperaMasLargaMin: sinAsignar.length ? Math.floor((hoy - Math.min(...sinAsignar.map(c => c.mensajes.at(-1)?.ts || hoy))) / 60000) : null,
    ...(admin ? { porAsesor: equipoPresencia().map((p) => {
      const agente = AGENTES.find(a => (a.id === 1 ? mockAdminUsername : a.username) === p.username);
      return { id: agente.id, nombre: p.nombre, disponible: p.disponible, estado: p.conectado ? p.estado : 'desconectado', abiertas: abiertas.filter(c => c.asignado?.id === agente.id).length };
    }) } : {}),
  };
  const mios = { nuevo: 0, contactado: 0, interesado: 0, inscrito: 0, descartado: 0 };
  let seguimientoSinAsignar = 0;
  Object.values(FICHAS).forEach(f => {
    if (f.asignadoA === username) mios[f.estado]++;
    if (!f.asignadoA && ['contactado', 'interesado'].includes(f.estado)) seguimientoSinAsignar++;
  });
  const reminders = admin ? RECORDATORIOS : RECORDATORIOS.filter(r => r.createdBy === username);
  const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
  // Igual que inicioService.metricasDelDia: conversaciones nuevas, preguntas a la IA y menús.
  const sumaInteracciones = (m) => ['conv_inicio', 'ai_request', 'menu_shown'].reduce((total, clave) => total + (m[clave] ?? 0), 0);
  const prospectos = (m) => (m.datos_acepta ?? 0) + (m.prospecto_completado ?? 0);
  const interacciones = sumaInteracciones(METRICAS_HOY);
  // Misma forma que armaría inicioService con listarConversaciones('open').
  const resumenConv = (c) => {
    const ultimo = c.mensajes.at(-1);
    return { id: c.id, nombre: c.contacto.nombre || c.contacto.telefono, equipo: c.equipo?.nombre ?? null, vista: ultimo?.texto ?? '', esperaMin: Math.max(0, Math.floor((Date.now() - (ultimo?.ts ?? Date.now())) / 60000)) };
  };
  const cola = sinAsignar.map(resumenConv).sort((a, b) => b.esperaMin - a.esperaMin).slice(0, 5);
  const sinLeer = abiertas.filter(c => c.asignado?.id === miId && c.noLeidos > 0).map(resumenConv).slice(0, 3);
  const DIAS_SIN_MOVIMIENTO = 5;
  const estancados = Object.values(FICHAS).filter(f => f.asignadoA === username && ['contactado', 'interesado'].includes(f.estado)
    && (f.actualizadoEn ?? 0) < Date.now() - DIAS_SIN_MOVIMIENTO * 864e5).length;
  const afectados = Object.entries(SALUD_MOCK.checks).filter(([, check]) => ['down', 'degraded'].includes(check.status)).map(([servicio, check]) => ({
    servicio,
    nivel: check.status === 'down' ? 'caido' : 'degradado',
    mensaje: servicio === 'iceberg' ? 'No se pueden descargar recibos' : 'Los registros nuevos del CRM pueden tardar en aparecer',
    ...(admin && check.detail ? { detalle: check.detail } : {}),
  }));
  if (atencion.estado === 'ok') Object.assign(atencion, { cola, sinLeer });
  j(res, {
    rol: admin ? 'admin' : 'asesor', generadoEn: Date.now(), atencion,
    seguimiento: process.env.MOCK_INICIO_ERROR ? { estado: 'error', mios: { nuevo: 0, contactado: 0, interesado: 0, inscrito: 0, descartado: 0 }, sinAsignar: 0 } : { estado: 'ok', mios, sinAsignar: seguimientoSinAsignar, estancados, diasSinMovimiento: DIAS_SIN_MOVIMIENTO },
    recordatorios: { estado: 'ok', fallidos: reminders.filter(r => r.estado === 'fallido').length, programadosHoy: reminders.filter(r => r.estado === 'programado' && r.scheduledAt >= inicio.getTime() && r.scheduledAt < inicio.getTime() + 864e5).length },
    hoy: { estado: 'ok', interaccionesBot: interacciones, derivadosAsesor: METRICAS_HOY.agent_handoff, prospectosNuevos: prospectos(METRICAS_HOY), preguntasIa: METRICAS_HOY.ai_request,
      ayer: { interaccionesBot: sumaInteracciones(METRICAS_AYER), derivadosAsesor: METRICAS_AYER.agent_handoff, prospectosNuevos: prospectos(METRICAS_AYER), preguntasIa: METRICAS_AYER.ai_request } },
    servicios: { estado: 'ok', afectados },
  });
});
// Solo del mock: simula que la persona escribe (o que llega alguien nuevo).
// POST /api/mock/atencion/simular { nueva?: boolean, id?: number, texto?: string }
app.post('/api/mock/atencion/simular', (req, res) => {
  if (req.body.nueva === true) {
    const abiertas = ATENCION.filter(c => c.estado === 'open');
    const elegibles = PRESENCIAS.filter(p => p.conectado && p.estado === 'disponible' && p.chatwootVinculado)
      .map(p => ({ agente: AGENTES.find(a => a.id === p.agenteId), abiertas: abiertas.filter(c => c.asignado?.id === p.agenteId).length }))
      .filter(item => item.abiertas < CONFIG_ATENCION.maxAbiertasPorAsesor)
      .sort((a, b) => a.abiertas - b.abiertas || a.agente.id - b.agente.id);
    const elegido = CONFIG_ATENCION.asignacionAutomatica ? elegibles[0]?.agente : null;
    const id = Math.max(...ATENCION.map(item => item.id)) + 1;
    const texto = req.body.texto || 'Hola, necesito hablar con un asesor.';
    const ts = Date.now() - (Number(req.body.haceMin) || 0) * 60000;
    const nueva = {
      id, estado: 'open', contacto: { nombre: req.body.nombre ?? `Persona demo ${id}`, telefono: `57300${String(id).padStart(7, '0')}` },
      asignado: elegido ? { id: elegido.id, nombre: elegido.nombre } : null,
      equipo: req.body.equipo === 'Posgrados' ? { id: 11, nombre: 'Posgrados' } : { id: 10, nombre: 'Admisiones' }, etiquetas: [], prioridad: null, noLeidos: 1,
      mensajes: [{ id: Date.now(), tipo: 'in', texto, ts, autor: null, adjuntos: [] }],
    };
    ATENCION.push(nueva);
    emitirAtencion({ tipo: 'nueva', conversacionId: id, entrante: true, nombre: nueva.contacto.nombre, texto });
    return j(res, { ok: true, id, asignado: nueva.asignado });
  }
  const c = ATENCION.find(x => x.id === Number(req.body.id)) ?? ATENCION.find(x => x.estado === 'open');
  const texto = req.body.texto || '¿Siguen ahí? Tengo otra pregunta.';
  c.mensajes.push({ id: Date.now(), tipo: 'in', texto, ts: Date.now(), autor: null, adjuntos: [] });
  c.noLeidos += 1;
  emitirAtencion({ tipo: 'mensaje', conversacionId: c.id, entrante: true, nombre: c.contacto.nombre, texto });
  j(res, { ok: true, id: c.id });
});
app.get('/api/tools/atencion/equipo', (_q, res) => j(res, { agentes: AGENTES, equipos: EQUIPOS, yo: yoAtencion(), miEquipoId: ROL === 'admin' ? null : 10 }));
app.get('/api/tools/atencion/etiquetas', (_q, res) => j(res, { etiquetas: ETIQUETAS_CUENTA }));
app.get('/api/tools/atencion/conversaciones', (req, res) => {
  const yo = yoAtencion();
  const base = ATENCION.filter(c => c.estado === (req.query.estado || 'open')
    && (!req.query.equipo || String(c.equipo?.id) === req.query.equipo)
    && (!req.query.etiqueta || c.etiquetas.includes(req.query.etiqueta)));
  const filtro = req.query.asignado || 'todas';
  const filtradas = base.filter(c => filtro === 'todas' || (filtro === 'sin_asignar' ? !c.asignado : c.asignado?.id === yo));
  j(res, {
    conversaciones: filtradas.map(resumenAtencion).sort((a, b) => b.actividadTs - a.actividadTs),
    conteos: { mias: base.filter(c => c.asignado?.id === yo).length, sin_asignar: base.filter(c => !c.asignado).length, todas: base.length },
    truncado: false,
  });
});
const convAtencion = (req, res) => {
  const c = ATENCION.find(x => x.id === Number(req.params.id));
  if (!c) res.status(404).json({ error: 'no_encontrada', message: 'La conversación no existe o no es del bot.' });
  return c;
};
app.get('/api/tools/atencion/conversaciones/:id', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  c.noLeidos = 0;
  j(res, { conversacion: resumenAtencion(c), mensajes: c.mensajes, hayAnteriores: false });
});
// Ficha de la persona y resumen con IA del chat de Atención.
const ventanaMock = (c) => {
  const ultimo = Math.max(0, ...c.mensajes.filter(m => m.tipo === 'in').map(m => m.ts));
  return { abierta: ultimo > 0 && Date.now() - ultimo < 864e5, ultimoEntranteTs: ultimo || null, cierraTs: ultimo ? ultimo + 864e5 : null };
};
const FICHAS_MOCK = {
  101: {
    interes: { nombre: 'MARÍA JOSÉ RESTREPO', correo: 'mjrestrepo@gmail.com', programa: 'Maestría en Ingeniería', area: 'Ingeniería', relacion: 'Egresado UTB', registradoEl: '2026-11-15 10:42' },
    crm: { estado: 'interesado', asignadoA: 'luis', etiquetas: ['beca', 'financiación'], notas: [{ texto: 'Pregunta por crédito ICETEX y becas de egresado.', autor: 'luis', ts: hace(60 * 26) }] },
    asistencias: [{ eventoId: 'ev1', evento: 'Feria de posgrados 2026', sector: 'posgrado', fecha: '2026-11-14', origen: 'qr', registradoEn: hace(60 * 72) }],
    plantillas: [{ templateName: 'gracias_por_asistir', createdAt: hace(60 * 48), createdBy: 'admin', etiqueta: 'Asistentes: Feria de posgrados 2026', resultado: 'enviado' }],
    bajaCampanas: false, sinDatos: [],
  },
  104: {
    interes: { nombre: '', correo: '', programa: '', area: '', relacion: 'De otra universidad', registradoEl: '' },
    crm: null, asistencias: [],
    plantillas: [{ templateName: 'campana_posgrado_pregrado', createdAt: hace(60 * 70), createdBy: 'luis', etiqueta: 'Números escritos a mano', resultado: 'fallido', error: 'Meta no la entregó: la persona recibió varias de marketing hace poco' }],
    bajaCampanas: true, sinDatos: ['CRM'],
  },
};
app.get('/api/tools/atencion/conversaciones/:id/ficha', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  if (!c.contacto.telefono) return res.status(404).json({ error: 'sin_telefono', message: 'Esta conversación no tiene un número de WhatsApp asociado.' });
  const base = FICHAS_MOCK[c.id] ?? {
    interes: { nombre: c.contacto.nombre, correo: '', programa: '', area: '', relacion: '', registradoEl: '' },
    crm: { estado: 'nuevo', etiquetas: [], notas: [] }, asistencias: [], plantillas: [], bajaCampanas: false, sinDatos: [],
  };
  const enviadas = [...BROADCAST_JOBS.values()].filter(job => job.destinatarios.includes(c.contacto.telefono) && job.createdAt > hace(5))
    .map(job => ({ templateName: job.templateName, createdAt: job.createdAt, createdBy: job.createdBy, etiqueta: job.etiqueta, resultado: job.enviados.includes(c.contacto.telefono) ? 'enviado' : 'pendiente' }));
  setTimeout(() => j(res, { ficha: {
    telefono: c.contacto.telefono, puedeRecibirPlantilla: /^[1-9]\d{9,14}$/.test(c.contacto.telefono),
    ventana: ventanaMock(c), ...base, plantillas: [...enviadas, ...base.plantillas],
  } }), 350);
});
const RESUMENES_MOCK = {
  101: '• Egresada de la UTB interesada en la Maestría en Ingeniería.\n• Preguntó por becas y formas de financiación.\n• Pidió un asesor para conocer costos y fechas de inscripción.',
  102: '• Estudiante de pregrado que pregunta cuándo es su turno de matrícula.\n• Pidió un asesor porque el bot no encontró su turno.',
  103: '• No puede entrar a SAVIO.\n• El bot no resolvió el problema y pidió ayuda de Soporte TI.',
  104: '• Va a enviar un certificado para su proceso de admisión.\n• Quedó pendiente recibir el documento.',
};
app.post('/api/tools/atencion/conversaciones/:id/resumen', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  if (process.env.MOCK_SIN_IA) return res.status(503).json({ error: 'resumen_no_disponible', message: 'El resumen con IA no está configurado.' });
  const texto = RESUMENES_MOCK[c.id];
  const hastaTs = Math.max(0, ...c.mensajes.filter(m => m.tipo === 'in').map(m => m.ts));
  setTimeout(() => j(res, { resumen: texto ? { texto, hastaTs: c.id === 101 ? hastaTs - 1 : hastaTs, generadoEn: req.body.forzar ? Date.now() : hace(12) } : null }), req.body.forzar ? 1200 : 700);
});
app.post('/api/tools/atencion/conversaciones/:id/mensajes', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'validation_error', message: 'El mensaje no puede estar vacío.' });
  // Andrés y Laura llevan más de 24 h sin escribir: Meta no aceptaría texto libre.
  const ventana = ventanaMock(c);
  if (!req.body.privado && !ventana.abierta) {
    const horas = Math.floor((Date.now() - ventana.ultimoEntranteTs) / 36e5);
    return res.status(409).json({ error: 'fuera_de_ventana', message: `Han pasado ${horas} horas desde su último mensaje. WhatsApp solo permite texto libre dentro de las 24 horas siguientes; para retomar el contacto hay que usar una plantilla aprobada por Meta.` });
  }
  const autor = AGENTES.find(a => a.id === yoAtencion()).nombre;
  c.mensajes.push({ id: Date.now(), tipo: req.body.privado ? 'nota' : 'out', texto, ts: Date.now(), autor, adjuntos: [] });
  emitirAtencion({ tipo: 'mensaje', conversacionId: c.id, entrante: false });
  j(res, { ok: true });
});
const normalizarEtiquetas = (entrada) => {
  if (!Array.isArray(entrada)) return null;
  const etiquetas = [...new Set(entrada.map(e => String(e).trim().toLowerCase().replace(/\s+/g, '-')))];
  return etiquetas.length <= 10 && etiquetas.every(e => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(e)) ? etiquetas : null;
};
app.post('/api/tools/atencion/conversaciones/:id/etiquetas', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  const etiquetas = normalizarEtiquetas(req.body.etiquetas);
  if (!etiquetas) return res.status(400).json({ error: 'validation_error', message: 'Usa hasta 10 etiquetas de 40 caracteres, sin tildes ni símbolos especiales.' });
  c.etiquetas = etiquetas;
  emitirAtencion({ tipo: 'etiquetas', conversacionId: c.id });
  j(res, { ok: true, etiquetas });
});
const TIPOS_ADJUNTO_MOCK = new Set([
  'image/jpeg', 'image/png', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);
app.post('/api/tools/atencion/conversaciones/:id/adjuntos', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  const { nombre, tipo, base64, privado } = req.body;
  const texto = String(req.body.texto || '').trim();
  if (!nombre || !TIPOS_ADJUNTO_MOCK.has(tipo) || typeof base64 !== 'string') {
    return res.status(400).json({ error: 'validation_error', message: 'El archivo no tiene un tipo permitido.' });
  }
  if (Buffer.from(base64, 'base64').length > 3 * 1024 * 1024) {
    return res.status(413).json({ error: 'archivo_muy_grande', message: 'El archivo supera el máximo de 3 MB.' });
  }
  if (!privado && c.id === 104) {
    return res.status(409).json({ error: 'fuera_de_ventana', message: 'Han pasado 25 horas desde su último mensaje. Usa una plantilla aprobada por Meta.' });
  }
  const autor = AGENTES.find(a => a.id === yoAtencion()).nombre;
  const esImagen = tipo === 'image/jpeg' || tipo === 'image/png';
  c.mensajes.push({
    id: Date.now(), tipo: privado ? 'nota' : 'out', texto, ts: Date.now(), autor,
    adjuntos: [{ tipo: esImagen ? 'image' : 'file', nombre, url: `https://example.com/${esImagen ? 'imagen-adjunta.jpg' : 'adjunto.pdf'}` }],
  });
  emitirAtencion({ tipo: 'mensaje', conversacionId: c.id, entrante: false });
  j(res, { ok: true });
});
app.post('/api/tools/atencion/conversaciones/:id/estado', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  c.estado = req.body.estado;
  c.mensajes.push({ id: Date.now(), tipo: 'sistema', texto: `Estado cambiado a ${req.body.estado}`, ts: Date.now(), autor: null, adjuntos: [] });
  emitirAtencion({ tipo: 'estado', conversacionId: c.id });
  j(res, { ok: true });
});
app.post('/api/tools/atencion/conversaciones/:id/asignar', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  const { asesorId, equipoId } = req.body;
  if (asesorId !== undefined) {
    const id = asesorId === 'yo' ? yoAtencion() : asesorId;
    const a = AGENTES.find(x => x.id === id);
    c.asignado = a ? { id: a.id, nombre: a.nombre } : null;
  }
  if (equipoId !== undefined) c.equipo = EQUIPOS.find(e => e.id === equipoId) ?? null;
  emitirAtencion({ tipo: 'asignacion', conversacionId: c.id });
  j(res, { ok: true });
});

const accionesMacroValidas = (acciones) => {
  if (!acciones || typeof acciones !== 'object' || Array.isArray(acciones)) return false;
  const claves = Object.keys(acciones);
  if (!claves.length || claves.some(k => !['nota', 'mensaje', 'etiquetas', 'equipoId', 'asesorId', 'estado'].includes(k))) return false;
  if (acciones.nota !== undefined && !String(acciones.nota).trim()) return false;
  if (acciones.mensaje !== undefined && !String(acciones.mensaje).trim()) return false;
  if (acciones.etiquetas !== undefined && !normalizarEtiquetas(acciones.etiquetas)) return false;
  if (acciones.equipoId !== undefined && acciones.equipoId !== null && !EQUIPOS.some(e => e.id === acciones.equipoId)) return false;
  if (acciones.asesorId !== undefined && acciones.asesorId !== null && acciones.asesorId !== 'yo' && !AGENTES.some(a => a.id === acciones.asesorId)) return false;
  return acciones.estado === undefined || ['open', 'pending', 'resolved'].includes(acciones.estado);
};
app.get('/api/tools/atencion/macros', (_q, res) => j(res, { macros: MACROS_ATENCION }));
app.post('/api/tools/atencion/macros', (req, res) => {
  if (ROL !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Solo un administrador puede crear macros.' });
  const nombre = String(req.body.nombre || '').trim();
  const acciones = req.body.acciones;
  if (!nombre || nombre.length > 60 || !accionesMacroValidas(acciones) || MACROS_ATENCION.length >= 40) {
    return res.status(400).json({ error: 'validation_error', message: 'La macro necesita un nombre de hasta 60 caracteres y al menos una acción válida. El máximo es 40 macros.' });
  }
  const macro = { id: siguienteMacroId++, nombre, acciones, creadoPor: 'admin', creadoEn: new Date().toISOString() };
  MACROS_ATENCION.push(macro);
  emitirAtencion({ tipo: 'macro' });
  res.status(201).json({ macro });
});
app.delete('/api/tools/atencion/macros/:id', (req, res) => {
  if (ROL !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Solo un administrador puede eliminar macros.' });
  const indice = MACROS_ATENCION.findIndex(m => m.id === Number(req.params.id));
  if (indice < 0) return res.status(404).json({ error: 'no_encontrada', message: 'La macro no existe.' });
  MACROS_ATENCION.splice(indice, 1);
  emitirAtencion({ tipo: 'macro' });
  j(res, { ok: true });
});
app.post('/api/tools/atencion/conversaciones/:id/macros/:macroId', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  const macro = MACROS_ATENCION.find(m => m.id === Number(req.params.macroId));
  if (!macro) return res.status(404).json({ error: 'no_encontrada', message: 'La macro no existe.' });
  // Las precondiciones se revisan antes de tocar nada para que la macro sea atómica.
  if (macro.acciones.mensaje && !c.contacto.telefono) {
    return res.status(409).json({ error: 'sin_usuario_chatwoot', message: 'La conversación no tiene un usuario de WhatsApp asociado.' });
  }
  if (macro.acciones.mensaje && c.id === 104) {
    return res.status(409).json({ error: 'fuera_de_ventana', message: 'Han pasado 25 horas desde el último mensaje. No se ejecutó ninguna acción.' });
  }
  const etiquetasMacro = macro.acciones.etiquetas ? normalizarEtiquetas([...c.etiquetas, ...macro.acciones.etiquetas]) : null;
  if (macro.acciones.etiquetas && !etiquetasMacro) {
    return res.status(400).json({ error: 'validation_error', message: 'La macro dejaría más de 10 etiquetas en la conversación.' });
  }
  const hechos = [];
  const autor = AGENTES.find(a => a.id === yoAtencion()).nombre;
  if (macro.acciones.nota) {
    c.mensajes.push({ id: Date.now(), tipo: 'nota', texto: macro.acciones.nota, ts: Date.now(), autor, adjuntos: [] });
    hechos.push('Nota guardada');
  }
  if (macro.acciones.mensaje) {
    const primerNombre = c.contacto.nombre.trim().split(/\s+/)[0] || 'hola';
    c.mensajes.push({ id: Date.now() + 1, tipo: 'out', texto: macro.acciones.mensaje.replace(/\{nombre\}/g, primerNombre), ts: Date.now(), autor, adjuntos: [] });
    hechos.push('Mensaje enviado');
  }
  if (macro.acciones.etiquetas) {
    c.etiquetas = etiquetasMacro;
    hechos.push('Etiquetas actualizadas');
  }
  if (Object.hasOwn(macro.acciones, 'equipoId')) {
    c.equipo = EQUIPOS.find(e => e.id === macro.acciones.equipoId) ?? null;
    hechos.push(c.equipo ? 'Equipo actualizado' : 'Equipo quitado');
  }
  if (Object.hasOwn(macro.acciones, 'asesorId')) {
    const id = macro.acciones.asesorId === 'yo' ? yoAtencion() : macro.acciones.asesorId;
    const agente = AGENTES.find(a => a.id === id);
    c.asignado = agente ? { id: agente.id, nombre: agente.nombre } : null;
    hechos.push(c.asignado ? 'Asesor actualizado' : 'Asesor quitado');
  }
  if (macro.acciones.estado) {
    c.estado = macro.acciones.estado;
    hechos.push(`Estado: ${macro.acciones.estado === 'resolved' ? 'resuelta' : macro.acciones.estado === 'pending' ? 'pendiente' : 'abierta'}`);
  }
  emitirAtencion({ tipo: 'macro', conversacionId: c.id });
  j(res, { ok: true, hechos });
});

app.get('/api/tools/chatwoot/summary', (_q, res) => j(res, { open: 7, unassigned: 3, pending: 2, resolvedToday: 11 }));
app.get('/api/tools/audit/me', (_q, res) => j(res, { entries: [
  { ts: hace(30), action: 'turno_consultado', target: 'T00098765' },
  { ts: hace(95), action: 'mensaje_enviado', target: '573001234567' },
  { ts: hace(300), action: 'login', target: '' },
] }));
app.get('/api/tools/audit/summary', (_q, res) => j(res, { summary: AUDIT }));

app.get('/api/tools/registros-posgrado', (_q, res) => j(res, { rows: REGISTROS }));
app.get('/api/tools/registros-evento-posgrado', (_q, res) => j(res, { rows: EVENTO }));
app.post('/api/tools/registros-evento-posgrado/:fila/seguimiento', (req, res) => {
  const f = EVENTO[Number(req.params.fila) - 2]; if (f) f[7] = req.body.estado; j(res, { ok: true });
});
app.post('/api/tools/registros-evento-posgrado/:fila/invitar', (req, res) => {
  const f = EVENTO[Number(req.params.fila) - 2];
  if (!f) return res.status(404).json({ error: 'not_found' });
  f[7] = 'Invitado a próximo evento';
  j(res, { ok: true });
});

app.get('/api/tools/crm/fichas', (_q, res) => j(res, { fichas: FICHAS }));
app.get('/api/tools/crm/:phone', (req, res) => j(res, { ficha: FICHAS[req.params.phone] || null }));
app.post('/api/tools/crm/:phone/:ruta', (req, res) => {
  const f = FICHAS[req.params.phone] || (FICHAS[req.params.phone] = { estado: 'nuevo', etiquetas: [], notas: [] });
  if (req.params.ruta === 'estado') f.estado = req.body.estado;
  f.actualizadoEn = Date.now() - (Number(req.body.haceDias) || 0) * 864e5;
  if (req.params.ruta === 'asignar') f.asignadoA = req.body.username;
  if (req.params.ruta === 'etiquetas') f.etiquetas = req.body.etiquetas ?? f.etiquetas;
  if (req.params.ruta === 'nota') f.notas.unshift({ id: 'n' + Date.now(), autor: 'admin', ts: Date.now(), texto: req.body.texto });
  j(res, { ficha: f });
});
app.delete('/api/tools/crm/:phone/nota/:id', (req, res) => {
  const f = FICHAS[req.params.phone];
  if (!f) return res.status(404).json({ error: 'not_found' });
  f.notas = f.notas.filter(n => n.id !== req.params.id);
  j(res, { ficha: f });
});

app.get('/api/tools/quick-replies', (_q, res) => j(res, { replies: [
  { id: 'q1', titulo: 'Saludo', texto: 'Hola {nombre} 👋 ¿en qué te puedo ayudar?' },
  { id: 'q2', titulo: 'Costos', texto: 'Te comparto los costos del programa: ...' },
] }));
app.post('/api/tools/quick-replies', (_q, res) => j(res, { ok: true }));

app.get('/api/tools/recordatorios', (_q, res) => j(res, { reminders: RECORDATORIOS }));
app.post('/api/tools/recordatorios', (req, res) => {
  const texto = String(req.body.telefono ?? '').trim();
  const telefono = texto.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(texto) || !/^[1-9]\d{9,14}$/.test(telefono)) {
    return res.status(400).json({ error: 'validation_error', message: 'telefono inválido (usa E.164 de 10–15 dígitos)' });
  }
  const reminder = { ...req.body, telefono, scheduledAt: Date.parse(req.body.scheduledAt), id: 'r' + Date.now(), estado: 'programado', createdBy: ROL === 'admin' ? 'admin' : 'luis' };
  RECORDATORIOS.unshift(reminder);
  j(res, { ok: true, reminder });
});
app.delete('/api/tools/recordatorios/:id', (req, res) => {
  const reminder = RECORDATORIOS.find(r => r.id === req.params.id);
  if (!reminder || reminder.estado !== 'programado') return res.status(409).json({ error: 'not_cancellable' });
  reminder.estado = 'cancelado';
  j(res, { ok: true, reminder });
});

const BROADCAST_JOBS = new Map();
const BROADCAST_DEDUPE = new Map();
const MOCK_TEMPLATES = [
  { name: 'aviso_academico_demo', language: 'es_CO', category: 'UTILITY', components: [{ type: 'BODY', text: 'Aviso académico de prueba' }] },
  { name: 'gracias_por_asistir', language: 'es_CO', category: 'MARKETING', components: [
    { type: 'HEADER', format: 'TEXT', text: 'Gracias por acompañarnos' },
    { type: 'BODY', text: 'Fue un gusto tenerte en nuestro evento de *Posgrados UTB* 🎓\n\nSi quieres conocer costos, becas y fechas de inscripción, un asesor puede contarte todo por aquí.' },
    { type: 'FOOTER', text: 'Universidad Tecnológica de Bolívar' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quiero más información' }, { type: 'URL', text: 'Ver programas', url: 'https://www.utb.edu.co/posgrados/' }] },
  ] },
  { name: 'invitacion_con_imagen', language: 'es', category: 'MARKETING', components: [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['/app/apple-touch-icon.png'] } },
    { type: 'BODY', text: '¡Hola! 👋 Te invitamos a la *Feria de Posgrados UTB* este viernes en el Campus Tecnológico.' },
    { type: 'FOOTER', text: 'Posgrados UTB' },
  ] },
  { name: 'vehiculo_listo', language: 'es', category: 'UTILITY', components: [
    { type: 'HEADER', format: 'TEXT', text: 'Tu vehículo está listo' },
    { type: 'BODY', text: '🚗 ¡Hola! Tu vehículo de la orden #{{1}} ya está listo para recoger. ¡Gracias por confiar en nosotros! 🙌', example: { body_text: [['42']] } },
    { type: 'FOOTER', text: 'SentraWash' },
  ] },
  { name: 'nodo_recordatorio_evento', language: 'es', category: 'UTILITY', components: [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['/app/apple-touch-icon.png'] } },
    { type: 'BODY', text: 'Hola {{1}}, mañana es tu evento.\n\n*{{2}}*\n🗓 {{3}}\n📍 {{4}}\n\nSi ya no puedes ir, retira tu inscripción.', example: { body_text: [['Manuel', 'CTW Hackathon — Cartagena Edition', 'jueves 13 de agosto, 8:00 a. m.', 'Centro de Convenciones, Cartagena']] } },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver el evento', url: 'https://nodo-eventos.duckdns.org/eventos/{{1}}', example: ['https://nodo-eventos.duckdns.org/eventos/ctw-hackathon-cartagena'] }, { type: 'QUICK_REPLY', text: 'No podré ir' }] },
  ] },
  { name: 'campana_posgrado_pregrado', language: 'es_CO', category: 'MARKETING', significados: { 'cuerpo:1': 'primer_nombre' }, components: [
    { type: 'BODY', text: 'Hola {{1}}, por tu pregrado en {{2}} hay posgrados de la UTB pensados para ti.', example: { body_text: [['Ana', 'Ingeniería de Sistemas']] } },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ver mis opciones' }, { type: 'QUICK_REPLY', text: 'No me interesa' }] },
  ] },
];
app.get('/api/tools/broadcast/templates', (_q, res) => j(res, { templates: process.env.MOCK_NO_TEMPLATES ? [] : MOCK_TEMPLATES }));
// Plantillas que alguien propuso y Meta todavía no aprueba (o rechazó).
const MOCK_SIN_APROBAR = [
  { id: 't-pend', name: 'recordatorio_entrevista', language: 'es', category: 'UTILITY', status: 'PENDING', rejectedReason: '', components: [{ type: 'BODY', text: 'Te recordamos tu entrevista de admisión mañana a las 9:00 a. m.' }] },
  { id: 't-rech', name: 'descuento_matricula', language: 'es', category: 'UTILITY', status: 'REJECTED', rejectedReason: 'PROMOTIONAL', components: [{ type: 'BODY', text: '¡20 % de descuento si te inscribes esta semana!' }] },
];
app.get('/api/tools/broadcast/templates/todas', (_q, res) => j(res, {
  templates: process.env.MOCK_NO_TEMPLATES ? [] : [...MOCK_TEMPLATES.map(t => ({ significados: {}, ...t, id: t.name, status: 'APPROVED', rejectedReason: '' })), ...MOCK_SIN_APROBAR.map(t => ({ significados: {}, ...t }))],
}));
app.post('/api/tools/broadcast/templates', (req, res) => {
  const nombre = String(req.body.nombre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  const cuerpo = String(req.body.cuerpo ?? '').trim();
  if (nombre.length < 3) return res.status(400).json({ error: 'validation_error', message: 'Ponle un nombre a la plantilla (al menos 3 letras).' });
  if (!cuerpo) return res.status(400).json({ error: 'validation_error', message: 'Escribe el mensaje.' });
  if ([...MOCK_TEMPLATES, ...MOCK_SIN_APROBAR].some(t => t.name === nombre && t.language === (req.body.idioma ?? 'es'))) {
    return res.status(400).json({ error: 'validation_error', message: 'Meta no aceptó la plantilla: Ya existe contenido en este idioma con ese nombre: usa otro nombre.' });
  }
  const enc = req.body.encabezado ?? {};
  const components = [];
  if (enc.tipo === 'texto') components.push({ type: 'HEADER', format: 'TEXT', text: enc.texto, ...(enc.ejemplo ? { example: { header_text: [enc.ejemplo] } } : {}) });
  if (enc.tipo === 'imagen') components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [`data:image/jpeg;base64,${req.body.imagen?.base64 ?? ''}`] } });
  if (/^\{\{/.test(cuerpo) || /\}\}$/.test(cuerpo)) return res.status(400).json({ error: 'validation_error', message: 'El mensaje no puede empezar ni terminar con un dato variable: agrega texto antes o después.' });
  const ejemplos = Array.isArray(req.body.ejemplosCuerpo) ? req.body.ejemplosCuerpo : [];
  components.push({ type: 'BODY', text: cuerpo, ...(ejemplos.length ? { example: { body_text: [ejemplos] } } : {}) });
  if (req.body.pie) components.push({ type: 'FOOTER', text: req.body.pie });
  const botones = Array.isArray(req.body.botones) ? req.body.botones : [];
  if (botones.length) components.push({ type: 'BUTTONS', buttons: [...botones.filter(b => b.tipo !== 'enlace'), ...botones.filter(b => b.tipo === 'enlace')].map(b => b.tipo === 'enlace'
    ? (b.dinamico ? { type: 'URL', text: b.texto, url: `${b.url}{{1}}`, example: [`${b.url}${b.ejemplo}`] } : { type: 'URL', text: b.texto, url: b.url })
    : { type: 'QUICK_REPLY', text: b.texto }) });
  // Para probar el envío en el mock, «Aprobar al crear» con MOCK_APROBAR=1.
  const plantilla = { id: `t-${Date.now()}`, name: nombre, language: req.body.idioma ?? 'es', category: req.body.categoria, status: process.env.MOCK_APROBAR ? 'APPROVED' : 'PENDING', rejectedReason: '', components, significados: req.body.significados ?? {} };
  MOCK_SIN_APROBAR.unshift(plantilla);
  res.status(201).json({ ok: true, plantilla: { id: plantilla.id, name: nombre, language: plantilla.language, status: 'PENDING', category: plantilla.category } });
});
const REVIEWS = [{
  id: '00000000-0000-4000-8000-000000000001', source: 'meta', from: '573001234567',
  messageId: 'wamid.demo.1', createdAt: hoy - 600000,
  reviewReason: 'Resultado del handler no confirmado tras vencerse el lease.',
}];
app.get('/api/tools/inbound/reviews', (_q, res) => j(res, { reviews: REVIEWS }));
app.post('/api/tools/inbound/reviews/:id/resolve', (req, res) => {
  const i = REVIEWS.findIndex(item => item.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not_found' });
  REVIEWS.splice(i, 1);
  j(res, { ok: true });
});
app.post('/api/tools/broadcast/send', (req, res) => {
  const { templateName, language } = req.body;
  // Igual que el servidor: `telefonos` sin datos o `destinatarios` con los valores de cada persona.
  const conDatos = Array.isArray(req.body.destinatarios) && req.body.relacion === undefined;
  const telefonos = conDatos ? req.body.destinatarios.map(d => String(d.telefono)) : req.body.telefonos;
  const parametrosDe = new Map(conDatos ? req.body.destinatarios.map(d => [String(d.telefono), d.parametros]) : []);
  const aprobada = [...MOCK_TEMPLATES, ...MOCK_SIN_APROBAR.filter(t => t.status === 'APPROVED')].find(t => t.name === templateName && t.language === language);
  if (!aprobada) return res.status(400).json({ error: 'validation_error', message: 'Template no aprobado' });
  if (!Array.isArray(telefonos) || !telefonos.length || telefonos.length > 200) return res.status(400).json({ error: 'validation_error', message: 'Destinatarios inválidos' });
  const numeros = [...new Set(telefonos)].sort();
  const key = JSON.stringify({ templateName, language, numeros, datos: numeros.map(n => parametrosDe.get(n) ?? []) });
  const previous = BROADCAST_DEDUPE.get(key);
  if (previous) return res.status(202).json({ ok: true, job: BROADCAST_JOBS.get(previous), repetido: true });
  const usaVariables = JSON.stringify(aprobada.components.map(c => ({ ...c, example: undefined }))).includes('{{');
  if (usaVariables && !conDatos) return res.status(400).json({ error: 'validation_error', message: 'Esa plantilla usa variables ({{1}}…): hay que enviar los datos de cada destinatario' });
  const job = { id: require('node:crypto').randomUUID(), templateName, language, createdBy: ROL === 'admin' ? 'admin' : 'luis', createdAt: Date.now(), estado: 'pendiente', destinatarios: numeros, solicitados: telefonos.length, duplicadosOmitidos: telefonos.length - numeros.length, enviados: [], fallidos: [], nextIndex: 0, etiqueta: String(req.body.etiqueta ?? '').slice(0, 80) };
  BROADCAST_JOBS.set(job.id, job);
  BROADCAST_DEDUPE.set(key, job.id);
  res.status(202).json({ ok: true, job, repetido: false });
});
// Un envío de hace dos días, para que el historial no arranque vacío.
BROADCAST_JOBS.set('11111111-1111-4111-8111-111111111111', {
  id: '11111111-1111-4111-8111-111111111111', templateName: 'gracias_por_asistir', language: 'es_CO', createdBy: 'admin',
  createdAt: hoy - 2 * 864e5, estado: 'completado', destinatarios: ['573001234567', '573009876543', '573015550101'], solicitados: 3,
  duplicadosOmitidos: 0, enviados: ['573001234567', '573009876543'], fallidos: [{ numero: '573015550101', error: 'Meta rechazó el envío (HTTP 400, código 131026)' }],
  nextIndex: 3, etiqueta: 'Asistentes: Feria de posgrados 2026',
});
// Un asesor ve sus envíos; un administrador, los de todos.
const veEnvio = (job) => ROL === 'admin' || job.createdBy === 'luis';
app.get('/api/tools/broadcast/jobs', (_q, res) => {
  // Cada consulta avanza un poco los envíos pendientes, como haría la cola real.
  for (const job of BROADCAST_JOBS.values()) {
    if (job.estado === 'completado') continue;
    job.estado = 'procesando';
    const paso = Math.max(1, Math.ceil(job.destinatarios.length / 3));
    job.enviados.push(...job.destinatarios.slice(job.nextIndex, job.nextIndex + paso));
    job.nextIndex = Math.min(job.destinatarios.length, job.nextIndex + paso);
    if (job.nextIndex >= job.destinatarios.length) job.estado = 'completado';
  }
  j(res, { jobs: [...BROADCAST_JOBS.values()].filter(veEnvio).sort((a, b) => b.createdAt - a.createdAt).map(job => ({
    id: job.id, templateName: job.templateName, language: job.language, createdBy: job.createdBy, createdAt: job.createdAt,
    estado: job.estado, solicitados: job.solicitados, enviados: job.enviados.length, fallidos: job.fallidos.length, etiqueta: job.etiqueta ?? '',
  })) });
});
app.get('/api/tools/broadcast/jobs/:id', (req, res) => {
  const job = BROADCAST_JOBS.get(req.params.id);
  if (!job || !veEnvio(job)) return res.status(404).json({ error: 'not_found' });
  job.estado = 'completado';
  job.enviados = [...job.destinatarios];
  job.nextIndex = job.destinatarios.length;
  j(res, { job });
});
app.post('/api/tools/recibo', (req, res) => {
  if (!/^T\d{8}$/.test(req.body.codigo)) return res.status(400).json({ error: 'codigo_invalido' });
  if (!/^\d{6,12}$/.test(req.body.cedula)) return res.status(400).json({ error: 'cedula_invalida' });
  if (req.body.codigo === 'T00000000') return res.status(200).json({ noRecibos: true, nombre: 'Estudiante de prueba' });
  if (req.body.cedula === '1234567890') return res.status(400).json({ error: 'login_failed' });
  res.set('Content-Type', 'application/pdf').send(Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'));
});
app.get('/api/auth/chatwoot-sso', (_q, res) => j(res, { url: 'https://chat.example.com/sso' }));
app.get('/health/deep', (_q, res) => j(res, SALUD_MOCK));

/* ── Asistencia a eventos ──────────────────────────────────────────────────
   El lector de Excel/CSV es el real (src/services/asistenciaImport.ts, vía
   tsx): lo que se ve al importar aquí es lo que hará el servidor. */
let lectorAsistencia = null;
try { require('tsx/cjs'); lectorAsistencia = require('../src/services/asistenciaImport.ts'); } catch { /* sin tsx: importación simulada */ }
const ASIS_EVENTOS = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', nombre: 'Feria de posgrados 2026', sector: 'posgrado', fecha: '2026-11-20', lugar: 'Campus Tecnológico', codigo: 'K7M2QX', estado: 'abierto', creadoPor: 'admin', creadoEn: hoy - 3 * 36e5 },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', nombre: 'Open house Ingenierías', sector: 'pregrado', fecha: '2026-10-30', lugar: 'Auditorio Jorge Taua', codigo: 'P4RT9B', estado: 'cerrado', creadoPor: 'luis', creadoEn: hoy - 18 * 864e5 },
];
const asis = (clave, nombre, whatsapp, correo, programa, origen, consentimiento, min, documento = '') => ({ clave, nombre, whatsapp, correo, documento, programa, origen, consentimiento, registradoEn: hace(min) });
const ASIS_PERSONAS = {
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1': [
    asis('w:573001234567', 'María José Restrepo', '573001234567', 'mjrestrepo@gmail.com', 'Maestría en Ingeniería', 'qr', true, 6),
    asis('w:573009876543', 'Carlos Pérez', '573009876543', '', '', 'qr', true, 14),
    asis('w:573015550101', 'Valentina Ortiz', '573015550101', 'vortiz@utb.edu.co', 'Especialización en Finanzas', 'qr', true, 31, '1047123456'),
    asis('c:alugo@gmail.com', 'Andrés Lugo', '', 'alugo@gmail.com', 'Doctorado en Ingeniería', 'importado', false, 95),
    asis('w:573022220011', 'Laura Ríos', '573022220011', 'lrios@gmail.com', '', 'importado', false, 95),
    asis('n:1a2b3c4d5e6f7a8b', 'Jorge Castillo', '', '', '', 'manual', false, 120),
  ],
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2': [
    asis('w:573033330022', 'Sofía Gómez', '573033330022', 'sofia@gmail.com', 'Ingeniería de Sistemas', 'qr', true, 18 * 1440),
    asis('w:573044440033', 'Daniel Mora', '573044440033', '', 'Ingeniería Civil', 'qr', true, 18 * 1440 + 5),
  ],
};
const asisEvento = (req, res) => {
  const evento = ASIS_EVENTOS.find(e => e.id === req.params.id);
  if (!evento) res.status(404).json({ error: 'not_found', message: 'El evento no existe' });
  return evento;
};
const asisClave = (p) => p.whatsapp ? `w:${p.whatsapp}` : p.correo ? `c:${p.correo}` : p.documento ? `d:${p.documento}` : `n:${Buffer.from(p.nombre).toString('hex').slice(0, 16)}`;
function asisRegistrar(eventoId, datos, origen, consentimiento) {
  const lista = ASIS_PERSONAS[eventoId] ?? (ASIS_PERSONAS[eventoId] = []);
  const clave = asisClave(datos);
  const previo = lista.find(a => a.clave === clave);
  if (previo) { Object.entries(datos).forEach(([k, v]) => { if (v) previo[k] = v; }); previo.consentimiento = previo.consentimiento || consentimiento; return false; }
  lista.unshift({ clave, nombre: '', whatsapp: '', correo: '', documento: '', programa: '', ...datos, origen, consentimiento, registradoEn: Date.now() });
  return true;
}
app.get('/api/tools/asistencia/eventos', (_q, res) => j(res, {
  eventos: [...ASIS_EVENTOS].sort((a, b) => b.creadoEn - a.creadoEn).map(e => ({ ...e, asistentes: (ASIS_PERSONAS[e.id] ?? []).length })),
}));
app.post('/api/tools/asistencia/eventos', (req, res) => {
  const nombre = String(req.body.nombre ?? '').trim();
  if (nombre.length < 3) return res.status(400).json({ error: 'invalid_data', message: 'El nombre del evento necesita al menos 3 caracteres' });
  const evento = { id: require('node:crypto').randomUUID(), nombre, sector: req.body.sector ?? 'otro', fecha: req.body.fecha ?? '', lugar: req.body.lugar ?? '', codigo: 'D3M0' + String(Math.floor(Math.random() * 90) + 10), estado: 'abierto', creadoPor: ROL === 'admin' ? 'admin' : 'luis', creadoEn: Date.now() };
  ASIS_EVENTOS.push(evento);
  res.status(201).json({ ok: true, evento });
});
app.get('/api/tools/asistencia/eventos/:id', (req, res) => {
  const evento = asisEvento(req, res);
  if (!evento) return;
  // Con MOCK_ASIS_VIVO llega una persona nueva en cada consulta, como en un evento real.
  if (process.env.MOCK_ASIS_VIVO && evento.estado === 'abierto') {
    const n = (ASIS_PERSONAS[evento.id] ?? []).length + 1;
    asisRegistrar(evento.id, { nombre: `Asistente ${n}`, whatsapp: `5730077${String(10000 + n)}` }, 'qr', true);
  }
  j(res, { evento, asistentes: [...(ASIS_PERSONAS[evento.id] ?? [])].sort((a, b) => b.registradoEn - a.registradoEn) });
});
app.get('/api/tools/asistencia/eventos/:id/qr', async (req, res) => {
  const evento = asisEvento(req, res);
  if (!evento) return;
  const texto = `Registrar mi asistencia: ${evento.codigo}`;
  if (process.env.MOCK_SIN_NUMERO) return j(res, { texto, enlace: null, imagen: null });
  const enlace = `https://wa.me/573000000000?text=${encodeURIComponent(texto)}`;
  const imagen = await require('qrcode').toDataURL(enlace, { errorCorrectionLevel: 'M', margin: 2, width: 720 });
  j(res, { texto, enlace, imagen, numero: '573000000000' });
});
app.patch('/api/tools/asistencia/eventos/:id', (req, res) => {
  const evento = asisEvento(req, res);
  if (!evento) return;
  for (const campo of ['nombre', 'sector', 'fecha', 'lugar', 'estado']) if (req.body[campo] !== undefined) evento[campo] = req.body[campo];
  j(res, { ok: true, evento });
});
app.delete('/api/tools/asistencia/eventos/:id', (req, res) => {
  const evento = asisEvento(req, res);
  if (!evento) return;
  if (ROL !== 'admin' && evento.creadoPor !== 'luis') return res.status(403).json({ error: 'forbidden', message: 'Solo quien creó el evento o un administrador puede eliminarlo' });
  ASIS_EVENTOS.splice(ASIS_EVENTOS.indexOf(evento), 1);
  delete ASIS_PERSONAS[evento.id];
  j(res, { ok: true });
});
app.post('/api/tools/asistencia/eventos/:id/asistentes', (req, res) => {
  const evento = asisEvento(req, res);
  if (!evento) return;
  const texto = String(req.body.whatsapp ?? '').trim();
  let whatsapp = texto.replace(/\D/g, '');
  if (whatsapp.length === 10 && whatsapp[0] === '3') whatsapp = `57${whatsapp}`;
  if (texto && !/^[1-9]\d{9,14}$/.test(whatsapp)) return res.status(400).json({ error: 'invalid_data', message: 'El celular no es válido: usa 10 dígitos o incluye el indicativo' });
  const nuevo = asisRegistrar(evento.id, { nombre: String(req.body.nombre ?? '').trim(), whatsapp, correo: String(req.body.correo ?? '').trim().toLowerCase(), documento: String(req.body.documento ?? '').trim(), programa: String(req.body.programa ?? '').trim() }, 'manual', req.body.consentimiento === true);
  res.status(nuevo ? 201 : 200).json({ ok: true, nuevo });
});
app.delete('/api/tools/asistencia/eventos/:id/asistentes', (req, res) => {
  const evento = asisEvento(req, res);
  if (!evento) return;
  const lista = ASIS_PERSONAS[evento.id] ?? [];
  const i = lista.findIndex(a => a.clave === req.body.clave);
  if (i < 0) return res.status(404).json({ error: 'not_found', message: 'Esa persona ya no está en la lista' });
  lista.splice(i, 1);
  j(res, { ok: true });
});
app.post('/api/tools/asistencia/eventos/:id/importar', (req, res) => {
  const evento = asisEvento(req, res);
  if (!evento) return;
  if (!lectorAsistencia) return res.status(503).json({ error: 'mock_sin_tsx', message: 'El mock necesita tsx para leer archivos' });
  try {
    const tabla = lectorAsistencia.leerTablaArchivo(Buffer.from(String(req.body.archivo ?? ''), 'base64'), String(req.body.nombreArchivo ?? ''));
    const preparada = lectorAsistencia.prepararImportacion(tabla, lectorAsistencia.validarMapeo(req.body.mapeo, tabla.columnas.length));
    const resumen = { columnas: preparada.columnas, mapeo: preparada.mapeo, totalFilas: preparada.totalFilas, validas: preparada.asistentes.length, omitidas: preparada.omitidas, sinWhatsapp: preparada.sinWhatsapp, celularesInvalidos: preparada.celularesInvalidos };
    if (req.body.confirmar !== true) return j(res, { ok: true, previa: true, ...resumen, muestra: preparada.asistentes.slice(0, 5) });
    let nuevos = 0;
    let actualizados = 0;
    for (const persona of preparada.asistentes) { if (asisRegistrar(evento.id, persona, 'importado', req.body.consentimiento === true)) nuevos++; else actualizados++; }
    j(res, { ok: true, previa: false, ...resumen, nuevos, actualizados, sinCupo: 0 });
  } catch (err) {
    res.status(400).json({ error: 'archivo_invalido', message: err.message });
  }
});

/* ===== Agenda de asesores (datos sintéticos en memoria) ===== */
const AG_USUARIO = ROL === 'admin' ? mockAdminUsername : 'luis';
const AG_ASESORES = [
  { username: AG_USUARIO, nombre: ROL === 'admin' ? 'Ángel Acero' : 'Luis Pérez', role: ROL },
  { username: 'laura', nombre: 'Laura Pérez', role: 'asesor' },
];
const AG_DISP = { activo: true, areas: ['posgrados', 'pregrado'], duracionMin: 30, pausaMin: 0,
  semana: [1, 2, 3, 4, 5].flatMap(dia => [{ dia, desde: '09:00', hasta: '12:00' }, { dia, desde: '14:00', hasta: '17:00' }]),
  excepciones: [{ desde: '2026-12-24', hasta: '2026-12-26', motivo: 'Vacaciones' }] };
const AG_DISPS = { [AG_USUARIO]: structuredClone(AG_DISP), laura: { ...structuredClone(AG_DISP), areas: ['ti'] } };
let AG_CONFIG = { antelacionMin: 120, maxCitasFuturas: 2, diasVentana: 14, festivos: ['2026-12-08'] };
const agIso = (ms) => new Date(ms - 5 * 3600000).toISOString().slice(0, 19) + '-05:00';
const agHoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const agAt = (dias, hhmm) => Date.parse(new Date(Date.parse(agHoy + 'T00:00:00Z') + dias * 86400000).toISOString().slice(0, 10) + 'T' + hhmm + ':00-05:00');
let agN = 0;
const AG_CITAS = [
  [0, '09:00', 'María José Restrepo', '573001234567', 'posgrados', AG_USUARIO, 'whatsapp', 'confirmada'],
  [0, '10:30', 'Carlos Pérez', '573009876543', 'pregrado', AG_USUARIO, 'voz', 'confirmada'],
  [0, '14:00', null, '573015550101', 'ti', 'laura', 'whatsapp', 'confirmada'],
  [1, '09:30', 'Valentina Ortiz', '573021110022', 'posgrados', AG_USUARIO, 'panel', 'confirmada'],
  [2, '15:00', 'Andrés Gómez', '573004440099', 'posgrados', AG_USUARIO, 'whatsapp', 'cancelada'],
].map(([d, h, nombre, tel, area, asesor, canal, est]) => ({
  id: 'cita_mock' + (++agN), telefono: tel, ...(nombre ? { nombre } : {}), area, asesor,
  asesorNombre: AG_ASESORES.find(a => a.username === asesor).nombre,
  inicio: agIso(agAt(d, h)), fin: agIso(agAt(d, h) + 1800000), canal, estado: est,
}));
const agPara = (c) => { const { telefono, ...r } = c; return { ...r, telefono, telefonoMasc: '****' + telefono.slice(-4), puedeEditar: ROL === 'admin' || c.asesor === AG_USUARIO }; };
app.get('/api/tools/agenda/estado', (_q, res) => j(res, { activa: true }));
app.get('/api/tools/agenda/asesores', (_q, res) => j(res, { asesores: AG_ASESORES.map(a => ({ ...a, activo: AG_DISPS[a.username].activo, areas: AG_DISPS[a.username].areas, duracionMin: 30, esYo: a.username === AG_USUARIO, puedeEditar: ROL === 'admin' || a.username === AG_USUARIO })) }));
app.get('/api/tools/agenda/disponibilidad/:u', (req, res) => j(res, { disponibilidad: AG_DISPS[req.params.u] }));
app.put('/api/tools/agenda/disponibilidad/:u', (req, res) => { AG_DISPS[req.params.u] = req.body; j(res, { ok: true, disponibilidad: req.body }); });
app.get('/api/tools/agenda/config', (_q, res) => j(res, { config: AG_CONFIG }));
app.put('/api/tools/agenda/config', (req, res) => { AG_CONFIG = req.body; j(res, { ok: true, config: AG_CONFIG }); });
app.get('/api/tools/agenda/citas', (req, res) => {
  const desde = Date.parse(req.query.desde + 'T00:00:00-05:00'); const hasta = desde + Number(req.query.dias || 1) * 86400000;
  j(res, { citas: AG_CITAS.filter(c => Date.parse(c.inicio) >= desde && Date.parse(c.inicio) < hasta && (!req.query.asesor || c.asesor === req.query.asesor)).map(agPara) });
});
app.get('/api/tools/agenda/franjas', (req, res) => {
  const desde = Date.parse(req.query.desde + 'T00:00:00-05:00'); const franjas = [];
  for (let d = 0; d < Number(req.query.dias || 1); d++) for (const h of ['09:00', '09:30', '10:00', '11:00', '14:30', '15:00']) {
    const ini = Date.parse(new Date(desde + d * 86400000 + 5 * 3600000).toISOString().slice(0, 10) + 'T' + h + ':00-05:00');
    if (ini > Date.now() && !AG_CITAS.some(c => c.asesor === req.query.asesor && c.estado === 'confirmada' && Date.parse(c.inicio) === ini)) franjas.push({ asesor: req.query.asesor, asesorNombre: req.query.asesor, inicio: agIso(ini), fin: agIso(ini + 1800000) });
  }
  j(res, { franjas });
});
app.post('/api/tools/agenda/citas', (req, res) => {
  const b = req.body; const c = { id: 'cita_mock' + (++agN), telefono: b.telefono.replace(/\D/g, ''), nombre: b.nombre, area: b.area, asesor: b.asesor, asesorNombre: b.asesor, inicio: agIso(Date.parse(b.inicio)), fin: agIso(Date.parse(b.fin)), canal: 'panel', motivo: b.motivo, estado: 'confirmada' };
  AG_CITAS.push(c); res.status(201).json({ ok: true, cita: agPara(c), aviso: { enviado: false, motivo: 'Sin ventana de 24 h (simulado)' } });
});
app.post('/api/tools/agenda/citas/:id/cancelar', (req, res) => { const c = AG_CITAS.find(x => x.id === req.params.id); if (!c) return res.status(404).json({ message: 'Esa cita ya no existe.' }); c.estado = 'cancelada'; j(res, { ok: true, cita: agPara(c), aviso: { enviado: true } }); });
app.post('/api/tools/agenda/citas/:id/estado', (req, res) => { const c = AG_CITAS.find(x => x.id === req.params.id); c.estado = req.body.estado; j(res, { ok: true, cita: agPara(c) }); });
app.post('/api/tools/agenda/citas/:id/mover', (req, res) => { const c = AG_CITAS.find(x => x.id === req.params.id); c.inicio = agIso(Date.parse(req.body.inicio)); c.fin = agIso(Date.parse(req.body.fin)); j(res, { ok: true, cita: agPara(c), aviso: { enviado: true } }); });

/* ===== Línea de voz (Llamadas): rutas de /api/tools/voz/* =====
   Las formas de respuesta salen de src/routes/tools/voz.ts y se arman con las MISMAS funciones puras de src/voice
   (vista, devoluciones, ajustes). El simulador es el REAL (src/voice/simulador.ts) sobre un almacén en memoria, con
   académico y agenda simulados y sin IA (entiende por reglas). Si tsx no carga, las rutas contestan 503.
   Todos los datos son de ejemplo: teléfonos 57300555xxxx. */
try {
  require('tsx/cjs');
  const { almacenMemoria } = require('../src/voice/almacen.ts');
  const { AJUSTES_DEFECTO, VOCES, leerAjustes } = require('../src/voice/ajustes.ts');
  const { crearSimulador } = require('../src/voice/simulador.ts');
  const { vistaLlamada, vistaTranscripcion, costoMesUsd } = require('../src/voice/vista.ts');
  const { pendingCallbacks, OUTCOME_WHY, buildWeeklyReport } = require('../src/voice/devoluciones.ts');
  const { VOICE_COP_PER_USD } = require('../src/voice/caps.ts');
  const { bogotaClock } = require('../src/voice/horario.ts');
  const { DIALOGO_VACIO } = require('../src/voice/tipos.ts');
  const almacen = almacenMemoria();
  let ajustes = leerAjustes({ activo: true, numeroDesvio: '+573005550100', nombreAgente: 'Tooli', topeMinutosDia: 120, topeMinutosMes: 1500 }, AJUSTES_DEFECTO);
  const simulador = crearSimulador({ almacen, ajustes: async () => ajustes, ia: null, secreto: 'mock-secreto-mock-secreto-mock-0123' });
  const min = (n) => new Date(Date.now() - n * 60000);
  const L = (r, t) => ({ r, t });
  const SALUDO = 'Hola, gracias por llamar a Posgrados de la UTB. Te atiende Tooli, la asistente virtual. Esta llamada se transcribe para atenderte, y se guarda 180 días. Si prefieres hablar con un asesor, dilo cuando quieras. ¿En qué te ayudo?';
  // [minutos atrás, teléfono, resultado, segundos, verificado, resumen, líneas]
  const SEMILLA = [
    [35, '573005550141', 'devolver_llamada', 74, false, 'Quiere saber si la Maestría en Gerencia se puede cursar virtual.', [L('a', SALUDO), L('c', 'Quiero información de la maestría en gerencia, pero prefiero que me llamen más tarde'), L('a', 'Claro, quedó anotado. Un asesor te devolverá la llamada en horario de oficina. Que tengas buen día.')]],
    [190, '573005550142', 'cita', 212, true, 'Cita con posgrados mañana a las 9:00 a. m.', [L('a', SALUDO), L('c', 'Quiero hablar con un asesor de posgrados'), L('a', 'Con gusto. Tengo estas franjas: mañana a las 9:00 a. m., o mañana a las 10:30 a. m. ¿Cuál prefieres?'), L('c', 'La primera'), L('a', 'Listo, tu cita con posgrados quedó mañana a las 9:00 a. m. Te llegará la confirmación por WhatsApp.')]],
    [420, '573005550143', 'consulta', 96, false, 'Costos y duración de la Especialización en Gestión de Proyectos.', [L('a', SALUDO), L('c', 'cuánto cuesta la especialización en gestión de proyectos'), L('a', 'Te cuento lo que tengo del programa. Si quieres el valor exacto de la matrícula, un asesor te lo confirma.'), L('c', 'gracias, eso era todo'), L('a', 'Con gusto. Que tengas un excelente día.')]],
    [1500, '573005550144', 'colgo', 12, false, 'Colgó mientras la asistente saludaba.', [L('a', SALUDO)]],
    [1560, '573005550145', 'sin_cupo', 0, false, null, [L('s', 'Sin minutos disponibles: la llamada se registró para devolverla.')]],
    [1800, '573005550146', 'datos_estudiante', 188, true, 'Consultó su turno de matrícula (estudiante verificado).', [L('a', SALUDO), L('c', 'quiero saber cuándo me toca matricular'), L('a', 'Para eso necesito verificarte. ¿Me dices tu código estudiantil?'), L('c', 'T00012345'), L('s', 'Código enviado por WhatsApp (simulado)'), L('c', '123456'), L('a', 'Listo, quedaste verificado. Tu turno de matrícula es el 12 de enero a las 8:00 a. m.')]],
    [2900, '573005550147', 'transferida', 143, false, 'Pasó a un asesor en vivo por una duda de admisión.', [L('a', SALUDO), L('c', 'necesito hablar con una persona'), L('a', 'Te paso con un asesor ahora mismo.'), L('s', 'Transferida al número de desvío.')]],
    [4400, '573005550148', 'fuera_de_horario', 0, false, null, [L('s', 'Llamó fuera del horario de asesores.')]],
    [5800, '573005550149', 'consulta', 120, false, 'Preguntó por becas de posgrado.', [L('a', SALUDO), L('c', 'tienen becas para posgrado'), L('a', 'Hay descuentos para egresados y convenios. Un asesor puede darte el detalle.')]],
    [9000, '573005550150', 'silencio', 31, false, null, [L('a', SALUDO), L('a', '¿Sigues ahí?'), L('a', 'No te escucho, así que voy a colgar. Puedes volver a llamar cuando quieras.')]],
    [14500, '573005550141', 'consulta', 88, false, 'Preguntó por el calendario de inscripciones.', [L('a', SALUDO), L('c', 'cuándo cierran las inscripciones'), L('a', 'Las inscripciones a posgrados cierran en enero. Confírmalo con un asesor.')]],
    [20000, '573005550151', 'cita', 175, true, 'Cita con TI por la clave del correo institucional.', [L('a', SALUDO), L('c', 'no puedo entrar a mi correo'), L('a', 'Te agendo con soporte. Tengo mañana a las 2:00 p. m.'), L('c', 'sí'), L('a', 'Listo, quedó agendada.')]],
  ];
  const listo = (async () => {
    for (const [atras, tel, resultado, seg, verif, resumen, lineas] of SEMILLA) {
      const ahora = min(atras);
      const r = await almacen.reservarLlamada({ proveedor: 'telnyx', proveedorCallId: 'mock-' + tel + '-' + atras, telefono: tel, simulada: false, soloRegistro: true, ahora, topes: { topeMinutosDia: 120, topeMinutosMes: 1500, maxMinutosLlamada: 10, retencionDias: 180 } });
      if (!r.ok) continue;
      const cobrados = seg > 0 ? Math.ceil(seg / 60) : 0;
      await almacen.guardar({ ...r.llamada, estado: 'cerrada', resultado, contestada: seg > 0 ? ahora.toISOString() : null, cerrada: new Date(ahora.getTime() + seg * 1000).toISOString(), duracionSeg: seg, minutosCobrados: cobrados, costoUsd: Math.round(cobrados * 0.07 * 10000) / 10000, resumen, dialogo: { ...DIALOGO_VACIO, verificado: verif ? tel : null } });
      let i = 0;
      for (const l of lineas) await almacen.agregarLinea(r.llamada.id, { ...l, at: new Date(ahora.getTime() + 1000 * (i++ * 6)).toISOString() }, 180);
    }
    const { day, month } = bogotaClock(new Date());
    await almacen.ajustarUso(day, month, 14);
    await almacen.ajustarUso('mock', month, 184);
  })();
  const admin = () => ROL === 'admin';
  const usuarioVoz = () => (ROL === 'admin' ? mockAdminUsername : 'luis');
  const wrap = (fn) => async (req, res) => { try { await listo; await fn(req, res); } catch (e) { console.error('[mock voz]', e.message); res.status(500).json({ error: 'voz_error', message: 'No se pudo completar la operación de la línea de voz.' }); } };
  const idOk = (id) => /^[0-9a-f-]{36}$/.test(id);
  const CONEXION = { llaveApi: true, llavePublica: true, conexion: true, numero: '+57 601 555 0100', webhookListo: true, ia: false, modeloIa: 'gpt-4o-mini', academico: true, agenda: true };
  const AVISOS = [
    { at: min(35).toISOString(), texto: 'Llamada 573005550141: pidió que le devuelvan la llamada.' },
    { at: min(1560).toISOString(), texto: 'Se acabaron los minutos del día: la llamada 573005550145 quedó para devolver.' },
  ];
  app.get('/api/tools/voz/estado', wrap(async (_q, res) => {
    const ahora = new Date();
    const uso = await almacen.uso(ahora);
    const costo = costoMesUsd(await almacen.listar(1000), ahora);
    res.json({
      conexion: admin() ? CONEXION : { lista: CONEXION.llaveApi && CONEXION.llavePublica },
      ajustes, voces: VOCES,
      uso: { ...uso, topeDia: ajustes.topeMinutosDia, topeMes: ajustes.topeMinutosMes },
      costoMes: { usd: costo, copAprox: Math.round((costo * VOICE_COP_PER_USD) / 100) * 100 },
      avisos: AVISOS, admin: admin(),
    });
  }));
  app.put('/api/tools/voz/ajustes', wrap(async (req, res) => {
    if (!admin()) return res.status(403).json({ error: 'forbidden' });
    ajustes = leerAjustes(req.body ?? {}, ajustes);
    res.json({ ajustes });
  }));
  app.post('/api/tools/voz/probar', wrap(async (_q, res) => {
    if (!admin()) return res.status(403).json({ error: 'forbidden' });
    res.json(process.env.MOCK_VOZ_PROBAR_FALLA ? { ok: false, message: 'Telnyx rechazó la llave (401). Revisa TELNYX_API_KEY.' } : { ok: true, message: 'Conexión con Telnyx correcta (simulada): número +57 601 555 0100 activo.' });
  }));
  app.get('/api/tools/voz/llamadas', wrap(async (req, res) => {
    const conSim = req.query.simuladas === '1';
    const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 50));
    const rows = (await almacen.listar(500)).filter((l) => conSim || !l.simulada).slice(0, limite);
    res.json({ llamadas: rows.map((l) => vistaLlamada(l, admin())) });
  }));
  app.get('/api/tools/voz/llamadas/:id', wrap(async (req, res) => {
    const l = idOk(req.params.id) ? await almacen.leer(req.params.id) : null;
    if (!l) return res.status(404).json({ error: 'not_found' });
    res.json({ llamada: vistaLlamada(l, admin()), transcripcion: vistaTranscripcion(await almacen.transcripcion(l.id), l.simulada) });
  }));
  app.get('/api/tools/voz/devoluciones', wrap(async (_q, res) => {
    const pend = pendingCallbacks(await almacen.listar(1000));
    res.json({ devoluciones: pend.map((p) => ({ ...p, motivo: OUTCOME_WHY[p.outcome] ?? p.outcome })) });
  }));
  app.post('/api/tools/voz/devoluciones/:id/hecha', wrap(async (req, res) => {
    const l = idOk(req.params.id) ? await almacen.leer(req.params.id) : null;
    if (!l || l.simulada) return res.status(404).json({ error: 'not_found' });
    const nota = typeof req.body?.nota === 'string' ? req.body.nota.replace(/[<>]/g, '').trim().slice(0, 300) : '';
    await almacen.guardar({ ...l, devolucionHecha: new Date().toISOString(), devolucionNota: nota || null, devolucionPor: usuarioVoz() });
    res.json({ ok: true });
  }));
  app.get('/api/tools/voz/reporte', wrap(async (_q, res) => res.json(buildWeeklyReport(await almacen.listar(2000)))));
  const enviarSim = (res, r) => {
    if (!r.ok) return res.status(r.motivo === 'tope_diario' ? 429 : r.motivo === 'no_encontrada' ? 404 : 409).json({ error: r.motivo });
    res.json(r);
  };
  app.post('/api/tools/voz/simular', wrap(async (req, res) => enviarSim(res, await simulador.iniciar({ desdeNumeroDelEstudiante: req.body?.desdeNumeroDelEstudiante === true }))));
  app.post('/api/tools/voz/simular/:id/decir', wrap(async (req, res) => {
    const texto = typeof req.body?.texto === 'string' ? req.body.texto : '';
    if (!idOk(req.params.id) || !texto.trim()) return res.status(400).json({ error: 'datos_invalidos' });
    enviarSim(res, await simulador.decir(req.params.id, texto));
  }));
  app.post('/api/tools/voz/simular/:id/silencio', wrap(async (req, res) => idOk(req.params.id) ? enviarSim(res, await simulador.silencio(req.params.id)) : res.status(400).json({ error: 'datos_invalidos' })));
  app.post('/api/tools/voz/simular/:id/colgar', wrap(async (req, res) => idOk(req.params.id) ? enviarSim(res, await simulador.colgar(req.params.id)) : res.status(400).json({ error: 'datos_invalidos' })));
} catch (err) {
  console.error('[mock voz] no se pudo cargar el simulador real:', err.message);
  app.use('/api/tools/voz', (_q, res) => res.status(503).json({ error: 'voz_no_disponible', message: 'El mock no pudo cargar src/voice (¿falta tsx?).' }));
}

app.use('/app', express.static(path.join(__dirname, '..', 'src', 'public', 'app')));
app.get('/favicon.ico', (_q, res) => res.sendFile(path.join(__dirname, '..', 'src', 'public', 'app', 'favicon.ico')));
app.get('/', (_q, res) => res.redirect('/app/index.html'));
// PORT permite abrir un segundo mock sin tumbar uno que ya esté corriendo.
const PUERTO = Number(process.env.PORT) || 4599;
app.listen(PUERTO, () => console.log(`mock panel en http://localhost:${PUERTO}/app/index.html`));
