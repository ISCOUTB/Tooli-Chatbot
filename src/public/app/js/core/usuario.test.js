import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarUsuario, sugerirUsuario, validarUsuario } from './usuario.js';

describe('política de usuario del panel', () => {
  it('normaliza y sugiere', () => {
    assert.equal(normalizarUsuario('  Ana_Diaz '), 'ana_diaz');
    assert.equal(sugerirUsuario('Ángel Acero'), 'angelacero');
  });
  it('distingue tildes de espacios', () => {
    assert.match(validarUsuario('ángel acero') ?? '', /tildes ni ñ/);
    assert.match(validarUsuario('angel acero') ?? '', /espacios/);
  });
  it('aplica todos los casos contractuales', () => {
    for (const username of ['angelacero', 'ana_diaz', 'luis.perez']) assert.equal(validarUsuario(username), null);
    for (const username of ['.ana', 'ana.', 'an', 'a..b', '1234']) assert.ok(validarUsuario(username), username);
  });
});
