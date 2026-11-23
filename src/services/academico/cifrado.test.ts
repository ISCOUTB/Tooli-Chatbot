import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cifrar, descifrar, ErrorCifrado, leerClave } from './cifrado';
import { claveValida } from './interruptores';

const CLAVE = randomBytes(32);

describe('cifrado de la sesión guardada y de la cédula', () => {
  it('ida y vuelta, y el texto no queda en claro', () => {
    const secreto = JSON.stringify({ cookies: [{ name: 'SESSID', value: 'abc123-valor-secreto' }] });
    const blob = cifrar(secreto, 'notas-sesion:573001112233', CLAVE);
    assert.ok(!blob.includes('abc123'));
    assert.ok(!blob.includes('SESSID'));
    assert.equal(descifrar(blob, 'notas-sesion:573001112233', CLAVE), secreto);
  });

  it('dos cifrados del mismo texto son distintos (IV aleatorio)', () => {
    assert.notEqual(cifrar('x', 'c', CLAVE), cifrar('x', 'c', CLAVE));
  });

  it('un blob copiado a otro teléfono no se abre', () => {
    const blob = cifrar('sesion', 'notas-sesion:573001112233', CLAVE);
    assert.throws(() => descifrar(blob, 'notas-sesion:573009998877', CLAVE), ErrorCifrado);
  });

  it('con otra clave o manipulado no se abre', () => {
    const blob = cifrar('sesion', 'c', CLAVE);
    assert.throws(() => descifrar(blob, 'c', randomBytes(32)), ErrorCifrado);
    const partes = blob.split('.');
    partes[3] = Buffer.from('otro-contenido').toString('base64url');
    assert.throws(() => descifrar(partes.join('.'), 'c', CLAVE), ErrorCifrado);
    assert.throws(() => descifrar('basura', 'c', CLAVE), ErrorCifrado);
  });

  it('una etiqueta recortada no se acepta (GCM exige los 16 bytes: authTagLength)', () => {
    const blob = cifrar('1045678901', 'cedula:573001112233', CLAVE);
    const partes = blob.split('.');
    assert.equal(Buffer.from(partes[2], 'base64url').length, 16);
    for (const largo of [4, 8, 12, 15]) {
      const corta = [...partes];
      corta[2] = Buffer.from(partes[2], 'base64url').subarray(0, largo).toString('base64url');
      assert.throws(() => descifrar(corta.join('.'), 'cedula:573001112233', CLAVE), ErrorCifrado, `etiqueta de ${largo} bytes`);
    }
    assert.equal(descifrar(blob, 'cedula:573001112233', CLAVE), '1045678901');
  });

  it('cifrar y descifrar fijan authTagLength: 16 (Node 22, el de CI y Docker, acepta etiquetas cortas si no)', () => {
    // Node 26 ya las rechaza solo; Node 22 las acepta con un aviso. Guardia estática para que no se pierda.
    const fuente = readFileSync(join(__dirname, 'cifrado.ts'), 'utf8');
    assert.match(fuente, /createCipheriv\('aes-256-gcm', clave, iv, \{ authTagLength: 16 \}\)/);
    assert.match(fuente, /createDecipheriv\('aes-256-gcm', clave, Buffer\.from\(iv, 'base64url'\), \{ authTagLength: 16 \}\)/);
  });

  it('la clave se acepta en hex o base64 de 32 bytes y nada más', () => {
    assert.equal(leerClave(CLAVE.toString('hex'))?.length, 32);
    assert.equal(leerClave(CLAVE.toString('base64'))?.length, 32);
    assert.equal(leerClave('corta'), null);
    assert.equal(leerClave(undefined), null);
    assert.equal(claveValida(CLAVE.toString('hex')), true);
    assert.equal(claveValida('corta'), false);
  });
});
