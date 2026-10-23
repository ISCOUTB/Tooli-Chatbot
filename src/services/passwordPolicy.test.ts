import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAcceptableNewPassword } from './passwordPolicy';

test('new passwords must be long enough and never cross bcrypt truncation boundary', () => {
  assert.equal(isAcceptableNewPassword('elevenchars'), false);
  assert.equal(isAcceptableNewPassword('twelve-chars'), true);
  assert.equal(isAcceptableNewPassword('a'.repeat(72)), true);
  assert.equal(isAcceptableNewPassword('a'.repeat(73)), false);
  assert.equal(isAcceptableNewPassword('á'.repeat(37)), false); // 74 UTF-8 bytes
  assert.equal(isAcceptableNewPassword({ length: 12 }), false);
});
