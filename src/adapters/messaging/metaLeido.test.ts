import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuerpoLeido } from './metaLeido';

describe('Meta: leído y escribiendo', () => {
  it('marca como leído y pide el indicador de escritura', () => {
    assert.deepEqual(cuerpoLeido('wamid.ABC', true), {
      messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.ABC', typing_indicator: { type: 'text' },
    });
  });

  it('sin respuesta del bot, solo lo marca como leído', () => {
    assert.deepEqual(cuerpoLeido('wamid.ABC', false), {
      messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.ABC',
    });
  });
});
