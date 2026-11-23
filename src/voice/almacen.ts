// Persistencia de la voz. En FastFood eran tablas de Supabase con funciones SQL (voice_claim_event,
// voice_reserve_call con FOR UPDATE, 0433); aquí la base es Redis (almacenRedis.ts, con scripts Lua atómicos). Esta
// interfaz deja que el manejador, el simulador y las pruebas usen el mismo motor; `almacenMemoria` replica las mismas
// reglas en memoria (pruebas, y respaldo si alguien corre el simulador sin Redis).
import { randomUUID } from 'node:crypto';
import { allowedMinutesForNewCall } from './caps';
import { bogotaClock } from './horario';
import { DIALOGO_VACIO, MAX_LINEAS, MAX_TURN_CHARS, type LineaTranscripcion, type LlamadaVoz } from './tipos';

export interface TopesReserva {
  topeMinutosDia: number;
  topeMinutosMes: number;
  maxMinutosLlamada: number;
  retencionDias: number;
}

export type Reserva = { ok: true; llamada: LlamadaVoz } | { ok: false; motivo: 'sin_cupo' | 'duplicada' };

export interface AlmacenVoz {
  /** Idempotencia: true solo la primera vez que llega ese evento. */
  reclamarEvento(proveedor: string, eventId: string): Promise<boolean>;
  /** Si procesar falló, se suelta para que el reintento del proveedor sirva. */
  liberarEvento(proveedor: string, eventId: string): Promise<void>;
  /** Reserva atómica de cupo (día y mes de Colombia) y crea la llamada. Simulada o soloRegistro (llamada sin cupo que
   *  igual queda en el registro para devolverla): no gasta cupo. */
  reservarLlamada(args: { proveedor: string; proveedorCallId: string; telefono: string; simulada: boolean; topes: TopesReserva; ahora: Date; soloRegistro?: boolean }): Promise<Reserva>;
  porProveedor(proveedor: string, proveedorCallId: string): Promise<LlamadaVoz | null>;
  leer(id: string): Promise<LlamadaVoz | null>;
  /** Compare-and-set: escribe solo si la versión guardada es `llamada.version`; guarda con versión + 1. */
  guardar(llamada: LlamadaVoz): Promise<LlamadaVoz | null>;
  /** Corrige el uso cuando la llamada se cierra (minutos cobrados - minutos apartados). */
  ajustarUso(dia: string, mes: string, deltaMinutos: number): Promise<void>;
  agregarLinea(id: string, linea: LineaTranscripcion, retencionDias: number): Promise<void>;
  transcripcion(id: string): Promise<LineaTranscripcion[]>;
  /** Más recientes primero, solo las que siguen dentro de la retención. */
  listar(limite: number): Promise<LlamadaVoz[]>;
  uso(ahora: Date): Promise<{ dia: number; mes: number }>;
  /** Cuenta simulaciones del día; false si ya se llegó al tope. */
  contarSimulacion(ahora: Date, tope: number): Promise<boolean>;
  /** Índice de fechas límite de silencio (para el barrido). Reemplaza la de esa llamada si ya había una. */
  indexarSilencio(id: string, vence: number): Promise<void>;
  /** Las que ya vencieron a `ahora` (ms), las más viejas primero. */
  silenciosVencidos(ahora: number, limite: number): Promise<{ id: string; vence: number }[]>;
  /** Saca la entrada solo si sigue siendo esa fecha (otra instancia pudo programar una nueva). */
  quitarSilencio(id: string, vence: number): Promise<void>;
}

/** Retención en ms desde un instante. */
export const expiraEn = (desde: Date, dias: number) => desde.getTime() + dias * 86_400_000;

export function nuevaLlamada(args: {
  id?: string; proveedor: string; proveedorCallId: string; telefono: string; simulada: boolean;
  minutosPermitidos: number; ahora: Date; retencionDias: number;
}): LlamadaVoz {
  const { day, month } = bogotaClock(args.ahora);
  return {
    id: args.id ?? randomUUID(),
    proveedor: args.proveedor,
    proveedorCallId: args.proveedorCallId,
    telefono: args.telefono.replace(/\D/g, '').slice(0, 20),
    simulada: args.simulada,
    estado: 'activa',
    resultado: 'en_curso',
    iniciada: args.ahora.toISOString(),
    contestada: null,
    cerrada: null,
    duracionSeg: 0,
    minutosPermitidos: args.minutosPermitidos,
    minutosCobrados: 0,
    costoUsd: 0,
    usoDia: day,
    usoMes: month,
    resumen: null,
    expira: expiraEn(args.ahora, args.retencionDias),
    devolucionHecha: null,
    devolucionNota: null,
    devolucionPor: null,
    version: 0,
    dialogo: DIALOGO_VACIO,
    hablando: false,
    despuesDeHablar: null,
    frase: 0,
    turnoAplicado: 0,
    puentes: 0,
    silencio: 0,
    actividad: args.ahora.getTime(),
    silencioVence: null,
    dictado: '',
  };
}

