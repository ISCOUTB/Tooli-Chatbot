import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { armarFicha, mismoNumero, type DatosFicha } from './fichaContacto';
import { almacenEnMemoria } from './asistenciaStoreMemoria';
import { asistenciasPorWhatsapp, crearEvento, registrarAsistente } from './asistenciaService';
import { envioParaContacto, type BroadcastJob } from './broadcastJobService';

const AHORA = Date.UTC(2026, 10, 17, 15, 0, 0);
const HORA = 60 * 60 * 1000;

const base = (cambios: Partial<DatosFicha> = {}): DatosFicha => ({
  telefono: '573001234567', ahora: AHORA, ventanaAplica: true,
  mensajesBot: [{ ts: AHORA - 3 * HORA, direction: 'in', text: 'Hola' }, { ts: AHORA - 2 * HORA, direction: 'out', text: 'Hola 👋' }],
  sesionBot: { nombre: 'Ana Bot', relacion: 'egresado_utb', programaNombre: 'Maestría en Ingeniería' },
  crm: { estado: 'contactado', asignadoA: 'luis', etiquetas: ['beca'], notas: [1, 2, 3, 4].map(n => ({ texto: `nota ${n}`, autor: 'luis', ts: n })) },
  registro: ['2026-11-10 09:00', 'Ana María Pérez', 'ana@gmail.com', '3001234567', 'Especialización en Finanzas', 'Posgrado'],
  asistencias: [{ evento: 'Feria de posgrados', sector: 'posgrado', fecha: '2026-11-20', origen: 'qr', registradoEn: 1 }],
  plantillas: [{ templateName: 'gracias', createdAt: 1, createdBy: 'luis', resultado: 'enviado' }],
  bajaCampanas: false,
  ...cambios,
});

describe('armarFicha', () => {
  it('junta el interés, el CRM, los eventos y las plantillas de la persona', () => {
    const f = armarFicha(base());
    assert.deepEqual(f.interes, {
      nombre: 'Ana María Pérez', correo: 'ana@gmail.com', programa: 'Especialización en Finanzas',
      area: 'Posgrado', relacion: 'Egresado UTB', registradoEl: '2026-11-10 09:00',
    });
    assert.deepEqual(f.crm?.notas.map(n => n.texto), ['nota 4', 'nota 3', 'nota 2'], 'las tres notas más recientes primero');
    assert.equal(f.asistencias.length, 1);
    assert.equal(f.puedeRecibirPlantilla, true);
    assert.deepEqual(f.sinDatos, []);
  });

  it('sin registro en el Sheet usa lo que la persona le dijo al bot', () => {
    assert.equal(armarFicha(base({ registro: null })).interes.programa, 'Maestría en Ingeniería');
    assert.equal(armarFicha(base({ registro: null })).interes.nombre, 'Ana Bot');
  });

  it('calcula si la ventana de 24 horas sigue abierta y cuándo cierra', () => {
    assert.deepEqual(armarFicha(base()).ventana, { abierta: true, ultimoEntranteTs: AHORA - 3 * HORA, cierraTs: AHORA + 21 * HORA });
    const vieja = armarFicha(base({ mensajesBot: [{ ts: AHORA - 30 * HORA, direction: 'in' }] }));
    assert.equal(vieja.ventana?.abierta, false);
    assert.equal(armarFicha(base({ mensajesBot: [] })).ventana?.abierta, false, 'sin mensajes de la persona no hay ventana');
    assert.equal(armarFicha(base({ ventanaAplica: false })).ventana, null, 'fuera de Meta no aplica');
  });

  it('una fuente que no respondió se nombra en vez de mostrarse vacía', () => {
    const f = armarFicha(base({ crm: null, asistencias: null, plantillas: null, mensajesBot: null }));
    assert.deepEqual(f.sinDatos.sort(), ['CRM', 'eventos', 'historial con el bot', 'plantillas enviadas']);
    assert.deepEqual(f.asistencias, []);
    assert.equal(f.ventana, null);
  });

  it('a quien escribe sin mostrar su número no se le pueden enviar plantillas', () => {
    assert.equal(armarFicha(base({ telefono: 'CO.abc123XYZ' })).puedeRecibirPlantilla, false);
  });

  it('reconoce el mismo número escrito con o sin 57', () => {
    assert.equal(mismoNumero('3001234567', '573001234567'), true);
    assert.equal(mismoNumero('+57 300 123 4567', '573001234567'), true);
    assert.equal(mismoNumero('3001234567', '573009999999'), false);
    assert.equal(mismoNumero('', '573001234567'), false);
  });
});

describe('fuentes de la ficha', () => {
  it('encuentra los eventos a los que fue una persona por su WhatsApp', async () => {
    const store = almacenEnMemoria();
    const feria = await crearEvento({ nombre: 'Feria de posgrados', sector: 'posgrado', fecha: '2026-11-20' }, 'manuel', store);
    const charla = await crearEvento({ nombre: 'Charla de becas', sector: 'pregrado' }, 'manuel', store);
    await registrarAsistente(feria.id, { whatsapp: '573001234567' }, { origen: 'qr', consentimiento: true }, store);
    await registrarAsistente(charla.id, { nombre: 'Otra persona', whatsapp: '3009998877' }, { origen: 'manual', consentimiento: false }, store);
    const de = await asistenciasPorWhatsapp('573001234567', store);
    assert.deepEqual(de.map(a => [a.evento, a.sector, a.origen]), [['Feria de posgrados', 'posgrado', 'qr']]);
    assert.deepEqual(await asistenciasPorWhatsapp('', store), []);
  });

  it('dice qué pasó con la plantilla que se le envió a la persona', () => {
    const job = {
      id: 'x', templateName: 'gracias', language: 'es', createdBy: 'luis', createdAt: 5, estado: 'procesando',
      destinatarios: ['573001112233', '573004445566', '573007778899'], solicitados: 4, duplicadosOmitidos: 0,
      enviados: ['573001112233'], fallidos: [{ numero: '573004445566', error: 'Meta rechazó el envío' }, { numero: '12', error: 'inválido' }], nextIndex: 2,
    } as BroadcastJob;
    assert.equal(envioParaContacto(job, '573001112233')?.resultado, 'enviado');
    assert.deepEqual(envioParaContacto(job, '573004445566'), { templateName: 'gracias', createdAt: 5, createdBy: 'luis', etiqueta: '', resultado: 'fallido', error: 'Meta rechazó el envío' });
    assert.equal(envioParaContacto(job, '573007778899')?.resultado, 'pendiente');
    assert.equal(envioParaContacto(job, '573000000000'), null);
  });
});
