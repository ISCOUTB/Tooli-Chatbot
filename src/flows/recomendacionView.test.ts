import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POSGRADOS_URL, POSGRADOS_VIRTUALES_URL } from '../services/catalogoUtb';
import { TABLA_PREGRADO, recomendar } from './recomendacionPregrado';
import {
  BOTONES_CONFIRMAR,
  BOTONES_SIN_COINCIDENCIA,
  ContextoResultados,
  FILAS_GRUPOS,
  FILAS_NIVEL,
  FILAS_RELACION,
  FilaLista,
  GRUPOS_PREGRADO,
  MAX_BOTON,
  MAX_DESCRIPCION_FILA,
  MAX_FILAS,
  MAX_TEXTO,
  MAX_TITULO_FILA,
  filasAcciones,
  filasPregrados,
  formatearResultados,
  getGrupo,
  parseAccion,
  parseGrupo,
  parseNivel,
  parsePregrado,
  parseRelacion,
  parseSiNo,
  parseSinCoincidencia,
  textoConfirmacion,
} from './recomendacionView';

/**
 * Vista del flujo de recomendación: que todo quepa en las listas y botones
 * de WhatsApp, que las respuestas (tocadas o escritas) se entiendan y que
 * los textos lleven enlaces oficiales sin prometer nada.
 */
function cabeEnLista(filas: readonly FilaLista[], donde: string): void {
  assert.ok(filas.length >= 1 && filas.length <= MAX_FILAS, `${donde}: ${filas.length} filas`);
  assert.equal(new Set(filas.map((f) => f.id)).size, filas.length, `${donde}: ids repetidos`);
  for (const f of filas) {
    assert.ok(f.title.length <= MAX_TITULO_FILA, `${donde}: título largo "${f.title}"`);
    assert.ok((f.description ?? '').length <= MAX_DESCRIPCION_FILA, `${donde}: descripción larga "${f.description}"`);
  }
}

const ctxBase: ContextoResultados = {
  relacion: 'estudiante_utb',
  etiquetaPregrado: 'Ingeniería Civil',
  nivel: '',
  soloVirtual: false,
};

describe('listas y botones caben en WhatsApp', () => {
  it('relación, escuelas, pregrados y niveles', () => {
    cabeEnLista(FILAS_RELACION, 'relación');
    cabeEnLista(FILAS_GRUPOS, 'escuelas');
    cabeEnLista(FILAS_NIVEL, 'niveles');
    for (const grupo of GRUPOS_PREGRADO) cabeEnLista(filasPregrados(grupo), grupo.id);
  });

  it('acciones tras recomendar, en todas sus variantes', () => {
    const r = recomendar({ pregradoId: 'ingenieria-civil' });
    for (const soloVirtual of [false, true]) {
      for (const yaVioMas of [false, true]) {
        cabeEnLista(filasAcciones(r, { ...ctxBase, soloVirtual }, yaVioMas), `acciones ${soloVirtual} ${yaVioMas}`);
      }
    }
  });

  it('los botones no pasan de 20 caracteres', () => {
    for (const b of [...BOTONES_CONFIRMAR, ...BOTONES_SIN_COINCIDENCIA]) {
      assert.ok(b.displayText.length <= MAX_BOTON, `botón largo "${b.displayText}" (${b.displayText.length})`);
    }
  });

  it('las escuelas cubren cada pregrado UTB exactamente una vez', () => {
    const enGrupos = GRUPOS_PREGRADO.flatMap((g) => g.pregrados);
    assert.equal(new Set(enGrupos).size, enGrupos.length, 'un pregrado está en dos escuelas');
    assert.deepEqual([...enGrupos].sort(), Object.keys(TABLA_PREGRADO).sort());
  });
});

