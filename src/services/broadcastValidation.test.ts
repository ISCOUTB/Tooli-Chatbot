import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BroadcastValidationError, MAX_BROADCAST_RECIPIENTS,
  validarTemplateName, validarLanguage,
  normalizarTelefonoBroadcast, clasificarDestinatarios,
  clasificarDestinatariosConDatos, contarVariablesCuerpo, limpiarVariable, MAX_LARGO_VARIABLE,
  encabezadoMediaDe, urlDeMetaSegura, ranurasDePlantilla, valorParaRanura,
} from './broadcastValidation';

/**
 * Un broadcast mal validado no falla en el panel: falla contra la API de Meta,
 * número por número, cuando el admin ya apretó "enviar". Estas reglas puras
 * frenan el envío antes, sin necesidad de red.
 */
describe('validarTemplateName', () => {
  it('acepta un nombre de template real de Meta', () => {
    assert.equal(validarTemplateName('recordatorio_cita_2026'), 'recordatorio_cita_2026');
  });

  it('recorta espacios de los extremos', () => {
    assert.equal(validarTemplateName('  aviso  '), 'aviso');
  });

  it('rechaza mayúsculas, espacios internos, llaves y vacío', () => {
    assert.throws(() => validarTemplateName('Aviso_Cita'), BroadcastValidationError);
    assert.throws(() => validarTemplateName('aviso cita'), BroadcastValidationError);
    assert.throws(() => validarTemplateName('aviso{{1}}'), BroadcastValidationError);
    assert.throws(() => validarTemplateName(''), BroadcastValidationError);
  });
});

describe('validarLanguage', () => {
  it('acepta el formato Meta con guion bajo', () => {
    assert.equal(validarLanguage('es_CO'), 'es_CO');
  });

  it('normaliza el guion a guion bajo', () => {
    assert.equal(validarLanguage('es-CO'), 'es_CO');
  });

  it('rechaza códigos que Meta no aceptaría', () => {
    assert.throws(() => validarLanguage(''), BroadcastValidationError);
    assert.throws(() => validarLanguage('español'), BroadcastValidationError);
    assert.throws(() => validarLanguage('e'), BroadcastValidationError);
  });
});

describe('normalizarTelefonoBroadcast', () => {
  it('se queda solo con los dígitos', () => {
    assert.equal(normalizarTelefonoBroadcast('+57 (300) 123-4567'), '573001234567');
  });

  it('no se cae con entradas vacías o no-strings', () => {
    assert.equal(normalizarTelefonoBroadcast(''), '');
    assert.equal(normalizarTelefonoBroadcast(undefined), '');
    assert.equal(normalizarTelefonoBroadcast(null), '');
  });
});

describe('clasificarDestinatarios', () => {
  it('normaliza, valida y deduplica manteniendo el orden', () => {
    const res = clasificarDestinatarios(['+57 300 123 4567', '573001234567', '573009876543']);
    assert.deepEqual(res.validos, ['573001234567', '573009876543']);
    assert.deepEqual(res.invalidos, []);
    assert.equal(res.solicitados, 3);
    assert.equal(res.duplicadosOmitidos, 1);
  });

  it('no falla en bloque: reporta cada número inválido', () => {
    const res = clasificarDestinatarios(['573001234567', '123', '']);
    assert.deepEqual(res.validos, ['573001234567']);
    assert.equal(res.invalidos.length, 2);
    assert.match(res.invalidos[0].error, /10–15 dígitos/);
  });

  it('rechaza ceros iniciales y texto arbitrario con dígitos incrustados', () => {
    const res = clasificarDestinatarios(['0000000000', 'llamar-573001234567-ahora']);
    assert.equal(res.validos.length, 0);
    assert.equal(res.invalidos.length, 2);
  });

  it('rechaza lo que no es un arreglo y la lista vacía', () => {
    assert.throws(() => clasificarDestinatarios('573001234567'), BroadcastValidationError);
    assert.throws(() => clasificarDestinatarios([]), BroadcastValidationError);
  });

  it('el límite de lote falla en bloque', () => {
    const muchos = Array.from({ length: MAX_BROADCAST_RECIPIENTS + 1 }, (_, i) =>
      `57300${String(100000 + i)}`);
    assert.throws(() => clasificarDestinatarios(muchos), BroadcastValidationError);
  });

  it('acepta exactamente el límite de lote', () => {
    const justo = Array.from({ length: MAX_BROADCAST_RECIPIENTS }, (_, i) =>
      `57300${String(100000 + i)}`);
    const res = clasificarDestinatarios(justo);
    assert.equal(res.validos.length, MAX_BROADCAST_RECIPIENTS);
  });
});

