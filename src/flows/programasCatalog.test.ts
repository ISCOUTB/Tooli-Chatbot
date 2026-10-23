import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREAS,
  CATEGORIA_URLS,
  POSGRADOS_URL,
  PROGRAMAS,
  URLS_OFICIALES,
  categoriaUrl,
  esCategoriaValida,
  formatearSugerencias,
  getArea,
  normalizeTexto,
  parseAreaSeleccion,
  recomendarPorArea,
  resumenOrientacion,
} from './programasCatalog';

/**
 * G02 — orientación de posgrados. Todo lo afirmado acá sale del repo
 * (`knowledgeBase.ts`): programas reales y sus enlaces oficiales de
 * categoría. Si el catálogo inventara un programa o una URL, estos tests
 * lo atraparían.
 */
describe('normalizeTexto (tildes)', () => {
  it('pliega tildes y mayúsculas como el resto del bot', () => {
    assert.equal(normalizeTexto('Tecnología'), 'tecnologia');
    assert.equal(normalizeTexto('MENÚ'), 'menu');
    assert.equal(normalizeTexto('  Energía Y Ambiente  '), 'energia y ambiente');
  });
});

describe('parseAreaSeleccion (áreas válidas)', () => {
  it('acepta el número de lista del 1 al 6', () => {
    const ids = AREAS.map((a) => a.id);
    for (let i = 0; i < AREAS.length; i++) {
      assert.equal(parseAreaSeleccion(String(i + 1)), ids[i]);
    }
  });

  it('acepta título e id con o sin tildes', () => {
    assert.equal(parseAreaSeleccion('Tecnología y sistemas'), 'tecnologia');
    assert.equal(parseAreaSeleccion('tecnologia y sistemas'), 'tecnologia');
    assert.equal(parseAreaSeleccion('TECNOLOGÍA Y SISTEMAS'), 'tecnologia');
    assert.equal(parseAreaSeleccion(' salud y educación '), 'salud_educacion');
    assert.equal(parseAreaSeleccion('salud_educacion'), 'salud_educacion');
    assert.equal(parseAreaSeleccion('Energía y ambiente'), 'energia');
  });

  it('acepta palabras clave de cada área', () => {
    assert.equal(parseAreaSeleccion('ciberseguridad'), 'tecnologia');
    assert.equal(parseAreaSeleccion('tributaria'), 'negocios');
    assert.equal(parseAreaSeleccion('automatización'), 'industria');
  });
});

describe('selecciones inválidas', () => {
  it('devuelve null sin adivinar', () => {
    for (const valor of ['', '   ', 'xyz', 'quiero ver el menu', 'menús']) {
      assert.equal(parseAreaSeleccion(valor), null);
    }
  });

  it('el 0 y el 7 no son áreas (navegación, no selección)', () => {
    assert.equal(parseAreaSeleccion('0'), null);
    assert.equal(parseAreaSeleccion('7'), null);
    assert.equal(parseAreaSeleccion('99'), null);
  });

  it('áreas y categorías desconocidas dan vacío, no inventos', () => {
    assert.deepEqual(recomendarPorArea('no-existe'), []);
    assert.deepEqual(recomendarPorArea(''), []);
    assert.equal(formatearSugerencias('no-existe'), null);
    assert.equal(categoriaUrl('diplomados'), null);
    assert.equal(categoriaUrl(''), null);
    assert.equal(getArea('no-existe'), undefined);
  });
});

