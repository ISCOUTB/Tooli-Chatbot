import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOTONES_CANAL, avisoContacto, camposContacto, contactoAnterior, contactoListo, correoEnTexto, describirContacto, filasFranja,
  franjasDelHorario, lineaContacto, parseCanal, parseDia, parseFranja, parseNumero, parseRepetir, respondeAlPaso, telefonoColombiano,
} from './contactoView';

const TEL = '573001112233';

describe('botones del canal', () => {
  it('son exactamente tres (el máximo de WhatsApp) y caben en 20 caracteres', () => {
    assert.equal(BOTONES_CANAL.length, 3);
    for (const b of BOTONES_CANAL) assert.ok([...b.displayText].length <= 20, b.displayText);
  });

  it('la cita solo aparece con la agenda encendida', () => {
    assert.equal(filasFranja(false).some((f) => /cita/i.test(f.title)), false);
    assert.equal(filasFranja(true).at(-1)?.id, 'contacto_franja_cita');
    for (const f of filasFranja(true)) assert.ok([...f.title].length <= 24, f.title);
  });
});

describe('parseCanal: respuestas escritas', () => {
  const casos: Array<[string, ReturnType<typeof parseCanal>]> = [
    ['Llámenme', { canal: 'llamada' }],
    ['LLAMENME!!', { canal: 'llamada' }],
    ['¿pueden marcarme?', { canal: 'llamada' }],
    ['al celular', { canal: 'llamada' }],
    ['llámenme pero no hoy', { canal: 'llamada' }],
    ['mejor una llamada en la tarde', { canal: 'llamada', franja: 'tarde' }],
    ['llámame mañana en la noche', { canal: 'llamada', franja: 'noche', dia: 'manana' }],
    ['llámenme mañana', { canal: 'llamada', dia: 'manana' }],
    ['me pueden llamar pasado mañana en la tarde', { canal: 'llamada', franja: 'tarde', dia: 'pasado' }],
    // «Me llamo…», «me llamaron» o no poder contestar no son pedir una llamada.
    ['me llamo Laura, por acá está bien', { canal: 'chat' }],
    ['no puedo contestar llamadas', { canal: 'chat' }],
    ['no puedo hablar ahora', { canal: 'chat' }],
    ['no puedo contestar llamadas, mejor por correo', { canal: 'correo' }],
    ['que me llame un asesor', { canal: 'llamada' }],
    ['¿me pueden llamar?', { canal: 'llamada' }],
    ['llámenme a este mismo número', { canal: 'llamada', mismoNumero: true }],
    ['al 300 123 4567', { canal: 'llamada', telefono: '3001234567' }],
    ['+57 300 123 4567', { canal: 'llamada', telefono: '3001234567' }],
    ['573001234567', { canal: 'llamada', telefono: '3001234567' }],
    ['el número es (300) 123-4567', { canal: 'llamada', telefono: '3001234567' }],
    ['teléfono fijo 605 123 4567', { canal: 'llamada', telefono: '6051234567' }],
    ['300 111 2233 o 301 444 5566', { canal: 'llamada', telefono: '3001112233' }],
    ['no me llamen, escríbanme', { canal: 'chat' }],
    ['por acá', { canal: 'chat' }],
    ['aquí mismo', { canal: 'chat' }],
    ['por whatsapp', { canal: 'chat' }],
    ['mándenme un mensaje', { canal: 'chat' }],
    ['no tengo correo', { canal: 'chat' }],
    ['mejor por chat', { canal: 'chat' }],
    ['x correo', { canal: 'correo' }],
    ['por mail', { canal: 'correo' }],
    ['escríbanme al gmail', { canal: 'correo' }],
    ['a mi correo ana@x.com', { canal: 'correo', correo: 'ana@x.com' }],
    ['correo: ANA@GMAIL.COM', { canal: 'correo', correo: 'ana@gmail.com' }],
    ['mi correo es ana@gmail.com y mi cel 3001234567', { canal: 'correo', correo: 'ana@gmail.com' }],
    ['1', { canal: 'chat' }],
    ['2', { canal: 'llamada' }],
    ['3', { canal: 'correo' }],
  ];
  for (const [texto, esperado] of casos) {
    it(JSON.stringify(texto), () => assert.deepEqual(parseCanal(texto), esperado));
  }

  it('lo que no dice un canal no se adivina', () => {
    for (const t of ['contáctenme', 'sí', 'ok', 'buenas tardes', 'cuando sea', '😀', '', '__image__', 'ana@x', '3001234',
      'mi cédula es 1045678901', '1234567890', 'me pueden contactar', 'espera', 'me llamo Laura', 'me llamaron ayer',
      'me llamó la atención la maestría']) {
      assert.equal(parseCanal(t), null, t);
    }
  });
});

