/* Servidor de PRUEBA para revisar el panel en el navegador sin Redis, sin Meta
   y sin Google Sheets. Solo expone datos sintéticos en localhost. */
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
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
  { username: 'admin', fullName: 'Ángel Acero', role: 'admin', area: 'all' },
  { username: 'luis', fullName: 'Luis Pérez', role: 'asesor', area: 'admisiones' },
  { username: 'ana', fullName: 'Ana Díaz', role: 'asesor', area: 'posgrados' },
];
const RECORDATORIOS = [
  { id: 'r1', telefono: '573001234567', mensaje: 'Recuerda tu cita de asesoría mañana', scheduledAt: hoy + 864e5, estado: 'programado', createdBy: 'luis' },
  { id: 'r2', telefono: '573009876543', mensaje: 'Vence tu pago de matrícula', scheduledAt: hoy - 864e5, estado: 'enviado', createdBy: 'admin' },
  { id: 'r3', telefono: '573021110022', mensaje: 'Invitación al evento', scheduledAt: hoy - 2 * 864e5, estado: 'fallido', error: 'Fuera de la ventana de 24h', createdBy: 'ana' },
];

const j = (res, data) => res.json(data);

// MOCK_ANON=1 simula "sin sesión", para poder ver la pantalla de login.
app.get('/api/auth/me', (_q, res) => !mockAuthenticated
  ? res.status(401).json({ error: 'no autenticado' })
  : j(res, {
  user: { username: ROL === 'admin' ? 'admin' : 'luis', fullName: ROL === 'admin' ? 'Ángel Acero' : 'Luis Pérez', role: ROL },
  urls: { chatwoot: 'https://chat.example.com', grafana: 'https://grafana.example.com' },
  capabilities: { chatwootSso: true, metaWindow: true },
}));
app.post('/api/auth/login', (req, res) => {
  if (req.body.password !== 'demo') return res.status(401).json({ error: 'invalid_credentials' });
  mockAuthenticated = true;
  j(res, { ok: true });
});
app.post('/api/auth/logout', (_q, res) => { mockAuthenticated = false; j(res, { ok: true }); });
app.get('/api/auth/users', (_q, res) => j(res, { users: USUARIOS }));
app.post('/api/auth/users', (req, res) => {
  const { username, fullName, email, role, area } = req.body;
  if (USUARIOS.some(u => u.username === username)) return res.status(409).json({ error: 'El usuario ya existe' });
  const user = { username, fullName, email, role, area };
  USUARIOS.push(user);
  j(res, { ok: true, user });
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

app.get('/api/tools/metrics/today', (_q, res) => j(res, { metrics: {
  menu_shown: 143, registro_completado: 12, turno_consultado: 31, recibo_descargado: 18,
  prospecto_completado: 9, notas_consultadas: 22, academico_menu_shown: 27 } }));
app.get('/api/tools/metrics/range', (req, res) => {
  const days = Number(req.query.days || 7);
  const out = {};
  for (let i = 0; i < days; i++) {
    const fecha = new Date(hoy - (days - 1 - i) * 864e5).toISOString().slice(0, 10);
    out[fecha] = { menu_shown: 90 + i * 11, registro_completado: 4 + (i % 5), turno_consultado: 12 + i,
      recibo_descargado: 6 + (i % 4), notas_consultadas: 9 + i * 2, prospecto_completado: 3 + (i % 3),
      academico_menu_shown: 7 + i, menu_pregrado_shown: 20 + i * 3 };
  }
  j(res, { days: out });
});

// ── Atención: conversaciones con asesor (en producción viven en Chatwoot) ──
// MOCK_ATENCION_OFF=1 simula un servidor sin Chatwoot configurado.
const AGENTES = [
  { id: 1, nombre: 'Ángel Acero', estado: 'online' },
  { id: 2, nombre: 'Luis Pérez', estado: 'online' },
  { id: 3, nombre: 'Ana Díaz', estado: 'offline' },
];
const EQUIPOS = [{ id: 10, nombre: 'Admisiones' }, { id: 11, nombre: 'Soporte TI' }];
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
app.get('/api/tools/atencion/equipo', (_q, res) => j(res, { agentes: AGENTES, equipos: EQUIPOS, yo: yoAtencion(), miEquipoId: ROL === 'admin' ? null : 10 }));
app.get('/api/tools/atencion/conversaciones', (req, res) => {
  const yo = yoAtencion();
  const base = ATENCION.filter(c => c.estado === (req.query.estado || 'open') && (!req.query.equipo || String(c.equipo?.id) === req.query.equipo));
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
app.post('/api/tools/atencion/conversaciones/:id/mensajes', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'validation_error', message: 'El mensaje no puede estar vacío.' });
  // El de Andrés lleva más de 24 h sin escribir: Meta no aceptaría texto libre.
  if (!req.body.privado && c.id === 104) {
    return res.status(409).json({ error: 'fuera_de_ventana', message: 'Han pasado 25 horas desde su último mensaje. WhatsApp solo permite texto libre dentro de las 24 horas siguientes; para retomar el contacto hay que usar una plantilla aprobada por Meta.' });
  }
  const autor = AGENTES.find(a => a.id === yoAtencion()).nombre;
  c.mensajes.push({ id: Date.now(), tipo: req.body.privado ? 'nota' : 'out', texto, ts: Date.now(), autor, adjuntos: [] });
  j(res, { ok: true });
});
app.post('/api/tools/atencion/conversaciones/:id/estado', (req, res) => {
  const c = convAtencion(req, res);
  if (!c) return;
  c.estado = req.body.estado;
  c.mensajes.push({ id: Date.now(), tipo: 'sistema', texto: `Estado cambiado a ${req.body.estado}`, ts: Date.now(), autor: null, adjuntos: [] });
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
  j(res, { ok: true });
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
  const reminder = { ...req.body, telefono, scheduledAt: Date.parse(req.body.scheduledAt), id: 'r' + Date.now(), estado: 'programado', createdBy: 'admin' };
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
const MOCK_TEMPLATES = [{ name: 'aviso_academico_demo', language: 'es_CO', category: 'UTILITY', components: [{ type: 'BODY', text: 'Aviso académico de prueba' }] }];
app.get('/api/tools/broadcast/templates', (_q, res) => j(res, { templates: process.env.MOCK_NO_TEMPLATES ? [] : MOCK_TEMPLATES }));
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
  const { templateName, language, telefonos } = req.body;
  if (!MOCK_TEMPLATES.some(t => t.name === templateName && t.language === language)) return res.status(400).json({ error: 'validation_error', message: 'Template no aprobado' });
  if (!Array.isArray(telefonos) || !telefonos.length || telefonos.length > 200) return res.status(400).json({ error: 'validation_error', message: 'Destinatarios inválidos' });
  const numeros = [...new Set(telefonos)].sort();
  const key = JSON.stringify({ templateName, language, numeros });
  const previous = BROADCAST_DEDUPE.get(key);
  if (previous) return res.status(202).json({ ok: true, job: BROADCAST_JOBS.get(previous) });
  const job = { id: 'bc' + Date.now(), templateName, language, createdBy: 'admin', createdAt: Date.now(), estado: 'pendiente', destinatarios: numeros, solicitados: telefonos.length, duplicadosOmitidos: telefonos.length - numeros.length, enviados: [], fallidos: [], nextIndex: 0 };
  BROADCAST_JOBS.set(job.id, job);
  BROADCAST_DEDUPE.set(key, job.id);
  res.status(202).json({ ok: true, job });
});
app.get('/api/tools/broadcast/jobs/:id', (req, res) => {
  const job = BROADCAST_JOBS.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  job.estado = 'completado';
  job.enviados = [...job.destinatarios];
  job.nextIndex = job.destinatarios.length;
  j(res, { job });
});
app.get('/api/tools/turno/:codigo', (req, res) => {
  if (!/^T\d{8}$/.test(req.params.codigo)) return res.status(400).json({ error: 'codigo_invalido' });
  if (req.params.codigo === 'T00000000') return res.status(404).json({ error: 'no_encontrado' });
  j(res, { turno: {
  nombre: 'María José', apellido: 'Restrepo', programa: 'Maestría en Ingeniería',
  turno: '12', fecha: '2026-10-12', hora: '09:00' } });
});
app.post('/api/tools/recibo', (req, res) => {
  if (!/^T\d{8}$/.test(req.body.codigo)) return res.status(400).json({ error: 'codigo_invalido' });
  if (!/^\d{6,12}$/.test(req.body.cedula)) return res.status(400).json({ error: 'cedula_invalida' });
  if (req.body.codigo === 'T00000000') return res.status(200).json({ noRecibos: true, nombre: 'Estudiante de prueba' });
  if (req.body.cedula === '1234567890') return res.status(400).json({ error: 'login_failed' });
  res.set('Content-Type', 'application/pdf').send(Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'));
});
app.get('/api/auth/chatwoot-sso', (_q, res) => j(res, { url: 'https://chat.example.com/sso' }));
app.get('/health/deep', (_q, res) => j(res, {
  status: 'degraded',
  timestamp: new Date().toISOString(),
  checks: {
    redis:    { status: 'ok',       latencyMs: 3,    timestamp: hoy },
    meta:     { status: 'ok',       latencyMs: 210,  timestamp: hoy },
    sheets:   { status: 'degraded', latencyMs: 1800, detail: 'Cuota casi agotada', timestamp: hoy },
    iceberg:  { status: 'down',     detail: 'El portal no responde', timestamp: hoy },
    chatwoot: { status: 'ok',       latencyMs: 96,   timestamp: hoy },
  },
}));

app.use('/app', express.static(path.join(__dirname, '..', 'src', 'public', 'app')));
app.get('/', (_q, res) => res.redirect('/app/index.html'));
app.listen(4599, () => console.log('mock panel en http://localhost:4599/app/index.html'));
