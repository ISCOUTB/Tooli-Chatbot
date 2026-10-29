import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMAS_UTB, getPrograma } from '../services/catalogoUtb';
import {
  FAMILIAS_EXTERNAS,
  ListasRecomendacion,
  TABLA_PREGRADO,
  TIPOS,
  interpretarPregrado,
  motivo,
  recomendar,
} from './recomendacionPregrado';

/**
 * Motor del flujo de recomendación por pregrado. Las pruebas cuidan que la
 * tabla curada no recomiende programas inexistentes ni de otro nivel, que
 * cubra todos los pregrados UTB y que la selección respete los filtros.
 */
const TODAS: [string, ListasRecomendacion][] = [
  ...Object.entries(TABLA_PREGRADO),
  ...FAMILIAS_EXTERNAS.map((f) => [`familia:${f.id}`, f.listas] as [string, ListasRecomendacion]),
];
const ids = (r: ReturnType<typeof recomendar>['recomendaciones']) => r.map((x) => x.programa.id);

describe('tabla curada', () => {
  it('cubre todos los pregrados UTB vigentes y solo esos', () => {
    const pregrados = PROGRAMAS_UTB.filter((p) => p.nivel === 'pregrado').map((p) => p.id).sort();
    assert.deepEqual(Object.keys(TABLA_PREGRADO).sort(), pregrados);
  });

  it('solo recomienda posgrados vigentes del catálogo', () => {
    for (const [origen, listas] of TODAS) {
      for (const tipo of TIPOS) {
        for (const id of listas[tipo]) {
          const p = getPrograma(id);
          assert.ok(p, `${origen}: ${id} no existe en el catálogo`);
          assert.notEqual(p.nivel, 'pregrado', `${origen}: ${id} es un pregrado`);
        }
      }
    }
  });

  it('no repite programas dentro de un mismo origen y siempre hay al menos 2 que profundizan', () => {
    for (const [origen, listas] of TODAS) {
      const todos = TIPOS.flatMap((t) => listas[t]);
      assert.equal(new Set(todos).size, todos.length, `${origen} repite un programa`);
      assert.ok(listas.profundiza.length >= 2, `${origen}: menos de 2 en profundiza`);
    }
  });

  it('la investigación solo apunta a maestrías o doctorados', () => {
    for (const [origen, listas] of TODAS) {
      for (const id of listas.investiga) {
        assert.match(getPrograma(id)!.nivel, /^(maestria|doctorado)$/, `${origen}: ${id}`);
      }
    }
  });

  it('los motivos no prometen admisión ni empleo', () => {
    for (const tipo of TIPOS) {
      const t = motivo(tipo, 'Ingeniería Civil');
      assert.ok(!/garantiz|asegurad|empleo/i.test(t), t);
    }
  });
});

describe('interpretarPregrado', () => {
  const utb = (texto: string) => {
    const r = interpretarPregrado(texto);
    return r?.tipo === 'utb' ? r.pregradoId : r;
  };
  const familia = (texto: string) => {
    const r = interpretarPregrado(texto);
    return r?.tipo === 'familia' ? r.familiaId : r;
  };

  it('reconoce los nombres de los pregrados UTB, con o sin tildes', () => {
    assert.equal(utb('Ingeniería Industrial'), 'ingenieria-industrial');
    assert.equal(utb('ingenieria de sistemas'), 'ingenieria-de-sistemas-y-computacion');
    assert.equal(utb('Derecho'), 'derecho');
    assert.equal(utb('Contaduría Pública Virtual'), 'virtual-contaduria-publica');
  });

  it('asocia carreras equivalentes de otras universidades', () => {
    assert.equal(utb('Informática'), 'ingenieria-de-sistemas-y-computacion');
    assert.equal(utb('Contador público'), 'contaduria-publica');
    assert.equal(utb('abogada'), 'derecho');
    assert.equal(utb('Comercio Exterior'), 'finanzas-y-negocios-internacionales');
    assert.equal(utb('Administración de Negocios'), 'administracion-de-empresas');
    assert.equal(utb('Periodismo'), 'comunicacion-social');
    assert.equal(utb('Publicidad'), 'marketing-y-transformacion-digital');
    assert.equal(utb('Ingeniería Electrónica y Telecomunicaciones'), 'ingenieria-electronica');
    assert.equal(utb('Ingeniería Sanitaria'), 'ingenieria-ambiental');
  });

  it('no confunde una ciencia básica con la ingeniería del mismo nombre', () => {
    assert.equal(familia('Química'), 'ciencias_basicas');
    assert.equal(utb('Ingeniería Química'), 'ingenieria-quimica');
  });

  it('usa las familias externas cuando no hay un pregrado UTB parecido', () => {
    assert.equal(familia('Medicina'), 'salud');
    assert.equal(familia('Enfermería'), 'salud');
    assert.equal(familia('Química Farmacéutica'), 'salud');
    assert.equal(familia('Matemáticas'), 'ciencias_basicas');
    assert.equal(familia('Sociología'), 'humanidades');
    assert.equal(familia('Turismo'), 'humanidades');
  });

  it('una licenciatura es educación aunque nombre otra disciplina', () => {
    assert.equal(familia('Licenciatura en Matemáticas'), 'educacion');
    assert.equal(familia('Licenciatura en Informática'), 'educacion');
    assert.equal(familia('Pedagogía Infantil'), 'educacion');
  });

  it('devuelve null en vez de adivinar', () => {
    for (const texto of ['', '   ', 'xyz', 'Medicina Veterinaria', 'Agronomía', 'ingeniería']) {
      assert.equal(interpretarPregrado(texto), null, texto);
    }
  });
});

