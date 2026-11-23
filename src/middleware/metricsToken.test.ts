import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricsAuthorized, metricsTokensFrom } from './webhookAuth';

const req = (headers: Record<string, string>, query: Record<string, string> = {}) => ({ headers, query }) as any;

test('el token de métricas se busca en cabecera, Bearer y URL', () => {
  assert.deepEqual(metricsTokensFrom(req({ 'x-metrics-token': 'cab', authorization: 'Bearer bea' }, { token: 'url' })), ['cab', 'bea', 'url']);
  assert.deepEqual(metricsTokensFrom(req({})), []);
});

test('basta con que una fuente traiga el token correcto', () => {
  const secret = 'token-de-metricas-largo';
  assert.equal(metricsAuthorized(req({ 'x-metrics-token': secret }), secret), true);
  // Un proxy delante añade su propio Bearer: Prometheus sigue entrando por ?token=
  assert.equal(metricsAuthorized(req({ authorization: 'Bearer jwt-del-proxy' }, { token: secret }), secret), true);
  assert.equal(metricsAuthorized(req({ authorization: 'Bearer otro' }, { token: 'malo' }), secret), false);
  assert.equal(metricsAuthorized(req({}), secret), false);
  assert.equal(metricsAuthorized(req({}, { token: '' }), ''), false);
});
