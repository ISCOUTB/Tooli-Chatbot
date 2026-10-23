import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeActivityText } from './activityPrivacy';

test('el historial no persiste contraseñas, OTP, cédulas ni notas', () => {
  assert.equal(sanitizeActivityText('in', 'notas_password', 'ClaveInstitucional-123'), '[contenido privado]');
  assert.equal(sanitizeActivityText('in', 'verif_codigo', '123456'), '[contenido privado]');
  assert.equal(sanitizeActivityText('in', 'recibo_cedula', '1234567890'), '[contenido privado]');
  assert.equal(sanitizeActivityText('out', 'notas_mfa', '📊 Tus notas del período: 4.5'), '[contenido privado]');
  assert.equal(sanitizeActivityText('out', 'menu', '📊 Tus notas del período: 4.5'), '[contenido privado]');
  assert.equal(sanitizeActivityText('out', 'menu_pregrado', '📚 Tus cursos en Savio: Cálculo I'), '[contenido privado]');
  assert.equal(sanitizeActivityText('out', 'menu', '📋 Turno de matrícula: Ana Pérez'), '[contenido privado]');
  assert.equal(sanitizeActivityText('in', 'menu', 'Hola'), 'Hola');
});
