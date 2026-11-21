/**
 * Perfil de quien conversa con el flujo de posgrados. La sesión dura una hora;
 * el perfil, 90 días, para que quien vuelve no tenga que contestar todo de nuevo.
 * Solo guarda valores cerrados (relación, carrera, nivel), el nombre que dio y
 * si autorizó recibir información. Nunca lo que escribió.
 */
import Redis from 'ioredis';
import { config } from '../config';
import { decisionGuardada } from './consentimientoService';

const redis = new Redis(config.redis.url, { lazyConnect: true });
const CLAVE = (telefono: string) => `perfil:${telefono}`;

export const TTL_PERFIL_SEGUNDOS = 90 * 24 * 60 * 60;

/** Lo que se recuerda entre conversaciones. */
export const CAMPOS_PERFIL = [
  'relacion', 'pregradoId', 'familiaId', 'nivel', 'nivelListo', 'nombre', 'correo', 'datos', 'info', 'filaCrm', 'sinPregrado',
  'pendiente', 'pendienteEn',
] as const;

/**
 * La pregunta sin contestar se recuerda un día: quien responde "Ingeniería Civil"
 * dos horas después (con la sesión ya vencida) sigue contestando esa pregunta.
 */
export const PENDIENTE_VIGENTE_MS = 24 * 60 * 60 * 1000;

export function pendienteVigente(perfil: Record<string, string>, ahora = Date.now()): boolean {
  const desde = Number(perfil.pendienteEn);
  return !!perfil.pendiente && Number.isFinite(desde) && desde > 0 && ahora - desde < PENDIENTE_VIGENTE_MS;
}

/** Lo que nunca se pierde al empezar de nuevo: el nombre y las autorizaciones. */
export const CAMPOS_CONSENTIMIENTO = ['nombre', 'correo', 'datos', 'info', 'filaCrm'] as const;

export function perfilDeDatos(data: Record<string, string>): Record<string, string> {
  const perfil: Record<string, string> = {};
  for (const campo of CAMPOS_PERFIL) {
    const valor = data[campo];
    if (typeof valor === 'string' && valor !== '') perfil[campo] = valor.slice(0, 120);
  }
  return perfil;
}

export function soloConsentimiento(perfil: Record<string, string> | null): Record<string, string> {
  const base: Record<string, string> = {};
  for (const campo of CAMPOS_CONSENTIMIENTO) if (perfil?.[campo]) base[campo] = perfil[campo];
  return base;
}

export async function leerPerfil(telefono: string): Promise<Record<string, string> | null> {
  const raw = await redis.get(CLAVE(telefono));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return perfilDeDatos(parsed as Record<string, string>);
  } catch {
    return null;
  }
}

/**
 * Una sesión reiniciada por otro paso (el asesor, el menú anterior) llega sin la
 * decisión sobre los datos: se recupera la constancia y, si autorizó, lo que se
 * recuerda de la persona, para no volver a pedirle la autorización ni el nombre.
 */
export async function conLoRecordado(telefono: string, data: Record<string, string>): Promise<Record<string, string>> {
  if (data.datos) return data;
  const decision = await decisionGuardada(telefono);
  if (!decision) return data;
  const completo: Record<string, string> = { ...data, datos: decision };
  if (decision !== 'si') return completo;
  try {
    const perfil = await leerPerfil(telefono);
    for (const campo of CAMPOS_PERFIL) {
      if (campo === 'pendiente' || campo === 'pendienteEn') continue;
      if (perfil?.[campo] && !completo[campo]) completo[campo] = perfil[campo];
    }
  } catch {
    // Sin el perfil se sigue con la decisión, que es lo que evita volver a preguntar.
  }
  return completo;
}

/** Suma datos al perfil sin borrar lo que ya tenía (solo con autorización de datos). */
export async function completarPerfil(telefono: string, campos: Record<string, string>): Promise<void> {
  const actual = (await leerPerfil(telefono)) ?? {};
  const junto = { ...actual, ...Object.fromEntries(Object.entries(campos).filter(([, v]) => v)) };
  if (junto.datos !== 'si') return;
  await guardarPerfil(telefono, junto);
}

export async function guardarPerfil(telefono: string, data: Record<string, string>): Promise<void> {
  const perfil = perfilDeDatos(data);
  if (!Object.keys(perfil).length) {
    await redis.del(CLAVE(telefono));
    return;
  }
  await redis.setex(CLAVE(telefono), TTL_PERFIL_SEGUNDOS, JSON.stringify(perfil));
}