describe('lectura de respuestas', () => {
  it('relación: por número o escrita', () => {
    assert.deepEqual(parseRelacion('1'), { tipo: 'relacion', relacion: 'estudiante_utb' });
    assert.deepEqual(parseRelacion('Egresado'), { tipo: 'relacion', relacion: 'egresado_utb' });
    assert.deepEqual(parseRelacion('otra universidad'), { tipo: 'relacion', relacion: 'externo' });
    assert.deepEqual(parseRelacion('4'), { tipo: 'salida', salida: 'pregrado' });
    assert.deepEqual(parseRelacion('notas'), { tipo: 'salida', salida: 'otras_gestiones' });
    for (const x of ['', '9', 'hola']) assert.equal(parseRelacion(x), null, x);
  });

  it('escuela: número, nombre, "ingeniería" o directamente el pregrado', () => {
    assert.deepEqual(parseGrupo('1'), { tipo: 'grupo', grupoId: 'ingenierias' });
    assert.deepEqual(parseGrupo('Transformación Digital'), { tipo: 'grupo', grupoId: 'transformacion_digital' });
    assert.deepEqual(parseGrupo('ingeniería'), { tipo: 'grupo', grupoId: 'ingenierias' });
    assert.deepEqual(parseGrupo('Psicología'), { tipo: 'pregrado', pregradoId: 'psicologia' });
    for (const x of ['', '0', '5', 'Medicina']) assert.equal(parseGrupo(x), null, x);
  });

  it('pregrado: número dentro de la escuela o nombre de cualquier pregrado UTB', () => {
    const ing = getGrupo('ingenierias');
    assert.equal(parsePregrado('2', ing), 'ingenieria-industrial');
    assert.equal(parsePregrado('Derecho', ing), 'derecho');
    assert.equal(parsePregrado('11', ing), null);
    assert.equal(parsePregrado('Medicina', ing), null, 'un pregrado que no es de la UTB no vale aquí');
  });

  it('confirmación, alternativas, nivel y acciones', () => {
    assert.equal(parseSiNo('Sí'), 'si');
    assert.equal(parseSiNo('no'), 'no');
    assert.equal(parseSiNo('tal vez'), null);
    assert.equal(parseSinCoincidencia('lista'), 'lista');
    assert.equal(parseSinCoincidencia('Elegir un área'), 'area');
    assert.equal(parseNivel('2'), 'maestria');
    assert.equal(parseNivel('Maestría'), 'maestria');
    assert.equal(parseNivel('4'), '', '"Aún no sé" no filtra');
    assert.equal(parseNivel('9'), null);
    assert.equal(parseAccion('mas'), 'mas');
    assert.equal(parseAccion('Solo virtuales'), 'virtual');
    assert.equal(parseAccion('xyz'), null);
  });

  it('la confirmación nombra el pregrado UTB o la familia', () => {
    assert.match(textoConfirmacion({ tipo: 'utb', pregradoId: 'ingenieria-industrial' })!, /Ingeniería Industrial/);
    assert.match(textoConfirmacion({ tipo: 'familia', familiaId: 'salud' })!, /Salud/);
    assert.equal(textoConfirmacion({ tipo: 'utb', pregradoId: 'no-existe' }), null);
  });
});

describe('formatearResultados', () => {
  it('cabe en un mensaje y enlaza cada programa, para todos los pregrados y filtros', () => {
    for (const pregradoId of Object.keys(TABLA_PREGRADO)) {
      for (const nivel of ['', 'especializacion', 'maestria', 'doctorado'] as const) {
        for (const soloVirtual of [false, true]) {
          const r = recomendar({ pregradoId }, { nivel: nivel || null, soloVirtual });
          const ctx = { ...ctxBase, nivel, soloVirtual };
          for (const mas of [false, true]) {
            const texto = formatearResultados(r, ctx, { mas });
            assert.ok(texto.length < MAX_TEXTO, `${pregradoId}: ${texto.length} caracteres`);
            for (const x of mas ? r.resto : r.recomendaciones) assert.ok(texto.includes(x.programa.url));
            assert.ok(texto.includes(POSGRADOS_URL));
            assert.ok(!/garantiz|asegurad/i.test(texto));
          }
        }
      }
    }
  });

  it('el beneficio de egresado solo se menciona a egresados', () => {
    const r = recomendar({ pregradoId: 'ingenieria-civil' });
    assert.ok(!formatearResultados(r, ctxBase).includes('egresado(a) UTB'));
    assert.ok(formatearResultados(r, { ...ctxBase, relacion: 'egresado_utb' }).includes('egresado(a) UTB'));
  });

  it('avisa cuando tuvo que soltar un filtro y enlaza UTB Virtual si hay virtuales', () => {
    const civil = recomendar({ pregradoId: 'ingenieria-civil' }, { soloVirtual: true });
    assert.match(formatearResultados(civil, { ...ctxBase, soloVirtual: true }), /incluí también presenciales/);

    const diseno = recomendar({ pregradoId: 'diseno' }, { nivel: 'doctorado' });
    assert.match(formatearResultados(diseno, { ...ctxBase, nivel: 'doctorado' }), /No encontré suficientes doctorados/);

    const sistemas = recomendar({ pregradoId: 'ingenieria-de-sistemas-y-computacion' });
    assert.ok(formatearResultados(sistemas, ctxBase).includes(POSGRADOS_VIRTUALES_URL));
  });

  it('"Más opciones" sigue la numeración y solo se ofrece si hay más', () => {
    const r = recomendar({ pregradoId: 'ingenieria-civil' });
    assert.match(formatearResultados(r, ctxBase, { mas: true }), new RegExp(`^${r.recomendaciones.length + 1}\\. `, 'm'));
    assert.ok(filasAcciones(r, ctxBase, false).some((f) => f.id === 'mas'));
    assert.ok(!filasAcciones(r, ctxBase, true).some((f) => f.id === 'mas'));
  });
});
