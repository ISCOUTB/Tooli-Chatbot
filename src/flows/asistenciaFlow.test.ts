import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '../services/session';
import {
  type AsistenciaStore, actualizarEvento, crearEvento, getAsistentePorWhatsapp, getEvento, getEventoPorCodigo,
  importarAsistentes, listarAsistentes, registrarAsistente,
} from '../services/asistenciaService';
import { almacenEnMemoria } from '../services/asistenciaStoreMemoria';
import { crearAtencionAsistencia } from './asistenciaFlow';
import { CONSENTIMIENTO_NEGADO, EVENTO_NO_DISPONIBLE, PEDIR_NOMBRE, textoQr } from './asistenciaView';

const ANA = '573001234567';

/** El bot de verdad, con el almacén en memoria y los mensajes salientes a la vista. */
async function escenario() {
  const store: AsistenciaStore = almacenEnMemoria();
  const sesiones = new Map<string, Session>();
  const enviados: string[] = [];
  const metricas: string[] = [];
  const evento = await crearEvento({ nombre: 'Feria de posgrados', sector: 'posgrado' }, 'manuel', store);
  const atender = crearAtencionAsistencia({
    enviarTexto: async (_to, text) => { enviados.push(text); },
    enviarBotones: async msg => { enviados.push(`[botones] ${msg.description}`); },
    leerSesion: async from => sesiones.get(from) ?? null,
    guardarSesion: async (from, session) => { sesiones.set(from, session); },
    borrarSesion: async from => { sesiones.delete(from); },
    getEvento: id => getEvento(id, store),
    getEventoPorCodigo: codigo => getEventoPorCodigo(codigo, store),
    getAsistentePorWhatsapp: (id, whatsapp) => getAsistentePorWhatsapp(id, whatsapp, store),
    registrarAsistente: (id, datos, opciones) => registrarAsistente(id, datos, opciones, store),
    track: async nombre => { metricas.push(nombre); },
  });
  /** Envía un mensaje y devuelve lo que el bot respondió a ese mensaje. */
  const decir = async (texto: string, perfil = '') => {
    const antes = enviados.length;
    const atendido = await atender(ANA, texto, perfil);
    return { atendido, respuestas: enviados.slice(antes) };
  };
  const lista = () => listarAsistentes(evento.id, store);
  return { store, evento, sesiones, metricas, decir, lista };
}

test('un mensaje cualquiera no es de asistencia y sigue al bot', async () => {
  const { decir, lista } = await escenario();
  for (const texto of ['hola', 'menu', '1', 'quiero información sobre asistencia médica']) {
    assert.deepEqual(await decir(texto), { atendido: false, respuestas: [] }, texto);
  }
  assert.deepEqual(await lista(), []);
});

test('escanear el QR registra a la persona al autorizar y luego completa sus datos', async () => {
  const { evento, sesiones, metricas, decir, lista } = await escenario();

  const inicio = await decir(textoQr(evento.codigo), 'Anita 🌸');
  assert.equal(inicio.atendido, true);
  assert.match(inicio.respuestas[0], /^\[botones\] Vas a registrar tu asistencia a \*Feria de posgrados\*[\s\S]*Ley 1581/);
  assert.deepEqual(await lista(), [], 'sin autorización todavía no se guarda nada');

  const autoriza = await decir('si', 'Anita 🌸');
  assert.deepEqual(autoriza.respuestas, [PEDIR_NOMBRE]);
  const [provisional] = await lista();
  assert.deepEqual(
    { whatsapp: provisional.whatsapp, nombre: provisional.nombre, origen: provisional.origen, consentimiento: provisional.consentimiento },
    { whatsapp: ANA, nombre: 'Anita 🌸', origen: 'qr', consentimiento: true },
    'queda en la lista enseguida, con el nombre del perfil mientras escribe el suyo',
  );

  assert.match((await decir('x')).respuestas[0], /nombre completo/);
  assert.match((await decir('Ana María Pérez')).respuestas[0], /Gracias, Ana[\s\S]*correo/);
  assert.match((await decir('ana arroba utb')).respuestas[0], /no parece válido/);
  const fin = await decir('Ana@UTB.edu.co');
  assert.match(fin.respuestas[0], /¡Listo, Ana! Tu asistencia a \*Feria de posgrados\* quedó registrada/);

  const [final] = await lista();
  assert.equal((await lista()).length, 1);
  assert.deepEqual(
    { nombre: final.nombre, correo: final.correo, whatsapp: final.whatsapp, origen: final.origen },
    { nombre: 'Ana María Pérez', correo: 'ana@utb.edu.co', whatsapp: ANA, origen: 'qr' },
  );
  assert.equal(sesiones.size, 0, 'al terminar la conversación vuelve al bot');
  assert.deepEqual(metricas, ['asistencia_registrada']);
  assert.deepEqual(await decir('hola'), { atendido: false, respuestas: [] });
});

