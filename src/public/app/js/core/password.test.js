import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newPasswordError } from './password.js';

describe('newPasswordError', () => {
  it('aplica el mínimo de 12 caracteres', () => {
    assert.match(newPasswordError('a'.repeat(11)), /12 caracteres/);
    assert.equal(newPasswordError('a'.repeat(12)), null);
  });

  it('acepta 72 bytes y rechaza 73 bytes ASCII', () => {
    assert.equal(newPasswordError('a'.repeat(72)), null);
    assert.match(newPasswordError('a'.repeat(73)), /72 bytes/);
  });

  it('mide bytes UTF-8 de acentos y emojis', () => {
    assert.equal(newPasswordError('é'.repeat(36)), null);
    assert.match(newPasswordError('é'.repeat(37)), /72 bytes/);
    assert.equal(newPasswordError('😀'.repeat(18)), null);
    assert.match(newPasswordError('😀'.repeat(19)), /72 bytes/);
  });
});
