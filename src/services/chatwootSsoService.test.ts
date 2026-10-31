import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buscarAgentePorCorreo, claveAleatoriaAtencion, equiposPorArea } from './chatwootSsoService';

describe('equipos de Atención por área', () => {
  it('asigna el equipo correspondiente a cada área', () => {
    assert.deepEqual(equiposPorArea('ti', '10', '20'), [10]);
    assert.deepEqual(equiposPorArea('admisiones', '10', '20'), [20]);
    assert.deepEqual(equiposPorArea('all', '10', '20'), [10, 20]);
  });

  it('no asigna equipos sin área o con ids vacíos o no numéricos', () => {
    assert.deepEqual(equiposPorArea(undefined, '10', '20'), []);
    assert.deepEqual(equiposPorArea('all', '', 'no-es-id'), []);
  });
});

describe('búsqueda de agentes por correo', () => {
  it('ignora mayúsculas y espacios en los extremos', () => {
    assert.equal(buscarAgentePorCorreo([{ id: 7, email: ' Asesor@Ejemplo.com ' }], ' asesor@ejemplo.COM '), 7);
  });

  it('descarta ids inválidos aunque el correo coincida', () => {
    assert.equal(buscarAgentePorCorreo([
      { id: 0, email: 'a@b.co' },
      { id: -1, email: 'a@b.co' },
      { id: 1.5, email: 'a@b.co' },
      { id: Number.MAX_SAFE_INTEGER + 1, email: 'a@b.co' },
      { id: '4', email: 'a@b.co' },
    ], 'a@b.co'), null);
  });

  it('devuelve null sin coincidencia e ignora entradas que no son objetos', () => {
    assert.equal(buscarAgentePorCorreo([null, 'texto', 3, { id: 2, email: 'otro@b.co' }], 'a@b.co'), null);
  });
});

describe('clave aleatoria de Atención', () => {
  it('cumple la política y cambia en cada llamada', () => {
    const primera = claveAleatoriaAtencion();
    const segunda = claveAleatoriaAtencion();
    assert.ok(primera.length >= 20);
    assert.match(primera, /[A-Z]/);
    assert.match(primera, /[a-z]/);
    assert.match(primera, /\d/);
    assert.match(primera, /[^A-Za-z0-9]/);
    assert.notEqual(primera, segunda);
  });
});
