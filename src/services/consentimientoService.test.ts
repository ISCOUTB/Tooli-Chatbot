import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { leerRegistro, registro } from './consentimientoService';

describe('constancia de la autorización de datos', () => {
  it('guarda solo la decisión y la fecha', () => {
    const raw = registro('si', new Date('2026-11-21T15:00:00Z'));
    assert.deepEqual(JSON.parse(raw), { datos: 'si', fecha: '2026-11-21T15:00:00.000Z' });
    assert.deepEqual(leerRegistro(raw), { datos: 'si', fecha: '2026-11-21T15:00:00.000Z' });
  });

  it('un registro dañado o desconocido cuenta como "no ha decidido"', () => {
    assert.equal(leerRegistro(null), null);
    assert.equal(leerRegistro('no es json'), null);
    assert.equal(leerRegistro('{"datos":"tal vez"}'), null);
    assert.equal(leerRegistro('null'), null);
    assert.deepEqual(leerRegistro('{"datos":"no"}'), { datos: 'no', fecha: '' });
  });
});
