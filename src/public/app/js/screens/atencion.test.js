import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* atencion.js arrastra screen.js y conversaciones.js, que tocan document al
   importarse. Igual que en conversaciones.test.js: stub mínimo, porque las
   funciones probadas no usan el DOM. */
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

let A;
before(async () => { A = await import('./atencion.js'); });

describe('vistaPrevia', () => {
  it('dice quién habló último', () => {
    assert.equal(A.vistaPrevia({ tipo: 'in', texto: '¿Tienen becas?' }), '¿Tienen becas?');
    assert.equal(A.vistaPrevia({ tipo: 'out', texto: 'Sí, te cuento' }), 'Asesor: Sí, te cuento');
    assert.equal(A.vistaPrevia({ tipo: 'nota', texto: 'Llamar mañana' }), '📝 Nota: Llamar mañana');
  });

  it('junta los saltos de línea del contexto del bot en una sola línea', () => {
    assert.equal(A.vistaPrevia({ tipo: 'in', texto: '🎓 Posgrado · MBA\n\n👤 Nombre: Ana' }), '🎓 Posgrado · MBA 👤 Nombre: Ana');
  });

  it('quita las marcas de WhatsApp', () => {
    assert.equal(A.vistaPrevia({ tipo: 'out', texto: 'Tu turno es el *12 de octubre*.' }), 'Asesor: Tu turno es el 12 de octubre.');
  });

  it('sin texto ni mensajes no deja la fila en blanco', () => {
    assert.equal(A.vistaPrevia({ tipo: 'in', texto: '' }), '(archivo adjunto)');
    assert.equal(A.vistaPrevia(null), 'Sin mensajes');
  });
});

describe('textoAsignacion', () => {
  it('distingue sin asignar, asignada a mí y a otra persona', () => {
    assert.equal(A.textoAsignacion(null, 2), 'Sin asignar');
    assert.equal(A.textoAsignacion({ id: 2, nombre: 'Luis Pérez' }, 2), 'Asignada a ti');
    assert.equal(A.textoAsignacion({ id: 3, nombre: 'Ana Díaz' }, 2), 'Asignada a Ana Díaz');
  });
});

describe('etiquetaEstado', () => {
  it('traduce los estados de Chatwoot y no rompe con uno nuevo', () => {
    assert.equal(A.etiquetaEstado('pending').label, 'Pendiente');
    assert.equal(A.etiquetaEstado('snoozed').label, 'snoozed');
  });
});
