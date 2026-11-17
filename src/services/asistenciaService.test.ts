import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALFABETO_CODIGO, AsistenciaError,
  actualizarEvento, crearEvento, eliminarAsistente, eliminarEvento, generarCodigo,
  getAsistentePorWhatsapp, getEventoPorCodigo, importarAsistentes, listarAsistentes, listarEventos,
  registrarAsistente,
} from './asistenciaService';
import { almacenEnMemoria } from './asistenciaStoreMemoria';

const almacen = almacenEnMemoria;

const EVENTO = { nombre: 'Feria de posgrados', sector: 'posgrado', fecha: '2026-11-20', lugar: 'Campus Tecnológico' };

test('el código mezcla letras y números y evita caracteres que se confunden', () => {
  for (let i = 0; i < 200; i++) {
    const codigo = generarCodigo();
    assert.equal(codigo.length, 6);
    assert.ok([...codigo].every(c => ALFABETO_CODIGO.includes(c)));
    assert.match(codigo, /\d/);
    assert.match(codigo, /[A-Z]/);
  }
  assert.doesNotMatch(ALFABETO_CODIGO, /[01ILO]/);
});

test('crea el evento abierto, lo encuentra por su código y valida los datos', async () => {
  const store = almacen();
  const evento = await crearEvento(EVENTO, 'manuel', store);
  assert.equal(evento.estado, 'abierto');
  assert.equal(evento.creadoPor, 'manuel');
  assert.equal((await getEventoPorCodigo(evento.codigo.toLowerCase(), store))?.id, evento.id);
  assert.equal(await getEventoPorCodigo('NOPE00', store), null);

  await assert.rejects(crearEvento({ ...EVENTO, nombre: 'x' }, 'manuel', store), /al menos 3 caracteres/);
  await assert.rejects(crearEvento({ ...EVENTO, sector: 'ventas' }, 'manuel', store), /sector/);
  await assert.rejects(crearEvento({ ...EVENTO, fecha: '20/11/2026' }, 'manuel', store), /fecha/);
});

test('lista los eventos del más reciente al más antiguo con su conteo', async () => {
  const store = almacen();
  const primero = await crearEvento(EVENTO, 'manuel', store);
  await new Promise(r => setTimeout(r, 3));
  const segundo = await crearEvento({ ...EVENTO, nombre: 'Open house pregrado', sector: 'pregrado' }, 'angel', store);
  await registrarAsistente(primero.id, { nombre: 'Ana', whatsapp: '3001234567' }, { origen: 'manual', consentimiento: false }, store);
  const lista = await listarEventos(store);
  assert.deepEqual(lista.map(e => [e.id, e.asistentes]), [[segundo.id, 0], [primero.id, 1]]);
});

test('una persona es una sola fila aunque llegue por el Excel y por el QR', async () => {
  const store = almacen();
  const evento = await crearEvento(EVENTO, 'manuel', store);
  // 1. Viene en la lista importada, solo con correo.
  await importarAsistentes(evento.id, [
    { nombre: 'Ana María Pérez', whatsapp: '', correo: 'ana@utb.edu.co', documento: '', programa: 'Maestría en Ingeniería' },
  ], false, store);
  // 2. Escanea el QR: llega su WhatsApp, todavía sin correo.
  const qr = await registrarAsistente(evento.id, { whatsapp: '573001234567' }, { origen: 'qr', consentimiento: true, exigirAbierto: true }, store);
  assert.equal(qr.nuevo, true, 'aún no se sabe que es la misma persona');
  assert.equal((await listarAsistentes(evento.id, store)).length, 2);
  // 3. Da su correo: las dos filas se juntan en una.
  const completo = await registrarAsistente(evento.id, { whatsapp: '573001234567', correo: 'Ana@UTB.edu.co' }, { origen: 'qr', consentimiento: true }, store);
  assert.equal(completo.nuevo, false);
  const lista = await listarAsistentes(evento.id, store);
  assert.equal(lista.length, 1);
  assert.deepEqual(
    { ...lista[0], registradoEn: 0 },
    {
      clave: 'w:573001234567', nombre: 'Ana María Pérez', whatsapp: '573001234567', correo: 'ana@utb.edu.co',
      documento: '', programa: 'Maestría en Ingeniería', origen: 'qr', consentimiento: true, registradoEn: 0,
    },
  );
});