describe('telefonoColombiano y correoEnTexto', () => {
  it('celulares y fijos de 10 dígitos, con o sin +57; nada más', () => {
    assert.equal(telefonoColombiano('300.123.4567'), '3001234567');
    assert.equal(telefonoColombiano('+57 (601) 555 1234'), '6015551234');
    assert.equal(telefonoColombiano('30012345678'), null);
    assert.equal(telefonoColombiano('6091234567'), null);
    assert.equal(telefonoColombiano('2001234567'), null);
  });

  it('el correo sale de la frase, sin el punto final', () => {
    assert.equal(correoEnTexto('Es ANA.Perez@Correo.com.'), 'ana.perez@correo.com');
    assert.equal(correoEnTexto('<ana@x.co>'), 'ana@x.co');
    assert.equal(correoEnTexto('ana@@x.com'), null);
  });
});

describe('parseFranja', () => {
  const casos: Array<[string, ReturnType<typeof parseFranja>]> = [
    ['en la tarde', 'tarde'], ['tardecita', 'tarde'], ['más tarde', 'tarde'], ['en la mañana', 'manana'], ['por la mañana', 'manana'],
    ['mañana por la mañana', 'manana'], ['mañana temprano', 'manana'],
    // «Mañana» a secas es el día, no la franja; «no puedo hablar ahora» no es «a cualquier hora».
    ['mañana', null], ['llámenme mañana', null], ['no puedo hablar ahora', null], ['ahora no puedo', null], ['ahora mismo', 'cualquiera'],
    ['mañana en la tarde', 'tarde'], ['temprano', 'manana'], ['noche', 'noche'], ['a las 3 pm', 'tarde'],
    ['10am', 'manana'], ['9:30 a.m.', 'manana'], ['7 pm', 'noche'], ['12 pm', 'tarde'], ['al medio día', 'tarde'],
    ['después del trabajo', 'noche'], ['cuando sea', 'cualquiera'], ['me da igual', 'cualquiera'],
    ['lo antes posible', 'cualquiera'], ['agendar', 'cita'], ['quiero una cita', 'cita'],
    ['1', 'manana'], ['4', 'cualquiera'], ['contacto_franja_noche', 'noche'],
    // Saludos y días no son una franja.
    ['buenas tardes', null], ['Buenas noches!', null], ['buenas noches, en la tarde', 'tarde'], ['pasado mañana', null],
    ['contacto_franja_inventada', null], ['__image__', null], ['ya', null],
  ];
  for (const [texto, esperado] of casos) {
    it(JSON.stringify(texto), () => assert.equal(parseFranja(texto), esperado));
  }
});

describe('parseNumero y parseRepetir', () => {
  it('a este, a otro o el número escrito', () => {
    assert.deepEqual(parseNumero('a este'), { este: true });
    assert.deepEqual(parseNumero('sí'), { este: true });
    assert.deepEqual(parseNumero('al whatsapp'), { este: true });
    assert.deepEqual(parseNumero('no, a este'), { este: true });
    assert.deepEqual(parseNumero('no, a otro'), { otro: true });
    assert.deepEqual(parseNumero('no'), { otro: true });
    assert.deepEqual(parseNumero('3001234567'), { telefono: '3001234567' });
    assert.equal(parseNumero('el de mi casa'), null);
  });

  it('"claro que no" no es un sí', () => {
    assert.equal(parseRepetir('claro que no'), 'otro');
    assert.equal(parseRepetir('sí'), 'igual');
    assert.equal(parseRepetir('dale'), 'igual');
    assert.equal(parseRepetir('mejor de otra forma'), 'otro');
    assert.equal(parseRepetir('contacto_igual'), 'igual');
    assert.equal(parseRepetir('qué'), null);
  });

  it('en los pasos del canal, lo que es del paso no va a la IA', () => {
    assert.equal(respondeAlPaso('reco_contacto', '¿me pueden llamar?'), true);
    assert.equal(respondeAlPaso('reco_contacto', '¿cuánto cuesta la maestría?'), false);
    assert.equal(respondeAlPaso('reco_llamada_numero', '¿al 3001234567?'), true);
    assert.equal(respondeAlPaso('reco_llamada_franja', '¿en la tarde puede ser?'), true);
    assert.equal(respondeAlPaso('reco_llamada_franja', 'buenas tardes'), false);
  });
});

