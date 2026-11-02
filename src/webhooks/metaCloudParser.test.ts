import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetaCloudWebhookResult, parseMetaCloudWebhooks } from './metaCloudParser';

function value(extra: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '573150000000', phone_number_id: 'pnid' },
      ...extra,
    } }] }],
  };
}

function webhook(mensaje: Record<string, unknown>) {
  return value({ messages: [{ from: '573001112233', id: 'wamid.X', timestamp: '1793300000', ...mensaje }] });
}

describe('parseMetaCloudWebhooks', () => {
  it('mantiene el mensaje con teléfono', () => {
    const [message] = parseMetaCloudWebhooks(webhook({ type: 'text', text: { body: 'Hola' } }));
    assert.equal(message.from, '573001112233');
    assert.equal(message.text, 'Hola');
  });

  it('mantiene botones y listas como el id elegido', () => {
    assert.equal(parseMetaCloudWebhooks(webhook({
      type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'si', title: 'Sí' } },
    }))[0].text, 'si');
    assert.equal(parseMetaCloudWebhooks(webhook({
      type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '2', title: 'Maestría' } },
    }))[0].text, '2');
  });

  it('acepta solo BSUID y asocia el perfil por user_id', () => {
    const bsuid = 'CO.13491208655302741918';
    const [message] = parseMetaCloudWebhooks(value({
      messages: [{ from_user_id: bsuid, id: 'wamid.B', timestamp: '1793300000', type: 'text', text: { body: 'Hola' } }],
      contacts: [{ user_id: bsuid, profile: { name: 'Laura', username: 'laura' } }],
    }));
    assert.deepEqual(
      { from: message.from, userId: message.userId, username: message.username, profileName: message.profileName },
      { from: bsuid, userId: bsuid, username: 'laura', profileName: 'Laura' },
    );
    const result = parseMetaCloudWebhookResult(value({
      messages: [{ from_user_id: bsuid, id: 'wamid.B', timestamp: '1793300000', type: 'text', text: { body: 'Hola' } }],
    }));
    assert.equal(result.sinTelefono, 1);
    assert.deepEqual(result.descartados, []);
  });

  it('emite audio y sticker como mensajes no soportados', () => {
    for (const type of ['audio', 'sticker']) {
      const [message] = parseMetaCloudWebhooks(webhook({ type, [type]: { id: 'media' } }));
      assert.equal(message.text, '__unsupported__');
      assert.equal(message.mediaType, type);
    }
  });

  it('descarta reacciones y sistemas', () => {
    assert.deepEqual(parseMetaCloudWebhooks(webhook({ type: 'reaction', reaction: { emoji: '👍' } })), []);
    assert.deepEqual(parseMetaCloudWebhooks(webhook({ type: 'system', system: { type: 'user_changed_number' } })), []);
  });

  it('cuenta estados, mensajes y descartes sin datos personales', () => {
    const result = parseMetaCloudWebhookResult(value({
      statuses: [{ id: 'a' }, { id: 'b' }],
      errors: [{ code: 131026 }],
      messages: [
        { from: '573001112233', id: '1', timestamp: '1', type: 'text', text: { body: 'Hola' } },
        { from: '573001112233', id: '2', timestamp: '2', type: 'reaction', reaction: {} },
      ],
    }));
    assert.equal(result.mensajes.length, 1);
    assert.equal(result.estados, 2);
    assert.equal(result.sinTelefono, 0);
    assert.deepEqual(result.descartados, ['131026', 'reaction']);
  });

  it('acepta un webhook que solo contiene estados', () => {
    const result = parseMetaCloudWebhookResult(value({ statuses: [{ id: 'a' }] }));
    assert.deepEqual(result, { mensajes: [], estados: 1, sinTelefono: 0, descartados: [] });
  });
});
