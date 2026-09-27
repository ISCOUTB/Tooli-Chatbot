import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeError, describeId, maskEmail, maskPhone, maskCode, describeText } from './logSafe';

/**
 * Estas funciones son la barrera que impide que las conversaciones de los
 * estudiantes terminen en texto plano en los logs. Un cambio que las rompa no
 * lanza ningún error: simplemente empieza a filtrar datos en silencio, y eso
 * solo se nota cuando ya está en producción. De ahí que se prueben.
 */
describe('maskPhone', () => {
  it('deja ver solo los últimos cuatro dígitos', () => {
    assert.equal(maskPhone('573001234567'), '****4567');
  });

  it('ignora el formato con que venga el número', () => {
    assert.equal(maskPhone('+57 300 123 4567'), '****4567');
    assert.equal(maskPhone('(300) 123-4567'), '****4567');
  });

  it('no revela nada si el número viene vacío o ausente', () => {
    assert.equal(maskPhone(''), '****');
    assert.equal(maskPhone(undefined), '****');
    assert.equal(maskPhone(null), '****');
  });

  it('nunca devuelve el número completo, ni siendo corto', () => {
    for (const entrada of ['1', '12', '123', '1234']) {
      assert.equal(maskPhone(entrada), '****');
    }
    for (const entrada of ['12345', '573001234567']) {
      assert.ok(!maskPhone(entrada).includes(entrada),
        `filtró el número completo para "${entrada}"`);
    }
  });

  it('enmascara JIDs de Evolution', () => {
    assert.equal(maskPhone('573001234567@s.whatsapp.net'), '****4567');
    assert.equal(maskPhone('573001234567@lid'), '****4567');
  });
});

describe('maskCode', () => {
  it('conserva el prefijo y el final, que es lo que sirve para depurar', () => {
    assert.equal(maskCode('T00012345'), 'T0****345');
  });

  it('oculta por completo los códigos demasiado cortos para enmascarar', () => {
    assert.equal(maskCode('T001'), '****');
    assert.equal(maskCode(''), '****');
    assert.equal(maskCode(undefined), '****');
  });

  it('no deja el código completo en el resultado', () => {
    const codigo = 'T00098765';
    assert.ok(!maskCode(codigo).includes(codigo));
  });
});

describe('describeText', () => {
  it('por defecto describe el mensaje sin mostrar su contenido', () => {
    assert.equal(describeText('quiero información de la maestría'), '33 chars');
  });

  it('con vista previa muestra solo el trozo pedido', () => {
    assert.equal(describeText('hola que tal', 4), '12 chars: "hola…"');
  });

  it('no agrega puntos suspensivos si el texto cabe entero', () => {
    assert.equal(describeText('hola', 10), '4 chars: "hola"');
  });

  it('colapsa los saltos de línea para no romper el formato del log', () => {
    assert.equal(describeText('hola\n\nmundo', 11), '11 chars: "hola mundo"');
  });

  it('trata texto ausente como texto vacío', () => {
    assert.equal(describeText(undefined), '0 chars');
    assert.equal(describeText(null), '0 chars');
  });

  it('cuenta emoji sin partir el par sustituto', () => {
    assert.equal(describeText('hola 👋'), '6 chars');
    assert.equal(describeText('👋👋👋', 2), '3 chars: "👋👋…"');
  });

  it('describe objetos inesperados sin serializarlos', () => {
    assert.equal(describeText({ text: 'contenido privado' }), 'non-string object');
    assert.equal(describeText(12345), 'non-string number');
  });

  it('limita incluso una vista previa pedida con un valor enorme', () => {
    const salida = describeText('a'.repeat(200), 5_000);
    assert.ok(salida.startsWith('200 chars: "'));
    assert.ok(salida.endsWith('…"'));
    assert.ok(salida.length < 200);
  });
});

describe('maskEmail', () => {
  it('oculta el buzón y conserva el dominio', () => {
    assert.equal(maskEmail('juan.perez@utb.edu.co'), '***@utb.edu.co');
  });

  it('no revela entradas rotas o ausentes', () => {
    assert.equal(maskEmail('sin-arroba'), '****');
    assert.equal(maskEmail(undefined), '****');
  });
});

describe('describeId', () => {
  it('no deja un messageId reutilizable', () => {
    const id = 'wamid.HBgNNTczMDAwMTIzNDU2NyIBAgM';
    const salida = describeId(id);
    assert.ok(!salida.includes(id));
    assert.ok(salida.includes(`(${id.length} chars)`));
  });

  it('oculta completamente IDs cortos', () => {
    assert.equal(describeId('abc123'), '**** (6 chars)');
    assert.equal(describeId(undefined), 'noid');
  });
});

describe('describeError', () => {
  it('resume un AxiosError sin serializar payload, headers o config', () => {
    const token = 'tok-secreto-xyz';
    const telefono = '573001234567';
    const err = {
      name: 'AxiosError',
      code: 'ERR_BAD_RESPONSE',
      message: 'Request failed with status code 502',
      response: {
        status: 502,
        data: { token, telefono, mensajes: ['hola'] },
        headers: { apikey: token },
      },
      config: { headers: { apikey: token } },
    };
    const salida = describeError(err);
    assert.ok(salida.includes('status=502'));
    assert.ok(salida.includes('ERR_BAD_RESPONSE'));
    assert.ok(!salida.includes(token));
    assert.ok(!salida.includes(telefono));
    assert.ok(!salida.includes('hola'));
  });

  it('redacta teléfono y correo dentro del mensaje y lo deja en una línea', () => {
    const salida = describeError(new Error('falló 573001234567 para juan@utb.edu.co\nsegunda línea'));
    assert.ok(!salida.includes('573001234567'));
    assert.ok(!salida.includes('juan@utb.edu.co'));
    assert.ok(salida.includes('****4567'));
    assert.ok(salida.includes('***@utb.edu.co'));
    assert.ok(!salida.includes('\n'));
  });
});