describe('lo que leen el asesor y la persona', () => {
  it('la línea del asesor trae el número con +57 y la franja', () => {
    assert.equal(lineaContacto({ canal: 'llamada', telefono: '3015551234', franja: 'tarde' }, TEL),
      '📞 Pidió llamada al +57 301 555 1234 en la tarde');
    assert.equal(lineaContacto({ canal: 'llamada', telefono: 'este', franja: 'noche' }, TEL),
      '📞 Pidió llamada al +573001112233 (este WhatsApp) en la noche');
    assert.equal(lineaContacto({ canal: 'correo', correo: 'ana@x.com' }, TEL), '📧 Pidió que le escriban al correo ana@x.com');
  });

  it('a quien pidió llamada en la noche no se le promete "en breve"', () => {
    const aviso = avisoContacto({ canal: 'llamada', telefono: 'este', franja: 'noche' }, null);
    assert.equal(aviso, '📞 Un asesor de Posgrados te llamará a este número en la noche.');
    assert.equal(avisoContacto({ canal: 'chat' }, null), 'Un asesor de Posgrados te responderá en breve.');
  });

  it('la vez pasada: el correo guardado cuenta; la cita no se repite; sin teléfono no hay "este número"', () => {
    assert.deepEqual(contactoAnterior({ correo: 'ana@x.com' }, TEL), { canal: 'correo', correo: 'ana@x.com' });
    assert.deepEqual(contactoAnterior({ contactoCanal: 'llamada', contactoTel: 'este', contactoFranja: 'cita' }, TEL),
      { canal: 'llamada', telefono: 'este' });
    assert.equal(contactoAnterior({ contactoCanal: 'llamada', contactoTel: 'este' }, 'CO.ABC123'), null);
    // Una llamada a medio elegir (sin número) no es "la vez pasada".
    assert.equal(contactoAnterior({ contactoCanal: 'llamada', contactoTel: '' }, TEL), null);
    assert.equal(describirContacto({ canal: 'llamada', telefono: '3015551234', franja: 'cualquiera' }),
      '📞 llamada a *301 555 1234* a cualquier hora');
  });

  it('la llamada no está lista sin número y franja', () => {
    assert.equal(contactoListo({ contactoCanal: 'llamada', contactoTel: 'este' }), null);
    assert.deepEqual(contactoListo({ contactoCanal: 'llamada', contactoTel: 'este', contactoFranja: 'tarde' }),
      { canal: 'llamada', telefono: 'este', franja: 'tarde' });
    assert.equal(contactoListo({ contactoCanal: 'correo' }), null);
  });
});

describe('el día y el horario del equipo', () => {
  it('«mañana» a secas es el día; «la mañana» es la franja', () => {
    assert.equal(parseDia('llámenme mañana'), 'manana');
    assert.equal(parseDia('mañana en la tarde'), 'manana');
    assert.equal(parseDia('pasado mañana'), 'pasado');
    assert.equal(parseDia('en la mañana'), null);
    assert.equal(parseDia('por las mañanas'), null);
    assert.equal(parseDia('en la tarde'), null);
  });

  it('solo se ofrecen las franjas del horario del equipo (8 a 18 por defecto: sin noche)', () => {
    assert.deepEqual(franjasDelHorario({ desde: '08:00', hasta: '18:00' }), ['manana', 'tarde', 'cualquiera']);
    assert.deepEqual(franjasDelHorario({ desde: '08:00', hasta: '20:00' }), ['manana', 'tarde', 'noche', 'cualquiera']);
    assert.deepEqual(franjasDelHorario({ desde: '13:00', hasta: '18:00' }), ['tarde', 'cualquiera']);
    const filas = filasFranja(false, ['manana', 'tarde', 'cualquiera']).map((f) => f.id);
    assert.deepEqual(filas, ['contacto_franja_manana', 'contacto_franja_tarde', 'contacto_franja_cualquiera']);
  });

  it('el día pedido llega al asesor y a la persona', () => {
    const c = { canal: 'llamada' as const, telefono: '3015551234', franja: 'tarde' as const, dia: 'manana' as const };
    assert.equal(lineaContacto(c, TEL), '📞 Pidió llamada al +57 301 555 1234 mañana (día) en la tarde');
    assert.match(avisoContacto(c, null), /te llamará a \*301 555 1234\* mañana en la tarde/);
    assert.match(describirContacto(c), /mañana en la tarde/);
  });

  it('cambiar de canal limpia el número, la franja y el día de la llamada', () => {
    assert.deepEqual(camposContacto({ canal: 'chat' }), {
      contactoCanal: 'chat', contactoTel: '', contactoFranja: '', contactoDia: '', pideLlamada: '',
    });
  });
});
