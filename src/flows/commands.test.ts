import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlobalCommand, areaOfStep, menuStepForArea, parseOriginArea, resolveOriginArea, returnMenuStep, sharedReturnStep, resolveAiArea } from './commands';

describe('parseGlobalCommand', () => {
  it('reconoce menú con mayúsculas, espacios y tilde', () => {
    for (const value of ['menu', 'MENU', 'Menú', ' menú ', 'MENÚ']) {
      assert.equal(parseGlobalCommand(value), 'menu');
    }
  });

  it('reconoce volver, atrás y cero', () => {
    for (const value of ['volver', 'VOLVER', 'atrás', 'atras', 'Atrás', '0']) {
      assert.equal(parseGlobalCommand(value), 'volver');
    }
  });

  it('reconoce salir', () => {
    for (const value of ['salir', 'SALIR', ' Salir ']) {
      assert.equal(parseGlobalCommand(value), 'salir');
    }
  });

  it('no trata subcadenas como comandos', () => {
    assert.equal(parseGlobalCommand('quiero ver el menu de posgrados'), null);
    assert.equal(parseGlobalCommand('menús'), null);
    assert.equal(parseGlobalCommand('me quiero volver loco'), null);
    assert.equal(parseGlobalCommand('asesor'), null);
    assert.equal(parseGlobalCommand('menu de posgrados'), null);
    assert.equal(parseGlobalCommand('quiero volver al menú'), null);
    assert.equal(parseGlobalCommand('salir de la conversación por favor'), null);
    assert.equal(parseGlobalCommand(''), null);
  });
});

describe('areaOfStep', () => {
  it('distingue los estados de Posgrado', () => {
    for (const step of [
      'menu_posgrado', 'programas_categoria', 'programas_detalle',
      'prospecto_nombre', 'prospecto_email', 'prospecto_programa',
      'registro_nombre', 'registro_email', 'registro_programa',
    ]) assert.equal(areaOfStep(step), 'posgrado');
  });

  it('distingue los estados de Pregrado', () => {
    for (const step of [
      'menu_pregrado', 'pregrado_registro_nombre', 'pregrado_registro_email',
      'pregrado_registro_carrera', 'pregrado_prospecto_nombre',
      'pregrado_prospecto_email', 'pregrado_prospecto_carrera',
      'pregrado_explorar_area', 'pregrado_explorar_carrera', 'pregrado_explorar_accion',
    ]) assert.equal(areaOfStep(step), 'pregrado');
  });

  it('no inventa un área para estados compartidos o desconocidos', () => {
    for (const step of ['academico_menu', 'menu', 'chatting_with_ai', 'with_agent', 'desconocido']) {
      assert.equal(areaOfStep(step), null);
    }
  });
});

describe('menuStepForArea', () => {
  it('devuelve el menú de la misma área', () => {
    assert.equal(menuStepForArea('pregrado'), 'menu_pregrado');
    assert.equal(menuStepForArea('posgrado'), 'menu_posgrado');
  });
});

describe('parseOriginArea', () => {
  it('acepta solo pregrado o posgrado exactos', () => {
    assert.equal(parseOriginArea('pregrado'), 'pregrado');
    assert.equal(parseOriginArea('posgrado'), 'posgrado');
  });

  it('rechaza ausencia y corrupción', () => {
    for (const value of ['posgrados', 'admisiones', 'ti', 'PREGRADO', ' pregrado ', '', null, undefined, 0, {}]) {
      assert.equal(parseOriginArea(value), null);
    }
  });
});

describe('resolveOriginArea', () => {
  it('resuelve ambas áreas', () => {
    assert.equal(resolveOriginArea({ originArea: 'pregrado' }), 'pregrado');
    assert.equal(resolveOriginArea({ originArea: 'posgrado' }), 'posgrado');
  });

  it('no inventa origen con datos ausentes', () => {
    assert.equal(resolveOriginArea(undefined), null);
    assert.equal(resolveOriginArea(null), null);
    assert.equal(resolveOriginArea({}), null);
  });

  it('no inventa origen con datos corruptos', () => {
    assert.equal(resolveOriginArea({ originArea: 'posgrados' }), null);
    assert.equal(resolveOriginArea({ originArea: 'admisiones' }), null);
    assert.equal(resolveOriginArea({ originArea: '' }), null);
    assert.equal(resolveOriginArea({ originArea: 'pregrado', area: 'posgrados' }), 'pregrado');
  });
});

describe('returnMenuStep', () => {
  it('vuelve al menú del área de origen', () => {
    assert.equal(returnMenuStep({ originArea: 'pregrado' }), 'menu_pregrado');
    assert.equal(returnMenuStep({ originArea: 'posgrado' }), 'menu_posgrado');
  });

  it('cae al menú raíz sin origen válido (legacy, ausente o corrupto)', () => {
    assert.equal(returnMenuStep(undefined), 'menu');
    assert.equal(returnMenuStep({}), 'menu');
    assert.equal(returnMenuStep({ originArea: 'posgrados' }), 'menu');
    assert.equal(returnMenuStep({ area: 'posgrados' }), 'menu');
  });
});

describe('sharedReturnStep', () => {
  it('“volver” va al origen y “menu”/“salir” a la raíz', () => {
    assert.equal(sharedReturnStep({ originArea: 'pregrado' }, 'volver'), 'menu_pregrado');
    assert.equal(sharedReturnStep({ originArea: 'posgrado' }, 'volver'), 'menu_posgrado');
    assert.equal(sharedReturnStep({ originArea: 'posgrado' }, 'menu'), 'menu');
    assert.equal(sharedReturnStep({ originArea: 'pregrado' }, 'salir'), 'menu');
    assert.equal(sharedReturnStep(undefined, 'volver'), 'menu');
    assert.equal(sharedReturnStep({ originArea: 'admisiones' }, 'volver'), 'menu');
  });
});

describe('resolveAiArea', () => {
  it('conserva áreas válidas (incluye sesiones legacy sin origen)', () => {
    assert.equal(resolveAiArea({ area: 'ti' }), 'ti');
    assert.equal(resolveAiArea({ area: 'admisiones' }), 'admisiones');
    assert.equal(resolveAiArea({ area: 'posgrados' }), 'posgrados');
  });

  it('usa el origen cuando el área falta', () => {
    assert.equal(resolveAiArea({ originArea: 'posgrado' }), 'posgrados');
    assert.equal(resolveAiArea({ originArea: 'pregrado' }), 'admisiones');
  });

  it('usa el origen cuando el área es corrupta, sin asumir Posgrado', () => {
    assert.equal(resolveAiArea({ area: 'POSGRADOS', originArea: 'pregrado' }), 'admisiones');
    assert.equal(resolveAiArea({ area: 'general', originArea: 'posgrado' }), 'posgrados');
    assert.equal(resolveAiArea({ area: '', originArea: 'pregrado' }), 'admisiones');
  });

  it('pide recuperación explícita sin ningún contexto válido', () => {
    assert.equal(resolveAiArea(undefined), null);
    assert.equal(resolveAiArea({}), null);
    assert.equal(resolveAiArea({ area: 'posgrados???' }), null);
    assert.equal(resolveAiArea({ area: '', originArea: 'admisiones' }), null);
  });
});

