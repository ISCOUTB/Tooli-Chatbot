import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMAS_UTB, getPrograma } from '../services/catalogoUtb';
import {
  FAMILIAS_EXTERNAS,
  ListasRecomendacion,
  TABLA_PREGRADO,
  TIPOS,
  carreraMencionada,
  interpretarPregrado,
  programasAfines,
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

/**
 * Mirada de asesor sobre la tabla: lo que se recomienda en cada nivel, con la
 * lista completa ("Más opciones" incluida), tiene que ser de la misma área.
 */
describe('afinidad de lo recomendado', () => {
  const NIVELES = ['especializacion', 'maestria', 'doctorado'] as const;
  const todo = (pregradoId: string, nivel: (typeof NIVELES)[number]) => {
    const r = recomendar({ pregradoId }, { nivel });
    return [...r.recomendaciones, ...r.resto].map((x) => x.programa);
  };
  const TECNICAS = Object.keys(TABLA_PREGRADO).filter((id) => /^ingenieria-/.test(id) || id === 'ciencia-de-datos');
  // Gestión Territorial y Derecho Urbano sí es de ingeniería civil y arquitectura.
  const AJENO_A_LO_TECNICO = /Negocios Internacionales|Maestría en Derecho|Derecho (Comercial|del Trabajo)|Derechos Humanos|Educaci|Psicosocial|Patrimonio|Contabilidad|Tributaria|Talento|Mercadeo/;

  it('a Ingeniería de Sistemas nunca le sale Negocios Internacionales, y sí Software', () => {
    for (const nivel of NIVELES) {
      const nombres = todo('ingenieria-de-sistemas-y-computacion', nivel).map((p) => p.nombre);
      assert.ok(!nombres.some((n) => /Negocios Internacionales/.test(n)), `${nivel}: ${nombres.join('; ')}`);
    }
    const especializaciones = recomendar({ pregradoId: 'ingenieria-de-sistemas-y-computacion' }, { nivel: 'especializacion' });
    assert.equal(especializaciones.recomendaciones[0].programa.id, 'virtual-ingenieria-de-software');
  });

  it('a las ingenierías y a Ciencia de Datos no les salen programas de negocios, leyes, educación o salud', () => {
    for (const pregradoId of TECNICAS) {
      for (const nivel of NIVELES) {
        const ajenos = todo(pregradoId, nivel).filter((p) => AJENO_A_LO_TECNICO.test(p.nombre)
          || (pregradoId !== 'ingenieria-biomedica' && /Salud/.test(p.nombre) && !/Seguridad y Salud/.test(p.nombre)));
        assert.deepEqual(ajenos.map((p) => p.nombre), [], `${pregradoId} / ${nivel}`);
      }
    }
  });

  it('a Derecho, Psicología y Comunicación no les salen programas de ingeniería', () => {
    for (const pregradoId of ['derecho', 'psicologia', 'comunicacion-social']) {
      for (const nivel of NIVELES) {
        const ajenos = todo(pregradoId, nivel).filter((p) =>
          /Software|Ciberseguridad|Estructural|Geotecnia|Automatizaci|Industria 4|Mantenimiento|Telecomunicaciones|Ingenier/.test(p.nombre));
        assert.deepEqual(ajenos.map((p) => p.nombre), [], `${pregradoId} / ${nivel}`);
      }
    }
  });

  it('pedida una maestría, cada pregrado UTB tiene al menos dos maestrías propias (sin soltar el nivel), salvo Diseño', () => {
    for (const pregradoId of Object.keys(TABLA_PREGRADO).filter((id) => id !== 'diseno')) {
      const r = recomendar({ pregradoId }, { nivel: 'maestria' });
      assert.equal(r.relajado, null, `${pregradoId} tuvo que soltar el nivel`);
    }
  });

  it('pedido un doctorado, cada pregrado UTB tiene al menos uno propio, salvo Diseño', () => {
    for (const pregradoId of Object.keys(TABLA_PREGRADO).filter((id) => id !== 'diseno')) {
      assert.equal(recomendar({ pregradoId }, { nivel: 'doctorado' }).relajado, null, pregradoId);
    }
  });
});

describe('programasAfines', () => {
  it('reúne los tres niveles de la tabla del pregrado o de la familia', () => {
    const sistemas = programasAfines({ pregradoId: 'ingenieria-de-sistemas-y-computacion' }).map((p) => p.id);
    assert.ok(sistemas.includes('virtual-ingenieria-de-software'));
    assert.ok(sistemas.includes('maestria-en-ciberseguridad'));
    assert.ok(sistemas.includes('doctorado-en-ingenieria'));
    assert.ok(!sistemas.includes('especializacion-en-gestion-de-negocios-internacionales'));
    assert.ok(programasAfines({ familiaId: 'salud' }).some((p) => p.id === 'virtual-gerencia-servicios-salud'));
  });

  it('incluye la gemela virtual de un afín (mismo programa y nivel en UTB Virtual), justo después', () => {
    const industrial = programasAfines({ pregradoId: 'ingenieria-industrial' }).map((p) => p.id);
    const presencial = industrial.indexOf('especializacion-en-gerencia-de-la-seguridad-y-salud-en-el-trabajo');
    assert.ok(presencial >= 0);
    assert.equal(industrial[presencial + 1], 'virtual-seguridad-y-salud-trabajo', industrial.join(', '));
    // Sin repetir: Salud ya trae las dos.
    const salud = programasAfines({ familiaId: 'salud' }).map((p) => p.id);
    assert.equal(salud.length, new Set(salud).size);
  });

  it('sin perfil conocido no hay afines', () => {
    assert.deepEqual(programasAfines({}), []);
    assert.deepEqual(programasAfines({ pregradoId: 'medicina' }), []);
  });
});

describe('carreraMencionada', () => {
  it('lee la carrera cuando la persona la declara en su pregunta', () => {
    const sistemas = { tipo: 'utb', pregradoId: 'ingenieria-de-sistemas-y-computacion' };
    assert.deepEqual(carreraMencionada('Soy estudiante de Ingeniería de Sistemas de la UTB, ¿qué especializaciones me recomiendan?'), sistemas);
    assert.deepEqual(carreraMencionada('soy ingeniero de sistemas y quiero una especialización'), sistemas);
    assert.deepEqual(carreraMencionada('Hola, estudio sistemas en la UTB. Qué especializaciones hay?'), sistemas);
    assert.deepEqual(carreraMencionada('estudio derecho en la utb'), { tipo: 'utb', pregradoId: 'derecho' });
    assert.deepEqual(carreraMencionada('Soy egresado de administración de empresas, busco una maestría'), { tipo: 'utb', pregradoId: 'administracion-de-empresas' });
  });

  it('no confunde el posgrado que busca con su carrera', () => {
    for (const texto of [
      'Hola, quiero información de especializaciones',
      'quiero una especialización en finanzas',
      '¿Cuánto cuesta la maestría en negocios internacionales?',
      'soy egresada de la UTB',
      'estudio en la utb',
      'soy de Cartagena',
      '',
    ]) {
      assert.equal(carreraMencionada(texto), null, texto);
    }
  });
});
