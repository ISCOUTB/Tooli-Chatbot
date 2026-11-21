import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ESPERA_MS, horaDeEnvio } from './seguimientoService';

/** Hora de Colombia (UTC-5) como instante. */
const co = (texto: string) => Date.parse(`${texto}-05:00`);

describe('seguimiento de conversaciones a medias', () => {
  it('de día sale 3 horas después', () => {
    const desde = co('2026-11-21T10:00:00');
    assert.equal(horaDeEnvio(desde), desde + ESPERA_MS);
  });

  it('nunca de noche: lo que caería después de las 9 p. m. sale a las 8 a. m.', () => {
    assert.equal(horaDeEnvio(co('2026-11-21T19:30:00')), co('2026-11-22T08:00:00'));
    assert.equal(horaDeEnvio(co('2026-11-21T20:59:00')), co('2026-11-22T08:00:00'));
  });

  it('lo que caería de madrugada sale a las 8 a. m. del mismo día', () => {
    assert.equal(horaDeEnvio(co('2026-11-21T02:00:00')), co('2026-11-21T08:00:00'));
  });

  it('siempre dentro de la ventana de 24 horas de WhatsApp', () => {
    for (let h = 0; h < 24; h++) {
      const desde = co(`2026-11-21T${String(h).padStart(2, '0')}:15:00`);
      const cuando = horaDeEnvio(desde);
      assert.ok(cuando !== null && cuando - desde <= 23 * 3_600_000, `a las ${h}:15`);
    }
    assert.equal(horaDeEnvio(co('2026-11-21T10:00:00'), 23.5 * 3_600_000), null);
  });
});
