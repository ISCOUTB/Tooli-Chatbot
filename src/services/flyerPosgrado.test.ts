import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POSGRADOS_UTB, getPrograma } from './catalogoUtb';
import { campoLaboralCorto, datosFlyer, htmlFlyer, tamanoTitular } from './flyerPosgrado';

const recursos = { foto: null, logo: 'data:image/svg+xml;base64,AA==', logoColor: 'data:image/svg+xml;base64,AA==',
  fuentes: { 400: 'data:font/woff2;base64,AA==', 600: 'data:font/woff2;base64,AA==', 800: 'data:font/woff2;base64,AA==', 900: 'data:font/woff2;base64,AA==' } };

describe('flyer estilo UTB', () => {
  it('saca los datos del catálogo: nivel, semestres, modalidad, valor y título', () => {
    const d = datosFlyer(getPrograma('maestria-en-administracion')!, '2026');
    assert.equal(d.nivel, 'Maestría');
    assert.equal(d.titular, 'Administración de Empresas-MBA');
    assert.equal(d.semestres, '3');
    assert.equal(d.modalidad, 'Presencial');
    assert.equal(d.inversion, '$17.900.000');
    assert.equal(d.inversionDetalle, 'por semestre · 2026');
    assert.equal(d.titulo, 'Magíster en Administración');
  });

  it('los virtuales dicen 100% virtual y sin valor publicado invita a consultarlo', () => {
    assert.equal(datosFlyer(getPrograma('virtual-ingenieria-de-software')!, '2026').modalidad, '100% virtual');
    const sinValor = POSGRADOS_UTB.find((p) => !p.inversion_cop)!;
    assert.equal(datosFlyer(sinValor, '2026').inversion, 'Consulta el valor');
  });

  it('en "¿Dónde podrás trabajar?" solo van cargos cortos, y con menos de dos no va la sección', () => {
    assert.deepEqual(
      campoLaboralCorto(['Con los conocimientos y habilidades adquiridos podrá trabajar en', 'Desarrollo de software.', 'Seguridad informática', 'Inteligencia artificial']),
      ['Desarrollo de software', 'Seguridad informática', 'Inteligencia artificial'],
    );
    assert.deepEqual(campoLaboralCorto(['Consultoría']), []);
  });

  it('el titular se achica con el largo', () => {
    assert.ok(tamanoTitular('Ingeniería') > tamanoTitular('Enseñanza de las Matemáticas y Ciencias Naturales en Entornos Digitales'));
  });

  it('cada posgrado arma su flyer sin huecos y con el texto escapado', () => {
    for (const p of POSGRADOS_UTB) {
      const html = htmlFlyer(datosFlyer(p, '2026'), recursos);
      assert.doesNotMatch(html, /undefined|>null</, p.id);
      assert.ok(html.includes(datosFlyer(p, '2026').semestres), p.id);
    }
    const raro = htmlFlyer({ ...datosFlyer(getPrograma('maestria-en-derecho')!, '2026'), titular: '<b>x</b> & "y"' }, recursos);
    assert.ok(raro.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;'));
  });
});
