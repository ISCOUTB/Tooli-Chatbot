import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IMessagingAdapter } from './IMessagingAdapter';
import { conZonaDePruebas } from './ZonaDePruebasAdapter';
import { buzon, enZonaDePruebas, esNumeroSimulado, nuevoNumeroSimulado } from '../../services/simulacion';

const SIM = '570000123456';
const REAL = '573001234567';

/** Adaptador «real» que solo anota a quién se le habría mandado algo. */
function adaptadorEspia(opcionales = true) {
  const llamadas: Array<{ metodo: string; to?: string }> = [];
  const anota = (metodo: string) => async (msg: { to?: string }) => { llamadas.push({ metodo, to: msg?.to }); };
  const real: IMessagingAdapter = {
    sendText: anota('sendText'),
    sendButtons: anota('sendButtons'),
    sendList: anota('sendList'),
    sendDocument: anota('sendDocument'),
    sendImage: anota('sendImage'),
    sendMediaFromUrl: anota('sendMediaFromUrl'),
    resolveSenderId: async (jid) => jid,
  };
  if (opcionales) {
    real.subirImagen = async () => { llamadas.push({ metodo: 'subirImagen' }); return 'id-meta'; };
    real.sendImageId = async (to) => { llamadas.push({ metodo: 'sendImageId', to }); return 'wamid'; };
    real.marcarLeido = async () => { llamadas.push({ metodo: 'marcarLeido' }); };
  }
  return { real, llamadas };
}

async function mandarDeTodo(a: IMessagingAdapter, to: string): Promise<void> {
  await a.sendText({ to, text: 'hola' });
  await a.sendButtons({ to, title: 'T', description: 'D', buttons: [{ id: '1', displayText: 'Uno' }] });
  await a.sendList({ to, title: 'T', description: 'D', buttonText: 'Ver', sections: [{ title: 'S', rows: [{ id: 'a', title: 'A' }] }] });
  await a.sendDocument({ to, buffer: Buffer.from('%PDF'), fileName: 'recibo.pdf', mimetype: 'application/pdf' });
  await a.sendImage({ to, buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg', caption: 'flyer' });
  await a.sendMediaFromUrl({ to, url: 'https://example.org/a.pdf', kind: 'document' });
  await a.sendImageId!(to, 'id-meta', 'pie');
}

describe('números de la zona de pruebas', () => {
  it('solo 57 0000 + 6 dígitos es simulado: ningún número colombiano real empieza por 0', () => {
    for (const t of ['570000000000', '570000999999', SIM]) assert.ok(esNumeroSimulado(t), t);
    for (const t of [REAL, '576015550100', '57000012345', '5700001234567', '+570000123456', '', null, 570000123456]) {
      assert.equal(esNumeroSimulado(t), false, String(t));
    }
    for (let i = 0; i < 50; i++) assert.ok(esNumeroSimulado(nuevoNumeroSimulado()));
  });

  it('enZonaDePruebas no acepta un número real', () => {
    assert.throws(() => enZonaDePruebas(REAL, async () => {}), /número simulado/);
  });
});

describe('ZonaDePruebasAdapter', () => {
  beforeEach(() => { buzon.borrar(SIM); });

  it('un número simulado NUNCA llega al adaptador real: todo queda en el buzón', async () => {
    const { real, llamadas } = adaptadorEspia();
    const a = conZonaDePruebas(real);
    await mandarDeTodo(a, SIM);
    // También dentro de una conversación simulada.
    await enZonaDePruebas(SIM, () => mandarDeTodo(a, SIM));
    assert.deepEqual(llamadas, []);
    const recibidos = buzon.sacar(SIM);
    assert.equal(recibidos.length, 14);
    assert.deepEqual(recibidos.slice(0, 7).map((m) => m.tipo), ['texto', 'botones', 'lista', 'documento', 'imagen', 'media', 'imagen']);
    const img = recibidos[4] as { src?: string; pie?: string };
    assert.match(img.src ?? '', /^data:image\/jpeg;base64,/);
    assert.equal(img.pie, 'flyer');
    assert.deepEqual(buzon.sacar(SIM), [], 'sacar vacía el buzón');
  });

  it('un número real nunca se captura: pasa tal cual al adaptador real', async () => {
    const { real, llamadas } = adaptadorEspia();
    await mandarDeTodo(conZonaDePruebas(real), REAL);
    assert.equal(llamadas.length, 7);
    assert.ok(llamadas.every((l) => l.to === REAL));
    assert.deepEqual(buzon.sacar(REAL), []);
  });

  it('dentro de una conversación simulada, lo que iría a OTRO número no sale y queda como nota', async () => {
    const { real, llamadas } = adaptadorEspia();
    const a = conZonaDePruebas(real);
    await enZonaDePruebas(SIM, () => mandarDeTodo(a, REAL));
    assert.deepEqual(llamadas, []);
    const notas = buzon.sacar(SIM);
    assert.equal(notas.length, 7);
    assert.ok(notas.every((n) => n.tipo === 'nota'));
    assert.doesNotMatch(JSON.stringify(notas), new RegExp(REAL), 'la nota no muestra el número completo');
  });

  it('en una simulación no sube imágenes a Meta (su id podría quedar en la caché de flyers)', async () => {
    const { real, llamadas } = adaptadorEspia();
    const a = conZonaDePruebas(real);
    await assert.rejects(enZonaDePruebas(SIM, () => a.subirImagen!(Buffer.from('x'), 'image/jpeg')));
    assert.equal(await a.subirImagen!(Buffer.from('x'), 'image/jpeg'), 'id-meta', 'fuera del simulador sí');
    assert.deepEqual(llamadas.map((l) => l.metodo), ['subirImagen']);
  });

  it('los métodos opcionales existen solo si el adaptador real los tiene (Evolution no sube imágenes)', () => {
    const sin = conZonaDePruebas(adaptadorEspia(false).real);
    assert.equal(sin.subirImagen, undefined);
    assert.equal(sin.sendImageId, undefined);
    assert.equal(sin.marcarLeido, undefined);
    const con = conZonaDePruebas(adaptadorEspia(true).real);
    assert.equal(typeof con.subirImagen, 'function');
    assert.equal(typeof con.marcarLeido, 'function');
  });
});
