import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ResultadoConsulta, TipoConsulta } from '../../contratos/academico';
import {
  avisoDeTurno, avisosDeTareas, ejecutarAvisos, esHoraDeAvisar, planificarAvisos, type DepsAvisos,
} from './avisos';

// Domingo 22 de noviembre de 2026, 10:00 en Colombia.
const AHORA = new Date('2026-11-22T10:00:00-05:00');
const horas = (h: number) => new Date(AHORA.getTime() + h * 3600_000).toISOString();

describe('cuándo se puede avisar', () => {
  it('solo entre las 8:00 y las 21:00 de Colombia', () => {
    assert.equal(esHoraDeAvisar(new Date('2026-11-22T07:59:00-05:00')), false);
    assert.equal(esHoraDeAvisar(new Date('2026-11-22T08:00:00-05:00')), true);
    assert.equal(esHoraDeAvisar(new Date('2026-11-22T20:59:00-05:00')), true);
    assert.equal(esHoraDeAvisar(new Date('2026-11-22T21:00:00-05:00')), false);
    // 02:00 UTC es 21:00 del día anterior en Colombia: de noche aunque en UTC sea de madrugada.
    assert.equal(esHoraDeAvisar(new Date('2026-11-23T02:00:00Z')), false);
  });
});

describe('qué se avisa', () => {
  it('tareas que vencen en las próximas 48 horas, no las vencidas ni las lejanas', () => {
    const avisos = avisosDeTareas([
      { titulo: 'Cercana', curso: 'Cálculo', vence: horas(5) },
      { titulo: 'Mañana', curso: 'Física', vence: horas(30) },
      { titulo: 'Lejana', curso: 'Cálculo', vence: horas(100) },
      { titulo: 'Vencida', curso: 'Cálculo', vence: horas(-3) },
    ], AHORA);
    assert.equal(avisos.length, 2);
    assert.match(avisos[0].texto, /"Cercana" de Cálculo vence en 5 horas/);
    assert.match(avisos[1].texto, /vence mañana/);
    assert.notEqual(avisos[0].clave, avisos[1].clave);
  });

  it('el turno de hoy o de mañana, y solo esos', () => {
    const turno = (fecha: string) => ({ codigo: 'T00012345', nombre: 'Ana', programa: 'P', turno: '14', fecha, hora: '08:00' });
    assert.match(avisoDeTurno(turno('22/11/2026'), AHORA)?.texto ?? '', /es hoy/);
    assert.match(avisoDeTurno(turno('23/11/2026'), AHORA)?.texto ?? '', /es mañana/);
    assert.equal(avisoDeTurno(turno('25/11/2026'), AHORA), null);
    assert.equal(avisoDeTurno(turno('21/11/2026'), AHORA), null);
    assert.equal(avisoDeTurno(turno('sin fecha'), AHORA), null);
  });

  it('planifica a partir de los resultados de academico.consultar y no avisa nada de lo que falló', () => {
    const cursos: ResultadoConsulta = {
      ok: true, tipo: 'cursos', paraVoz: 'x.', paraTexto: 'x',
      datos: { tareas: [{ titulo: 'Taller', curso: 'Cálculo', vence: horas(5) }] },
    };
    const turnoFalla: ResultadoConsulta = { ok: false, tipo: 'turno', motivo: 'sin_codigo', paraVoz: 'x.', paraTexto: 'x' };
    assert.equal(planificarAvisos({ cursos, turno: turnoFalla }, AHORA).length, 1);
    assert.deepEqual(planificarAvisos({ turno: turnoFalla }, AHORA), []);
  });
});

function armar(over: Partial<DepsAvisos> = {}, hora = AHORA) {
  const enviados: Array<[string, string]> = [];
  const reservas = new Set<string>();
  const consultas: string[] = [];
  const deps: DepsAvisos = {
    ahora: () => hora,
    listarTelefonos: async () => ['573001', '573002', '573003'],
    consultar: async (telefono, tipo: TipoConsulta) => {
      consultas.push(`${telefono}:${tipo}`);
      if (tipo === 'cursos') {
        return { ok: true, tipo, paraVoz: 'x.', paraTexto: 'x', datos: { tareas: [{ titulo: `Taller-${telefono}`, curso: 'C', vence: horas(5) }] } };
      }
      return { ok: false, tipo, motivo: 'sin_codigo', paraVoz: 'x.', paraTexto: 'x' };
    },
    ventanaAbierta: async () => true,
    reservar: async (t, c) => { const k = `${t}|${c}`; if (reservas.has(k)) return false; reservas.add(k); return true; },
    enviar: async (t, texto) => { enviados.push([t, texto]); },
    optoutDe: async () => false,
    ...over,
  };
  return { deps, enviados, consultas };
}

describe('envío de avisos', () => {
  it('manda uno por estudiante con tarea por vencer, y no se repite en la siguiente corrida', async () => {
    const { deps, enviados } = armar();
    const a = await ejecutarAvisos(deps);
    assert.deepEqual(a, { revisados: 3, enviados: 3, omitidos: 0 });
    assert.equal(enviados.length, 3);
    const b = await ejecutarAvisos(deps);
    assert.equal(b.enviados, 0, 'el mismo aviso no se manda dos veces');
    assert.equal(enviados.length, 3);
  });

  it('de noche no se manda ni se consulta nada', async () => {
    const { deps, enviados, consultas } = armar({}, new Date('2026-11-22T22:00:00-05:00'));
    assert.deepEqual(await ejecutarAvisos(deps), { revisados: 0, enviados: 0, omitidos: 0 });
    assert.equal(enviados.length + consultas.length, 0);
  });

  it('quien se dio de baja o tiene la ventana de 24 h cerrada se omite sin consultarle nada', async () => {
    const { deps, enviados, consultas } = armar({
      optoutDe: async (t) => t === '573001',
      ventanaAbierta: async (t) => t !== '573002',
    });
    const r = await ejecutarAvisos(deps);
    assert.deepEqual(r, { revisados: 3, enviados: 1, omitidos: 2 });
    assert.deepEqual(enviados.map(([t]) => t), ['573003']);
    assert.ok(consultas.every((c) => c.startsWith('573003')));
  });

  it('un estudiante con error no frena a los demás', async () => {
    const { deps, enviados } = armar({
      consultar: async (t, tipo) => {
        if (t === '573002') throw new Error('Moodle caído con token SECRETO');
        return { ok: true, tipo, paraVoz: 'x.', paraTexto: 'x', datos: { tareas: [{ titulo: 'T', curso: 'C', vence: horas(5) }] } };
      },
    });
    const r = await ejecutarAvisos(deps);
    assert.equal(r.enviados, 2);
    assert.equal(r.omitidos, 1);
    assert.ok(!enviados.some(([, texto]) => texto.includes('SECRETO')));
  });

  it('respeta el máximo de estudiantes por corrida', async () => {
    let pedido = 0;
    const { deps } = armar({ listarTelefonos: async (limite) => { pedido = limite; return []; } });
    await ejecutarAvisos(deps, { maximo: 40 });
    assert.equal(pedido, 40);
  });
});
