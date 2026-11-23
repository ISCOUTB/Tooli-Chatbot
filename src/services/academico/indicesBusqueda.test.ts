import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { claveBusqueda } from './identidadAcademica';
import { clavesIndice, huellaDeIndice, secretosBusqueda } from './indicesBusqueda';

const JWT = 'jwt-de-prueba-solo-para-los-tests-32-chars';
const AES = 'a'.repeat(64);
const PROPIA = 'clave-propia-de-busqueda-de-32-caracteres-o-mas';

describe('clave propia para los índices de búsqueda (#38)', () => {
  it('sin TOOLI_BUSQUEDA_CLAVE se sigue usando la de siempre (nada queda huérfano al desplegar)', () => {
    assert.deepEqual(secretosBusqueda({ jwt: JWT }), { actual: JWT, legado: null });
    assert.deepEqual(secretosBusqueda({ academico: AES, jwt: JWT }), { actual: AES, legado: null });
    assert.deepEqual(secretosBusqueda({ busqueda: 'corta', academico: AES, jwt: JWT }), { actual: AES, legado: null }, 'una clave inválida no cuenta');
  });

  it('con TOOLI_BUSQUEDA_CLAVE, el secreto se deriva con HKDF y es independiente de JWT_SECRET y de la clave AES', () => {
    const a = secretosBusqueda({ busqueda: PROPIA, academico: AES, jwt: JWT });
    const b = secretosBusqueda({ busqueda: PROPIA, academico: 'b'.repeat(64), jwt: 'otro-jwt-distinto-de-32-caracteres-xx' });
    assert.equal(a.actual, b.actual, 'rotar JWT_SECRET o la clave AES no cambia los índices');
    assert.match(a.actual, /^[0-9a-f]{64}$/);
    assert.notEqual(a.actual, PROPIA, 'no se usa la clave en crudo: HKDF con etiqueta');
    assert.equal(a.legado, AES, 'la vieja queda solo para leer lo no migrado');
    assert.equal(b.legado, 'b'.repeat(64));
  });

  it('las claves candidatas: primero la nueva, después la vieja (respaldo mientras se migra)', () => {
    const s = secretosBusqueda({ busqueda: PROPIA, jwt: JWT });
    assert.deepEqual(clavesIndice('codigo', 'T00012345', s), [
      claveBusqueda('codigo', 'T00012345', s.actual), claveBusqueda('codigo', 'T00012345', JWT),
    ]);
    assert.deepEqual(clavesIndice('cedula', '1045678901', secretosBusqueda({ jwt: JWT })), [claveBusqueda('cedula', '1045678901', JWT)]);
    const k = clavesIndice('cedula', '1045678901', s)[0];
    assert.equal(`identity-cedula:${huellaDeIndice(k)}`, k);
  });
});
