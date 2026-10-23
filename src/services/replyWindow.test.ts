import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ultimoEntranteVerificable, ventanaTextoLibreAbierta, VENTANA_TEXTO_LIBRE_MS } from './replyWindow';

describe('ventana de respuesta de Meta', () => {
  const now = 1_800_000_000_000;

  it('elige el último entrante aunque el historial llegue desordenado', () => {
    assert.equal(ultimoEntranteVerificable([
      { ts: now - 26 * 60 * 60 * 1000, direction: 'in' },
      { ts: now - 3 * 60 * 60 * 1000, direction: 'out' },
      { ts: now - 60 * 60 * 1000, direction: 'in' },
    ], now), now - 60 * 60 * 1000);
  });

  it('no presume una ventana abierta sin mensaje entrante verificable', () => {
    assert.equal(ultimoEntranteVerificable([{ ts: now - 1000, direction: 'out' }], now), null);
    assert.equal(ultimoEntranteVerificable([{ ts: now + 1000, direction: 'in' }], now), null);
    assert.equal(ventanaTextoLibreAbierta(null, now), false);
  });

  it('cierra la ventana a las 24 horas exactas', () => {
    assert.equal(ventanaTextoLibreAbierta(now - VENTANA_TEXTO_LIBRE_MS + 1, now), true);
    assert.equal(ventanaTextoLibreAbierta(now - VENTANA_TEXTO_LIBRE_MS, now), false);
  });
});