test('un dato vacío no borra uno guardado ni se retira el consentimiento', async () => {
  const store = almacen();
  const evento = await crearEvento(EVENTO, 'manuel', store);
  await registrarAsistente(evento.id, { whatsapp: '573001234567', nombre: 'Luis Díaz' }, { origen: 'qr', consentimiento: true }, store);
  await importarAsistentes(evento.id, [{ nombre: '', whatsapp: '573001234567', correo: '', documento: '1047123456', programa: '' }], false, store);
  const a = await getAsistentePorWhatsapp(evento.id, '573001234567', store);
  assert.equal(a?.nombre, 'Luis Díaz');
  assert.equal(a?.documento, '1047123456');
  assert.equal(a?.consentimiento, true);
  assert.equal(a?.origen, 'qr', 'quien escaneó el QR estuvo presente');
});

test('el número que entrega WhatsApp se guarda tal cual, sin anteponer 57', async () => {
  const store = almacen();
  const evento = await crearEvento(EVENTO, 'manuel', store);
  // Islandia: +354 y siete dígitos da diez dígitos que empiezan por 3.
  const { asistente } = await registrarAsistente(evento.id, { whatsapp: '3546112345' }, { origen: 'qr', consentimiento: true }, store);
  assert.equal(asistente.whatsapp, '3546112345');
  // El mismo número escrito a mano en el panel sí se toma como celular colombiano.
  const manual = await registrarAsistente(evento.id, { nombre: 'Otro', whatsapp: '3009998877' }, { origen: 'manual', consentimiento: false }, store);
  assert.equal(manual.asistente.whatsapp, '573009998877');
});

test('con el registro cerrado el QR no anota a nadie, pero el asesor sí', async () => {
  const store = almacen();
  const evento = await crearEvento(EVENTO, 'manuel', store);
  await actualizarEvento(evento.id, { estado: 'cerrado' }, store);
  await assert.rejects(
    registrarAsistente(evento.id, { whatsapp: '573001234567' }, { origen: 'qr', consentimiento: true, exigirAbierto: true }, store),
    (err: unknown) => err instanceof AsistenciaError && err.code === 'evento_cerrado',
  );
  const manual = await registrarAsistente(evento.id, { nombre: 'Llegó tarde' }, { origen: 'manual', consentimiento: false }, store);
  assert.equal(manual.nuevo, true);
  await assert.rejects(
    registrarAsistente(evento.id, {}, { origen: 'manual', consentimiento: false }, store),
    (err: unknown) => err instanceof AsistenciaError && err.code === 'invalid_data',
  );
});

test('importar cuenta nuevos y actualizados, y repetir el archivo no duplica', async () => {
  const store = almacen();
  const evento = await crearEvento(EVENTO, 'manuel', store);
  const personas = [
    { nombre: 'Ana', whatsapp: '573001234567', correo: '', documento: '', programa: '' },
    { nombre: 'Luis', whatsapp: '', correo: 'luis@x.co', documento: '', programa: '' },
    { nombre: 'Solo Nombre', whatsapp: '', correo: '', documento: '', programa: '' },
  ];
  assert.deepEqual(await importarAsistentes(evento.id, personas, true, store), { nuevos: 3, actualizados: 0, sinCupo: 0 });
  assert.deepEqual(await importarAsistentes(evento.id, personas, true, store), { nuevos: 0, actualizados: 3, sinCupo: 0 });
  assert.equal((await listarAsistentes(evento.id, store)).length, 3);
});

test('quitar a una persona y eliminar el evento liberan sus datos y el código', async () => {
  const store = almacen();
  const evento = await crearEvento(EVENTO, 'manuel', store);
  const { asistente } = await registrarAsistente(evento.id, { nombre: 'Ana', correo: 'ana@x.co' }, { origen: 'manual', consentimiento: false }, store);
  assert.equal(await eliminarAsistente(evento.id, 'clave-rara', store), false);
  assert.equal(await eliminarAsistente(evento.id, asistente.clave, store), true);
  assert.equal(await eliminarAsistente(evento.id, asistente.clave, store), false);

  assert.equal(await eliminarEvento(evento.id, store), true);
  assert.equal(await getEventoPorCodigo(evento.codigo, store), null);
  assert.deepEqual(await listarEventos(store), []);
  assert.equal(await eliminarEvento(evento.id, store), false);
});
