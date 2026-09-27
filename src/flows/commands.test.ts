import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlobalCommand, areaOfStep, menuStepForArea } from './commands';

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

