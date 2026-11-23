import type { ResultadoConsulta, TipoConsulta } from '../../contratos/academico';
import type { TareaProxima, TurnoDato } from './tipos';
import { leerFecha } from './voz';

/**
 * Avisos proactivos (cierra el TODO de flows/recordatorios.ts): tareas de Savio
 * por vencer y turno de matrícula del día siguiente. APAGADOS por defecto
 * (TOOLI_AVISOS_ACADEMICOS_ENABLED=1 los enciende).
 *
 * Reglas: solo a estudiantes con vínculo vigente, nunca de noche (21:00 a 08:00
 * en Colombia), solo dentro de las 24 h en que WhatsApp permite texto libre
 * (fuera de esa ventana haría falta una plantilla aprobada por Meta: queda
 * pendiente), y cada aviso se manda una sola vez. El recibo NO tiene aviso: cada
 * consulta es un login completo en Iceberg (lento y con captcha).
 */

export interface Aviso {
  /** Identifica el aviso para no repetirlo. */
  clave: string;
  texto: string;
}

const HORA_MS = 3600_000;
const COLOMBIA_MS = -5 * HORA_MS;

export function horaColombia(ahora: Date): number {
  return new Date(ahora.getTime() + COLOMBIA_MS).getUTCHours();
}

/** Entre las 08:00 y las 21:00 de Colombia. */
export function esHoraDeAvisar(ahora: Date): boolean {
  const h = horaColombia(ahora);
  return h >= 8 && h < 21;
}

/** Cuánto falta, dicho para WhatsApp. */
function cuanto(msFaltan: number): string {
  const horas = Math.round(msFaltan / HORA_MS);
  if (horas < 1) return 'en menos de una hora';
  if (horas < 24) return `en ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  return 'mañana';
}

export function avisosDeTareas(tareas: TareaProxima[], ahora: Date, ventanaHoras = 48): Aviso[] {
  return tareas
    .map((t) => ({ t, falta: new Date(t.vence).getTime() - ahora.getTime() }))
    .filter(({ falta }) => Number.isFinite(falta) && falta > 0 && falta <= ventanaHoras * HORA_MS)
    .map(({ t, falta }) => ({
      clave: `tarea:${t.curso}:${t.titulo}:${t.vence}`.slice(0, 200),
      texto: `📝 *Recordatorio de Savio*\n"${t.titulo}" de ${t.curso} vence ${cuanto(falta)}.\n\n_Escribe *mi semestre* para ver tus tareas. Para no recibir estos avisos escribe *baja*._`,
    }));
}

/** Aviso si el turno es hoy o mañana (en hora de Colombia). */
export function avisoDeTurno(t: TurnoDato, ahora: Date): Aviso | null {
  const f = leerFecha(t.fecha);
  if (!f) return null;
  const hoy = new Date(ahora.getTime() + COLOMBIA_MS);
  const dias = Math.round(
    (Date.UTC(f.anio, f.mes - 1, f.dia) - Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate())) / (24 * HORA_MS),
  );
  if (dias !== 0 && dias !== 1) return null;
  return {
    clave: `turno:${t.codigo}:${t.fecha}:${t.hora}`,
    texto: `📋 *Tu turno de matrícula es ${dias === 0 ? 'hoy' : 'mañana'}*\nTurno ${t.turno}, ${t.fecha} a las ${t.hora}.\n\n_Escribe *mi semestre* para más datos._`,
  };
}

export function planificarAvisos(resultados: Partial<Record<TipoConsulta, ResultadoConsulta>>, ahora: Date): Aviso[] {
  const avisos: Aviso[] = [];
  const cursos = resultados.cursos;
  if (cursos?.ok) {
    const datos = cursos.datos as { tareas?: TareaProxima[] };
    avisos.push(...avisosDeTareas(datos.tareas ?? [], ahora));
  }
  const turno = resultados.turno;
  if (turno?.ok) {
    const aviso = avisoDeTurno(turno.datos as TurnoDato, ahora);
    if (aviso) avisos.push(aviso);
  }
  return avisos;
}

export interface DepsAvisos {
  ahora(): Date;
  listarTelefonos(limite: number): Promise<string[]>;
  consultar(telefono: string, tipo: TipoConsulta): Promise<ResultadoConsulta>;
  /** true si el último mensaje de la persona fue hace menos de ~23 h. */
  ventanaAbierta(telefono: string): Promise<boolean>;
  /** Marca el aviso como enviado; false si ya estaba marcado (no repetir). */
  reservar(telefono: string, clave: string): Promise<boolean>;
  enviar(telefono: string, texto: string): Promise<void>;
  /** Quien escribió «baja» o no quiere avisos. */
  optoutDe(telefono: string): Promise<boolean>;
}

export interface ResumenAvisos { revisados: number; enviados: number; omitidos: number }

export async function ejecutarAvisos(deps: DepsAvisos, opciones: { maximo?: number } = {}): Promise<ResumenAvisos> {
  const resumen: ResumenAvisos = { revisados: 0, enviados: 0, omitidos: 0 };
  const ahora = deps.ahora();
  if (!esHoraDeAvisar(ahora)) return resumen;
  for (const telefono of await deps.listarTelefonos(opciones.maximo ?? 500)) {
    resumen.revisados++;
    try {
      if (await deps.optoutDe(telefono) || !(await deps.ventanaAbierta(telefono))) { resumen.omitidos++; continue; }
      const [cursos, turno] = await Promise.all([deps.consultar(telefono, 'cursos'), deps.consultar(telefono, 'turno')]);
      for (const aviso of planificarAvisos({ cursos, turno }, ahora)) {
        if (!(await deps.reservar(telefono, aviso.clave))) continue;
        await deps.enviar(telefono, aviso.texto);
        resumen.enviados++;
      }
    } catch {
      // Un estudiante con error no frena a los demás ni deja rastro del mensaje.
      resumen.omitidos++;
    }
  }
  return resumen;
}
