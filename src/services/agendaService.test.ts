import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { crearAgenda, AgendaError, AgendaServicio } from './agendaService';
import { MundoFake, USUARIOS_BASE, crearMundo, dispSemana } from './agenda.fakes.test';
import type { Franja } from '../contratos/agenda';

const bog = (iso: string) => Date.parse(`${iso}-05:00`);
const fr = (asesor: string, inicio: string, min = 30): Franja => {
  const ini = bog(inicio);
  const f = (ms: number) => new Date(ms - 5 * 3600_000).toISOString().slice(0, 19) + '-05:00';
  return { asesor, asesorNombre: asesor, inicio: f(ini), fin: f(ini + min * 60_000) };
};
const TEL = '573001234567';
const TEL2 = '573009876543';

let mundo: MundoFake;
let ag: AgendaServicio;

async function preparar(opts: { laura?: Record<string, unknown>; mario?: Record<string, unknown> | null } = {}) {
  mundo = crearMundo();
  ag = crearAgenda(mundo.deps);
  await ag.guardarDisponibilidad('laura', dispSemana(['posgrados'], opts.laura));
  if (opts.mario !== null) await ag.guardarDisponibilidad('mario', dispSemana(['posgrados', 'ti'], opts.mario));
}

const reservar = (tel: string, franja: Franja, area: 'posgrados' | 'pregrado' | 'ti' = 'posgrados') =>
  ag.reservar({ telefono: tel, area, franja, canal: 'whatsapp' });

