import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBsuid, metaRecipient, normalizeContactId } from './whatsappId';

describe('identificadores de WhatsApp', () => {
  it('reconoce BSUID normales y parent', () => {
    assert.equal(isBsuid('CO.13491208655302741918'), true);
    assert.equal(isBsuid('CO.ENT.Abc123'), true);
    assert.equal(isBsuid('co.123'), false);
    assert.equal(isBsuid('CO.valor-con-guion'), false);
  });

  it('conserva el BSUID y normaliza teléfonos a dígitos', () => {
    assert.equal(normalizeContactId('CO.ENT.Abc123'), 'CO.ENT.Abc123');
    assert.equal(normalizeContactId('+57 300-123-4567'), '573001234567');
  });

  it('elige recipient para BSUID y to para teléfono', () => {
    assert.deepEqual(metaRecipient('CO.123'), { recipient: 'CO.123' });
    assert.deepEqual(metaRecipient('573001234567'), { to: '573001234567' });
  });
});
