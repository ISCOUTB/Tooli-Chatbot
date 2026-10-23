import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskInstitutionalEmail } from './academicAccountView';

test('el estado de cuenta oculta el identificador del correo', () => {
  assert.equal(maskInstitutionalEmail('estudiante@utb.edu.co'), 'e***@utb.edu.co');
  assert.equal(maskInstitutionalEmail('x@utbvirtual.edu.co'), 'x***@utbvirtual.edu.co');
  assert.equal(maskInstitutionalEmail('corrupto'), '[correo institucional]');
});
