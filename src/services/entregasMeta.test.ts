import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { avisarEstado, esperarSalida } from './entregasMeta';

describe('esperarSalida', () => {
  it('sigue apenas Meta confirma todos los mensajes', async () => {
    const espera = esperarSalida(['wamid.a', 'wamid.b'], 2_000);
    avisarEstado('wamid.a', 'sent');
    avisarEstado('wamid.b', 'delivered');
    assert.equal(await espera, true);
  });

  it('cuenta las confirmaciones que llegaron antes de esperar', async () => {
    avisarEstado('wamid.c', 'sent');
    assert.equal(await esperarSalida(['wamid.c'], 50), true);
  });

  it('no se queda colgado si la confirmación no llega', async () => {
    const inicio = Date.now();
    assert.equal(await esperarSalida(['wamid.nunca'], 60), false);
    assert.ok(Date.now() - inicio < 1_000);
  });

  it('un envío fallido también libera la espera', async () => {
    const espera = esperarSalida(['wamid.f'], 2_000);
    avisarEstado('wamid.f', 'failed');
    assert.equal(await espera, true);
  });

  it('ignora estados que no son de salida y listas vacías', async () => {
    avisarEstado('wamid.x', 'deleted');
    assert.equal(await esperarSalida(['wamid.x'], 40), false);
    assert.equal(await esperarSalida([], 40), true);
  });
});
