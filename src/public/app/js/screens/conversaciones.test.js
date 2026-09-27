import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* conversaciones.js arrastra screen.js, cuyo IIFE registra listeners de
   document al importarse. Acá no hay navegador, así que se le da un stub
   mínimo: ninguna de las funciones probadas toca el DOM. */
globalThis.document ??= {
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {} },
    appendChild() {}, addEventListener() {}, setAttribute() {},
  }),
  body: { appendChild() {} },
  activeElement: null,
};

let C;
before(async () => { C = await import('./conversaciones.js'); });

describe('swipeIntentaHorizontal', () => {
  it('gesto horizontal claro es intención', () => {
    assert.equal(C.swipeIntentaHorizontal(30, 5), true);
    assert.equal(C.swipeIntentaHorizontal(-40, 6), true);
  });

  it('gesto vertical no es intención', () => {
    assert.equal(C.swipeIntentaHorizontal(5, 30), false);
  });

  it('jitter por debajo del mínimo no es intención', () => {
    assert.equal(C.swipeIntentaHorizontal(5, 5), false);
    assert.equal(C.swipeIntentaHorizontal(12, 0), false);
  });

  it('a igual magnitud en ambos ejes no es intención', () => {
    assert.equal(C.swipeIntentaHorizontal(13, 13), false);
  });
});

describe('cercaDelFondo', () => {
  it('exactamente al fondo es estar al fondo', () => {
    assert.equal(C.cercaDelFondo(900, 1000, 100), true);
  });

  it('dentro del umbral (80px) cuenta como fondo', () => {
    assert.equal(C.cercaDelFondo(820, 1000, 100), true);
  });

  it('un píxel fuera del umbral ya es estar leyendo arriba', () => {
    assert.equal(C.cercaDelFondo(819, 1000, 100), false);
  });

  it('respeta un umbral personalizado', () => {
    assert.equal(C.cercaDelFondo(700, 1000, 100, 200), true);
    assert.equal(C.cercaDelFondo(700, 1000, 100, 199), false);
  });
});

describe('aplicarPlaceholders', () => {
  it('reemplaza {nombre} por el primer nombre', () => {
    assert.equal(C.aplicarPlaceholders('Hola {nombre}, ¿cómo vas?', 'María José'), 'Hola María, ¿cómo vas?');
  });

  it('reemplaza todas las ocurrencias', () => {
    assert.equal(C.aplicarPlaceholders('{nombre} y {nombre}', 'Ana'), 'Ana y Ana');
  });

  it('sin nombre cae en "hola", nunca deja el literal', () => {
    assert.equal(C.aplicarPlaceholders('Hola {nombre}', undefined), 'Hola hola');
    assert.equal(C.aplicarPlaceholders('Hola {nombre}', '   '), 'Hola hola');
  });

  it('sin placeholder devuelve el texto intacto', () => {
    assert.equal(C.aplicarPlaceholders('Sin cambios', 'Luis'), 'Sin cambios');
  });
});
