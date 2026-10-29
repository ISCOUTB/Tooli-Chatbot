import { icon } from './icons.js';

const AUDIT_LABELS = {
  login: { label: 'Inició sesión', icon: '🔑' },
  turno_consultado: { label: 'Consultó un turno', icon: '📋' },
  recibo_descargado: { label: 'Descargó un recibo', icon: '🧾' },
  sesion_reseteada: { label: 'Reseteó una sesión', icon: '🔄' },
  usuario_baneado: { label: 'Baneó un usuario', icon: '⛔' },
  usuario_desbaneado: { label: 'Desbaneó un usuario', icon: '✅' },
  ia_activada: { label: 'Activó la IA', icon: '🤖' },
  ia_desactivada: { label: 'Apagó la IA', icon: '🤖' },
  usuario_creado: { label: 'Creó un usuario', icon: '➕' },
  usuario_eliminado: { label: 'Eliminó un usuario', icon: '🗑️' },
  seguimiento_evento_actualizado: { label: 'Actualizó seguimiento de un prospecto', icon: '🎯' },
  invitacion_evento_enviada: { label: 'Invitó a próximo evento por WhatsApp', icon: '📨' },
  broadcast_enviado: { label: 'Envió una plantilla masiva', icon: '📣' },
  recordatorio_enviado: { label: 'Envió un recordatorio', icon: '🔔' },
  recordatorio_programado: { label: 'Programó un recordatorio', icon: '⏰' },
  recordatorio_cancelado: { label: 'Canceló un recordatorio', icon: '✖️' },
  mensaje_enviado: { label: 'Respondió por WhatsApp', icon: '💬' },
  crm_nota_agregada: { label: 'Agregó una nota al CRM', icon: '📝' },
  crm_estado_actualizado: { label: 'Movió un prospecto en el embudo', icon: '🎯' },
  crm_asignado: { label: 'Asignó un prospecto', icon: '🙋' },
  atencion_nota_privada: { label: 'Dejó una nota en una conversación', icon: '📝' },
  atencion_estado_cambiado: { label: 'Cambió el estado de una conversación', icon: '✅' },
  atencion_asignada: { label: 'Asignó una conversación', icon: '🙋' },
};

/* Agrupa cada acción de auditoría por área real de negocio, para poder
   comparar carga de trabajo Pregrado vs Posgrado vs Administración en el
   dashboard de rendimiento — no es un campo que exista en el dato crudo,
   se deriva de qué acción es (turno/recibo = trámites de pregrado). */
const AUDIT_AREAS = {
  pregrado: { label: 'Pregrado', color: '#0284c7', actions: ['turno_consultado', 'recibo_descargado'] },
  posgrado: { label: 'Posgrado', color: '#7c3aed', actions: ['seguimiento_evento_actualizado', 'invitacion_evento_enviada'] },
  atencion: { label: 'Atención directa', color: '#16a34a', actions: ['mensaje_enviado', 'recordatorio_enviado', 'recordatorio_programado', 'recordatorio_cancelado', 'broadcast_enviado', 'crm_nota_agregada', 'crm_estado_actualizado', 'crm_asignado', 'atencion_nota_privada', 'atencion_estado_cambiado', 'atencion_asignada'] },
  administracion: { label: 'Administración', color: '#d97706', actions: ['sesion_reseteada', 'usuario_baneado', 'usuario_desbaneado', 'usuario_creado', 'usuario_eliminado', 'ia_activada', 'ia_desactivada'] },
  sistema: { label: 'Sistema', color: '#64748b', actions: ['login'] },
};
function areaForAction(action) {
  return Object.entries(AUDIT_AREAS).find(([, a]) => a.actions.includes(action))?.[0] ?? 'sistema';
}

function dateLabelToday() {
  const s = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { AUDIT_LABELS, AUDIT_AREAS, areaForAction, dateLabelToday };
