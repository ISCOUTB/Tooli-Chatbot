import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bloqueIdentidad, estadoIdentidad, etiquetaIdentidad } from './identidadAsesor';

const vinculo = { email: 'ana.perez@utb.edu.co', verifiedAt: 1 };
const datos = { verifEmail: 'ana.perez@utb.edu.co', verifCodigo: 'T00012345', verifCedula: '1047000000' };

test('solo es correo verificado si el WhatsApp está vinculado a ESE correo', () => {
  assert.equal(estadoIdentidad(vinculo, 'ana.perez@utb.edu.co'), 'correo_verificado');
  assert.equal(estadoIdentidad(vinculo, ' Ana.Perez@UTB.edu.co '), 'correo_verificado');
  assert.equal(estadoIdentidad(vinculo, 'otro@utb.edu.co'), 'sin_verificar');
  assert.equal(estadoIdentidad(null, 'ana.perez@utb.edu.co'), 'sin_verificar');
  assert.equal(estadoIdentidad(vinculo, undefined), 'sin_verificar');
});

test('el asesor nunca ve «verificada» para datos que nadie comprobó', () => {
  const sin = bloqueIdentidad(datos, 'sin_verificar');
  assert.match(sin, /SIN verificar/);
  assert.doesNotMatch(sin, /Identidad verificada/);
  assert.match(sin, /T00012345/);
  assert.equal(etiquetaIdentidad('sin_verificar'), 'identidad-sin-verificar');

  const con = bloqueIdentidad(datos, 'correo_verificado');
  assert.match(con, /Correo verificado con código/);
  assert.equal(etiquetaIdentidad('correo_verificado'), 'correo-verificado');
});

test('si académico ya comprobó el código del vínculo, el bloque lo dice en vez de «lo escribió la persona»', () => {
  const conCodigo = { ...vinculo, codigo: 'T00012345', codigoVerificado: true };
  const b = bloqueIdentidad(datos, estadoIdentidad(conCodigo, datos.verifEmail), conCodigo);
  assert.match(b, /código estudiantil comprobado por académico/);
  assert.match(b, /Código: T00012345 \(comprobado por académico\)/);
  assert.doesNotMatch(b, /Código y cédula: los escribió la persona/);
  assert.match(b, /Cédula: la escribió la persona/);

  // Escribió otro código: se muestra el comprobado y se avisa que no coincide.
  const otro = bloqueIdentidad({ ...datos, verifCodigo: 't00099999' }, 'correo_verificado', conCodigo);
  assert.match(otro, /T00012345 \(comprobado por académico\) — escribió t00099999, NO coincide/);

  // Código guardado pero NO comprobado, o vínculo de otro correo: sigue siendo lo que escribió la persona.
  const sinComprobar = bloqueIdentidad(datos, 'correo_verificado', { codigo: 'T00012345', codigoVerificado: false });
  assert.match(sinComprobar, /Código y cédula: los escribió la persona/);
  assert.doesNotMatch(sinComprobar, /comprobado por académico/);
  const otroCorreo = bloqueIdentidad(datos, 'sin_verificar', conCodigo);
  assert.doesNotMatch(otroCorreo, /comprobado por académico/);
  assert.match(otroCorreo, /SIN verificar/);
});
