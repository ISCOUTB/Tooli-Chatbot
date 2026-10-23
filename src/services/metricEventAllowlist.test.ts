import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMetricEvent } from './metricEventAllowlist';

test('panel metric event allowlist rejects arbitrary label values', () => {
  assert.equal(isMetricEvent('menu_shown'), true);
  assert.equal(isMetricEvent('academico_notas'), true);
  assert.equal(isMetricEvent('student_phone_573001234567'), false);
  assert.equal(isMetricEvent('menu_shown\nsecret=123'), false);
  assert.equal(isMetricEvent({ toString: () => 'menu_shown' }), false);
});
