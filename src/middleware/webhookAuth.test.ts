import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { config } from '../config';
import { requireMetaSignature, verifyChatwootToken, verifyMetaSignature, verifySharedSecret } from './webhookAuth';
import type { RawBodyRequest } from './webhookAuth';

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

test('Meta middleware only enforces the signature once META_APP_SECRET is set', () => {
  const original = config.metaCloud.appSecret;
  const body = Buffer.from('{"entry":[]}');
  const run = (signature?: string) => {
    let nextCalled = false;
    let status: number | undefined;
    const req = { rawBody: body, header: () => signature } as unknown as RawBodyRequest;
    const res = { sendStatus: (s: number) => { status = s; }, status: (s: number) => { status = s; return res; }, json: () => res } as any;
    requireMetaSignature(req, res, () => { nextCalled = true; });
    return { nextCalled, status };
  };
  try {
    config.metaCloud.appSecret = '';
    assert.deepEqual(run(), { nextCalled: true, status: undefined });

    config.metaCloud.appSecret = 'meta-app-secret-for-test';
    assert.deepEqual(run(), { nextCalled: false, status: 401 });
    const signature = `sha256=${createHmac('sha256', 'meta-app-secret-for-test').update(body).digest('hex')}`;
    assert.deepEqual(run(signature), { nextCalled: true, status: undefined });
  } finally {
    config.metaCloud.appSecret = original;
  }
});

test('Chatwoot token requires a configured high entropy secret and exact match', () => {
  const token = 'c63acf651859dd45b8e1f51283136fd5';
  assert.equal(verifyChatwootToken(token, token), true);
  assert.equal(verifyChatwootToken(token.slice(0, -1), token), false);
  assert.equal(verifyChatwootToken([token], token), false);
  assert.equal(verifyChatwootToken(token, ''), false);
  assert.equal(verifyChatwootToken('short', 'short'), false);
});

test('in production a missing META_APP_SECRET rejects deliveries unless explicitly allowed', () => {
  const original = config.metaCloud.appSecret;
  const env = { node: process.env.NODE_ENV, allow: process.env.META_ALLOW_UNSIGNED };
  const run = () => {
    let nextCalled = false;
    let status: number | undefined;
    const req = { rawBody: Buffer.from('{}'), header: () => undefined } as unknown as RawBodyRequest;
    const res = { sendStatus: (s: number) => { status = s; }, status: (s: number) => { status = s; return res; }, json: () => res } as any;
    requireMetaSignature(req, res, () => { nextCalled = true; });
    return { nextCalled, status };
  };
  try {
    config.metaCloud.appSecret = '';
    process.env.NODE_ENV = 'production';
    delete process.env.META_ALLOW_UNSIGNED;
    assert.deepEqual(run(), { nextCalled: false, status: 503 });
    process.env.META_ALLOW_UNSIGNED = '1';
    assert.deepEqual(run(), { nextCalled: true, status: undefined });
  } finally {
    config.metaCloud.appSecret = original;
    if (env.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env.node;
    if (env.allow === undefined) delete process.env.META_ALLOW_UNSIGNED; else process.env.META_ALLOW_UNSIGNED = env.allow;
  }
});

test('shared secrets (Evolution, metrics) need an exact non-empty match', () => {
  assert.equal(verifySharedSecret('s3creto-largo', 's3creto-largo'), true);
  assert.equal(verifySharedSecret('s3creto-larg', 's3creto-largo'), false);
  assert.equal(verifySharedSecret(undefined, 's3creto-largo'), false);
  assert.equal(verifySharedSecret(['s3creto-largo'], 's3creto-largo'), false);
  assert.equal(verifySharedSecret('', ''), false);
});
