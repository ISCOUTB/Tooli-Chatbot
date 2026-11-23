import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// router.js toca el DOM solo al pintar; para importarlo basta con lo mínimo.
globalThis.document ??= {
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
  body: { appendChild() {} }, activeElement: null, head: { appendChild() {} },
};

let R;
before(async () => { R = await import('./router.js'); });

const rutas = (secciones) => secciones.flatMap(s => s.routes.map(r => r.route));

describe('menú del panel según la sesión', () => {
  it('con AGENDA_ACTIVA=false la pestaña Agenda no aparece, ni para el administrador', () => {
    assert.equal(rutas(R.filtrarSecciones(R.NAV_SECTIONS, { esAdmin: true, caps: {} })).includes('agenda'), false);
    assert.equal(rutas(R.filtrarSecciones(R.NAV_SECTIONS, { esAdmin: false, caps: { agenda: false } })).includes('agenda'), false);
    assert.equal(R.rutaDisponible('agenda', { esAdmin: true, caps: { agenda: false } }), false, 'ni entrando por #agenda o el atajo g a');
  });

  it('encendida aparece para todos; lo de administración sigue siendo solo del administrador', () => {
    const asesor = rutas(R.filtrarSecciones(R.NAV_SECTIONS, { esAdmin: false, caps: { agenda: true } }));
    assert.ok(asesor.includes('agenda'));
    assert.equal(asesor.includes('usuarios'), false);
    assert.ok(rutas(R.filtrarSecciones(R.NAV_SECTIONS, { esAdmin: true, caps: { agenda: true } })).includes('usuarios'));
    assert.equal(R.rutaDisponible('agenda', { esAdmin: false, caps: { agenda: true } }), true);
    assert.equal(R.rutaDisponible('home', { esAdmin: false, caps: {} }), true, 'lo que no está en el menú no se bloquea');
  });
});
