import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PENDIENTE_VIGENTE_MS, juntarPerfil, pendienteVigente, perfilDeDatos, sesionParaElPerfil, soloConsentimiento } from './perfilService';

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

describe('perfil: canal de contacto', () => {
  it('completar no pisa con vacíos, pero vacía lo que ya no aplica', () => {
    const antes = { datos: 'si', nombre: 'Ana', contactoCanal: 'llamada', contactoTel: '3015551234', contactoFranja: 'noche' };
    assert.deepEqual(juntarPerfil(antes, { nombre: '', contactoCanal: 'chat' }, ['contactoTel', 'contactoFranja']),
      { datos: 'si', nombre: 'Ana', contactoCanal: 'chat' });
    assert.deepEqual(juntarPerfil(antes, { correo: '' }), antes);
  });

  it('la sesión de la conversación no borra el canal, el correo ni el nombre guardados', () => {
    const guardado = { datos: 'si', nombre: 'Ana', correo: 'ana@x.com', filaCrm: '7', contactoCanal: 'llamada', contactoTel: 'este', contactoFranja: 'tarde' };
    assert.deepEqual(sesionParaElPerfil(guardado, { datos: 'si', relacion: 'externo' }),
      { datos: 'si', relacion: 'externo', nombre: 'Ana', correo: 'ana@x.com', filaCrm: '7', contactoCanal: 'llamada', contactoTel: 'este', contactoFranja: 'tarde' });
    // Un canal a medio elegir en la sesión no pisa el completo del perfil; el nombre nuevo sí manda.
    assert.deepEqual(sesionParaElPerfil(guardado, { datos: 'si', nombre: 'Laura', contactoCanal: 'correo', contactoTel: '' }),
      { datos: 'si', nombre: 'Laura', correo: 'ana@x.com', filaCrm: '7', contactoCanal: 'llamada', contactoTel: 'este', contactoFranja: 'tarde' });
    assert.deepEqual(sesionParaElPerfil(null, { datos: 'si' }), { datos: 'si' });
  });
});
