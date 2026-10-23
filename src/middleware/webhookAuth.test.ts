import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyChatwootToken, verifyMetaSignature } from './webhookAuth';

test('Meta signature checks the exact raw bytes and rejects forged deliveries', () => {
  const secret = 'meta-app-secret-for-test';
  const body = Buffer.from('{"entry":[{"id":"123"}]}');
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyMetaSignature(body, signature, secret), true);
  assert.equal(verifyMetaSignature(Buffer.from('{"entry": [{"id":"123"}]}'), signature, secret), false);
  assert.equal(verifyMetaSignature(body, signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0'), secret), false);
  assert.equal(verifyMetaSignature(body, undefined, secret), false);
  assert.equal(verifyMetaSignature(undefined, signature, secret), false);
  assert.equal(verifyMetaSignature(body, signature, ''), false);
});

test('Chatwoot token requires a configured high entropy secret and exact match', () => {
  const token = 'c63acf651859dd45b8e1f51283136fd5';
  assert.equal(verifyChatwootToken(token, token), true);
  assert.equal(verifyChatwootToken(token.slice(0, -1), token), false);
  assert.equal(verifyChatwootToken([token], token), false);
  assert.equal(verifyChatwootToken(token, ''), false);
  assert.equal(verifyChatwootToken('short', 'short'), false);
});
