import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventoAtencion, formatoSse, publicarAtencion, suscribirAtencion } from './atencionEventos';

describe('avisos en vivo de la bandeja de atención', () => {
  it('cada panel suscrito recibe el evento con su hora', () => {
    const recibidos: EventoAtencion[][] = [[], []];
    const cancelar = recibidos.map((lista) => suscribirAtencion((e) => lista.push(e)));
    publicarAtencion({ tipo: 'mensaje', conversacionId: 31, entrante: true, nombre: 'María', texto: 'Hola' });
    cancelar.forEach((c) => c());
    for (const lista of recibidos) {
      assert.equal(lista.length, 1);
      assert.equal(lista[0].conversacionId, 31);
      assert.equal(lista[0].texto, 'Hola');
      assert.ok(lista[0].ts > 0);
    }
  });

  it('al cancelar deja de recibir', () => {
    let n = 0;
    const cancelar = suscribirAtencion(() => { n++; });
    cancelar();
    publicarAtencion({ tipo: 'estado', conversacionId: 5 });
    assert.equal(n, 0);
  });

  it('acorta la vista previa y la deja en una línea', () => {
    let ultimo: EventoAtencion | undefined;
    const cancelar = suscribirAtencion((e) => { ultimo = e; });
    publicarAtencion({ tipo: 'mensaje', conversacionId: 1, texto: `${'a'.repeat(200)}\n\nfin` });
    cancelar();
    assert.equal(ultimo?.texto?.length, 120);
    assert.ok(ultimo?.texto?.endsWith('…'));
  });

  it('ignora eventos sin una conversación válida', () => {
    let n = 0;
    const cancelar = suscribirAtencion(() => { n++; });
    publicarAtencion({ tipo: 'mensaje', conversacionId: 0 });
    publicarAtencion({ tipo: 'mensaje', conversacionId: Number.NaN });
    cancelar();
    assert.equal(n, 0);
  });

  it('el formato SSE es un evento con nombre y una línea de datos', () => {
    const texto = formatoSse({ tipo: 'nueva', conversacionId: 7, ts: 1 });
    assert.equal(texto, 'event: atencion\ndata: {"tipo":"nueva","conversacionId":7,"ts":1}\n\n');
  });
});
