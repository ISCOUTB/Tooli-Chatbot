import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateCode } from './nutriaCode';

test('new NutriA QR codes have a longer, scan-friendly namespace', () => {
  const codes = Array.from({ length: 500 }, generateCode);
  for (const code of codes) {
    assert.match(code, /^NUTR-[A-HJ-NP-Z2-9]{10}$/);
  }
  assert.equal(new Set(codes).size, codes.length);
});
