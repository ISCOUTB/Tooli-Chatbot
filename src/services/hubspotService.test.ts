import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { config } from '../config';
import { HubspotLead, upsertContactoHubspot } from './hubspotService';

/**
 * Qué propiedades llegan a HubSpot. No hay red: se captura lo que se enviaría.
 */
const lead: HubspotLead = {
  email: 'laura@example.com',
  nombre: 'Laura Gómez Pérez',
  whatsapp: '573001112233',
  posgradoInteres: 'Maestría en Administración de Empresas-MBA',
  interesFinanciacion: '',
  consentimiento: true,
};

async function conHubspot(
  props: Partial<typeof config.hubspot>,
  fn: (enviados: Record<string, string>[]) => Promise<void>,
  falla: (n: number) => boolean = () => false,
) {
  const original = { ...config.hubspot };
  const originalPost = axios.post;
  const enviados: Record<string, string>[] = [];
  Object.assign(config.hubspot, { activo: true, token: 't' }, props);
  axios.post = (async (_url: string, body: { inputs: { properties: Record<string, string> }[] }) => {
    enviados.push(body.inputs[0].properties);
    if (falla(enviados.length)) throw new Error('propiedad inexistente');
    return { data: {} };
  }) as typeof axios.post;
  try {
    await fn(enviados);
  } finally {
    Object.assign(config.hubspot, original);
    axios.post = originalPost;
  }
}

describe('upsertContactoHubspot', () => {
  it('sin propiedades personalizadas envía solo las estándar', async () => {
    await conHubspot({ propPosgrado: '', propFuente: '', propPregrado: '', propRelacion: '' }, async (enviados) => {
      await upsertContactoHubspot({ ...lead, pregrado: 'Ingeniería Industrial', relacion: 'Egresado(a) UTB' });
      assert.deepEqual(enviados, [{ email: 'laura@example.com', firstname: 'Laura', lastname: 'Gómez Pérez', phone: '+573001112233' }]);
    });
  });

  it('usa la fuente del lead y envía pregrado y relación si sus propiedades están configuradas', async () => {
    await conHubspot({ propFuente: 'fuente_lead', propPregrado: 'pregrado_utb', propRelacion: 'relacion_utb', fuenteValor: 'Bot WhatsApp - Evento Posgrados' }, async (enviados) => {
      await upsertContactoHubspot({ ...lead, fuente: 'Bot WhatsApp - Campaña por pregrado', pregrado: 'Ingeniería Industrial', relacion: 'Egresado(a) UTB' });
      assert.equal(enviados[0].fuente_lead, 'Bot WhatsApp - Campaña por pregrado');
      assert.equal(enviados[0].pregrado_utb, 'Ingeniería Industrial');
      assert.equal(enviados[0].relacion_utb, 'Egresado(a) UTB');
    });
  });

  it('sin fuente propia usa la del evento, como antes', async () => {
    await conHubspot({ propFuente: 'fuente_lead', fuenteValor: 'Bot WhatsApp - Evento Posgrados', propPregrado: 'pregrado_utb' }, async (enviados) => {
      await upsertContactoHubspot(lead);
      assert.equal(enviados[0].fuente_lead, 'Bot WhatsApp - Evento Posgrados');
      assert.ok(!('pregrado_utb' in enviados[0]), 'sin pregrado no se manda la propiedad vacía');
    });
  });

  it('si HubSpot rechaza las personalizadas, reintenta solo con las estándar', async () => {
    await conHubspot({ propPregrado: 'pregrado_utb' }, async (enviados) => {
      await upsertContactoHubspot({ ...lead, pregrado: 'Derecho' });
      assert.equal(enviados.length, 2);
      assert.ok('pregrado_utb' in enviados[0]);
      assert.deepEqual(Object.keys(enviados[1]).sort(), ['email', 'firstname', 'lastname', 'phone']);
    }, (n) => n === 1);
  });

  it('inactivo no llama a HubSpot', async () => {
    await conHubspot({ activo: false }, async (enviados) => {
      await upsertContactoHubspot(lead);
      assert.equal(enviados.length, 0);
    });
  });
});
