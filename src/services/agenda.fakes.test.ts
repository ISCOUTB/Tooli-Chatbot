/**
 * Dobles para probar la agenda sin Redis ni WhatsApp.
 *
 * Este archivo termina en .test.ts para quedar fuera del build (tsconfig
 * excluye *.test.ts) y no tiene pruebas propias: solo lo importan las demás.
 *
 * FakeRedis implementa lo mínimo que usa agendaService. Sus `eval` son un
 * PORT en JavaScript de los scripts Lua (LUA_RESERVAR, LUA_CAMBIAR_ESTADO).
 * Cada operación espera un turno del bucle de eventos ANTES de ejecutarse, de
 * modo que dos reservas simultáneas se intercalan igual que contra un Redis
 * real, y cada script corre entero sin que nada se cuele a la mitad (como Redis).
 * La prueba contra el Lua verdadero está en tools/test-agenda-redis.mjs.
 */

import {
  DepsAgenda, LUA_ASESOR_BORRADO, LUA_CAMBIAR_ESTADO, LUA_RENOMBRAR_ASESOR, LUA_RESERVAR, RedisAgenda, UsuarioAgenda,
} from './agendaService';
import type { HorarioEquipo } from './agendaLogica';

const tick = () => new Promise<void>((r) => setImmediate(r));

function borde(valor: string | number, defecto: number): { n: number; excl: boolean } {
  const s = String(valor);
  if (s === '+inf') return { n: Infinity, excl: false };
  if (s === '-inf') return { n: -Infinity, excl: false };
  if (s.startsWith('(')) return { n: Number(s.slice(1)), excl: true };
  const n = Number(s);
  return { n: Number.isFinite(n) ? n : defecto, excl: false };
}

export class FakeRedis implements RedisAgenda {
  strings = new Map<string, string>();
  zsets = new Map<string, Map<string, number>>();
  evals = 0;

  private z(key: string): Map<string, number> {
    let z = this.zsets.get(key);
    if (!z) { z = new Map(); this.zsets.set(key, z); }
    return z;
  }

  async get(key: string) { await tick(); return this.strings.get(key) ?? null; }
  async set(key: string, value: string) { await tick(); this.strings.set(key, value); return 'OK'; }
  async del(...keys: string[]) { await tick(); let n = 0; for (const k of keys) if (this.strings.delete(k)) n++; return n; }
  async mget(keys: string[]) { await tick(); return keys.map((k) => this.strings.get(k) ?? null); }
  async zrem(key: string, ...members: string[]) { await tick(); let n = 0; for (const m of members) if (this.z(key).delete(m)) n++; return n; }

  async zrangebyscore(key: string, min: string | number, max: string | number) {
    await tick();
    return this.rango(key, min, max);
  }

  private rango(key: string, min: string | number, max: string | number): string[] {
    const lo = borde(min, -Infinity);
    const hi = borde(max, Infinity);
    return [...this.z(key).entries()]
      .filter(([, s]) => (lo.excl ? s > lo.n : s >= lo.n) && (hi.excl ? s < hi.n : s <= hi.n))
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
      .map(([m]) => m);
  }

  async eval(script: string, numKeys: number, ...args: Array<string | number>) {
    await tick();
    this.evals++;
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);
    // Desde aquí NO hay ningún await: el script es atómico.
    if (script === LUA_RESERVAR) return this.reservar(keys, argv);
    if (script === LUA_CAMBIAR_ESTADO) return this.cambiarEstado(keys, argv);
    if (script === LUA_RENOMBRAR_ASESOR) return this.renombrarAsesor(keys, argv);
    if (script === LUA_ASESOR_BORRADO) return this.asesorBorrado(keys, argv);
    throw new Error('Script Lua desconocido para el doble');
  }

  private reservar(keys: string[], a: string[]): number {
    const ini = Number(a[1]); const fin = Number(a[2]); const pausa = Number(a[3]); const ahora = Number(a[4]);
    const maxFut = Number(a[5]); const excluir = a[9];
    const parse = (m: string) => { const r = /^(\d+):(\d+):(.+)$/.exec(m)!; return { i: Number(r[1]), f: Number(r[2]), id: r[3] }; };
    let cuenta = 0;
    for (const m of this.rango(keys[1], a[4], '+inf')) {
      const { i, f, id } = parse(m);
      if (id === excluir) continue;
      cuenta++;
      if (ini < f && i < fin) return -2;
    }
    if (maxFut > 0 && cuenta >= maxFut) return -1;
    for (const m of this.rango(keys[0], a[10], `(${a[11]}`)) {
      const { i, f, id } = parse(m);
      if (id === excluir) continue;
      if (ini < f + pausa && i < fin + pausa) return 0;
    }
    this.strings.set(keys[2], a[6]);
    this.z(keys[0]).set(a[0], ini);
    this.z(keys[1]).set(a[0], ini);
    this.z(keys[3]).set(a[8], ini);
    const limite = ahora - 86_400_000;
    for (const k of [keys[0], keys[1]]) {
      for (const [m, s] of this.z(k)) if (s <= limite) this.z(k).delete(m);
    }
    return 1;
  }

  private renombrarAsesor(keys: string[], a: string[]): number {
    const disp = this.strings.get(keys[0]);
    if (disp !== undefined) { this.strings.set(keys[1], disp); this.strings.delete(keys[0]); }
    for (const [m, sc] of this.z(keys[2])) this.z(keys[3]).set(m, sc);
    this.zsets.delete(keys[2]);
    let n = 0;
    for (const id of this.z(keys[4]).keys()) {
      const k = a[2] + id;
      const raw = this.strings.get(k);
      if (!raw) continue;
      const c = JSON.parse(raw);
      let cambio = false;
      if (c.asesor === a[0] && !c.sinAsesor) { c.asesor = a[1]; cambio = true; n++; }
      if (c.creadaPor === a[0]) { c.creadaPor = a[1]; cambio = true; }
      if (cambio) this.strings.set(k, JSON.stringify(c));
    }
    return n;
  }

  private asesorBorrado(keys: string[], a: string[]): number {
    this.strings.delete(keys[0]);
    this.zsets.delete(keys[1]);
    let n = 0;
    for (const [id, score] of this.z(keys[2])) {
      const k = a[1] + id;
      const raw = this.strings.get(k);
      if (!raw) continue;
      const c = JSON.parse(raw);
      if (c.asesor !== a[0] || c.sinAsesor) continue;
      c.sinAsesor = true;
      this.strings.set(k, JSON.stringify(c));
      if (c.estado === 'confirmada' && score >= Number(a[2])) n++;
    }
    return n;
  }

  private cambiarEstado(keys: string[], a: string[]): string {
    const raw = this.strings.get(keys[0]);
    if (!raw) return 'noexiste';
    const c = JSON.parse(raw);
    if (a[0] !== '' && c.telefono !== a[0]) return 'ajena';
    if (!a[2].includes(`,${c.estado},`)) return 'estado';
    c.estado = a[1];
    this.strings.set(keys[0], JSON.stringify(c));
    if (a[1] === 'cancelada') this.z(keys[1]).delete(a[4]);
    this.z(keys[2]).delete(a[4]);
    return 'ok';
  }
}