describe('franjasLibres', () => {
  beforeEach(() => preparar());

  it('devuelve franjas reales ordenadas, con ISO de Bogotá, sin el pasado ni la antelación mínima', async () => {
    // Ahora: lunes 08:00. Antelación por defecto 120 min: lo primero libre es 10:00.
    const f = await ag.franjasLibres({ area: 'posgrados', max: 4 });
    assert.deepEqual(f.map((x) => x.inicio), [
      '2026-11-23T10:00:00-05:00', '2026-11-23T10:30:00-05:00', '2026-11-23T11:00:00-05:00', '2026-11-23T11:30:00-05:00',
    ]);
    assert.ok(f.every((x) => x.fin.endsWith('-05:00') && x.asesorNombre));
    assert.deepEqual(f.map((x) => x.inicio), [...f.map((x) => x.inicio)].sort());
  });

  it('a la misma hora ofrece un solo asesor: el que tiene menos citas', async () => {
    await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const f = await ag.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-24T00:00:00')), dias: 1, max: 3 });
    assert.equal(f[0].inicio, '2026-11-24T09:00:00-05:00');
    assert.equal(f[0].asesor, 'mario', 'laura ya tiene esa hora ocupada, queda mario');
    assert.equal(new Set(f.map((x) => x.inicio)).size, f.length, 'sin horas repetidas');
    const sinCarga = await ag.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-25T00:00:00')), dias: 1, max: 1 });
    assert.equal(sinCarga[0].asesor, 'laura', 'con igual carga gana el orden alfabético');
  });

  it('filtra por área y deja fuera a los asesores inactivos', async () => {
    const ti = await ag.franjasLibres({ area: 'ti', max: 50 });
    assert.ok(ti.length > 0 && ti.every((x) => x.asesor === 'mario'));
    assert.deepEqual(await ag.franjasLibres({ area: 'pregrado' }), []);
    await ag.guardarDisponibilidad('mario', dispSemana(['ti'], { activo: false }));
    assert.deepEqual(await ag.franjasLibres({ area: 'ti' }), []);
  });

  it('no sale de la ventana de días configurada', async () => {
    const f = await ag.franjasLibres({ area: 'posgrados', dias: 400, max: 200 });
    const ultimo = f[f.length - 1].inicio.slice(0, 10);
    assert.ok(ultimo <= '2026-12-06', `salió de la ventana de 14 días: ${ultimo}`);
  });

  it('una cita confirmada deja de ofrecerse y cancelarla la devuelve', async () => {
    const franja = fr('laura', '2026-11-24T10:00:00');
    const r = await reservar(TEL, franja);
    assert.equal(r.ok, true);
    const durante = await ag.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-24T00:00:00')), dias: 1, max: 100 });
    // Mario sigue libre a esa hora, así que la hora se ofrece pero ya con Mario.
    assert.equal(durante.find((x) => x.inicio === franja.inicio)?.asesor, 'mario');
    await ag.guardarDisponibilidad('mario', dispSemana(['posgrados'], { activo: false }));
    const sinMario = await ag.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-24T00:00:00')), dias: 1, max: 100 });
    assert.equal(sinMario.some((x) => x.inicio === franja.inicio), false);
    assert.equal(await ag.cancelar((r as { cita: { id: string } }).cita.id, TEL), true);
    const despues = await ag.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-24T00:00:00')), dias: 1, max: 100 });
    assert.equal(despues.some((x) => x.inicio === franja.inicio), true);
  });

  it('el horario del equipo recorta las franjas y los festivos las quitan', async () => {
    mundo.equipo.horario = { activo: true, dias: [1, 2, 3, 4, 5], desde: '10:00', hasta: '11:00' };
    const f = await ag.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-24T00:00:00')), dias: 1, max: 20 });
    assert.deepEqual(f.map((x) => x.inicio.slice(11, 16)), ['10:00', '10:30']);
    await ag.guardarConfig({ antelacionMin: 120, maxCitasFuturas: 2, diasVentana: 14, festivos: ['2026-11-24'] });
    assert.deepEqual(await ag.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-24T00:00:00')), dias: 1 }), []);
  });
});

describe('reservar', () => {
  beforeEach(() => preparar());

  it('reserva una franja válida y la devuelve en citasDe con asesor y nombre', async () => {
    const r = await ag.reservar({ telefono: `+${TEL}`, nombre: 'Ana', area: 'posgrados', franja: fr('laura', '2026-11-24T09:00:00'), canal: 'whatsapp', motivo: 'Dudas de la maestría' });
    assert.equal(r.ok, true);
    const mias = await ag.citasDe(TEL);
    assert.equal(mias.length, 1);
    assert.deepEqual(
      { tel: mias[0].telefono, asesor: mias[0].asesor, nombre: mias[0].asesorNombre, estado: mias[0].estado, canal: mias[0].canal },
      { tel: TEL, asesor: 'laura', nombre: 'Laura Pérez', estado: 'confirmada', canal: 'whatsapp' },
    );
    assert.equal(mias[0].inicio, '2026-11-24T09:00:00-05:00');
    assert.deepEqual(await ag.citasDe(TEL2), []);
  });

  it('la misma franja ya tomada responde "ocupada"', async () => {
    const franja = fr('laura', '2026-11-24T09:00:00');
    assert.equal((await reservar(TEL, franja)).ok, true);
    assert.deepEqual(await reservar(TEL2, franja), { ok: false, motivo: 'ocupada' });
  });

  it('una franja que se traslapa con otra cita del asesor también es "ocupada"', async () => {
    await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    // 09:15 no está en la rejilla, pero aunque la disponibilidad lo permitiera chocaría; se prueba con el panel.
    const r = await ag.reservarPanel({ telefono: TEL2, area: 'posgrados', franja: fr('laura', '2026-11-24T09:15:00') }, 'admin', true);
    assert.deepEqual(r, { ok: false, motivo: 'ocupada' });
    // La contigua, 09:30, sí.
    assert.equal((await reservar(TEL2, fr('laura', '2026-11-24T09:30:00'))).ok, true);
  });

  it('CONCURRENCIA: 12 personas piden a la vez la misma franja y solo una gana', async () => {
    const franja = fr('laura', '2026-11-24T09:00:00');
    const tels = Array.from({ length: 12 }, (_, i) => `57300111${String(1000 + i)}`);
    const resultados = await Promise.all(tels.map((t) => reservar(t, franja)));
    assert.equal(resultados.filter((r) => r.ok).length, 1);
    assert.equal(resultados.filter((r) => !r.ok && r.motivo === 'ocupada').length, 11);
    const guardadas = await ag.listarCitas({ desdeMs: bog('2026-11-24T00:00:00'), hastaMs: bog('2026-11-25T00:00:00') });
    assert.equal(guardadas.length, 1);
    // El ganador es dueño de la cita; los demás no tienen ninguna.
    const ganador = tels.find((_, i) => resultados[i].ok)!;
    assert.equal((await ag.citasDe(ganador)).length, 1);
    for (const t of tels.filter((x) => x !== ganador)) assert.equal((await ag.citasDe(t)).length, 0);
  });

  it('CONCURRENCIA: franjas solapadas simultáneas (panel) tampoco se cuelan', async () => {
    const pedidos = ['09:00', '09:10', '09:20', '09:29'].map((h, i) =>
      ag.reservarPanel({ telefono: `57300222${1000 + i}`, area: 'posgrados', franja: fr('laura', `2026-11-24T${h}:00`) }, 'admin', true));
    const r = await Promise.all(pedidos);
    assert.equal(r.filter((x) => x.ok).length, 1);
  });

  it('CONCURRENCIA: el límite por teléfono se cumple aunque lleguen a la vez', async () => {
    await ag.guardarConfig({ antelacionMin: 120, maxCitasFuturas: 1, diasVentana: 14, festivos: [] });
    const horas = ['09:00', '09:30', '10:00', '10:30'];
    const r = await Promise.all(horas.map((h) => reservar(TEL, fr('laura', `2026-11-24T${h}:00`))));
    assert.equal(r.filter((x) => x.ok).length, 1);
    assert.equal(r.filter((x) => !x.ok && x.motivo === 'limite').length, 3);
    assert.equal((await ag.citasDe(TEL)).length, 1);
  });

  it('límite de citas futuras por teléfono', async () => {
    assert.equal((await reservar(TEL, fr('laura', '2026-11-24T09:00:00'))).ok, true);
    assert.equal((await reservar(TEL, fr('laura', '2026-11-24T14:00:00'))).ok, true);
    assert.deepEqual(await reservar(TEL, fr('laura', '2026-11-25T09:00:00')), { ok: false, motivo: 'limite' });
    // Otro teléfono no se ve afectado.
    assert.equal((await reservar(TEL2, fr('laura', '2026-11-25T09:00:00'))).ok, true);
  });

  it('el mismo teléfono no puede tener dos citas a la misma hora con asesores distintos', async () => {
    assert.equal((await reservar(TEL, fr('laura', '2026-11-24T09:00:00'))).ok, true);
    assert.deepEqual(await reservar(TEL, fr('mario', '2026-11-24T09:00:00')), { ok: false, motivo: 'invalida' });
  });

  it('rechaza como inválida lo que no es una franja real', async () => {
    const malas: Array<[string, Parameters<typeof reservar>]> = [
      ['pasada', [TEL, fr('laura', '2026-11-23T07:00:00')]],
      ['dentro de la antelación mínima', [TEL, fr('laura', '2026-11-23T09:00:00')]],
      ['fuera de su horario', [TEL, fr('laura', '2026-11-24T12:00:00')]],
      ['fuera de la rejilla', [TEL, fr('laura', '2026-11-24T09:10:00')]],
      ['fin de semana', [TEL, fr('laura', '2026-11-28T09:00:00')]],
      ['duración distinta a la del asesor', [TEL, fr('laura', '2026-11-24T09:00:00', 45)]],
      ['asesor inexistente', [TEL, fr('nadie', '2026-11-24T09:00:00')]],
      ['área que el asesor no atiende', [TEL, fr('laura', '2026-11-24T09:00:00'), 'ti']],
      ['más allá de la ventana de días', [TEL, fr('laura', '2027-03-02T09:00:00')]],
      ['teléfono inválido', ['123', fr('laura', '2026-11-24T09:00:00')]],
    ];
    for (const [nombre, args] of malas) {
      assert.deepEqual(await reservar(...args), { ok: false, motivo: 'invalida' }, nombre);
    }
    assert.deepEqual(await ag.reservar({ telefono: TEL, area: 'posgrados', canal: 'whatsapp', franja: { asesor: 'laura', asesorNombre: 'x', inicio: 'mañana', fin: 'pasado' } }), { ok: false, motivo: 'invalida' });
    assert.deepEqual(await ag.listarCitas({ desdeMs: 0, hastaMs: Date.parse('2100-01-01') }), [], 'nada se guardó');
  });

  it('un asesor con excepción (vacaciones) o festivo no se puede reservar aunque la franja exista en su semana', async () => {
    await ag.guardarDisponibilidad('laura', dispSemana(['posgrados'], { excepciones: [{ desde: '2026-11-24', hasta: '2026-11-26', motivo: 'Vacaciones' }] }));
    assert.deepEqual(await reservar(TEL, fr('laura', '2026-11-25T09:00:00')), { ok: false, motivo: 'invalida' });
    assert.equal((await reservar(TEL, fr('laura', '2026-11-27T09:00:00'))).ok, true);
    await ag.guardarConfig({ antelacionMin: 120, maxCitasFuturas: 2, diasVentana: 14, festivos: ['2026-11-30'] });
    assert.deepEqual(await reservar(TEL2, fr('laura', '2026-11-30T09:00:00')), { ok: false, motivo: 'invalida' });
  });

  it('respeta la pausa entre citas del asesor', async () => {
    await ag.guardarDisponibilidad('laura', dispSemana(['posgrados'], { pausaMin: 15 }));
    await ag.guardarDisponibilidad('mario', dispSemana(['posgrados'], { activo: false }));
    // Rejilla con pausa: 09:00, 09:45, 10:30, 11:15.
    assert.equal((await reservar(TEL, fr('laura', '2026-11-24T09:00:00'))).ok, true);
    const libres = await ag.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-24T00:00:00')), dias: 1, max: 20 });
    assert.deepEqual(libres.slice(0, 3).map((x) => x.inicio.slice(11, 16)), ['09:45', '10:30', '11:15']);
    // Pegada a la anterior, sin respetar la pausa: no es una franja de la rejilla del asesor.
    const pegada = await reservar(TEL2, fr('laura', '2026-11-24T09:30:00'));
    assert.deepEqual(pegada, { ok: false, motivo: 'invalida' }, 'no está en la rejilla del asesor');
  });
});

describe('cancelar', () => {
  beforeEach(() => preparar());

  it('solo el dueño de la cita puede cancelarla', async () => {
    const r = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    assert.equal(r.ok, true);
    const id = (r as { cita: { id: string } }).cita.id;
    assert.equal(await ag.cancelar(id, TEL2), false, 'otro teléfono no puede');
    assert.equal(await ag.cancelar(id, ''), false, 'sin teléfono no puede');
    assert.equal((await ag.citasDe(TEL)).length, 1, 'la cita sigue en pie');
    assert.equal((await ag.obtenerCita(id))?.estado, 'confirmada');
    assert.equal(await ag.cancelar(id, `+${TEL}`), true, 'el dueño, aunque escriba el número con +');
    assert.equal((await ag.obtenerCita(id))?.estado, 'cancelada');
    assert.deepEqual(await ag.citasDe(TEL), []);
  });

  it('cancelar libera la franja para otra persona, y cancelar dos veces no hace nada', async () => {
    const franja = fr('laura', '2026-11-24T09:00:00');
    await ag.guardarDisponibilidad('mario', dispSemana(['posgrados'], { activo: false }));
    const r = await reservar(TEL, franja);
    const id = (r as { cita: { id: string } }).cita.id;
    assert.deepEqual(await reservar(TEL2, franja), { ok: false, motivo: 'ocupada' });
    assert.equal(await ag.cancelar(id, TEL), true);
    assert.equal(await ag.cancelar(id, TEL), false);
    assert.equal((await reservar(TEL2, franja)).ok, true);
  });

  it('cancelar un id que no existe o mal formado devuelve false', async () => {
    assert.equal(await ag.cancelar('cita_inexistente', TEL), false);
    assert.equal(await ag.cancelar('../../etc', TEL), false);
  });

  it('CONCURRENCIA: cancelar dos veces a la vez solo cuenta una', async () => {
    const r = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id = (r as { cita: { id: string } }).cita.id;
    const res = await Promise.all([ag.cancelar(id, TEL), ag.cancelar(id, TEL), ag.cancelar(id, TEL)]);
    assert.equal(res.filter(Boolean).length, 1);
  });
});

describe('reprogramar', () => {
  beforeEach(() => preparar());

  it('mueve la cita: la nueva queda confirmada y la vieja cancelada, sin consumir el límite', async () => {
    await ag.guardarConfig({ antelacionMin: 120, maxCitasFuturas: 1, diasVentana: 14, festivos: [] });
    const r1 = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id1 = (r1 as { cita: { id: string } }).cita.id;
    const r2 = await ag.reprogramar(id1, TEL, fr('laura', '2026-11-25T10:00:00'));
    assert.equal(r2.ok, true, 'con límite 1 la reprogramación no debe toparse con la propia cita');
    const mias = await ag.citasDe(TEL);
    assert.equal(mias.length, 1);
    assert.equal(mias[0].inicio, '2026-11-25T10:00:00-05:00');
    assert.equal((await ag.obtenerCita(id1))?.estado, 'cancelada');
    assert.equal((mias[0] as { reprogramadaDe?: string }).reprogramadaDe, id1);
  });

  it('si el nuevo horario está ocupado, la cita original no se toca', async () => {
    await ag.guardarDisponibilidad('mario', dispSemana(['posgrados'], { activo: false }));
    await reservar(TEL2, fr('laura', '2026-11-25T10:00:00'));
    const r1 = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id1 = (r1 as { cita: { id: string } }).cita.id;
    assert.deepEqual(await ag.reprogramar(id1, TEL, fr('laura', '2026-11-25T10:00:00')), { ok: false, motivo: 'ocupada' });
    assert.equal((await ag.obtenerCita(id1))?.estado, 'confirmada');
  });

  it('no se puede reprogramar la cita de otro', async () => {
    const r1 = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id1 = (r1 as { cita: { id: string } }).cita.id;
    assert.deepEqual(await ag.reprogramar(id1, TEL2, fr('laura', '2026-11-25T10:00:00')), { ok: false, motivo: 'invalida' });
    assert.equal((await ag.obtenerCita(id1))?.estado, 'confirmada');
  });

  it('se puede reprogramar al mismo horario sin chocar con la propia cita', async () => {
    await ag.guardarDisponibilidad('mario', dispSemana(['posgrados'], { activo: false }));
    await ag.guardarDisponibilidad('laura', dispSemana(['posgrados'], { duracionMin: 60 }));
    const r1 = await reservar(TEL, fr('laura', '2026-11-24T09:00:00', 60));
    const id1 = (r1 as { cita: { id: string } }).cita.id;
    assert.equal((await ag.reprogramar(id1, TEL, fr('laura', '2026-11-24T09:00:00', 60))).ok, true);
    assert.equal((await ag.citasDe(TEL)).length, 1);
  });
});

describe('recordatorios 24 h y 1 h', () => {
  beforeEach(() => preparar());

  it('con Evolution programa los dos con el texto de la cita y los cancela al cancelar', async () => {
    const r = await reservar(TEL, fr('laura', '2026-11-26T10:00:00'));
    assert.equal(mundo.recordatorios.length, 2);
    assert.deepEqual(mundo.recordatorios.map((x) => x.cuandoMs), [bog('2026-11-25T10:00:00'), bog('2026-11-26T09:00:00')]);
    assert.match(mundo.recordatorios[0].mensaje, /jueves 26 de noviembre a las 10:00 a\. m\./);
    assert.match(mundo.recordatorios[0].mensaje, /Laura Pérez/);
    assert.ok(mundo.recordatorios.every((x) => x.telefono === TEL && !x.cancelado));
    await ag.cancelar((r as { cita: { id: string } }).cita.id, TEL);
    assert.ok(mundo.recordatorios.every((x) => x.cancelado));
  });

  it('con Meta, lo que cae fuera de la ventana de 24 h queda anotado como pendiente y no se programa', async () => {
    mundo.adaptador.valor = 'meta';
    const r = await reservar(TEL, fr('laura', '2026-11-26T10:00:00'));
    assert.equal(mundo.recordatorios.length, 0);
    const guardada = await ag.obtenerCita((r as { cita: { id: string } }).cita.id);
    assert.deepEqual(guardada?.recordatoriosPendientes, ['24h', '1h']);
  });

  it('con Meta, la ventana se cuenta desde el último mensaje de la persona, no desde la reserva', async () => {
    mundo.adaptador.valor = 'meta';
    // Cita hoy a las 14:00: el de 1 h sale a las 13:00, 5 h después de la reserva.
    mundo.entrantes.set(TEL, mundo.reloj.ahora - 3 * 24 * 3600_000);
    const panel = await ag.reservarPanel({ telefono: TEL, area: 'posgrados', franja: fr('laura', '2026-11-23T14:00:00') }, 'laura', false);
    assert.equal(panel.ok, true);
    assert.equal(mundo.recordatorios.length, 0, 'escribió hace 3 días: el texto libre ya no llega');
    const guardada = await ag.obtenerCita((panel as { cita: { id: string } }).cita.id);
    assert.deepEqual(guardada?.recordatoriosPendientes, ['1h'], 'queda «sin recordatorio» y el panel lo muestra');
    assert.equal(guardada?.motivoSinRecordatorio, 'ventana');
    assert.deepEqual(guardada?.recordatorios ?? [], []);

    // La misma cita para alguien que acaba de escribir por WhatsApp sí lleva el recordatorio.
    mundo.entrantes.set(TEL2, mundo.reloj.ahora - 60_000);
    const wa = await reservar(TEL2, fr('laura', '2026-11-23T14:30:00'));
    assert.equal(mundo.recordatorios.length, 1);
    assert.deepEqual((wa as { cita: { recordatorios?: string[] } }).cita.recordatorios, ['1h']);
  });

  it('un contacto con BSUID (sin teléfono) no rompe nada: queda marcado sin recordatorio', async () => {
    const BSUID = 'CO.Ab12Cd34Ef56';
    // Igual que reminderService: validarTelefono no acepta un BSUID.
    mundo.deps.recordatorios.programar = async (t) => {
      if (!/^\d+$/.test(t)) throw new Error('telefono inválido (usa E.164 de 10–15 dígitos)');
      return 'rem_x';
    };
    const r = await reservar(BSUID, fr('laura', '2026-11-26T10:00:00'));
    assert.equal(r.ok, true);
    const guardada = await ag.obtenerCita((r as { cita: { id: string } }).cita.id);
    assert.deepEqual(guardada?.recordatoriosPendientes, ['24h', '1h']);
    assert.equal(guardada?.motivoSinRecordatorio, 'sin_telefono');
  });

  it('si programar falla, la cita queda marcada sin recordatorio (no se promete lo que no salió)', async () => {
    mundo.deps.recordatorios.programar = async () => { throw new Error('Redis caído'); };
    const r = await reservar(TEL, fr('laura', '2026-11-26T10:00:00'));
    const guardada = await ag.obtenerCita((r as { cita: { id: string } }).cita.id);
    assert.deepEqual(guardada?.recordatoriosPendientes, ['24h', '1h']);
    assert.equal(guardada?.motivoSinRecordatorio, 'error');
  });

  it('reprogramar cancela los recordatorios viejos y programa los nuevos', async () => {
    const r = await reservar(TEL, fr('laura', '2026-11-26T10:00:00'));
    await ag.reprogramar((r as { cita: { id: string } }).cita.id, TEL, fr('laura', '2026-11-27T10:00:00'));
    assert.equal(mundo.recordatorios.length, 4);
    assert.deepEqual(mundo.recordatorios.map((x) => x.cancelado), [true, true, false, false]);
  });

  it('si programar el recordatorio falla, la cita igual queda reservada', async () => {
    mundo.deps.recordatorios.programar = async () => { throw new Error('Redis caído'); };
    const r = await reservar(TEL, fr('laura', '2026-11-26T10:00:00'));
    assert.equal(r.ok, true);
    assert.equal((await ag.citasDe(TEL)).length, 1);
  });
});

describe('acciones del panel', () => {
  beforeEach(() => preparar());

  it('marcar atendida / no asistió solo cuando la cita ya empezó, y no si está cancelada', async () => {
    const r = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id = (r as { cita: { id: string } }).cita.id;
    await assert.rejects(ag.marcarPanel(id, 'atendida'), (e: AgendaError) => e.code === 'futura');
    mundo.reloj.ahora = bog('2026-11-24T09:45:00');
    assert.equal((await ag.marcarPanel(id, 'no_asistio')).estado, 'no_asistio');
    assert.equal((await ag.marcarPanel(id, 'atendida')).estado, 'atendida', 'se puede corregir');
    assert.deepEqual(await ag.citasDe(TEL), [], 'una cita atendida ya no es futura confirmada');
    mundo.reloj.ahora = bog('2026-11-23T08:00:00');
    const r2 = await reservar(TEL, fr('laura', '2026-11-25T09:00:00'));
    const id2 = (r2 as { cita: { id: string } }).cita.id;
    await ag.cancelarPanel(id2);
    mundo.reloj.ahora = bog('2026-11-25T10:00:00');
    await assert.rejects(ag.marcarPanel(id2, 'atendida'), (e: AgendaError) => e.code === 'estado_invalido');
    await assert.rejects(ag.marcarPanel('cita_noexiste', 'atendida'), (e: AgendaError) => e.code === 'no_encontrada');
  });

  it('cancelarPanel cancela cualquier cita confirmada pero no dos veces', async () => {
    const r = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id = (r as { cita: { id: string } }).cita.id;
    assert.equal((await ag.cancelarPanel(id)).estado, 'cancelada');
    await assert.rejects(ag.cancelarPanel(id), (e: AgendaError) => e.code === 'estado_invalido');
  });

  it('crear desde el panel puede salirse de la rejilla (forzar) pero no chocar ni ir al pasado', async () => {
    await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    assert.deepEqual(await ag.reservarPanel({ telefono: TEL2, area: 'posgrados', franja: fr('laura', '2026-11-24T09:10:00') }, 'admin', false), { ok: false, motivo: 'invalida' });
    const fuera = await ag.reservarPanel({ telefono: TEL2, area: 'posgrados', franja: fr('laura', '2026-11-24T19:00:00') }, 'admin', true);
    assert.equal(fuera.ok, true);
    assert.equal((fuera as { cita: { canal: string } }).cita.canal, 'panel');
    assert.deepEqual(await ag.reservarPanel({ telefono: TEL2, area: 'posgrados', franja: fr('laura', '2026-11-23T07:00:00') }, 'admin', true), { ok: false, motivo: 'invalida' });
  });

  it('mover una cita libera el hueco anterior y deja la vieja cancelada', async () => {
    await ag.guardarDisponibilidad('mario', dispSemana(['posgrados'], { activo: false }));
    const r = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id = (r as { cita: { id: string } }).cita.id;
    const m = await ag.moverPanel(id, fr('laura', '2026-11-24T15:00:00'), 'admin', false);
    assert.equal(m.ok, true);
    assert.equal((await ag.obtenerCita(id))?.estado, 'cancelada');
    assert.equal((await reservar(TEL2, fr('laura', '2026-11-24T09:00:00'))).ok, true);
    await assert.rejects(ag.moverPanel('cita_noexiste', fr('laura', '2026-11-24T15:30:00'), 'admin', false), (e: AgendaError) => e.code === 'no_encontrada');
  });

  it('listarCitas filtra por rango, asesor y estado e incluye canceladas', async () => {
    const a = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    await reservar(TEL2, fr('mario', '2026-11-24T10:00:00'));
    await reservar('573005550000', fr('laura', '2026-11-26T10:00:00'));
    await ag.cancelar((a as { cita: { id: string } }).cita.id, TEL);
    const dia = { desdeMs: bog('2026-11-24T00:00:00'), hastaMs: bog('2026-11-25T00:00:00') };
    assert.equal((await ag.listarCitas(dia)).length, 2);
    assert.equal((await ag.listarCitas({ ...dia, asesor: 'laura' })).length, 1);
    assert.equal((await ag.listarCitas({ ...dia, estado: 'confirmada' })).length, 1);
    assert.equal((await ag.listarCitas({ desdeMs: dia.desdeMs, hastaMs: bog('2026-11-27T00:00:00') })).length, 3);
  });

  it('solo se puede guardar disponibilidad de un usuario que existe y datos válidos', async () => {
    await assert.rejects(ag.guardarDisponibilidad('fantasma', dispSemana()), (e: AgendaError) => e.code === 'asesor_invalido');
    await assert.rejects(ag.guardarDisponibilidad('laura', { ...dispSemana(), duracionMin: 1 }));
    const todos = await ag.asesores();
    assert.deepEqual(todos.map((a) => a.username), USUARIOS_BASE.map((u) => u.username));
    assert.equal(todos.find((a) => a.username === 'admin')?.disponibilidad.activo, false);
  });
});

describe('renombrar o borrar a un asesor', () => {
  beforeEach(() => preparar());

  const renombrarEnUsuarios = (viejo: string, nuevo: string) => {
    const u = USUARIOS_DEL_MUNDO().find((x) => x.username === viejo)!;
    u.username = nuevo;
  };
  const USUARIOS_DEL_MUNDO = () => (mundo.deps.usuarios as unknown as { _lista?: typeof USUARIOS_BASE })._lista ?? [];

  it('renombrar migra disponibilidad, ocupación y citas: la hora tomada no se puede volver a reservar', async () => {
    await ag.guardarDisponibilidad('mario', dispSemana(['posgrados'], { activo: false }));
    const r = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id = (r as { cita: { id: string } }).cita.id;
    const cancelada = await reservar(TEL2, fr('laura', '2026-11-24T10:00:00'));
    await ag.cancelar((cancelada as { cita: { id: string } }).cita.id, TEL2);

    renombrarEnUsuarios('laura', 'laura.perez');
    assert.equal(await ag.renombrarAsesor('laura', 'laura.perez'), 2, 'las dos citas de laura cambian de dueño');

    assert.equal((await ag.disponibilidadDe('laura.perez')).activo, true, 'conserva su disponibilidad');
    assert.equal(mundo.redis.strings.has('agenda:disp:laura'), false);
    const libres = await ag.franjasDeAsesor('laura.perez', { desde: new Date(bog('2026-11-24T00:00:00')), dias: 1 });
    assert.equal(libres.some((f) => f.inicio === '2026-11-24T09:00:00-05:00'), false, 'la hora ocupada sigue ocupada');
    assert.deepEqual(await reservar(TEL2, fr('laura.perez', '2026-11-24T09:00:00')), { ok: false, motivo: 'ocupada' }, 'sin doble reserva');

    const cita = await ag.obtenerCita(id);
    assert.equal(cita?.asesor, 'laura.perez');
    const dia = { desdeMs: bog('2026-11-24T00:00:00'), hastaMs: bog('2026-11-25T00:00:00') };
    assert.equal((await ag.listarCitas({ ...dia, asesor: 'laura.perez' })).length, 2);
    assert.equal((await ag.listarCitas({ ...dia, asesor: 'laura' })).length, 0);
    // Cancelar después del cambio libera la hora del asesor nuevo (el ZSET correcto).
    await ag.cancelarPanel(id);
    assert.equal((await reservar(TEL2, fr('laura.perez', '2026-11-24T09:00:00'))).ok, true);
  });

  it('renombrar dos veces o a sí mismo no rompe nada', async () => {
    await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    renombrarEnUsuarios('laura', 'lp');
    assert.equal(await ag.renombrarAsesor('laura', 'lp'), 1);
    assert.equal(await ag.renombrarAsesor('laura', 'lp'), 0, 'idempotente');
    assert.equal(await ag.renombrarAsesor('lp', 'LP'), 0);
    assert.equal((await ag.citasDe(TEL))[0].asesor, 'lp');
  });

  it('borrar: sus citas futuras no quedan huérfanas sin aviso', async () => {
    const r = await reservar(TEL, fr('laura', '2026-11-24T09:00:00'));
    const id = (r as { cita: { id: string } }).cita.id;
    await reservar(TEL2, fr('mario', '2026-11-24T09:30:00'));
    assert.equal(await ag.asesorBorrado('laura'), 1, 'una cita futura confirmada queda sin asesor');

    const cita = await ag.obtenerCita(id);
    assert.equal(cita?.sinAsesor, true);
    assert.equal(cita?.estado, 'confirmada', 'la persona conserva su cita hasta que el equipo decida');
    assert.deepEqual((await ag.citasSinAsesor()).map((c) => c.id), [id], 'el panel la lista');
    assert.equal(mundo.redis.strings.has('agenda:disp:laura'), false);
    assert.equal(mundo.redis.zsets.get('agenda:asesor:laura')?.size ?? 0, 0);
    // Un usuario nuevo con el mismo nombre no hereda ni su agenda ni sus citas.
    const dia = { desdeMs: bog('2026-11-24T00:00:00'), hastaMs: bog('2026-11-25T00:00:00') };
    assert.equal((await ag.listarCitas({ ...dia, asesor: 'laura' })).length, 0);
    assert.equal((await ag.disponibilidadDe('laura')).activo, false);
    // El administrador la mueve a otro asesor y deja de estar huérfana.
    const m = await ag.moverPanel(id, fr('mario', '2026-11-24T10:00:00'), 'admin', false);
    assert.equal(m.ok, true);
    assert.deepEqual(await ag.citasSinAsesor(), []);
  });
});

