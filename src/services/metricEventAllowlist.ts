import type { MetricEvent } from './metrics';

// Runtime allowlist for data arriving through the authenticated panel endpoint.
// Keep this in sync with MetricEvent when adding a deliberate new event.
const METRIC_EVENT_NAMES: ReadonlySet<string> = new Set([
  'menu_shown', 'turno_consultado', 'turno_no_encontrado', 'recibo_descargado',
  'recibo_login_failed', 'recibo_no_pendientes', 'recibo_error', 'ai_request',
  'ai_resolved', 'ai_failed', 'ai_escalated_to_agent', 'ai_disabled_escalation',
  'ai_used_tool', 'ai_identity_verification_started', 'agent_handoff',
  'agent_outside_hours', 'rate_limited', 'duplicate_message',
  'prospecto_iniciado', 'prospecto_completado', 'programas_especializaciones',
  'programas_maestrias', 'programas_doctorados', 'programas_ayuda_areas',
  'programas_ayuda_area', 'registro_iniciado', 'registro_completado',
  'menu_pregrado_shown', 'prospecto_pregrado_iniciado',
  'prospecto_pregrado_completado', 'registro_pregrado_iniciado',
  'registro_pregrado_completado', 'academico_menu_shown', 'academico_notas',
  'pregrado_explorar_iniciado', 'pregrado_explorar_area', 'pregrado_explorar_carrera',
  'admisiones_guia_pregrado', 'admisiones_guia_posgrado',
  'academico_horario', 'academico_savio', 'academico_calendario',
  'academico_recibo', 'academico_correo', 'academico_becas',
  'academico_derechos', 'verificacion_iniciada', 'verificacion_completada',
  'savio_cursos_consultados', 'savio_cuenta_no_encontrada', 'savio_error',
  'notas_consultadas', 'notas_no_encontradas',
  'reco_inicio', 'reco_relacion_estudiante_utb', 'reco_relacion_egresado_utb',
  'reco_relacion_externo', 'reco_pregrado_utb', 'reco_externo_coincide',
  'reco_externo_sin_coincidencia', 'reco_resultados', 'reco_mas_opciones',
  'reco_salida_pregrado', 'reco_salida_otras_gestiones',
]);

export function isMetricEvent(value: unknown): value is MetricEvent {
  return typeof value === 'string' && METRIC_EVENT_NAMES.has(value);
}
