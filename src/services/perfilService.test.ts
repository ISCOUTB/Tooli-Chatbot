import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PENDIENTE_VIGENTE_MS, pendienteVigente, perfilDeDatos, soloConsentimiento } from './perfilService';

describe('perfil de quien vuelve', () => {
  it('solo recuerda los valores cerrados, el nombre y la autorización; nunca lo que escribió', () => {
    const perfil = perfilDeDatos({
      relacion: 'egresado_utb', pregradoId: 'ing-industrial', nivel: 'maestria', nivelListo: '1',
      nombre: 'Laura', info: 'si', filaCrm: '12',
      aiHistory: '[{"role":"user","content":"mi cédula es 123"}]', pendiente: 'nivel', pregradoTexto: 'algo', familiaId: '',
    });
    assert.deepEqual(perfil, {
      relacion: 'egresado_utb', pregradoId: 'ing-industrial', nivel: 'maestria', nivelListo: '1',
      nombre: 'Laura', info: 'si', filaCrm: '12', pendiente: 'nivel',
    });
  });

  it('al empezar de nuevo conserva solo el nombre y la autorización', () => {
    assert.deepEqual(
      soloConsentimiento({ relacion: 'externo', nombre: 'Laura', info: 'no', filaCrm: '7', nivel: 'doctorado' }),
      { nombre: 'Laura', info: 'no', filaCrm: '7' },
    );
    assert.deepEqual(soloConsentimiento(null), {});
  });

  it('la pregunta pendiente vale un día', () => {
    const ahora = Date.parse('2026-11-21T15:00:00Z');
    const hace = (ms: number) => String(ahora - ms);
    assert.equal(pendienteVigente({ pendiente: 'pregrado', pendienteEn: hace(2 * 3_600_000) }, ahora), true);
    assert.equal(pendienteVigente({ pendiente: 'pregrado', pendienteEn: hace(PENDIENTE_VIGENTE_MS + 1) }, ahora), false);
    assert.equal(pendienteVigente({ pendiente: 'pregrado' }, ahora), false);
    assert.equal(pendienteVigente({ pendienteEn: hace(1000) }, ahora), false);
  });

  it('recorta valores largos', () => {
    assert.equal(perfilDeDatos({ nombre: 'x'.repeat(500) }).nombre.length, 120);
  });
});