describe('recomendar', () => {
  it('sin filtros da 4: dos que profundizan, una que complementa y una de investigación', () => {
    const r = recomendar({ pregradoId: 'ingenieria-civil' });
    assert.deepEqual(r.recomendaciones.map((x) => x.tipo), ['profundiza', 'profundiza', 'complementa', 'investiga']);
    assert.deepEqual(ids(r.recomendaciones), [
      'especializacion-en-analisis-y-diseno-estructural',
      'especializacion-en-geotecnia-vial-y-pavimentos',
      'especializacion-en-gerencia-de-proyectos',
      'maestria-en-ingenieria',
    ]);
    assert.equal(r.relajado, null);
    assert.ok(r.resto.length > 0, 'debe quedar algo para "Más opciones"');
  });

  it('el resto no repite lo ya recomendado', () => {
    for (const pregradoId of Object.keys(TABLA_PREGRADO)) {
      const r = recomendar({ pregradoId });
      const mostrados = new Set(ids(r.recomendaciones));
      assert.ok(r.resto.every((x) => !mostrados.has(x.programa.id)), pregradoId);
      assert.ok(r.recomendaciones.length >= 2 && r.recomendaciones.length <= 4, pregradoId);
    }
  });

  it('si un tipo no tiene programas, su cupo pasa al siguiente', () => {
    // Diseño no tiene ruta de investigación en la tabla
    const r = recomendar({ pregradoId: 'diseno' });
    assert.equal(r.recomendaciones.length, 4);
    assert.ok(r.recomendaciones.every((x) => x.tipo !== 'investiga'));
  });

  it('respeta el nivel pedido', () => {
    const r = recomendar({ pregradoId: 'ingenieria-industrial' }, { nivel: 'maestria' });
    assert.ok(r.recomendaciones.length >= 2);
    assert.ok(r.recomendaciones.every((x) => x.programa.nivel === 'maestria'));
    assert.equal(r.relajado, null);
  });

  it('con doctorado basta uno; si no hay ninguno, suelta el nivel y lo avisa', () => {
    const civil = recomendar({ pregradoId: 'ingenieria-civil' }, { nivel: 'doctorado' });
    assert.deepEqual(ids(civil.recomendaciones), ['doctorado-en-ingenieria']);
    assert.equal(civil.relajado, null);

    const diseno = recomendar({ pregradoId: 'diseno' }, { nivel: 'doctorado' });
    assert.equal(diseno.relajado, 'nivel');
    assert.ok(diseno.recomendaciones.length >= 2);
  });

  it('solo virtuales: filtra si alcanza y, si no, suelta la modalidad', () => {
    const derecho = recomendar({ pregradoId: 'derecho' }, { soloVirtual: true });
    assert.deepEqual(ids(derecho.recomendaciones), ['virtual-contratacion-estatal', 'virtual-derechos-humanos']);
    assert.equal(derecho.relajado, null);

    const civil = recomendar({ pregradoId: 'ingenieria-civil' }, { soloVirtual: true });
    assert.equal(civil.relajado, 'modalidad');
    assert.ok(civil.recomendaciones.length >= 2);
  });

  it('funciona con familias externas', () => {
    const r = recomendar({ familiaId: 'salud' });
    assert.equal(r.recomendaciones[0].programa.id, 'virtual-gerencia-servicios-salud');
    assert.match(r.recomendaciones[0].motivo, /área de la salud/);
  });

  it('un perfil desconocido da vacío, no inventos', () => {
    assert.deepEqual(recomendar({}).recomendaciones, []);
    assert.deepEqual(recomendar({ pregradoId: 'medicina' }).recomendaciones, []);
    assert.deepEqual(recomendar({ familiaId: 'no-existe' }).recomendaciones, []);
  });
});
