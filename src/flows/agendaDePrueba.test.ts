import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Franja } from '../contratos/agenda';
import { conAgendaDePrueba } from './agendaDePrueba';
import type { AgendaDelFlujo } from './agendaFlow';
import { buzon, enZonaDePruebas } from '../services/simulacion';

const SIM = '570000777888';
const REAL = '573007778889';
const AHORA = new Date('2026-11-23T08:00:00-05:00');
const franja = (h: number): Franja => ({
  asesor: 'laura', asesorNombre: 'Laura', inicio: `2026-11-24T${String(h).padStart(2, '0')}:00:00-05:00`, fin: `2026-11-24T${String(h).padStart(2, '0')}:30:00-05:00`,
});

let llamadasReales: string[];
let libresReales: Franja[];
function agendaReal(): AgendaDelFlujo {
  const anota = (m: string) => { llamadasReales.push(m); };
  return {
    async franjasLibres() { anota('franjasLibres'); return libresReales; },
    async reservar(i) { anota('reservar'); return { ok: true, cita: { id: 'cita_real', telefono: i.telefono, area: i.area, asesor: 'laura', asesorNombre: 'Laura', inicio: i.franja.inicio, fin: i.franja.fin, canal: i.canal, estado: 'confirmada' } }; },
    async citasDe() { anota('citasDe'); return []; },
    async cancelar() { anota('cancelar'); return true; },
    async reprogramar() { anota('reprogramar'); return { ok: false, motivo: 'invalida' }; },
  };
}

beforeEach(() => { llamadasReales = []; libresReales = [franja(9), franja(10)]; buzon.borrar(SIM); });

describe('agenda del flujo en el simulador', () => {
  it('lee los horarios reales pero reserva, lista, reprograma y cancela solo en memoria', async () => {
    const a = conAgendaDePrueba(agendaReal(), () => AHORA);
    await enZonaDePruebas(SIM, async () => {
      const libres = await a.franjasLibres({ area: 'posgrados' });
      assert.deepEqual(libres.map((f) => f.inicio), [franja(9).inicio, franja(10).inicio]);
      const r = await a.reservar({ telefono: SIM, nombre: 'Ana', area: 'posgrados', franja: libres[0], canal: 'whatsapp' });
      assert.ok(r.ok);
      const id = r.ok ? r.cita.id : '';
      assert.deepEqual((await a.franjasLibres({ area: 'posgrados' })).map((f) => f.inicio), [franja(10).inicio], 'la hora reservada ya no se ofrece');
      assert.deepEqual((await a.citasDe(SIM)).map((c) => c.id), [id]);
      const mov = await a.reprogramar(id, SIM, franja(10));
      assert.ok(mov.ok && mov.cita.inicio === franja(10).inicio);
      assert.equal(await a.cancelar(id, SIM), true);
      assert.deepEqual(await a.citasDe(SIM), []);
    });
    assert.deepEqual(llamadasReales, ['franjasLibres', 'franjasLibres'], 'a la agenda real solo se le preguntan horarios');
    assert.ok(buzon.sacar(SIM).some((m) => m.tipo === 'nota' && /no se guardó en la agenda real/.test(m.texto)));
  });

  it('sin horarios reales libres ofrece horarios de ejemplo y lo avisa', async () => {
    libresReales = [];
    const a = conAgendaDePrueba(agendaReal(), () => AHORA);
    const libres = await enZonaDePruebas(SIM, () => a.franjasLibres({ area: 'ti' }));
    assert.ok(libres.length > 0);
    assert.ok(buzon.sacar(SIM).some((m) => m.tipo === 'nota' && /ejemplo/.test(m.texto)));
  });

  it('fuera del simulador todo va a la agenda real', async () => {
    const a = conAgendaDePrueba(agendaReal(), () => AHORA);
    await a.franjasLibres({ area: 'posgrados' });
    await a.reservar({ telefono: REAL, area: 'posgrados', franja: franja(9), canal: 'whatsapp' });
    await a.citasDe(REAL);
    await a.cancelar('cita_real', REAL);
    await a.reprogramar('cita_real', REAL, franja(10));
    assert.deepEqual(llamadasReales, ['franjasLibres', 'reservar', 'citasDe', 'cancelar', 'reprogramar']);
  });

  it('una reserva para un número simulado nunca va a la agenda real, ni siquiera sin contexto', async () => {
    const a = conAgendaDePrueba(agendaReal(), () => AHORA);
    const r = await a.reservar({ telefono: SIM, area: 'posgrados', franja: franja(9), canal: 'whatsapp' });
    assert.ok(r.ok);
    assert.deepEqual(llamadasReales, []);
  });
});
