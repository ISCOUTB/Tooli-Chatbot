import Redis from 'ioredis';
import { config } from '../config';
import { recordEvent } from './promMetrics';

const redis = new Redis(config.redis.url);

const COUNTER_TTL = 60 * 60 * 24 * 90;

export type MetricEvent =
  | 'menu_shown'
  | 'turno_consultado'
  | 'turno_no_encontrado'
  | 'recibo_descargado'
  | 'recibo_login_failed'
  | 'recibo_no_pendientes'
  | 'recibo_error'
  | 'ai_request'
  | 'ai_resolved'
  | 'ai_failed'
  | 'ai_escalated_to_agent'
  | 'ai_disabled_escalation'
  | 'ai_used_tool'
  | 'ai_identity_verification_started'
  | 'agent_handoff'
  | 'agent_outside_hours'
  | 'rate_limited'
  | 'duplicate_message'
  // Posgrados
  | 'prospecto_iniciado'
  | 'prospecto_completado'
  | 'programas_especializaciones'
  | 'programas_maestrias'
  | 'programas_doctorados'
  | 'programas_ayuda_areas'
  | 'programas_ayuda_area'
  | 'registro_iniciado'
  | 'registro_completado'
  // Pregrado
  | 'menu_pregrado_shown'
  | 'prospecto_pregrado_iniciado'
  | 'prospecto_pregrado_completado'
  | 'registro_pregrado_iniciado'
  | 'registro_pregrado_completado'
  | 'admisiones_guia_pregrado'
  | 'admisiones_guia_posgrado'
  | 'pregrado_explorar_iniciado'
  | 'pregrado_explorar_area'
  | 'pregrado_explorar_carrera'
  // Mi vida académica (hub de plataformas para estudiantes matriculados).
  // Un evento por recurso, no uno genérico con prop: así el panel puede
  // rankear qué está buscando realmente la gente (ver renderMetricas).
  | 'academico_menu_shown'
  | 'academico_notas'
  | 'academico_horario'
  | 'academico_savio'
  | 'academico_calendario'
  | 'academico_recibo'
  | 'academico_correo'
  | 'academico_becas'
  | 'academico_derechos'
  | 'savio_cursos_consultados'
  | 'savio_cuenta_no_encontrada'
  | 'savio_error'
  // Verificación de identidad (OTP correo)
  | 'verificacion_iniciada'
  | 'verificacion_completada'
  // Notas
  | 'notas_consultadas'
  | 'notas_no_encontradas'
  // Recomendación de posgrados según el pregrado
  | 'reco_inicio'
  | 'reco_relacion_estudiante_utb'
  | 'reco_relacion_egresado_utb'
  | 'reco_relacion_externo'
  | 'reco_pregrado_utb'
  | 'reco_externo_coincide'
  | 'reco_externo_sin_coincidencia'
  | 'reco_resultados'
  | 'reco_mas_opciones'
  | 'reco_salida_pregrado'
  | 'reco_salida_otras_gestiones'
  | 'reco_ficha'
  | 'reco_ia'
  | 'reco_asesor'
  | 'reco_consentimiento_no'
  | 'reco_lead_completado'
  | 'reco_campana_ver'
  | 'reco_campana_baja';

export interface MetricProps {
  area?: 'ti' | 'admisiones' | 'posgrados';
  plataforma?: string;
  nivel?: string;
  reason?: string;
  [k: string]: string | number | boolean | undefined;
}

function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function track(event: MetricEvent, props: MetricProps = {}): Promise<void> {
  const day = dayKey();
  const propsStr = Object.entries(props)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  console.log(`[metric] ${event}${propsStr ? ' ' + propsStr : ''}`);

  recordEvent(event, props);

  try {
    const pipe = redis.pipeline();
    pipe.hincrby(`metrics:${day}`, event, 1);
    pipe.expire(`metrics:${day}`, COUNTER_TTL);

    if (props.area) {
      pipe.hincrby(`metrics:${day}`, `${event}:area:${props.area}`, 1);
    }
    if (props.plataforma) {
      pipe.hincrby(`metrics:${day}`, `${event}:plataforma:${props.plataforma}`, 1);
    }
    await pipe.exec();
  } catch (err) {
    console.error('[metrics] redis error:', err);
  }
}

export async function getMetrics(day: string = dayKey()): Promise<Record<string, string>> {
  return await redis.hgetall(`metrics:${day}`);
}
