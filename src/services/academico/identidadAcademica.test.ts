import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  claveBusqueda, conservarAlRenovar, enmascararCorreo, enmascararTelefono, extraerCamposAcademicos,
  normalizarCedula, normalizarCodigo, sinCamposAcademicos,
} from './identidadAcademica';

describe('formato de código y cédula', () => {
  it('normaliza el código estudiantil', () => {
    assert.equal(normalizarCodigo(' t00012345 '), 'T00012345');
    assert.equal(normalizarCodigo('T1234'), null);
    assert.equal(normalizarCodigo('12345678'), null);
    assert.equal(normalizarCodigo(undefined), null);
  });

  it('normaliza la cédula quitando puntos y espacios', () => {
    assert.equal(normalizarCedula('1.045.678.901'), '1045678901');
    assert.equal(normalizarCedula('12345'), null);
    assert.equal(normalizarCedula('12a456789'), null);
  });
});

describe('claves de búsqueda inversa', () => {
  it('son HMAC: cambian con el secreto y no contienen el dato', () => {
    const a = claveBusqueda('codigo', 'T00012345', 'secreto-uno');
    const b = claveBusqueda('codigo', 'T00012345', 'secreto-dos');
    assert.notEqual(a, b);
    assert.ok(!a.includes('T00012345'));
    assert.equal(a, claveBusqueda('codigo', 'T00012345', 'secreto-uno'));
    assert.notEqual(claveBusqueda('cedula', '123456789', 's'), claveBusqueda('codigo', '123456789', 's'));
  });
});

describe('compatibilidad con los vínculos que ya existen', () => {
  it('un vínculo viejo (solo correo y fecha) no trae campos académicos', () => {
    assert.deepEqual(extraerCamposAcademicos({ email: 'a@utb.edu.co', verifiedAt: 1 }), {});
  });

  it('copia solo los campos conocidos y válidos', () => {
    const campos = extraerCamposAcademicos({
      email: 'a@utb.edu.co', codigo: 't00012345', codigoVerificado: true, codigoFuente: 'iceberg',
      nombre: ' Ana Pérez ', nivel: 'posgrado', cedulaCifrada: 'v1.a.b.c', intruso: 'x',
    });
    assert.deepEqual(campos, {
      codigo: 'T00012345', codigoVerificado: true, codigoFuente: 'iceberg', nombre: 'Ana Pérez',
      nivel: 'posgrado', cedulaCifrada: 'v1.a.b.c',
    });
  });

  it('descarta un código mal formado y una cédula cifrada que no es del formato', () => {
    const campos = extraerCamposAcademicos({ codigo: 'hola', codigoVerificado: true, cedulaCifrada: '1234567' });
    assert.deepEqual(campos, {});
  });

  it('un código declarado a mano no queda como verificado por accidente', () => {
    assert.equal(extraerCamposAcademicos({ codigo: 'T00012345', codigoVerificado: 'true' }).codigoVerificado, false);
  });

  it('al renovar con el mismo correo conserva el código; con otro correo, no', () => {
    const anterior = { email: 'Ana@utb.edu.co', verifiedAt: 1, codigo: 'T00012345', codigoVerificado: true };
    assert.equal(conservarAlRenovar(anterior, 'ana@utb.edu.co').codigo, 'T00012345');
    assert.deepEqual(conservarAlRenovar(anterior, 'otra@utb.edu.co'), {});
    assert.deepEqual(conservarAlRenovar(null, 'ana@utb.edu.co'), {});
  });

  it('sinCamposAcademicos deja solo el vínculo', () => {
    assert.deepEqual(
      sinCamposAcademicos({ email: 'a@utb.edu.co', verifiedAt: 1, codigo: 'T00012345', nombre: 'Ana' }),
      { email: 'a@utb.edu.co', verifiedAt: 1 },
    );
  });
});

describe('enmascarado', () => {
  it('no deja ver el número ni el correo completos', () => {
    assert.equal(enmascararTelefono('573001234567'), '****4567');
    assert.equal(enmascararTelefono('12'), '****');
    assert.equal(enmascararCorreo('ana.perez@utb.edu.co'), 'a***@utb.edu.co');
    assert.equal(enmascararCorreo('sin-arroba'), '');
  });
});
