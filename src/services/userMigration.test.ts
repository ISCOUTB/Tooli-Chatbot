import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reescribirUsuarioEnAuditoria } from './auditService';
import { FichaCrm, reescribirUsuarioEnFicha } from './crmService';

describe('migraciones puras de usuario', () => {
  it('reescribe auditoría y conserva orden y entradas inválidas', () => {
    const raw = [JSON.stringify({ ts: 2, username: 'ana', action: 'login' }), '{mal}', JSON.stringify({ ts: 1, username: 'luis', action: 'login' })];
    const result = reescribirUsuarioEnAuditoria(raw, 'ana', 'anadiaz');
    assert.equal(JSON.parse(result[0]).username, 'anadiaz');
    assert.equal(result[1], '{mal}');
    assert.equal(JSON.parse(result[2]).username, 'luis');
  });
  it('reescribe todos los campos de una ficha sin mutarla', () => {
    const ficha: FichaCrm = { phone: '57', estado: 'nuevo', asignadoA: 'ana', actualizadoPor: 'ana', etiquetas: [], notas: [{ id: '1', texto: 'x', autor: 'ana', ts: 1 }], actualizadoEn: 1 };
    const result = reescribirUsuarioEnFicha(ficha, 'ana', 'anadiaz');
    assert.equal(result.asignadoA, 'anadiaz');
    assert.equal(result.actualizadoPor, 'anadiaz');
    assert.equal(result.notas[0].autor, 'anadiaz');
    assert.equal(ficha.asignadoA, 'ana');
  });
});