describe('categorías válidas y URLs oficiales', () => {
  it('las tres categorías son válidas y apuntan a su URL oficial', () => {
    assert.ok(esCategoriaValida('especializaciones'));
    assert.ok(esCategoriaValida('maestrias'));
    assert.ok(esCategoriaValida('doctorados'));
    assert.equal(categoriaUrl('especializaciones'), 'https://www.utb.edu.co/posgrado/especializaciones/');
    assert.equal(categoriaUrl('maestrias'), 'https://www.utb.edu.co/posgrado/maestrias/');
    assert.equal(categoriaUrl('doctorados'), 'https://www.utb.edu.co/posgrado/doctorados/');
  });

  it('solo hay cuatro URLs oficiales y todas son del dominio posgrado UTB', () => {
    assert.equal(URLS_OFICIALES.length, 4);
    for (const url of URLS_OFICIALES) {
      assert.ok(url.startsWith('https://www.utb.edu.co/posgr'), `URL fuera del catálogo: ${url}`);
    }
    assert.ok(URLS_OFICIALES.includes(POSGRADOS_URL));
    assert.ok(URLS_OFICIALES.includes(CATEGORIA_URLS.maestrias));
  });

  it('cada sugerencia usa la URL oficial de su categoría', () => {
    for (const area of AREAS) {
      for (const s of recomendarPorArea(area.id)) {
        assert.equal(s.url, CATEGORIA_URLS[s.categoria]);
        assert.ok(URLS_OFICIALES.includes(s.url));
      }
    }
  });
});

describe('sugerencias reales y sin duplicados', () => {
  it('cada área devuelve entre 2 y 4 sugerencias', () => {
    assert.ok(AREAS.length >= 3 && AREAS.length <= 8);
    for (const area of AREAS) {
      const sugs = recomendarPorArea(area.id);
      assert.ok(sugs.length >= 2 && sugs.length <= 4, `${area.id}: ${sugs.length}`);
    }
  });

  it('ningún área repite programas', () => {
    for (const area of AREAS) {
      const nombres = recomendarPorArea(area.id).map((s) => `${s.categoria}::${s.programa}`);
      assert.equal(new Set(nombres).size, nombres.length, `duplicado en ${area.id}`);
    }
  });

  it('toda sugerencia existe en el catálogo (nada inventado)', () => {
    const reales = new Set(PROGRAMAS.map((p) => `${p.categoria}::${p.nombre}`));
    for (const area of AREAS) {
      for (const s of recomendarPorArea(area.id)) {
        assert.ok(reales.has(`${s.categoria}::${s.programa}`), `invento: ${s.programa}`);
      }
    }
  });

  it('el catálogo no tiene duplicados y todo programa aparece en al menos un área', () => {
    const claves = PROGRAMAS.map((p) => `${p.categoria}::${p.nombre}`);
    assert.equal(new Set(claves).size, claves.length, 'duplicado en PROGRAMAS');
    const cubiertos = new Set<string>();
    for (const area of AREAS) {
      for (const s of recomendarPorArea(area.id)) cubiertos.add(`${s.categoria}::${s.programa}`);
    }
    for (const clave of claves) {
      assert.ok(cubiertos.has(clave), `programa huérfano: ${clave}`);
    }
  });

  it('ni el texto ni los encajes prometen admisión o empleabilidad', () => {
    const textos: string[] = [];
    for (const area of AREAS) {
      const t = formatearSugerencias(area.id);
      assert.ok(t, `sin texto para ${area.id}`);
      textos.push(t as string);
      for (const s of recomendarPorArea(area.id)) textos.push(s.encaje);
    }
    for (const t of textos) {
      assert.ok(!/garantiz/i.test(t), `promesa indebida: ${t}`);
      assert.ok(!/empleo asegurado/i.test(t), `promesa indebida: ${t}`);
      assert.ok(!/admisi.n asegurada/i.test(t), `promesa indebida: ${t}`);
    }
  });

  it('el texto incluye los programas y sus enlaces oficiales', () => {
    const texto = formatearSugerencias('tecnologia');
    assert.ok(texto?.includes('Maestría en Ciberseguridad'));
    assert.ok(texto?.includes(CATEGORIA_URLS.maestrias));
    assert.ok(texto?.includes(CATEGORIA_URLS.especializaciones));
    assert.ok(texto?.includes(POSGRADOS_URL));
  });

  it('el contexto para IA y asesor usa únicamente el catálogo del área guardada', () => {
    const resumen = resumenOrientacion('tecnologia');
    assert.ok(resumen?.includes('Tecnología y sistemas'));
    for (const sugerencia of recomendarPorArea('tecnologia')) {
      assert.ok(resumen?.includes(sugerencia.programa));
    }
    assert.equal(resumenOrientacion('area-inventada'), null);
  });
});