test('quien no autoriza no queda en la lista', async () => {
  const { evento, sesiones, metricas, decir, lista } = await escenario();
  await decir(textoQr(evento.codigo));
  assert.match((await decir('tal vez')).respuestas[0], /^\[botones\]/, 'una respuesta que no es sí ni no repite la pregunta');
  assert.deepEqual((await decir('no')).respuestas, [CONSENTIMIENTO_NEGADO]);
  assert.deepEqual(await lista(), []);
  assert.equal(sesiones.size, 0);
  assert.deepEqual(metricas, ['asistencia_consentimiento_no']);
});

test('el correo se puede omitir', async () => {
  const { evento, decir, lista } = await escenario();
  await decir(textoQr(evento.codigo));
  await decir('Sí, autorizo');
  await decir('Luis Castro');
  assert.match((await decir('omitir')).respuestas[0], /¡Listo, Luis!/);
  assert.equal((await lista())[0].correo, '');
});

test('"menu" a mitad del registro lo abandona sin perder la asistencia', async () => {
  const { evento, sesiones, decir, lista } = await escenario();
  await decir(textoQr(evento.codigo));
  await decir('si');
  assert.deepEqual(await decir('menu'), { atendido: false, respuestas: [] }, 'el menú lo atiende el bot');
  assert.equal(sesiones.size, 0);
  assert.equal((await lista()).length, 1, 'ya había autorizado: sigue contando como asistente');
});

test('a quien ya venía en la lista importada no se le vuelve a pedir lo que ya se sabe', async () => {
  const { store, evento, decir, lista } = await escenario();
  await importarAsistentes(evento.id, [
    { nombre: 'Ana María Pérez', whatsapp: ANA, correo: 'ana@utb.edu.co', documento: '', programa: 'Maestría en Ingeniería' },
  ], false, store);
  await decir(textoQr(evento.codigo), 'Anita 🌸');
  const fin = await decir('si', 'Anita 🌸');
  assert.match(fin.respuestas[0], /¡Listo, Ana!/);
  const [persona] = await lista();
  assert.equal((await lista()).length, 1);
  assert.equal(persona.nombre, 'Ana María Pérez', 'el nombre del perfil no pisa el de la lista');
  assert.equal(persona.origen, 'qr');
  assert.equal(persona.consentimiento, true);
});

test('volver a escanear avisa que ya estaba registrada', async () => {
  const { evento, decir, lista } = await escenario();
  await decir(textoQr(evento.codigo));
  await decir('si');
  await decir('Ana María Pérez');
  await decir('omitir');
  assert.match((await decir(textoQr(evento.codigo))).respuestas[0], /Ya estabas en la lista/);
  assert.equal((await lista()).length, 1);
});

test('un código que no existe o un evento cerrado no registran a nadie', async () => {
  const { store, evento, sesiones, decir, lista } = await escenario();
  assert.deepEqual((await decir('Registrar mi asistencia: ZZZ999')).respuestas, [EVENTO_NO_DISPONIBLE]);

  // El evento cierra justo después de que la persona escaneó.
  await decir(textoQr(evento.codigo));
  await actualizarEvento(evento.id, { estado: 'cerrado' }, store);
  assert.deepEqual((await decir('si')).respuestas, [EVENTO_NO_DISPONIBLE]);
  assert.deepEqual(await lista(), []);
  assert.equal(sesiones.size, 0);

  assert.deepEqual((await decir(textoQr(evento.codigo))).respuestas, [EVENTO_NO_DISPONIBLE]);
});
