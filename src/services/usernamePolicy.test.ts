import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarUsuario, sugerirUsuario, validarUsuario } from './usernamePolicy';

describe('política de usuario', () => {
  it('normaliza espacios exteriores y mayúsculas', () => assert.equal(normalizarUsuario('  Ana_Diaz '), 'ana_diaz'));
  it('sugiere un usuario sin tildes ni espacios', () => assert.equal(sugerirUsuario('Ángel Acero'), 'angelacero'));
  it('explica tildes y espacios por separado', () => {
    assert.match(validarUsuario('ángel acero') ?? '', /tildes ni ñ/);
    assert.match(validarUsuario('angel acero') ?? '', /espacios/);
  });
  it('acepta nombres válidos', () => {
    assert.equal(validarUsuario('angelacero'), null);
    assert.equal(validarUsuario('ana_diaz'), null);
    assert.equal(validarUsuario('luis.perez'), null);
  });
  it('rechaza bordes, largo, puntos consecutivos y solo números', () => {
    for (const username of ['.ana', 'ana.', 'an', 'a..b', '1234']) assert.ok(validarUsuario(username), username);
  });
});
