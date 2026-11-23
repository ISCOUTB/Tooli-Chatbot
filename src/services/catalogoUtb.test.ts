import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NIVELES_POSGRADO,
  POSGRADOS_UTB,
  PROGRAMAS_UTB,
  buscarPrograma,
  fichaPrograma,
  getPrograma,
  textoNombraPrograma,
  valorCorto,
  valorSemestre,
  valorTotal,
} from './catalogoUtb';
import { KB_POSGRADOS } from './knowledgeBase';

describe('valor total del programa', () => {
  it('se calcula aquí para que la IA no multiplique (en la prueba con IA real se equivocó)', () => {
    const doctorado = getPrograma('doctorado-en-administracion')!;
    assert.equal(valorTotal(doctorado), '$112.943.200 en total (8 semestres)');
    assert.ok(fichaPrograma(doctorado).includes('Valor total del programa: $112.943.200 en total (8 semestres)'));
    assert.ok(KB_POSGRADOS.includes('$112.943.200 en total (8 semestres)'));
  });

  it('sin valor o sin duración no se inventa un total', () => {
    for (const p of POSGRADOS_UTB) {
      if (p.inversion_cop == null || !p.duracion_semestres) assert.equal(valorTotal(p), null, p.nombre);
    }
  });
});

/**
 * Catálogo extraído de las páginas oficiales de la UTB. Las pruebas cuidan
 * que lo empaquetado sea coherente y que la búsqueda por nombre (que usa la
 * IA) encuentre el programa correcto sin inventar coincidencias.
 */
describe('catálogo empaquetado', () => {
  it('trae pregrados y los tres niveles de posgrado, solo de la oferta vigente', () => {
    for (const nivel of ['pregrado', ...NIVELES_POSGRADO]) {
      assert.ok(PROGRAMAS_UTB.some((p) => p.nivel === nivel), `sin programas de ${nivel}`);
    }
    assert.ok(PROGRAMAS_UTB.every((p) => p.oferta_vigente));
    assert.ok(POSGRADOS_UTB.every((p) => p.nivel !== 'pregrado'));
  });

  it('cada programa tiene id único, nombre y página oficial de la UTB', () => {
    const ids = PROGRAMAS_UTB.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of PROGRAMAS_UTB) {
      assert.ok(p.nombre, p.id);
      assert.match(p.url, /^https:\/\/(www|virtual)\.utb\.edu\.co\//, p.id);
    }
  });

  it('los valores salen en pesos o en el texto publicado (SMMLV)', () => {
    assert.equal(valorSemestre(getPrograma('maestria-en-ciberseguridad')!), '$13.000.000/sem');
    assert.equal(valorCorto(getPrograma('doctorado-en-desarrollo-regional-y-local')!), '$15.13M/sem');
    assert.equal(valorSemestre(getPrograma('doctorado-en-ingenieria')!), '8 SMMLV/sem');
    // UTB Virtual no publica el valor en la ficha: viene de derechos pecuniarios
    assert.equal(valorSemestre(getPrograma('virtual-ingenieria-de-software')!), '$8.300.000/sem');
  });
});

