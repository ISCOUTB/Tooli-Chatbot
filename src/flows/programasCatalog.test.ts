import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREAS,
  CATEGORIAS,
  POSGRADOS_URL,
  POSGRADOS_VIRTUALES_URL,
  PROGRAMAS,
  esCategoriaValida,
  formatearListado,
  formatearSugerencias,
  getArea,
  normalizeTexto,
  parseAreaSeleccion,
  recomendarPorArea,
  resumenOrientacion,
} from './programasCatalog';

/**
 * G02 — orientación de posgrados. Todo lo afirmado acá sale del catálogo
 * extraído de las páginas oficiales (`services/catalogoUtb.ts`): programas
 * reales y la página oficial de cada uno. Si la orientación inventara un
 * programa o una URL, estos tests lo atraparían.
 */
const URL_OFICIAL = /^https:\/\/(www\.utb\.edu\.co\/posgrados\/|virtual\.utb\.edu\.co\/(especializaciones|maestrias)\/)[a-z0-9-]+\/$/;
describe('normalizeTexto (tildes)', () => {
  it('pliega tildes y mayúsculas como el resto del bot', () => {
    assert.equal(normalizeTexto('Tecnología'), 'tecnologia');
    assert.equal(normalizeTexto('MENÚ'), 'menu');
    assert.equal(normalizeTexto('  Energía Y Ambiente  '), 'energia y ambiente');
  });
});

describe('parseAreaSeleccion (áreas válidas)', () => {
  it('acepta el número de lista del 1 al 7', () => {
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
    assert.equal(parseAreaSeleccion('Derecho y sociedad'), 'derecho_sociedad');
  });

  it('acepta palabras clave de cada área', () => {
    assert.equal(parseAreaSeleccion('ciberseguridad'), 'tecnologia');
    assert.equal(parseAreaSeleccion('tributaria'), 'negocios');
    assert.equal(parseAreaSeleccion('automatización'), 'industria');
    assert.equal(parseAreaSeleccion('derecho'), 'derecho_sociedad');
  });
});

describe('selecciones inválidas', () => {
  it('devuelve null sin adivinar', () => {
    for (const valor of ['', '   ', 'xyz', 'quiero ver el menu', 'menús']) {
      assert.equal(parseAreaSeleccion(valor), null);
    }
  });

  it('el 0 y el 8 no son áreas (navegación, no selección)', () => {
    assert.equal(parseAreaSeleccion('0'), null);
    assert.equal(parseAreaSeleccion('8'), null);
    assert.equal(parseAreaSeleccion('99'), null);
  });

  it('áreas y categorías desconocidas dan vacío, no inventos', () => {
    assert.deepEqual(recomendarPorArea('no-existe'), []);
    assert.deepEqual(recomendarPorArea(''), []);
    assert.equal(formatearSugerencias('no-existe'), null);
    assert.equal(esCategoriaValida('diplomados'), false);
    assert.equal(getArea('no-existe'), undefined);
  });
});

describe('catálogo y URLs oficiales', () => {
  it('las tres categorías son válidas y todas tienen programas', () => {
    for (const c of CATEGORIAS) {
      assert.ok(esCategoriaValida(c));
      assert.ok(PROGRAMAS.some((p) => p.categoria === c), `categoría vacía: ${c}`);
    }
  });

  it('cada programa apunta a su propia página oficial', () => {
    for (const p of PROGRAMAS) assert.match(p.url, URL_OFICIAL, `URL fuera del catálogo: ${p.url}`);
    const urls = PROGRAMAS.map((p) => p.url);
    assert.equal(new Set(urls).size, urls.length, 'dos programas con la misma URL');
  });

  it('las páginas de categoría que ya no existen no se usan', () => {
    for (const area of AREAS) {
      const texto = formatearSugerencias(area.id) ?? '';
      assert.ok(!/posgrado\/(especializaciones|maestrias|doctorados)\//.test(texto), `enlace roto en ${area.id}`);
    }
    for (const c of CATEGORIAS) {
      assert.ok(!/posgrado\/(especializaciones|maestrias|doctorados)\//.test(formatearListado(c)), `enlace roto en ${c}`);
    }
  });

  it('cada sugerencia usa la URL oficial de su programa', () => {
    for (const area of AREAS) {
      for (const s of recomendarPorArea(area.id)) {
        const p = PROGRAMAS.find((x) => x.nombre === s.programa && x.categoria === s.categoria && x.virtual === s.virtual);
        assert.equal(s.url, p?.url);
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

  it('el catálogo no tiene duplicados (un mismo nombre solo se repite entre presencial y virtual)', () => {
    const claves = PROGRAMAS.map((p) => `${p.categoria}::${p.nombre}::${p.virtual}`);
    assert.equal(new Set(claves).size, claves.length, 'duplicado en PROGRAMAS');
  });

  it('las tres categorías tienen al menos una sugerencia en algún área', () => {
    const vistas = new Set(AREAS.flatMap((a) => recomendarPorArea(a.id).map((s) => s.categoria)));
    for (const c of CATEGORIAS) assert.ok(vistas.has(c), `sin sugerencias de ${c}`);
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
    for (const s of recomendarPorArea('tecnologia')) assert.ok(texto?.includes(s.url), `falta ${s.url}`);
    assert.ok(texto?.includes(POSGRADOS_URL));
    // Ingeniería de Software es virtual: se enlaza también el portal de UTB Virtual
    assert.ok(texto?.includes(POSGRADOS_VIRTUALES_URL));
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

describe('formatearListado', () => {
  it('lista todos los programas de la categoría y cabe en un mensaje de WhatsApp', () => {
    for (const c of CATEGORIAS) {
      const texto = formatearListado(c);
      assert.ok(texto.length < 4096, `${c}: ${texto.length} caracteres`);
      for (const p of PROGRAMAS.filter((x) => x.categoria === c)) {
        const corto = p.nombre.replace(/^(Especialización|Maestría) en /, '');
        assert.ok(texto.includes(corto), `${c}: falta ${p.nombre}`);
      }
    }
  });

  it('separa presenciales y virtuales y enlaza los valores oficiales', () => {
    const texto = formatearListado('especializaciones');
    assert.ok(texto.indexOf('*Presenciales*') < texto.indexOf('*Virtuales'));
    assert.ok(texto.includes('Ingeniería de Software — $8.3M/sem'));
    assert.ok(texto.includes('https://www.utb.edu.co/la-utb/derechos-pecuniarios/'));
    assert.ok(formatearListado('doctorados').includes('Doctorado en Ingeniería — 8 SMMLV/sem'));
  });
});
