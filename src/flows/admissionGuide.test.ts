import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatAdmissionGuide } from './admissionGuide';

describe('guías de admisión', () => {
  it('separa pregrado y posgrado con enlaces oficiales y siguientes pasos', () => {
    const pregrado = formatAdmissionGuide('pregrado');
    const posgrado = formatAdmissionGuide('posgrado');
    assert.match(pregrado, /Saber 11/);
    assert.match(pregrado, /Finalizar y enviar/);
    assert.match(posgrado, /título profesional/);
    assert.match(posgrado, /hoja de vida/);
    assert.match(pregrado, /inscripciones-pregrado\/primera-vez/);
    assert.match(posgrado, /inscripciones-posgrado/);
    for (const guide of [pregrado, posgrado]) {
      assert.match(guide, /derechos-pecuniarios/);
      assert.match(guide, /no envía tu solicitud/);
      assert.ok(!guide.includes('$'), 'no debe prometer un costo fijo');
    }
  });
});
