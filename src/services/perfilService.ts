/**
 * Perfil de quien conversa con el flujo de posgrados. La sesión dura una hora;
 * el perfil, 90 días, para que quien vuelve no tenga que contestar todo de nuevo.
 * Solo guarda valores cerrados (relación, carrera, nivel), el nombre que dio,
 * cómo prefiere que la contacten (canal, número y franja) y si autorizó recibir
 * información. Nunca lo que escribió.
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
  'pendiente', 'pendienteEn', 'programaInteres', 'contactoCanal', 'contactoTel', 'contactoFranja',
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

/** Lo que nunca se pierde al empezar de nuevo: el nombre, las autorizaciones y cómo contactarla. */
export const CAMPOS_CONSENTIMIENTO = ['nombre', 'correo', 'datos', 'info', 'filaCrm', 'contactoCanal', 'contactoTel', 'contactoFranja'] as const;

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

/**
 * Suma `campos` a lo que ya tenía sin borrarlo (un valor vacío no pisa), salvo
 * los de `vaciar`, que se quitan: al cambiar de la llamada al chat, el número y
 * la franja de antes ya no aplican.
 */
export function juntarPerfil(
  actual: Record<string, string>, campos: Record<string, string>, vaciar: readonly string[] = [],
): Record<string, string> {
  const junto: Record<string, string> = { ...actual, ...Object.fromEntries(Object.entries(campos).filter(([, v]) => v)) };
  for (const campo of vaciar) delete junto[campo];
  return junto;
}

/** Suma datos al perfil sin borrar lo que ya tenía (solo con autorización de datos); `vaciar` quita los que ya no aplican. */
export async function completarPerfil(telefono: string, campos: Record<string, string>, vaciar: readonly string[] = []): Promise<void> {
  const junto = juntarPerfil((await leerPerfil(telefono)) ?? {}, campos, vaciar);
  if (junto.datos !== 'si') return;
  await guardarPerfil(telefono, junto);
}

/** Cómo pidió que la contactaran: lo escribe solo el paso del asesor al conectar. */
export const CAMPOS_CONTACTO = ['contactoCanal', 'contactoTel', 'contactoFranja'] as const;

/**
 * Lo que se guarda al recordar la sesión de la conversación: la sesión manda,
 * pero el nombre, el correo y la fila del CRM que no trae se conservan, y el
 * canal de contacto guardado no lo pisa una sesión que no lo tiene o que lo
 * tiene a medio elegir (lo escribe `completarPerfil` al conectar con el asesor).
 */
export function sesionParaElPerfil(guardado: Record<string, string> | null, data: Record<string, string>): Record<string, string> {
  const junto: Record<string, string> = { ...data };
  if (!guardado) return junto;
  for (const campo of ['nombre', 'correo', 'filaCrm'] as const) {
    if (!junto[campo] && guardado[campo]) junto[campo] = guardado[campo];
  }
  if (guardado.contactoCanal) for (const campo of CAMPOS_CONTACTO) junto[campo] = guardado[campo] ?? '';
  return junto;
}

export async function guardarPerfil(telefono: string, data: Record<string, string>): Promise<void> {
  const perfil = perfilDeDatos(data);
  if (!Object.keys(perfil).length) {
    await redis.del(CLAVE(telefono));
    return;
  }
  await redis.setex(CLAVE(telefono), TTL_PERFIL_SEGUNDOS, JSON.stringify(perfil));
}