describe('contarVariablesCuerpo', () => {
  const cuerpo = (text: string) => ({ type: 'BODY', text });

  it('cuenta las variables numeradas del cuerpo', () => {
    assert.equal(contarVariablesCuerpo([]), 0);
    assert.equal(contarVariablesCuerpo([cuerpo('Hola, te contamos de posgrados')]), 0);
    assert.equal(contarVariablesCuerpo([cuerpo('Hola {{1}}, como egresado de {{2}}…'), { type: 'FOOTER', text: 'UTB' }]), 2);
  });

  it('ignora los ejemplos que Meta guarda junto al cuerpo', () => {
    assert.equal(contarVariablesCuerpo([{ ...cuerpo('Hola {{1}}'), example: { body_text: [['{{x}}']] } }]), 1);
  });

  it('rechaza variables fuera del cuerpo y variables con nombre', () => {
    assert.throws(() => contarVariablesCuerpo([{ type: 'HEADER', format: 'TEXT', text: 'Hola {{1}}' }]), BroadcastValidationError);
    assert.throws(() => contarVariablesCuerpo([{ type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://x/{{1}}' }] }]), BroadcastValidationError);
    assert.throws(() => contarVariablesCuerpo([cuerpo('Hola {{nombre}}')]), BroadcastValidationError);
  });
});

describe('limpiarVariable', () => {
  it('deja el valor en una línea, sin espacios de sobra y con largo acotado', () => {
    assert.equal(limpiarVariable('  Laura\n\tGómez   Pérez '), 'Laura Gómez Pérez');
    assert.equal(limpiarVariable(undefined), '');
    assert.equal(limpiarVariable('x'.repeat(200)).length, MAX_LARGO_VARIABLE);
  });
});

describe('clasificarDestinatariosConDatos', () => {
  it('acepta teléfonos sueltos y destinatarios con datos, alineados con validos', () => {
    const res = clasificarDestinatariosConDatos([
      '573001234567',
      { telefono: '+57 300 987 6543', parametros: ['Laura', 'Ingeniería Industrial'], contexto: { relacion: 'egresado_utb', pregradoId: 'ingenieria-industrial' } },
      { telefono: '573009876543', parametros: ['Repetida'] },
      { telefono: '123', parametros: ['Nadie'] },
    ]);
    assert.deepEqual(res.validos, ['573001234567', '573009876543']);
    assert.deepEqual(res.datos, [
      { parametros: [], contexto: null },
      { parametros: ['Laura', 'Ingeniería Industrial'], contexto: { relacion: 'egresado_utb', pregradoId: 'ingenieria-industrial' } },
    ]);
    assert.equal(res.duplicadosOmitidos, 1);
    assert.equal(res.invalidos.length, 1);
  });

  it('el contexto solo conserva claves simples con valores de texto cortos', () => {
    const res = clasificarDestinatariosConDatos([{
      telefono: '573001234567',
      contexto: { relacion: 'externo', 'clave rara': 'x', numero: 3, largo: 'y'.repeat(300) },
    }]);
    assert.deepEqual(Object.keys(res.datos[0].contexto!), ['relacion', 'largo']);
    assert.equal(res.datos[0].contexto!.largo.length, 100);
  });
});

describe('encabezado con archivo', () => {
  const EJEMPLO = 'https://scontent.whatsapp.net/v/t61.29466-34/123_456_n.png?ccb=1-7&oh=abc&oe=6F000000';

  it('toma el archivo con el que Meta aprobó la plantilla', () => {
    assert.deepEqual(
      encabezadoMediaDe([{ type: 'HEADER', format: 'IMAGE', example: { header_handle: [EJEMPLO] } }, { type: 'BODY', text: 'Hola' }]),
      { tipo: 'image', ejemplo: EJEMPLO },
    );
    assert.equal(encabezadoMediaDe([{ type: 'header', format: 'document', example: { header_handle: [EJEMPLO] } }])?.tipo, 'document');
  });

  it('un encabezado de texto o ausente no lleva archivo', () => {
    assert.equal(encabezadoMediaDe([{ type: 'HEADER', format: 'TEXT', text: 'Hola' }]), null);
    assert.equal(encabezadoMediaDe([{ type: 'HEADER', text: 'Sin formato declarado' }]), null);
    assert.equal(encabezadoMediaDe([{ type: 'BODY', text: 'Solo cuerpo' }]), null);
    assert.equal(encabezadoMediaDe([]), null);
  });

  it('sin archivo de ejemplo o con un tipo no admitido no se puede enviar', () => {
    assert.throws(() => encabezadoMediaDe([{ type: 'HEADER', format: 'IMAGE' }]), /no entregó el archivo/);
    assert.throws(() => encabezadoMediaDe([{ type: 'HEADER', format: 'IMAGE', example: { header_handle: [] } }]), BroadcastValidationError);
    assert.throws(() => encabezadoMediaDe([{ type: 'HEADER', format: 'LOCATION' }]), /no envía/);
  });

  it('el archivo solo se descarga de Meta y por HTTPS', () => {
    assert.equal(urlDeMetaSegura(EJEMPLO), EJEMPLO);
    for (const mala of [
      'http://scontent.whatsapp.net/a.png',            // sin cifrar
      'https://127.0.0.1/a.png',                       // red interna
      'https://redis:6379/',                           // servicio interno del compose
      'https://scontent.whatsapp.net.evil.example/a',  // dominio que solo se parece
      'https://evilwhatsapp.net/a.png',
      'https://usuario:clave@scontent.whatsapp.net/a.png',
      'file:///etc/passwd',
      'no es una url',
    ]) {
      assert.throws(() => urlDeMetaSegura(mala), BroadcastValidationError, mala);
    }
  });
});

describe('ranurasDePlantilla', () => {
  it('ordena cuerpo, encabezado y botones, como las plantillas reales de la cuenta', () => {
    // nodo_recordatorio_evento: imagen, cuatro variables y un enlace con {{1}} al final.
    assert.deepEqual(ranurasDePlantilla([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://scontent.whatsapp.net/a.png'] } },
      { type: 'BODY', text: 'Hola {{1}}, mañana es tu evento. *{{2}}* 🗓 {{3}} 📍 {{4}}', example: { body_text: [['Manuel', 'CTW', 'jueves', 'Centro']] } },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver el evento', url: 'https://nodo-eventos.duckdns.org/eventos/{{1}}' }, { type: 'QUICK_REPLY', text: 'No podré ir' }] },
    ]), [
      { lugar: 'cuerpo', numero: 1 }, { lugar: 'cuerpo', numero: 2 }, { lugar: 'cuerpo', numero: 3 }, { lugar: 'cuerpo', numero: 4 },
      { lugar: 'boton', indice: 0, numero: 1 },
    ]);
    assert.deepEqual(ranurasDePlantilla([{ type: 'HEADER', format: 'TEXT', text: 'Orden {{1}}' }, { type: 'BODY', text: 'Total {{1}}' }]), [
      { lugar: 'cuerpo', numero: 1 }, { lugar: 'encabezado', numero: 1 },
    ]);
    assert.deepEqual(ranurasDePlantilla([{ type: 'BODY', text: 'Sin variables' }, { type: 'FOOTER', text: 'UTB' }]), []);
  });

  it('rechaza variables con nombre o en botones que no son enlaces', () => {
    assert.throws(() => ranurasDePlantilla([{ type: 'BODY', text: 'Hola {{nombre}}' }]), /variables con nombre/);
    assert.throws(() => ranurasDePlantilla([{ type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', example: '{{1}}', text: '{{1}}' }] }]), /botón con variables/);
  });

  it('el final de un enlace se codifica y el texto del cuerpo no', () => {
    assert.equal(valorParaRanura({ lugar: 'boton', indice: 0, numero: 1 }, ' feria de posgrados '), 'feria%20de%20posgrados');
    assert.equal(valorParaRanura({ lugar: 'boton', indice: 0, numero: 1 }, 'eventos/ctw-2026'), 'eventos/ctw-2026');
    assert.equal(valorParaRanura({ lugar: 'cuerpo', numero: 1 }, 'Lavado básico, Encerado'), 'Lavado básico, Encerado');
  });
});