export interface Recordatorio { id: string; telefono: string; mensaje: string; cuandoMs: number; cancelado: boolean }

export interface MundoFake {
  redis: FakeRedis;
  deps: DepsAgenda;
  recordatorios: Recordatorio[];
  reloj: { ahora: number };
  equipo: { horario: HorarioEquipo | null };
  adaptador: { valor: 'meta' | 'evolution' };
  /** Último mensaje entrante por teléfono (la marca de `activity:<tel>`). Sin entrada: nunca escribió. */
  entrantes: Map<string, number>;
}

export const USUARIOS_BASE: UsuarioAgenda[] = [
  { username: 'laura', fullName: 'Laura Pérez', role: 'asesor' },
  { username: 'mario', fullName: 'Mario Gómez', role: 'asesor' },
  { username: 'admin', fullName: 'Administrador', role: 'admin' },
];

/** `ahoraMs` por defecto: lunes 2026-11-23 08:00 en Bogotá. */
export function crearMundo(opts: { ahoraMs?: number; usuarios?: UsuarioAgenda[] } = {}): MundoFake {
  const redis = new FakeRedis();
  const recordatorios: Recordatorio[] = [];
  const reloj = { ahora: opts.ahoraMs ?? Date.parse('2026-11-23T08:00:00-05:00') };
  const equipo: { horario: HorarioEquipo | null } = { horario: null };
  const adaptador: { valor: 'meta' | 'evolution' } = { valor: 'evolution' };
  const usuarios = (opts.usuarios ?? USUARIOS_BASE).map((u) => ({ ...u }));
  const entrantes = new Map<string, number>();
  const deps: DepsAgenda = {
    redis,
    ahora: () => reloj.ahora,
    usuarios: {
      listar: async () => usuarios,
      obtener: async (u) => usuarios.find((x) => x.username === u.toLowerCase()) ?? null,
      // Para que una prueba pueda renombrar a un usuario como lo haría usersService.
      _lista: usuarios,
    } as DepsAgenda['usuarios'],
    horarioEquipo: async () => equipo.horario,
    recordatorios: {
      programar: async (telefono, mensaje, cuandoMs) => {
        const id = `rem_${recordatorios.length + 1}`;
        recordatorios.push({ id, telefono, mensaje, cuandoMs, cancelado: false });
        return id;
      },
      cancelar: async (id) => { const r = recordatorios.find((x) => x.id === id); if (r) r.cancelado = true; },
    },
    adaptador: () => adaptador.valor,
    ultimoEntrante: async (tel) => entrantes.get(tel) ?? null,
  };
  return { redis, deps, recordatorios, reloj, equipo, adaptador, entrantes };
}

/** Lunes a viernes 09:00-12:00 y 14:00-17:00, citas de 30 min, áreas indicadas. */
export function dispSemana(areas: Array<'posgrados' | 'pregrado' | 'ti'> = ['posgrados'], extra: Record<string, unknown> = {}) {
  const semana = [1, 2, 3, 4, 5].flatMap((dia) => [
    { dia, desde: '09:00', hasta: '12:00' },
    { dia, desde: '14:00', hasta: '17:00' },
  ]);
  return { activo: true, areas, duracionMin: 30, pausaMin: 0, semana, excepciones: [], ...extra };
}
