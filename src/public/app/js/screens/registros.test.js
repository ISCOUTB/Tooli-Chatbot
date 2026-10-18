import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* Las pantallas importan utilidades de DOM/router en la carga, pero las
   funciones probadas aquí son puras. Se deja el mínimo para importar. */
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

let R;
before(async () => { R = await import('./registros.js'); });

/* Filas sintéticas con la forma real del endpoint: [fecha, nombre, email,
   whatsapp, programa, área]. */
const FILA_PRE = ['2026-09-10T09:02:00Z', 'Sofía', 'sofia@example.com', '1001', 'Ingeniería de Sistemas', 'Pregrado'];
const FILA_MAE = ['2026-09-11T12:18:00Z', 'María', 'maria@example.com', '1002', 'Maestría en Ingeniería', 'Posgrado'];
const FILA_VIEJA = ['2026-09-09T16:40:00Z', 'Carlos', 'carlos@example.com', '1003', 'Especialización en Finanzas'];

describe('resumirSegmentos', () => {
  it('cuenta pregrado y posgrado por separado', () => {
    assert.deepEqual(R.resumirSegmentos([FILA_PRE, FILA_MAE]), { total: 2, pregrado: 1, posgrado: 1 });
  });

  it('las filas viejas sin área cuentan como posgrado', () => {
    assert.deepEqual(R.resumirSegmentos([FILA_VIEJA]), { total: 1, pregrado: 0, posgrado: 1 });
  });

  it('vacío es cero en todo', () => {
    assert.deepEqual(R.resumirSegmentos([]), { total: 0, pregrado: 0, posgrado: 0 });
  });
});

describe('filtrarCrmRows', () => {
  const filas = [FILA_PRE, FILA_MAE, FILA_VIEJA];

  it('sin filtros devuelve todo con su índice real', () => {
    const pares = R.filtrarCrmRows(filas, { segmento: 'todos', etapa: 'todas', q: '', fichas: {} });
    assert.deepEqual(pares.map(p => p.idx), [0, 1, 2]);
  });

  it('filtra por segmento sin mirar el programa en pregrado', () => {
    const pares = R.filtrarCrmRows(filas, { segmento: 'pregrado', etapa: 'todas', q: '', fichas: {} });
    assert.deepEqual(pares.map(p => p.idx), [0]);
  });

  it('filtra por etapa usando las fichas, por defecto "nuevo"', () => {
    const fichas = { 1002: { estado: 'interesado' } };
    const pares = R.filtrarCrmRows(filas, { segmento: 'todos', etapa: 'interesado', q: '', fichas });
    assert.deepEqual(pares.map(p => p.idx), [1]);
  });

  it('"solo los míos" compara contra el usuario dado', () => {
    const fichas = { 1001: { estado: 'nuevo', asignadoA: 'luis' } };
    assert.deepEqual(
      R.filtrarCrmRows(filas, { segmento: 'todos', etapa: 'todas', soloMios: true, usuario: 'luis', q: '', fichas }).map(p => p.idx),
      [0],
    );
    assert.deepEqual(
      R.filtrarCrmRows(filas, { segmento: 'todos', etapa: 'todas', soloMios: true, usuario: 'ana', q: '', fichas }).map(p => p.idx),
      [],
    );
  });

  it('la búsqueda mira nombre, email y programa sin importar mayúsculas', () => {
    assert.deepEqual(R.filtrarCrmRows(filas, { q: 'MARÍA', fichas: {} }).map(p => p.idx), [1]);
    assert.deepEqual(R.filtrarCrmRows(filas, { q: 'ingeniería', fichas: {} }).map(p => p.idx), [0, 1]);
  });

  it('combina segmento, etapa y búsqueda', () => {
    const fichas = { 1002: { estado: 'contactado' }, 1003: { estado: 'contactado' } };
    const pares = R.filtrarCrmRows(filas, { segmento: 'maestria', etapa: 'contactado', q: 'maría', fichas });
    assert.deepEqual(pares.map(p => p.idx), [1]);
  });

  it('no muta las filas para guardar el índice', () => {
    const copia = filas.map(r => [...r]);
    R.filtrarCrmRows(copia, { q: '', fichas: {} });
    for (const row of copia) assert.equal('__i' in row, false);
  });
});

describe('filasCrmParaCsv', () => {
  it('arma una fila con área, etapa y asesor reales', () => {
    const fichas = { 1001: { estado: 'contactado', asignadoA: 'luis', etiquetas: ['beca'], notas: [{}, {}] } };
    const pares = R.filtrarCrmRows([FILA_PRE], { q: '', fichas });
    const [fila] = R.filasCrmParaCsv(pares, fichas);
    assert.equal(fila[1], 'Sofía');
    assert.equal(fila[5], 'Pregrado');
    assert.equal(fila[6], 'Contactado');
    assert.equal(fila[7], 'luis');
    assert.equal(fila[8], 'beca');
    assert.equal(fila[9], 2);
  });

  it('sin ficha usa valores por defecto, no undefined', () => {
    const pares = R.filtrarCrmRows([FILA_MAE], { q: '', fichas: {} });
    const [fila] = R.filasCrmParaCsv(pares, {});
    assert.equal(fila[6], 'Nuevo');
    assert.equal(fila[7], '');
    assert.equal(fila[8], '');
    assert.equal(fila[9], 0);
  });
});

describe('textoResumenSegmentos', () => {
  it('muestra totales por segmento', () => {
    assert.equal(R.textoResumenSegmentos({ total: 5, pregrado: 2, posgrado: 3 }, 5), '5 prospectos · 2 Pregrado · 3 Posgrado');
  });

  it('avisa cuántos se ven cuando el filtro recorta', () => {
    assert.equal(R.textoResumenSegmentos({ total: 5, pregrado: 2, posgrado: 3 }, 2), '5 prospectos · 2 Pregrado · 3 Posgrado · viendo 2');
  });

  it('singulariza con un prospecto', () => {
    assert.equal(R.textoResumenSegmentos({ total: 1, pregrado: 1, posgrado: 0 }, 1), '1 prospecto · 1 Pregrado · 0 Posgrado');
  });
});
