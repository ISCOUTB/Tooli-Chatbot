import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AtencionMacroError, normalizarMacro, planMacro, reemplazarNombre } from './atencionMacrosService';

describe('normalizarMacro', () => {
  it('recorta textos y normaliza etiquetas', () => {
    assert.deepEqual(normalizarMacro({
      nombre: '  Seguimiento ',
      acciones: { mensaje: ' Hola {nombre} ', etiquetas: [' Posgrado Prospecto ', 'URGENTE'], equipoId: null },
    }), {
      nombre: 'Seguimiento',
      acciones: { mensaje: 'Hola {nombre}', etiquetas: ['posgrado-prospecto', 'urgente'], equipoId: null },
    });
  });

  it('exige nombre, una acción y valores válidos', () => {
    assert.throws(() => normalizarMacro({ nombre: '', acciones: { mensaje: 'hola' } }), AtencionMacroError);
    assert.throws(() => normalizarMacro({ nombre: 'Vacía', acciones: {} }), AtencionMacroError);
    assert.throws(() => normalizarMacro({ nombre: 'Mala', acciones: { estado: 'closed' } }), AtencionMacroError);
    assert.throws(() => normalizarMacro({ nombre: 'Mala', acciones: { asesorId: 0 } }), AtencionMacroError);
  });
});

describe('planMacro', () => {
  it('ordena los pasos aunque las acciones lleguen en otro orden', () => {
    assert.deepEqual(planMacro({ estado: 'resolved', asesorId: 'yo', equipoId: 2, etiquetas: ['beca'], mensaje: 'Hola', nota: 'Contexto' }), [
      { tipo: 'nota', valor: 'Contexto' },
      { tipo: 'mensaje', valor: 'Hola' },
      { tipo: 'etiquetas', valor: ['beca'] },
      { tipo: 'equipo', valor: 2 },
      { tipo: 'asesor', valor: 'yo' },
      { tipo: 'estado', valor: 'resolved' },
    ]);
  });
});

describe('reemplazarNombre', () => {
  it('usa solo el primer nombre', () => {
    assert.equal(reemplazarNombre('Hola {nombre}, ¿cómo estás?', 'María José Restrepo'), 'Hola María, ¿cómo estás?');
  });

  it('nunca deja el placeholder ni la coma sobrante si falta el nombre', () => {
    assert.equal(reemplazarNombre('Hola {nombre}, ¿cómo estás?', ''), 'Hola ¿cómo estás?');
    assert.equal(reemplazarNombre('{nombre}, bienvenida', null), 'bienvenida');
  });
});
