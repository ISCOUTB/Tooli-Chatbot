import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ResumenLimiteError, ResumenNoDisponibleError, resumirConversacionBot, transcripcion, type MensajeBot } from './resumenBot';

const MENSAJES: MensajeBot[] = [
  { ts: 3, direction: 'in', text: 'Quiero hablar con un asesor' },
  { ts: 1, direction: 'in', text: 'Hola, soy egresada de Sistemas' },
  { ts: 2, direction: 'out', text: 'Te recomiendo la  Maestría en Ingeniería' },
];

function almacen() {
  const datos = new Map<string, string>();
  return { datos, get: async (k: string) => datos.get(k) ?? null, set: async (k: string, v: string) => { datos.set(k, v); } };
}

describe('resumen de la conversación con el bot', () => {
  it('arma el guion en orden y con quién dijo qué', () => {
    assert.equal(transcripcion(MENSAJES), [
      'Persona: Hola, soy egresada de Sistemas',
      'Bot: Te recomiendo la Maestría en Ingeniería',
      'Persona: Quiero hablar con un asesor',
    ].join('\n'));
  });

  it('si el historial no cabe, conserva lo más reciente', () => {
    const largos = Array.from({ length: 80 }, (_x, i) => ({ ts: i, direction: 'in' as const, text: `mensaje ${i} ${'x'.repeat(150)}` }));
    const guion = transcripcion(largos);
    assert.ok(guion.length <= 6000);
    assert.match(guion, /mensaje 79/);
    assert.doesNotMatch(guion, /mensaje 0 /);
  });

  it('pide el resumen una vez y lo reutiliza mientras no haya mensajes nuevos', async () => {
    const guardado = almacen();
    let llamadas = 0;
    let recibido = '';
    const completar = async (_s: string, usuario: string) => { llamadas++; recibido = usuario; return '• Egresada de Sistemas\n• Quiere un asesor'; };
    const primero = await resumirConversacionBot('573001234567', MENSAJES, { completar, almacen: guardado });
    assert.equal(primero?.texto, '• Egresada de Sistemas\n• Quiere un asesor');
    assert.equal(primero?.hastaTs, 3);
    assert.match(recibido, /^Persona: Hola/);
    await resumirConversacionBot('573001234567', MENSAJES, { completar, almacen: guardado });
    assert.equal(llamadas, 1, 'sin mensajes nuevos no se vuelve a pedir');
    await resumirConversacionBot('573001234567', [...MENSAJES, { ts: 4, direction: 'in', text: '¿Hay becas?' }], { completar, almacen: guardado });
    assert.equal(llamadas, 2, 'con un mensaje nuevo sí');
    await resumirConversacionBot('573001234567', [...MENSAJES, { ts: 4, direction: 'in', text: '¿Hay becas?' }], { completar, almacen: guardado, forzar: true });
    assert.equal(llamadas, 3, 'forzar lo vuelve a pedir');
  });

  it('sin mensajes de la persona no hay nada que resumir', async () => {
    const completar = async () => { throw new Error('no debía llamarse'); };
    assert.equal(await resumirConversacionBot('573001234567', [], { completar, almacen: almacen() }), null);
    assert.equal(await resumirConversacionBot('573001234567', [{ ts: 1, direction: 'out', text: 'Hola' }], { completar, almacen: almacen() }), null);
  });

  it('el límite solo se consulta cuando hay que pedirle el resumen a la IA', async () => {
    const guardado = almacen();
    let consultas = 0;
    let permitido = true;
    const permitir = async () => { consultas++; return permitido; };
    const completar = async () => '• Algo';
    await resumirConversacionBot('573001234567', MENSAJES, { completar, almacen: guardado, permitir });
    await resumirConversacionBot('573001234567', MENSAJES, { completar, almacen: guardado, permitir });
    assert.equal(consultas, 1, 'leer el resumen guardado no gasta el límite');
    permitido = false;
    await assert.rejects(resumirConversacionBot('573001234567', MENSAJES, { completar, almacen: guardado, permitir, forzar: true }), ResumenLimiteError);
  });

  it('una respuesta vacía de la IA se informa', async () => {
    await assert.rejects(
      resumirConversacionBot('573001234567', MENSAJES, { completar: async () => '  ', almacen: almacen() }),
      ResumenNoDisponibleError,
    );
  });
});
