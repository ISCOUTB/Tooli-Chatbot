import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  enLotes, fechaEvento, filtrarAsistentes, firmaLista, nombreArchivoCsv, parseNumerosPegados,
  resumenAsistentes, telefonosContactables,
} from './asistencia.js';

const persona = (extra) => ({
  clave: 'x', nombre: '', whatsapp: '', correo: '', documento: '', programa: '', origen: 'qr', consentimiento: false, registradoEn: 1, ...extra,
});

const LISTA = [
  persona({ clave: 'w:573001234567', nombre: 'María José Restrepo', whatsapp: '573001234567', correo: 'mj@gmail.com', consentimiento: true }),
  persona({ clave: 'w:573009876543', nombre: 'Carlos Pérez', whatsapp: '573009876543', origen: 'importado' }),
  persona({ clave: 'c:ana@utb.edu.co', nombre: 'Ana Núñez', correo: 'ana@utb.edu.co', origen: 'importado', consentimiento: true }),
  persona({ clave: 'w:CO.abc123', nombre: 'Sin Teléfono', whatsapp: 'CO.abc123', consentimiento: true }),
];

test('solo se le escribe a quien autorizó y tiene un número', () => {
  assert.deepEqual(telefonosContactables(LISTA), ['573001234567']);
  assert.deepEqual(resumenAsistentes(LISTA), { total: 4, conWhatsapp: 3, porQr: 2, autorizaron: 3, contactables: 1 });
  assert.deepEqual(resumenAsistentes(undefined), { total: 0, conWhatsapp: 0, porQr: 0, autorizaron: 0, contactables: 0 });
});

test('un número repetido en la lista se cuenta una sola vez', () => {
  const repetida = [LISTA[0], { ...LISTA[0], clave: 'otra' }];
  assert.deepEqual(telefonosContactables(repetida), ['573001234567']);
});

test('la búsqueda ignora tildes y encuentra por celular', () => {
  assert.deepEqual(filtrarAsistentes(LISTA, 'nunez').map(a => a.nombre), ['Ana Núñez']);
  assert.deepEqual(filtrarAsistentes(LISTA, 'MARIA').map(a => a.nombre), ['María José Restrepo']);
  assert.deepEqual(filtrarAsistentes(LISTA, '987 65').map(a => a.nombre), ['Carlos Pérez']);
  assert.equal(filtrarAsistentes(LISTA, '  ').length, 4);
  assert.equal(filtrarAsistentes(LISTA, 'zzz').length, 0);
});

test('la fecha del evento no se corre un día por la zona horaria', () => {
  assert.match(fechaEvento('2026-11-20'), /^20 .*2026$/);
  assert.equal(fechaEvento(''), '');
  assert.equal(fechaEvento('20/11/2026'), '');
});

test('la firma cambia cuando cambia la lista y no por el orden de consulta', () => {
  assert.equal(firmaLista(LISTA), firmaLista(LISTA.map(a => ({ ...a }))));
  assert.notEqual(firmaLista(LISTA), firmaLista([...LISTA, persona({ clave: 'nueva' })]));
  assert.notEqual(firmaLista(LISTA), firmaLista(LISTA.map((a, i) => (i ? a : { ...a, nombre: 'Otro' }))));
});

test('lee números pegados, completa el 57 y separa inválidos y repetidos', () => {
  assert.deepEqual(
    parseNumerosPegados('3001234567\n+57 300 123 4567, 573009876543; hola\n12345\n\n+1 (415) 555-2671'),
    { validos: ['573001234567', '573009876543', '14155552671'], invalidos: 2, repetidos: 1 },
  );
  assert.deepEqual(parseNumerosPegados(''), { validos: [], invalidos: 0, repetidos: 0 });
});

test('parte los destinatarios en envíos del tamaño que admite el servidor', () => {
  const lista = Array.from({ length: 450 }, (_x, i) => String(i));
  assert.deepEqual(enLotes(lista).map(l => l.length), [200, 200, 50]);
  assert.deepEqual(enLotes([]), []);
});

test('el archivo exportado lleva un nombre limpio', () => {
  assert.equal(nombreArchivoCsv('Feria de Posgrados — 2026 ¡UTB!'), 'asistencia-feria-de-posgrados-2026-utb.csv');
  assert.equal(nombreArchivoCsv('***'), 'asistencia-evento.csv');
});
