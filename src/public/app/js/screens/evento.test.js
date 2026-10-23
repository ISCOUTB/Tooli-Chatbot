import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= {};
globalThis.navigator ??= {};
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.document ??= {
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  head: { appendChild() {} },
  body: { appendChild() {} },
};

let E;
before(async () => { E = await import('./evento.js'); });

/* Filas sintéticas con la forma real del endpoint (rango A2:H):
   [fecha, whatsapp, nombre, correo, interésFin, programa, autoriza, seguimiento]. */
const R1 = ['2026-09-10T10:00:00Z', '1001', 'María', 'maria@example.com', 'Sí', 'Maestría en Ingeniería', 'Sí', 'Interesado'];
const R2 = ['2026-09-10T11:00:00Z', '1002', 'Carlos', 'carlos@example.com', 'Sí, con beca', 'Especialización en Finanzas', 'Sí', 'Interesado en beca'];
const R3 = ['2026-09-09T15:00:00Z', '1003', 'Pedro', 'pedro@example.com', 'No', 'Maestría en Marketing', 'No', 'pendiente'];

describe('estadoEventoDe', () => {
  it('devuelve el seguimiento tal cual', () => {
    assert.equal(E.estadoEventoDe(R1), 'Interesado');
  });

  it('sin seguimiento cae en pendiente, no en vacío', () => {
    assert.equal(E.estadoEventoDe(['f', 'w', 'n', 'c', 'i', 'p', 'Sí']), 'pendiente');
  });
});

describe('autorizaContacto', () => {
  it('acepta Sí en cualquier capitalización', () => {
    assert.equal(E.autorizaContacto(R1), true);
    assert.equal(E.autorizaContacto(['f', 'w', 'n', 'c', 'i', 'p', 'sí']), true);
  });

  it('todo lo demás es no autorizado', () => {
    assert.equal(E.autorizaContacto(R3), false);
    assert.equal(E.autorizaContacto(['f', 'w', 'n', 'c', 'i', 'p', '']), false);
  });
});

describe('filtrarEventoRows', () => {
  const filas = [R1, R2, R3];

  it('sin filtros devuelve todo con su índice real', () => {
    assert.deepEqual(E.filtrarEventoRows(filas, {}).map(p => p.idx), [0, 1, 2]);
  });

  it('la vista de beca deja solo candidatos a beca', () => {
    assert.deepEqual(E.filtrarEventoRows(filas, { becaVista: 'beca' }).map(p => p.idx), [1]);
  });

  it('el filtro de estado respeta el valor exacto', () => {
    assert.deepEqual(E.filtrarEventoRows(filas, { estadoFiltro: 'Interesado' }).map(p => p.idx), [0]);
  });

  it('la búsqueda mira nombre, correo y programa', () => {
    assert.deepEqual(E.filtrarEventoRows(filas, { q: 'marketing' }).map(p => p.idx), [2]);
    assert.deepEqual(E.filtrarEventoRows(filas, { q: 'CARLOS' }).map(p => p.idx), [1]);
  });

  it('no muta las filas al filtrar', () => {
    const copia = filas.map(r => [...r]);
    E.filtrarEventoRows(copia, { q: '' });
    for (const row of copia) assert.equal('__i' in row, false);
  });
});

describe('resumirEvento', () => {
  it('cuenta totales, autorización y becas', () => {
    assert.deepEqual(E.resumirEvento([R1, R2, R3]), {
      total: 3,
      porEstado: { Interesado: 1, 'Interesado en beca': 1, pendiente: 1 },
      autorizaron: 2,
      noAutorizaron: 1,
      candidatosBeca: 1,
    });
  });

  it('vacío es cero en todo', () => {
    assert.deepEqual(E.resumirEvento([]), { total: 0, porEstado: {}, autorizaron: 0, noAutorizaron: 0, candidatosBeca: 0 });
  });
});

describe('textoResumenEvento', () => {
  it('resume lo operativo sin inventar nada', () => {
    assert.equal(
      E.textoResumenEvento({ total: 3, autorizaron: 2, candidatosBeca: 1 }, 3),
      '3 registros · 2 autorizó contacto · 1 candidato a beca',
    );
  });

  it('avisa cuántos se ven cuando el filtro recorta', () => {
    assert.equal(
      E.textoResumenEvento({ total: 3, autorizaron: 2, candidatosBeca: 1 }, 1),
      '3 registros · 2 autorizó contacto · 1 candidato a beca · viendo 1',
    );
  });
});

describe('validarInvitacion', () => {
  it('rechaza mensajes demasiado cortos', () => {
    assert.equal(E.validarInvitacion('hola'), 'El mensaje es muy corto.');
    assert.equal(E.validarInvitacion('   '), 'El mensaje es muy corto.');
  });

  it('rechaza más de 1000 caracteres', () => {
    assert.equal(E.validarInvitacion('x'.repeat(1001)), 'Máximo 1000 caracteres.');
  });

  it('acepta un mensaje normal', () => {
    assert.equal(E.validarInvitacion('Hola, te invitamos al próximo evento de posgrados.'), null);
  });
});
