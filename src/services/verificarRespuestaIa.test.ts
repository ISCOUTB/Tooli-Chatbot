import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { corregirRespuestaIa } from './verificarRespuestaIa';

describe('corregirRespuestaIa', () => {
  it('una «maestría» que solo existe como especialización pasa a especialización', () => {
    const r = corregirRespuestaIa('Te recomiendo la *Maestría en Gerencia de Servicios de Salud*, que es virtual.');
    assert.equal(r.texto, 'Te recomiendo la *Especialización en Gerencia de Servicios de Salud*, que es virtual.');
    assert.equal(r.cambios, 1);
    const minuscula = corregirRespuestaIa('Puedes estudiar una maestría en Gestión Ambiental Sostenible el próximo semestre.');
    assert.equal(minuscula.texto, 'Puedes estudiar una especialización en Gestión Ambiental Sostenible el próximo semestre.');
  });

  it('los programas que sí existen y las frases genéricas no se tocan', () => {
    for (const t of [
      'La *Maestría en Ciberseguridad* dura 3 semestres.',
      'La *Maestría en Administración de Empresas-MBA* cuesta $13.000.000 por semestre.',
      'El *Doctorado en Ingeniería* es presencial.',
      'Tenemos maestrías virtuales y especializaciones de un año.',
      'Una maestría en gerencia te puede servir.',
    ]) {
      const r = corregirRespuestaIa(t);
      assert.equal(r.texto, t, t);
      assert.equal(r.cambios, 0, t);
    }
  });

  it('un enlace de posgrado inventado se cambia por el del catálogo o por la página general', () => {
    const r = corregirRespuestaIa('Más información: https://www.utb.edu.co/posgrados/maestria-en-gestion-ambiental-sostenible/');
    assert.equal(r.texto, 'Más información: https://www.utb.edu.co/posgrados/especializacion-en-gestion-ambiental-sostenible/');
    const general = corregirRespuestaIa('Mira https://www.utb.edu.co/posgrados/doctorados/ para ver todos.');
    assert.equal(general.texto, 'Mira https://www.utb.edu.co/posgrado/ para ver todos.');
    const bueno = 'Página: https://www.utb.edu.co/posgrados/maestria-en-ciberseguridad/';
    assert.equal(corregirRespuestaIa(bueno).texto, bueno);
  });
});
