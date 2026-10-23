import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLinkedSession, linkedChatwootTarget } from './chatwootWebhookGuard';

const payload = {
  account: { id: 2 }, inbox: { id: 7 },
  conversation: { id: 91, inbox_id: 7, account_id: 2, meta: { sender: { identifier: '573001234567' } } },
};

test('Chatwoot delivery must belong to the configured account, inbox and live conversation', () => {
  assert.deepEqual(linkedChatwootTarget(payload, '2', '7', 'message'), { phone: '573001234567', conversationId: 91 });
  assert.equal(linkedChatwootTarget({ ...payload, inbox: { id: 8 } }, '2', '7', 'message'), null);
  assert.equal(linkedChatwootTarget({ ...payload, account: undefined, conversation: { ...payload.conversation, account_id: undefined } }, '2', '7', 'message'), null);
  assert.equal(linkedChatwootTarget({ ...payload, conversation: { ...payload.conversation, id: 92 } }, '2', '7', 'message')?.conversationId, 92);
  assert.equal(linkedChatwootTarget({ ...payload, contact: { identifier: '573009999999' } }, '2', '7', 'message'), null);
  assert.equal(linkedChatwootTarget({ ...payload, conversation: { ...payload.conversation, meta: { sender: { identifier: 'not-a-phone' } } } }, '2', '7', 'message'), null);
  assert.equal(isLinkedSession({ step: 'with_agent', data: { conversationId: '91' } }, 91), true);
  assert.equal(isLinkedSession({ step: 'with_agent', data: { conversationId: '90' } }, 91), false);
  assert.equal(isLinkedSession({ step: 'menu', data: { conversationId: '91' } }, 91), false);
});
