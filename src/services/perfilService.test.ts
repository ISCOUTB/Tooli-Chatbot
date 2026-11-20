import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { perfilDeDatos, soloConsentimiento } from './perfilService';

describe('perfil de quien vuelve', () => {
  it('solo recuerda los valores cerrados, el nombre y la autorización; nunca lo que escribió', () => {
    const perfil = perfilDeDatos({
      relacion: 'egresado_utb', pregradoId: 'ing-industrial', nivel: 'maestria', nivelListo: '1',
      nombre: 'Laura', info: 'si', filaCrm: '12',
      aiHistory: '[{"role":"user","content":"mi cédula es 123"}]', pendiente: 'nivel', pregradoTexto: 'algo', familiaId: '',
    });
    assert.deepEqual(perfil, {
      relacion: 'egresado_utb', pregradoId: 'ing-industrial', nivel: 'maestria', nivelListo: '1',
      nombre: 'Laura', info: 'si', filaCrm: '12',
    });
  });

  it('al empezar de nuevo conserva solo el nombre y la autorización', () => {
    assert.deepEqual(
      soloConsentimiento({ relacion: 'externo', nombre: 'Laura', info: 'no', filaCrm: '7', nivel: 'doctorado' }),
      { nombre: 'Laura', info: 'no', filaCrm: '7' },
    );
    assert.deepEqual(soloConsentimiento(null), {});
  });

  it('recorta valores largos', () => {
    assert.equal(perfilDeDatos({ nombre: 'x'.repeat(500) }).nombre.length, 120);
  });
});
