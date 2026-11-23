/**
 * Zona de pruebas del simulador de WhatsApp («Probar el bot» en el panel).
 *
 * El simulador corre el flujo REAL (`handleMessage`) con números reservados y,
 * mientras atiende un mensaje simulado, deja una marca en el contexto asíncrono
 * (AsyncLocalStorage). Con eso:
 *   - El adaptador de mensajería (ZonaDePruebasAdapter) guarda en el buzón lo
 *     que el bot le manda a un número simulado, en vez de mandarlo a Meta o
 *     Evolution. Lo decide por el NÚMERO, no por el contexto: un número
 *     simulado nunca sale, ni siquiera desde un temporizador sin contexto.
 *   - Los servicios con efectos fuera (Sheets, HubSpot, Chatwoot, métricas,
 *     correos, incidencias…) preguntan `saltarEnSimulacion()` y no escriben;
 *     el simulador muestra lo que se saltó como una nota de prueba.
 *
 * Números reservados: 57 0000 + 6 dígitos (12 dígitos, como un celular
 * colombiano). Ningún número real de Colombia empieza por 0 después del 57
 * (el 0 es el prefijo de marcación nacional, nunca parte del número), así que
 * es imposible confundir uno de estos con el de una persona.
 *
 * El buzón vive en la memoria del proceso (el backend corre en un solo
 * proceso). Si algún día hay varias réplicas, el buzón tendría que ir a Redis.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomInt } from 'node:crypto';

export const PREFIJO_SIMULADO = '570000';
const NUMERO_SIMULADO = /^570000\d{6}$/;

export function esNumeroSimulado(telefono: unknown): boolean {
  return typeof telefono === 'string' && NUMERO_SIMULADO.test(telefono);
}

/** Un número simulado nuevo (aleatorio dentro del rango reservado). */
export function nuevoNumeroSimulado(): string {
  return `${PREFIJO_SIMULADO}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}

/** Correo ficticio del estudiante simulado: nunca existe en la UTB ni toca el vínculo de nadie. */
export function correoSimulado(telefono: string): string {
  return `simulador.${telefono}@utb.edu.co`;
}

// ── Contexto: «este trabajo es de una conversación simulada» ─────────────────

interface ContextoSimulacion { telefono: string }
const contexto = new AsyncLocalStorage<ContextoSimulacion>();

/** ¿Lo que corre ahora mismo viene de una conversación simulada? */
export function enSimulacion(): boolean {
  return contexto.getStore() !== undefined;
}

export function telefonoEnSimulacion(): string | null {
  return contexto.getStore()?.telefono ?? null;
}

/** Corre `fn` como parte de la conversación simulada de `telefono`. Solo acepta números reservados. */
export function enZonaDePruebas<T>(telefono: string, fn: () => Promise<T>): Promise<T> {
  if (!esNumeroSimulado(telefono)) throw new Error('Solo un número simulado puede entrar a la zona de pruebas');
  return contexto.run({ telefono }, fn);
}

// ── Buzón: lo que el bot «mandó» a cada número simulado ──────────────────────

export interface BotonSimulado { id: string; texto: string }
export interface FilaSimulada { id: string; titulo: string; descripcion?: string }

export type MensajeSimulado = { id: string; ts: number } & (
  | { tipo: 'texto'; texto: string }
  | { tipo: 'botones'; titulo: string; texto: string; pie?: string; botones: BotonSimulado[] }
  | { tipo: 'lista'; titulo: string; texto: string; pie?: string; boton: string; secciones: Array<{ titulo: string; filas: FilaSimulada[] }> }
  | { tipo: 'imagen'; pie?: string; src?: string; detalle?: string }
  | { tipo: 'documento'; nombre: string; mimetype: string; bytes: number; pie?: string }
  | { tipo: 'media'; clase: string; url: string; nombre?: string; pie?: string }
  /** Lo que el simulador NO hizo fuera (o hizo de mentira) para que la prueba no ensucie datos reales. */
  | { tipo: 'nota'; servicio: string; texto: string }
);

/** Distribuye `Omit` sobre la unión (el `Omit` normal la aplana y pierde los campos de cada tipo). */
export type NuevoMensajeSimulado = MensajeSimulado extends infer M ? (M extends MensajeSimulado ? Omit<M, 'id' | 'ts'> : never) : never;

const MAX_POR_NUMERO = 200;
const MAX_NUMEROS = 100;
const buzones = new Map<string, MensajeSimulado[]>();
let secuencia = 0;

export const buzon = {
  anotar(telefono: string, mensaje: NuevoMensajeSimulado): void {
    if (!esNumeroSimulado(telefono)) return;
    let lista = buzones.get(telefono);
    if (!lista) {
      // Acotado: un simulador olvidado no puede crecer sin límite en memoria.
      if (buzones.size >= MAX_NUMEROS) buzones.delete(buzones.keys().next().value!);
      lista = [];
      buzones.set(telefono, lista);
    }
    secuencia = (secuencia + 1) % Number.MAX_SAFE_INTEGER;
    lista.push({ ...mensaje, id: `m${Date.now().toString(36)}${secuencia.toString(36)}`, ts: Date.now() } as MensajeSimulado);
    if (lista.length > MAX_POR_NUMERO) lista.splice(0, lista.length - MAX_POR_NUMERO);
  },
  /** Entrega lo pendiente y lo saca del buzón. */
  sacar(telefono: string): MensajeSimulado[] {
    const lista = buzones.get(telefono) ?? [];
    buzones.delete(telefono);
    return lista;
  },
  borrar(telefono: string): void {
    buzones.delete(telefono);
  },
};

/**
 * Lo llaman los servicios con efectos fuera antes de escribir. Devuelve true si
 * hay que saltarse la escritura: la conversación es simulada (por contexto) o el
 * teléfono es reservado. Deja una nota en el buzón para que quien prueba vea qué
 * se habría hecho.
 */
export function saltarEnSimulacion(servicio: string, texto: string, telefono?: string): boolean {
  const tel = telefonoEnSimulacion() ?? (esNumeroSimulado(telefono) ? telefono! : null);
  if (!tel) return false;
  buzon.anotar(tel, { tipo: 'nota', servicio, texto });
  return true;
}
