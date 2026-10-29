import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { esNombreGenerico, getOrCreateContact } from './chatwootService';

/**
 * Nombre del contacto en Chatwoot: es lo primero que ve el asesor en la lista
 * de conversaciones. No hay red: se captura lo que se enviaría.
 */
const llamadas: { metodo: string; url: string; body?: unknown }[] = [];
let contactoExistente: { id: number; name: string; identifier: string } | null = null;

// El cliente de Chatwoot se crea en la primera llamada, así que basta con
// reemplazar axios.create antes de usarlo.
const createOriginal = axios.create;
axios.create = (() => ({
  get: async (url: string) => {
    llamadas.push({ metodo: 'get', url });
    if (url === '/contacts/search') return { data: { payload: contactoExistente ? [contactoExistente] : [] } };
    return { data: { payload: [{ inbox: { id: 0 }, source_id: 'src-1' }] } };
  },
  post: async (url: string, body: unknown) => {
    llamadas.push({ metodo: 'post', url, body });
    return { data: { payload: { contact: { id: 7 }, contact_inbox: { source_id: 'src-1' } } } };
  },
  put: async (url: string, body: unknown) => {
    llamadas.push({ metodo: 'put', url, body });
    return { data: {} };
  },
})) as unknown as typeof axios.create;

after(() => { axios.create = createOriginal; });

async function conContacto(nombreActual: string | null, nombreNuevo: string) {
  llamadas.length = 0;
  contactoExistente = nombreActual === null ? null : { id: 42, name: nombreActual, identifier: '573001234567' };
  await getOrCreateContact('573001234567', nombreNuevo);
  return llamadas.filter((l) => l.metodo === 'put');
}

describe('esNombreGenerico', () => {
  it('reconoce los nombres de relleno del bot y de Chatwoot', () => {
    assert.equal(esNombreGenerico('Usuario 4567', '573001234567'), true);
    assert.equal(esNombreGenerico('Prospecto', '573001234567'), true);
    assert.equal(esNombreGenerico('+57 300 123 4567', '573001234567'), true);
    assert.equal(esNombreGenerico('  ', '573001234567'), true);
    assert.equal(esNombreGenerico(undefined, '573001234567'), true);
  });

  it('un nombre de persona no es genérico', () => {
    assert.equal(esNombreGenerico('María José Restrepo', '573001234567'), false);
    assert.equal(esNombreGenerico('Usuario Frecuente', '573001234567'), false);
  });
});

describe('getOrCreateContact', () => {
  it('corrige el nombre genérico de un contacto existente cuando ya se conoce el real', async () => {
    const puts = await conContacto('Usuario 4567', 'María José Restrepo');
    assert.deepEqual(puts, [{ metodo: 'put', url: '/contacts/42', body: { name: 'María José Restrepo' } }]);
  });

  it('no pisa un nombre real con otro nombre ni con uno genérico', async () => {
    assert.deepEqual(await conContacto('María José Restrepo', 'Majo'), []);
    assert.deepEqual(await conContacto('María José Restrepo', 'Usuario 4567'), []);
  });

  it('un contacto nuevo se crea con el nombre recibido', async () => {
    await conContacto(null, 'Carlos Pérez');
    const creado = llamadas.find((l) => l.metodo === 'post' && l.url === '/contacts');
    assert.equal((creado?.body as { name: string }).name, 'Carlos Pérez');
  });
});