export function recortarLinea(l: LineaTranscripcion): LineaTranscripcion {
  return { ...l, t: l.t.slice(0, MAX_TURN_CHARS) };
}

/** Implementación en memoria con las mismas reglas que los scripts Lua de almacenRedis. */
export function almacenMemoria(reloj: () => number = Date.now): AlmacenVoz & { _llamadas: Map<string, LlamadaVoz> } {
  const eventos = new Set<string>();
  const llamadas = new Map<string, LlamadaVoz>();
  const porProv = new Map<string, string>();
  const lineas = new Map<string, LineaTranscripcion[]>();
  const usoDia = new Map<string, number>();
  const usoMes = new Map<string, number>();
  const sims = new Map<string, number>();
  const silencios = new Map<string, number>();
  const clon = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const vigente = (l: LlamadaVoz | undefined) => (l && l.expira > reloj() ? l : null);
  return {
    _llamadas: llamadas,
    async reclamarEvento(p, id) {
      const k = `${p}:${id}`;
      if (eventos.has(k)) return false;
      eventos.add(k);
      return true;
    },
    async liberarEvento(p, id) { eventos.delete(`${p}:${id}`); },
    async reservarLlamada({ proveedor, proveedorCallId, telefono, simulada, topes, ahora, soloRegistro }) {
      const k = `${proveedor}:${proveedorCallId}`;
      if (porProv.has(k)) return { ok: false, motivo: 'duplicada' };
      const { day, month } = bogotaClock(ahora);
      let minutos = topes.maxMinutosLlamada;
      if (!simulada && !soloRegistro) {
        minutos = allowedMinutesForNewCall(
          { dailyMinutesCap: topes.topeMinutosDia, monthlyMinutesCap: topes.topeMinutosMes, maxCallMinutes: topes.maxMinutosLlamada, costPerMinuteUsd: 0 },
          usoDia.get(day) ?? 0, usoMes.get(month) ?? 0,
        );
        if (minutos < 1) return { ok: false, motivo: 'sin_cupo' };
        usoDia.set(day, (usoDia.get(day) ?? 0) + minutos);
        usoMes.set(month, (usoMes.get(month) ?? 0) + minutos);
      }
      const llamada = nuevaLlamada({ proveedor, proveedorCallId, telefono, simulada, minutosPermitidos: minutos, ahora, retencionDias: topes.retencionDias });
      llamadas.set(llamada.id, clon(llamada));
      porProv.set(k, llamada.id);
      return { ok: true, llamada };
    },
    async porProveedor(p, cid) {
      const id = porProv.get(`${p}:${cid}`);
      const l = id ? vigente(llamadas.get(id)) : null;
      return l ? clon(l) : null;
    },
    async leer(id) {
      const l = vigente(llamadas.get(id));
      return l ? clon(l) : null;
    },
    async guardar(l) {
      const actual = llamadas.get(l.id);
      if (!actual || actual.version !== l.version) return null;
      const nueva = { ...clon(l), version: l.version + 1 };
      llamadas.set(l.id, nueva);
      return clon(nueva);
    },
    async ajustarUso(dia, mes, delta) {
      usoDia.set(dia, Math.max(0, (usoDia.get(dia) ?? 0) + delta));
      usoMes.set(mes, Math.max(0, (usoMes.get(mes) ?? 0) + delta));
    },
    async agregarLinea(id, linea) {
      const prev = lineas.get(id) ?? [];
      const next = [...prev, recortarLinea(linea)];
      lineas.set(id, next.length > MAX_LINEAS ? next.slice(next.length - MAX_LINEAS) : next);
    },
    async transcripcion(id) {
      return vigente(llamadas.get(id)) ? clon(lineas.get(id) ?? []) : [];
    },
    async listar(limite) {
      return [...llamadas.values()]
        .filter((l) => vigente(l))
        .sort((a, b) => Date.parse(b.iniciada) - Date.parse(a.iniciada))
        .slice(0, limite)
        .map(clon);
    },
    async uso(ahora) {
      const { day, month } = bogotaClock(ahora);
      return { dia: usoDia.get(day) ?? 0, mes: usoMes.get(month) ?? 0 };
    },
    async contarSimulacion(ahora, tope) {
      const { day } = bogotaClock(ahora);
      const n = (sims.get(day) ?? 0) + 1;
      if (n > tope) return false;
      sims.set(day, n);
      return true;
    },
    async indexarSilencio(id, vence) { silencios.set(id, vence); },
    async silenciosVencidos(ahora, limite) {
      return [...silencios.entries()].filter(([, v]) => v <= ahora).sort((a, b) => a[1] - b[1]).slice(0, limite).map(([id, vence]) => ({ id, vence }));
    },
    async quitarSilencio(id, vence) { if (silencios.get(id) === vence) silencios.delete(id); },
  };
}