describe('buscarPrograma', () => {
  const ids = (q: string, niveles?: Parameters<typeof buscarPrograma>[1]) => buscarPrograma(q, niveles).map((p) => p.id);

  it('encuentra por nombre completo, con o sin tildes', () => {
    assert.deepEqual(ids('Maestría en Ciberseguridad'), ['maestria-en-ciberseguridad']);
    assert.deepEqual(ids('maestria en ciberseguridad'), ['maestria-en-ciberseguridad']);
  });

  it('encuentra por siglas y nombres parciales', () => {
    assert.deepEqual(ids('MBA'), ['maestria-en-administracion']);
    assert.deepEqual(ids('Ingeniería de Sistemas'), ['ingenieria-de-sistemas-y-computacion']);
    assert.deepEqual(ids('Psicología'), ['psicologia']);
  });

  it('usa el nivel pedido para desempatar', () => {
    assert.deepEqual(ids('Especialización en Gerencia de Proyectos'), ['especializacion-en-gerencia-de-proyectos']);
    assert.deepEqual(ids('Maestría en Gerencia de Proyectos'), ['maestria-en-gerencia-de-proyectos']);
    assert.equal(ids('Gerencia de Proyectos').length, 2, 'sin nivel es ambiguo');
  });

  it('distingue la versión virtual cuando se pide', () => {
    const nombre = 'Especialización en Gerencia de la Seguridad y Salud en el Trabajo';
    // la UTB ofrece el mismo nombre presencial y virtual: sin modalidad es ambiguo
    assert.equal(ids(nombre).length, 2);
    assert.deepEqual(ids(`${nombre} virtual`), ['virtual-seguridad-y-salud-trabajo']);
    assert.deepEqual(ids(`${nombre} presencial`), ['especializacion-en-gerencia-de-la-seguridad-y-salud-en-el-trabajo']);
    assert.deepEqual(ids('Seguridad y Salud en el Trabajo virtual'), ['virtual-seguridad-y-salud-trabajo']);
  });

  it('respeta el filtro de niveles (la IA de posgrados no recibe pregrados)', () => {
    assert.deepEqual(ids('Psicología', NIVELES_POSGRADO), []);
    assert.deepEqual(ids('Ingeniería Civil', NIVELES_POSGRADO), []);
  });

  it('no inventa coincidencias', () => {
    for (const q of ['', '   ', 'Medicina', 'Maestría en Astrofísica', 'Logística del Transporte']) {
      assert.deepEqual(ids(q), [], q);
    }
  });

  // A un estudiante de Sistemas le llegó el flyer de un programa ajeno: la IA
  // consulta nombres a medias y una palabra de área elegía un programa al azar.
  it('una palabra de área sola no elige un programa: devuelve varios o ninguno', () => {
    for (const q of [
      'Especialización en Sistemas', 'especialización en sistemas', 'Maestría en Sistemas', 'sistemas',
      'especialización en ingeniería', 'Especialización en Ingeniería de Sistemas',
      'maestría en gestión', 'Especialización en Gestión', 'gestión',
      'especialización en negocios', 'Maestría en Negocios', 'negocios',
      'especialización en gerencia', 'especialización en tecnología',
    ]) {
      assert.notEqual(ids(q, NIVELES_POSGRADO).length, 1, `${q} → ${ids(q, NIVELES_POSGRADO).join(', ')}`);
    }
  });

  it('los nombres reales se siguen encontrando, también los que solo tienen palabras de área', () => {
    for (const p of POSGRADOS_UTB) {
      assert.ok(ids(p.nombre, NIVELES_POSGRADO).includes(p.id), p.nombre);
    }
    assert.deepEqual(ids('Especialización en Sistemas Energéticos', NIVELES_POSGRADO), ['especializacion-sistemas-energeticos-sostenibles']);
    assert.deepEqual(ids('Especialización en Negocios Internacionales', NIVELES_POSGRADO), ['especializacion-en-gestion-de-negocios-internacionales']);
    assert.deepEqual(ids('Maestría en Negocios Internacionales', NIVELES_POSGRADO), ['maestria-negocios-internacionales-e-integracion']);
    assert.deepEqual(ids('Maestría en Administración', NIVELES_POSGRADO), ['maestria-en-administracion']);
    assert.deepEqual(ids('Maestría en Ingeniería', NIVELES_POSGRADO), ['maestria-en-ingenieria']);
    assert.deepEqual(ids('Especialización en Ingeniería de Software', NIVELES_POSGRADO), ['virtual-ingenieria-de-software']);
    assert.deepEqual(ids('Especialización en Gestión Ambiental', NIVELES_POSGRADO), ['especializacion-en-gestion-ambiental-sostenible']);
    assert.deepEqual(ids('Ingeniería de Sistemas', ['pregrado']), ['ingenieria-de-sistemas-y-computacion']);
  });
});

describe('textoNombraPrograma', () => {
  const nombra = (texto: string, id: string) => textoNombraPrograma(texto, getPrograma(id)!);
  const NI = 'especializacion-en-gestion-de-negocios-internacionales';

  it('reconoce el programa cuando la persona lo nombra', () => {
    assert.ok(nombra('¿Cuánto cuesta la especialización en negocios internacionales?', NI));
    assert.ok(nombra('háblame de gestión de negocios internacionales', NI));
    assert.ok(nombra('cuánto vale el MBA', 'maestria-en-administracion'));
    assert.ok(nombra('me interesa la maestría en ingeniería', 'maestria-en-ingenieria'));
    assert.ok(nombra('info de sistemas energéticos', 'especializacion-sistemas-energeticos-sostenibles'));
    assert.ok(nombra('quiero estudiar ciberseguridad', 'maestria-en-ciberseguridad'));
  });

  it('no lo da por nombrado por una palabra de área o una que comparte con otro', () => {
    const pregunta = 'Soy estudiante de ingeniería de sistemas, ¿qué especializaciones me recomiendan?';
    assert.ok(!nombra(pregunta, NI));
    assert.ok(!nombra(pregunta, 'especializacion-sistemas-energeticos-sostenibles'));
    assert.ok(!nombra(pregunta, 'maestria-en-ingenieria'));
    assert.ok(!nombra('quiero información de especializaciones', NI));
    assert.ok(!nombra('estándares internacionales de contabilidad', NI));
    assert.ok(!nombra('algo de negocios', NI));
  });
});

describe('fichaPrograma', () => {
  it('incluye los datos clave y la página oficial, sin pasar del límite', () => {
    for (const p of PROGRAMAS_UTB) {
      const ficha = fichaPrograma(p);
      assert.ok(ficha.length <= 6000, `${p.id}: ${ficha.length}`);
      assert.ok(ficha.includes(p.nombre));
      assert.ok(ficha.includes(p.url));
    }
    const ficha = fichaPrograma(getPrograma('maestria-en-ciberseguridad')!);
    assert.ok(ficha.includes('Semestre 1: Ciberseguridad en la red'));
    assert.ok(ficha.includes('SNIES: 116394'));
    assert.ok(ficha.includes('$13.000.000/sem'));
  });

  it('dice cuando el valor no está publicado en vez de inventarlo', () => {
    const sinValor = PROGRAMAS_UTB.find((p) => valorSemestre(p) === null);
    assert.ok(sinValor, 'se esperaba al menos un programa sin valor publicado');
    assert.ok(fichaPrograma(sinValor).includes('no publicado; confirmar con la UTB'));
  });
});
