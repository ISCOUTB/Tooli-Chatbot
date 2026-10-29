import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetaCloudWebhooks } from './metaCloudParser';

/** Webhook de Meta con un único mensaje; `mensaje` trae el tipo y su contenido. */
function webhook(mensaje: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '573150000000', phone_number_id: 'pnid' },
          messages: [{ from: '573001112233', id: 'wamid.X', timestamp: '1793300000', ...mensaje }],
        },
      }],
    }],
  };
}

describe('parseMetaCloudWebhooks', () => {
  it('texto, botón y lista interactivos llegan como texto o como el id elegido', () => {
    assert.equal(parseMetaCloudWebhooks(webhook({ type: 'text', text: { body: 'Hola' } }))[0].text, 'Hola');
    assert.equal(parseMetaCloudWebhooks(webhook({
      type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'si', title: '✅ Sí' } },
    }))[0].text, 'si');
    assert.equal(parseMetaCloudWebhooks(webhook({
      type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '2', title: 'Maestría' } },
    }))[0].text, '2');
  });

  it('el toque en un botón de plantilla llega con su payload', () => {
    const [m] = parseMetaCloudWebhooks(webhook({
      type: 'button',
      context: { from: '573150000000', id: 'wamid.PLANTILLA' },
      button: { payload: 'campana_ver', text: 'Ver mis opciones' },
    }));
    assert.equal(m.text, 'campana_ver');
    assert.equal(m.from, '573001112233');
  });

  it('sin payload, usa el texto del botón', () => {
    const [m] = parseMetaCloudWebhooks(webhook({ type: 'button', button: { text: 'No me interesa' } }));
    assert.equal(m.text, 'No me interesa');
  });

  it('ignora tipos sin soporte sin perder los demás', () => {
    assert.deepEqual(parseMetaCloudWebhooks(webhook({ type: 'audio', audio: { id: 'a1' } })), []);
    assert.deepEqual(parseMetaCloudWebhooks({ object: 'otra_cosa' }), []);
  });
});
