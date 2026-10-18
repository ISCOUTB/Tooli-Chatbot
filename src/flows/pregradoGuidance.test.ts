import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREGRADO_AREAS,
  buildUndecidedLabel,
  formatAreasMessage,
  formatCareersMessage,
  getAllCareers,
  getAreaById,
  getCareersByArea,
  getGuidanceState,
  isGuidanceRequest,
  normalizeGuidanceInput,
  parseAreaSelection,
  parseCareerSelection,
  withGuidance,
  withoutGuidance,
} from './pregradoGuidance';

describe('normalizeGuidanceInput', () => {
  it('quita tildes, mayúsculas y espacios sobrantes', () => {
    assert.equal(normalizeGuidanceInput('  NO   SÉ  '), 'no se');
    assert.equal(normalizeGuidanceInput('Ayúdame A Elegir'), 'ayudame a elegir');
    assert.equal(normalizeGuidanceInput('Diseño y Arquitectura'), 'diseno y arquitectura');
  });
});

describe('isGuidanceRequest', () => {
  it('detecta variantes de "no sé" con o sin tildes', () => {
    for (const value of ['no sé', 'NO SÉ', 'no se', 'No Se', 'aún no sé', 'aun no se', 'no sé aún', 'nose']) {
      assert.ok(isGuidanceRequest(value), `no detectó "${value}"`);
    }
  });

  it('detecta pedidos de explorar y de ayuda para elegir', () => {
    for (const value of [
      'ver carreras',
      'quiero explorar',
      'ayúdame a elegir',
      'Ayudame a decidir',
      'no sé qué estudiar',
      'estoy indecisa',
    ]) {
      assert.ok(isGuidanceRequest(value), `no detectó "${value}"`);
    }
  });

  it('no confunde una carrera concreta con indecisión', () => {
    for (const value of [
      'Ingeniería de Sistemas y Computación',
      'Derecho',
      'algo de salud',
      'Psicología',
      'quiero ver el menu de posgrados',
      'menu',
      '',
    ]) {
      assert.ok(!isGuidanceRequest(value), `falso positivo con "${value}"`);
    }
  });
});

describe('parseAreaSelection', () => {
  it('acepta el número o el nombre del área', () => {
    assert.equal(parseAreaSelection('1'), 'ingenieria');
    assert.equal(parseAreaSelection('5'), 'transformacion_digital');
    assert.equal(parseAreaSelection('Ingeniería'), 'ingenieria');
    assert.equal(parseAreaSelection('diseño y arquitectura'), 'diseno_arquitectura');
    assert.equal(parseAreaSelection('NEGOCIOS'), 'negocios');
    assert.equal(parseAreaSelection('sociedad'), 'sociedad');
    assert.equal(parseAreaSelection('Transformación Digital'), 'transformacion_digital');
  });

  it('rechaza globales, fuera de rango y carreras sueltas', () => {
    for (const value of ['0', 'menu', 'volver', 'salir', '6', '99', '', 'medicina', 'Ingeniería de Sistemas y Computación']) {
      assert.equal(parseAreaSelection(value), null, `aceptó "${value}" como área`);
    }
  });
});

