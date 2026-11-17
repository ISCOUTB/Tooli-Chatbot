import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  confirmacion, enlaceWhatsApp, parseCodigoAsistencia, parseNombre, quiereOmitir, textoQr,
} from './asistenciaView';

test('el mensaje del QR se reconoce aunque la persona lo retoque', () => {
  assert.equal(parseCodigoAsistencia(textoQr('K7M2QX')), 'K7M2QX');
  assert.equal(parseCodigoAsistencia('registrar mi asistencia:k7m2qx'), 'K7M2QX');
  assert.equal(parseCodigoAsistencia('  Asistencia - K7M2QX  '), 'K7M2QX');
  assert.equal(parseCodigoAsistencia('Hola! Registrar mi asistencia: K7M2QX'), 'K7M2QX');
});

test('una frase normal con la palabra asistencia no dispara el registro', () => {
  for (const texto of [
    'Quiero información sobre asistencia médica',
    'asistencia semana',
    'asistencia: semana',          // seis letras sin números: no es un código
    'asistencia: 123456',          // solo números: tampoco
    'asistencia: K7M2QXZ',         // largo distinto
    'Registrar mi asistencia: K7M2QX y otra cosa',
    'asistencia',
    '',
    'x'.repeat(200),
  ]) {
    assert.equal(parseCodigoAsistencia(texto), null, texto);
  }
});

test('el enlace del QR abre WhatsApp con el mensaje ya escrito', () => {
  assert.equal(
    enlaceWhatsApp('573001234567', 'K7M2QX'),
    'https://wa.me/573001234567?text=Registrar%20mi%20asistencia%3A%20K7M2QX',
  );
});

test('valida el nombre y reconoce a quien no quiere dar el correo', () => {
  assert.equal(parseNombre('  Ana   María Pérez '), 'Ana María Pérez');
  assert.equal(parseNombre('Li'), null);
  assert.equal(parseNombre('3001234567'), null);
  assert.equal(parseNombre('👍'), null);
  assert.equal(quiereOmitir('Omitir'), true);
  assert.equal(quiereOmitir('no tengo'), true);
  assert.equal(quiereOmitir('ana@utb.edu.co'), false);
  assert.match(confirmacion('Ana María Pérez', 'Feria'), /¡Listo, Ana!.*\*Feria\*/);
  assert.match(confirmacion('', 'Feria'), /¡Listo!/);
});
