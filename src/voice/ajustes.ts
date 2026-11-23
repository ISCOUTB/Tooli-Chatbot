// Ajustes de la línea de voz editables desde el panel (se guardan en Redis, clave `voz:ajustes`). Puro: tipos,
// valores por defecto y saneo. Portado de FastFood (src/lib/voice/settings.ts): mismas voces, topes y costo; lo del
// restaurante (pedidos, SMS, frases por plato) se quitó; se añadieron retención, horario de asesores y verificación.
// Las credenciales NO viven aquí: vienen del entorno (src/config) y nunca salen hacia el panel.
import { HORARIO_ASESORES_DEFECTO, leerHorarioAsesores, readScheduleRules, SCHEDULE_OFF, type FranjaAsesores, type ScheduleRules } from './horario';

export interface AjustesVoz {
  activo: boolean;
  /** Número de desvío a un asesor (E.164 con +). Sin él no hay transferencia en vivo. */
  numeroDesvio: string | null;
  nombreAgente: string;
  voz: string;
  idioma: string;
  /** Saludo propio; vacío = el de siempre. */
  saludo: string;
  grabar: boolean;
  /** Días que se guardan la transcripción y el registro de cada llamada (Ley 1581: lo necesario y no más). */
  retencionDias: number;
  topeMinutosDia: number;
  topeMinutosMes: number;
  maxMinutosLlamada: number;
  /**
   * Tope de la pata saliente al pasar a un asesor (Telnyx `time_limit_secs`; sin él deja hasta 4 h). Vale también para
   * el desvío con la línea apagada o sin cupo: nunca se transfiere sin tope.
   */
  maxMinutosTransferencia: number;
  costoMinutoUsd: number;
  /** Cuándo hay asesores para transferir en vivo. */
  horarioAsesores: FranjaAsesores[];
  /** Reglas de ruteo de FastFood: horas en que la llamada pasa directo a una persona. */
  reglasRuteo: ScheduleRules;
  // «confiarEnNumero» ya no existe: el número que llama se puede falsificar y NUNCA basta para leer datos. Un ajuste
  // viejo guardado con ese campo se ignora (leerAjustes no lo copia).
  /** Tope de conversaciones del simulador por día (cada turno puede gastar IA). */
  topeSimulacionesDia: number;
}

export const AJUSTES_DEFECTO: AjustesVoz = {
  activo: false,
  numeroDesvio: null,
  nombreAgente: 'Tooli',
  voz: 'Azure.es-CO-SalomeNeural',
  idioma: 'es-MX',
  saludo: '',
  grabar: false,
  retencionDias: 180,
  topeMinutosDia: 120,
  topeMinutosMes: 1500,
  maxMinutosLlamada: 10,
  maxMinutosTransferencia: 30,
  costoMinutoUsd: 0.07,
  horarioAsesores: HORARIO_ASESORES_DEFECTO,
  reglasRuteo: SCHEDULE_OFF,
  topeSimulacionesDia: 60,
};

/** Voces probadas en español para Telnyx (formato `Proveedor.Voz`), las mismas de FastFood. */
export const VOCES: { id: string; label: string; idioma: string }[] = [
  { id: 'Azure.es-CO-SalomeNeural', label: 'Salomé · Colombia, mujer', idioma: 'es-MX' },
  { id: 'Azure.es-CO-GonzaloNeural', label: 'Gonzalo · Colombia, hombre', idioma: 'es-MX' },
  { id: 'AWS.Polly.Mia-Neural', label: 'Mía · México, mujer', idioma: 'es-MX' },
  { id: 'AWS.Polly.Lupe-Neural', label: 'Lupe · Latina (EE. UU.), mujer', idioma: 'es-US' },
  { id: 'AWS.Polly.Pedro-Neural', label: 'Pedro · Latino (EE. UU.), hombre', idioma: 'es-US' },
];

const entero = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

function numeroE164(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const d = v.replace(/[^\d+]/g, '');
  const digits = d.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Sanea lo que llegue (Redis o panel) sobre una base. Nunca lanza; lo que no sirve conserva el valor de la base. */
export function leerAjustes(raw: unknown, base: AjustesVoz = AJUSTES_DEFECTO): AjustesVoz {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const voz = typeof o.voz === 'string' && /^[A-Za-z0-9.\-]{3,60}$/.test(o.voz) ? o.voz : base.voz;
  const preset = VOCES.find((v) => v.id === voz);
  return {
    activo: has('activo') ? o.activo === true : base.activo,
    numeroDesvio: has('numeroDesvio') ? (o.numeroDesvio === null || o.numeroDesvio === '' ? null : numeroE164(o.numeroDesvio) ?? base.numeroDesvio) : base.numeroDesvio,
    nombreAgente: typeof o.nombreAgente === 'string' && o.nombreAgente.trim() ? o.nombreAgente.trim().slice(0, 30) : base.nombreAgente,
    voz,
    idioma: typeof o.idioma === 'string' && /^es-[A-Z]{2}$/.test(o.idioma) ? o.idioma : preset?.idioma ?? base.idioma,
    saludo: typeof o.saludo === 'string' ? o.saludo.replace(/[<>{}]/g, '').trim().slice(0, 300) : base.saludo,
    grabar: has('grabar') ? o.grabar === true : base.grabar,
    retencionDias: has('retencionDias') ? entero(o.retencionDias, 1, 730, base.retencionDias) : base.retencionDias,
    topeMinutosDia: has('topeMinutosDia') ? entero(o.topeMinutosDia, 0, 10_000, base.topeMinutosDia) : base.topeMinutosDia,
    topeMinutosMes: has('topeMinutosMes') ? entero(o.topeMinutosMes, 0, 100_000, base.topeMinutosMes) : base.topeMinutosMes,
    maxMinutosLlamada: has('maxMinutosLlamada') ? entero(o.maxMinutosLlamada, 1, 30, base.maxMinutosLlamada) : base.maxMinutosLlamada,
    maxMinutosTransferencia: has('maxMinutosTransferencia') ? entero(o.maxMinutosTransferencia, 1, 240, base.maxMinutosTransferencia) : base.maxMinutosTransferencia,
    costoMinutoUsd: has('costoMinutoUsd') && Number.isFinite(Number(o.costoMinutoUsd)) ? Math.min(5, Math.max(0, Number(o.costoMinutoUsd))) : base.costoMinutoUsd,
    horarioAsesores: has('horarioAsesores') ? leerHorarioAsesores(o.horarioAsesores) : base.horarioAsesores,
    reglasRuteo: has('reglasRuteo') ? readScheduleRules(o.reglasRuteo) : base.reglasRuteo,
    topeSimulacionesDia: has('topeSimulacionesDia') ? entero(o.topeSimulacionesDia, 0, 1000, base.topeSimulacionesDia) : base.topeSimulacionesDia,
  };
}
