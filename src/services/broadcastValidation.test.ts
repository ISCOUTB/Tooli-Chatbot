import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BroadcastValidationError, MAX_BROADCAST_RECIPIENTS,
  validarTemplateName, validarLanguage,
  normalizarTelefonoBroadcast, clasificarDestinatarios,
  clasificarDestinatariosConDatos, contarVariablesCuerpo, limpiarVariable, MAX_LARGO_VARIABLE,
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
