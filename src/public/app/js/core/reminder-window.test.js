import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estadoVentanaRecordatorio } from './reminder-window.js';

describe('estadoVentanaRecordatorio', () => {
  const ultimoEntrante = Date.UTC(2026, 9, 20, 12);

  it('avisa por un envío futuro aunque el mensaje entrante sea reciente hoy', () => {
    assert.equal(estadoVentanaRecordatorio(ultimoEntrante, ultimoEntrante + 25 * 60 * 60 * 1000), 'fuera');
  });

  it('conserva la ventana hasta antes de cumplirse 24 horas', () => {
    assert.equal(estadoVentanaRecordatorio(ultimoEntrante, ultimoEntrante + 24 * 60 * 60 * 1000 - 1), 'dentro');
    assert.equal(estadoVentanaRecordatorio(ultimoEntrante, ultimoEntrante + 24 * 60 * 60 * 1000), 'fuera');
  });

  it('no afirma que hubo conversación cuando falta historial o fecha', () => {
    assert.equal(estadoVentanaRecordatorio(undefined, ultimoEntrante + 60_000), 'sin-historial');
    assert.equal(estadoVentanaRecordatorio(ultimoEntrante, NaN), 'sin-fecha');
  });
});