describe('parseCareerSelection', () => {
  it('acepta número o nombre exacto dentro del área', () => {
    const first = getCareersByArea('negocios')[0];
    assert.deepEqual(parseCareerSelection('1', 'negocios'), { kind: 'career', career: first });
    assert.deepEqual(parseCareerSelection('Derecho', 'sociedad'), { kind: 'career', career: 'Derecho' });
    assert.deepEqual(parseCareerSelection('ingeniería civil', 'ingenieria'), {
      kind: 'career',
      career: 'Ingeniería Civil',
    });
  });

  it('acepta "aún no sé" por texto o por última opción numérica', () => {
    const careers = getCareersByArea('sociedad');
    assert.deepEqual(parseCareerSelection('aún no sé', 'sociedad'), { kind: 'undecided' });
    assert.deepEqual(parseCareerSelection('AUN NO SE', 'sociedad'), { kind: 'undecided' });
    assert.deepEqual(parseCareerSelection('no estoy segura', 'sociedad'), { kind: 'undecided' });
    assert.deepEqual(parseCareerSelection(String(careers.length + 1), 'sociedad'), { kind: 'undecided' });
  });

  it('mantiene abierta la elección ante solicitudes de orientación', () => {
    for (const value of [
      'ayúdame a elegir',
      'ayúdame a elegir entre Ingeniería Industrial y Sistemas',
      'ver carreras de ingeniería',
      '¿qué me recomiendas?',
    ]) {
      assert.deepEqual(parseCareerSelection(value, 'ingenieria'), { kind: 'invalid' }, `finalizó con "${value}"`);
    }
  });

  it('rechaza basura sin guardar nada', () => {
    for (const value of ['0', '99', 'xyz', '', 'menu', 'Medicina']) {
      assert.deepEqual(parseCareerSelection(value, 'negocios'), { kind: 'invalid' }, `aceptó "${value}"`);
    }
    // Una carrera de otra área no vale dentro de esta.
    assert.deepEqual(parseCareerSelection('Derecho', 'ingenieria'), { kind: 'invalid' });
  });
});

describe('catálogo', () => {
  it('es completo y no tiene duplicados', () => {
    const all = getAllCareers();
    assert.equal(all.length, new Set(all).size, 'el catálogo tiene duplicados');
    for (const expected of [
      'Ingeniería Eléctrica',
      'Ingeniería de Sistemas y Computación',
      'Arquitectura',
      'Diseño',
      'Administración de Empresas',
      'Psicología',
      'Derecho',
      'Ciencia de Datos',
    ]) {
      assert.ok(all.includes(expected), `falta "${expected}"`);
    }
  });

  it('cada área tiene carreras y todo lo mostrado existe en el catálogo', () => {
    const all = new Set(getAllCareers());
    assert.equal(PREGRADO_AREAS.length, 5);
    for (const area of PREGRADO_AREAS) {
      assert.ok(area.careers.length > 0, `área vacía: ${area.id}`);
      for (const career of area.careers) assert.ok(all.has(career), `"${career}" fuera de catálogo`);
    }
  });

  it('la etiqueta de indecisión menciona el área para el asesor', () => {
    const label = buildUndecidedLabel(getAreaById('sociedad')?.label ?? '');
    assert.ok(label.includes('Aún no sé'));
    assert.ok(label.includes('Sociedad'));
  });

  it('los mensajes listan opciones del catálogo sin costos ni enlaces', () => {
    const areas = formatAreasMessage('initial');
    for (const area of PREGRADO_AREAS) assert.ok(areas.includes(area.label));
    const careers = formatCareersMessage('ingenieria', 'initial');
    assert.ok(careers.includes('Ingeniería Civil'));
    assert.ok(careers.includes('Aún no sé'));
    for (const text of [areas, careers]) {
      assert.ok(!text.includes('$'));
      assert.ok(!text.includes('http'));
    }
  });
});

describe('estado de guía en sesión', () => {
  it('activa, conserva nombre/correo y se limpia al finalizar', () => {
    const base = { nombre: 'Ana', email: 'ana@example.com' };
    const inArea = withGuidance(base, { stage: 'area' });
    assert.deepEqual(getGuidanceState(inArea), { stage: 'area' });
    assert.equal(inArea.nombre, 'Ana');

    const inCareer = withGuidance(base, { stage: 'career', areaId: 'negocios' });
    assert.deepEqual(getGuidanceState(inCareer), { stage: 'career', areaId: 'negocios' });

    const clean = withoutGuidance(inCareer);
    assert.equal(getGuidanceState(clean), null);
    assert.equal(clean.nombre, 'Ana');
    assert.equal(clean.email, 'ana@example.com');
  });

  it('ignora estados corruptos en vez de romper el flujo', () => {
    assert.equal(getGuidanceState({}), null);
    assert.equal(getGuidanceState(null), null);
    assert.equal(getGuidanceState({ pregrado_guidance_stage: 'career' }), null);
    assert.equal(
      getGuidanceState({ pregrado_guidance_stage: 'career', pregrado_guidance_area: 'medicina' }),
      null,
    );
  });
});
