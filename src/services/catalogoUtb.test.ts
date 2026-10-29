import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NIVELES_POSGRADO,
  POSGRADOS_UTB,
  PROGRAMAS_UTB,
  buscarPrograma,
  fichaPrograma,
  getPrograma,
  valorCorto,
  valorSemestre,
} from './catalogoUtb';

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
