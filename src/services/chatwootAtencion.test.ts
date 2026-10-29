import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contarPorAsignado, filtrarPorAsignado, mapConversacion, mapMensaje, tipoDeMensaje } from './chatwootAtencion';

/**
 * Traducción de la API de Chatwoot a la bandeja de atención del panel. Las
 * formas de los datos son las que devuelve Chatwoot v3 en /conversations y
 * /conversations/:id/messages.
 */
const conversacionCruda = {
  id: 31,
  status: 'open',
  inbox_id: 1,
  unread_count: 2,
  last_activity_at: 1_793_280_000,
  labels: ['posgrado-prospecto'],
  priority: 'medium',
  meta: {
    sender: { name: 'María José Restrepo', phone_number: '+573001234567', identifier: '573001234567' },
    assignee: { id: 4, name: 'luis.perez', available_name: 'Luis Pérez' },
    team: { id: 2, name: 'admisiones' },
  },
  messages: [{ id: 900, content: '¿Tienen becas?', message_type: 0, created_at: 1_793_280_000 }],
};

describe('tipoDeMensaje', () => {
  it('distingue persona, asesor, nota y aviso del sistema', () => {
    assert.equal(tipoDeMensaje({ message_type: 0 }), 'in');
    assert.equal(tipoDeMensaje({ message_type: 1 }), 'out');
    assert.equal(tipoDeMensaje({ message_type: 3 }), 'out');
    assert.equal(tipoDeMensaje({ message_type: 2 }), 'sistema');
    assert.equal(tipoDeMensaje({ message_type: 1, private: true }), 'nota');
  });

  it('acepta los nombres en texto que usan los webhooks', () => {
    assert.equal(tipoDeMensaje({ message_type: 'incoming' }), 'in');
    assert.equal(tipoDeMensaje({ message_type: 'outgoing' }), 'out');
  });
});

describe('mapConversacion', () => {
  it('trae lo que la bandeja muestra en cada fila', () => {
    const c = mapConversacion(conversacionCruda);
    assert.equal(c.id, 31);
    assert.deepEqual(c.contacto, { nombre: 'María José Restrepo', telefono: '573001234567' });
    assert.deepEqual(c.asignado, { id: 4, nombre: 'Luis Pérez' });
    assert.deepEqual(c.equipo, { id: 2, nombre: 'admisiones' });
    assert.equal(c.noLeidos, 2);
    assert.equal(c.actividadTs, 1_793_280_000_000, 'segundos de Chatwoot a milisegundos');
    assert.deepEqual(c.ultimoMensaje, { texto: '¿Tienen becas?', ts: 1_793_280_000_000, tipo: 'in' });
  });

  it('sin asignar ni nombre: asignado nulo y el teléfono como nombre', () => {
    const c = mapConversacion({ id: 5, meta: { sender: { identifier: '573009876543' }, assignee: null }, messages: [] });
    assert.equal(c.asignado, null);
    assert.equal(c.contacto.nombre, '+573009876543');
    assert.equal(c.ultimoMensaje, null);
  });
});

describe('mapMensaje', () => {
  it('conserva solo adjuntos con una URL web', () => {
    const m = mapMensaje({
      id: 1, content: 'Mira', message_type: 0, created_at: 10,
      attachments: [{ file_type: 'image', data_url: 'https://x/a.jpg' }, { file_type: 'file', data_url: 'javascript:alert(1)' }],
    });
    assert.deepEqual(m.adjuntos, [{ tipo: 'image', url: 'https://x/a.jpg', nombre: null }]);
  });

  it('el autor es el nombre visible de quien escribió', () => {
    assert.equal(mapMensaje({ id: 2, message_type: 1, sender: { name: 'luis', available_name: 'Luis Pérez' } }).autor, 'Luis Pérez');
    assert.equal(mapMensaje({ id: 3, message_type: 2 }).autor, null);
  });
});

describe('filtrarPorAsignado', () => {
  const lista = [
    mapConversacion(conversacionCruda),
    mapConversacion({ ...conversacionCruda, id: 32, meta: { ...conversacionCruda.meta, assignee: null } }),
    mapConversacion({ ...conversacionCruda, id: 33, meta: { ...conversacionCruda.meta, assignee: { id: 9, name: 'ana' } } }),
  ];

  it('"Mías" usa el usuario de atención del asesor', () => {
    assert.deepEqual(filtrarPorAsignado(lista, 'mias', 4).map((c) => c.id), [31]);
    assert.deepEqual(filtrarPorAsignado(lista, 'mias', undefined), [], 'sin usuario vinculado no hay "mías"');
  });

  it('cuenta cada pestaña sobre la misma lista', () => {
    assert.deepEqual(contarPorAsignado(lista, 4), { mias: 1, sin_asignar: 1, todas: 3 });
  });
});
