import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* Igual que en format.test.js: el módulo importa utilidades que tocan el DOM al
   cargarse, pero las funciones que se prueban aquí son puras. */
globalThis.document ??= {
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  body: { appendChild() {} },
};

let C;
before(async () => { C = await import('./crm.js'); });

describe('programaCategoria', () => {
  it('reconoce los tres niveles de posgrado', () => {
    assert.equal(C.programaCategoria('Doctorado en Ingeniería'), 'doctorado');
    assert.equal(C.programaCategoria('Maestría en Marketing'), 'maestria');
    assert.equal(C.programaCategoria('Especialización en Finanzas'), 'especializacion');
  });

  it('reconoce "maestria" sin tilde, que es como se escribe medio Sheet', () => {
    assert.equal(C.programaCategoria('maestria en ingenieria'), 'maestria');
  });

  it('no depende de mayúsculas', () => {
    assert.equal(C.programaCategoria('DOCTORADO EN INGENIERÍA'), 'doctorado');
  });

  it('todo lo demás cae en "otro" en vez de perderse', () => {
    assert.equal(C.programaCategoria('Diplomado en algo'), 'otro');
    assert.equal(C.programaCategoria(''), 'otro');
    assert.equal(C.programaCategoria(undefined), 'otro');
  });
});

describe('areaOf', () => {
  it('lee el área de la columna correspondiente', () => {
    assert.equal(C.areaOf(['fecha', 'nombre', 'correo', 'tel', 'programa', 'Pregrado']), 'Pregrado');
  });

  it('las filas guardadas antes de esa columna cuentan como Posgrado', () => {
    // La columna de área se agregó después: las filas viejas del Sheet la
    // traen vacía y en su momento todas eran de posgrado.
    assert.equal(C.areaOf(['fecha', 'nombre', 'correo', 'tel', 'programa']), 'Posgrado');
    assert.equal(C.areaOf(['fecha', 'nombre', 'correo', 'tel', 'programa', '']), 'Posgrado');
  });
});

describe('crmCategoria', () => {
  const fila = (programa, area) => ['f', 'n', 'c', 't', programa, area];

  it('una fila de pregrado es pregrado, sin mirar el programa', () => {
    assert.equal(C.crmCategoria(fila('Ingeniería de Sistemas', 'Pregrado')), 'pregrado');
  });

  it('una fila de posgrado se clasifica por su programa', () => {
    assert.equal(C.crmCategoria(fila('Maestría en Ingeniería', 'Posgrado')), 'maestria');
  });

  it('una fila vieja sin área se clasifica por su programa', () => {
    assert.equal(C.crmCategoria(['f', 'n', 'c', 't', 'Doctorado en X']), 'doctorado');
  });
});

describe('flowCategory', () => {
  it('sin sesión activa no hay categoría que mostrar', () => {
    assert.equal(C.flowCategory(undefined), null);
    assert.equal(C.flowCategory(''), null);
    assert.equal(C.flowCategory('menu'), null);   // en el menú raíz aún no eligió rama
  });

  it('clasifica los pasos reales de cada flujo', () => {
    assert.equal(C.flowCategory('menu_posgrado').key, 'posgrado');
    assert.equal(C.flowCategory('registro_email').key, 'posgrado');
    assert.equal(C.flowCategory('pregrado_registro_nombre').key, 'pregrado');
    assert.equal(C.flowCategory('esperando_codigo').key, 'pregrado');   // turno de matrícula
    assert.equal(C.flowCategory('evento_confirmacion').key, 'evento');
    assert.equal(C.flowCategory('chatting_with_ai').key, 'soporte');
    assert.equal(C.flowCategory('agent_area').key, 'soporte');
  });

  it('un paso desconocido no revienta: simplemente no tiene categoría', () => {
    // Si mañana alguien agrega un flujo nuevo, la bandeja debe seguir
    // pintándose aunque esa conversación no encaje en ninguna categoría.
    assert.equal(C.flowCategory('paso_que_no_existe'), null);
  });

  it('la categoría trae etiqueta y color para pintar la insignia', () => {
    const cat = C.flowCategory('menu_pregrado');
    assert.equal(cat.label, 'Pregrado');
    assert.match(cat.color, /^#[0-9a-f]{6}$/i);
  });
});

describe('crmEstadoMeta', () => {
  it('devuelve el estado pedido con su etiqueta', () => {
    assert.equal(C.crmEstadoMeta('inscrito').label, 'Inscrito');
  });

  it('un valor desconocido cae en el primer estado, no en undefined', () => {
    // Las fichas viejas pueden no tener estado: la tarjeta debe pintarse igual.
    assert.equal(C.crmEstadoMeta('lo-que-sea'), C.CRM_ESTADOS[0]);
    assert.equal(C.crmEstadoMeta(undefined), C.CRM_ESTADOS[0]);
  });

  it('todos los estados tienen etiqueta, ícono y color', () => {
    for (const e of C.CRM_ESTADOS) {
      assert.ok(e.label && e.icon && e.color, `estado incompleto: ${e.value}`);
    }
  });
});

describe('flowCategory', () => {
  it('la recomendación de posgrados y el evento tienen categoría en la bandeja', () => {
    assert.equal(C.flowCategory('reco_correo').key, 'posgrado');
    assert.equal(C.flowCategory('posg_nombre').key, 'evento');
  });
});

describe('describirPaso', () => {
  it('traduce el paso a lo que la persona está haciendo', () => {
    assert.equal(C.describirPaso('registro_email'), 'Registro de interés · escribiendo su correo');
    assert.equal(C.describirPaso('reco_nombre'), 'Recomendación de posgrados · escribiendo su nombre');
    assert.equal(C.describirPaso('pregrado_explorar_carrera'), 'Explorando carreras · eligiendo opciones');
    assert.equal(C.describirPaso('esperando_codigo'), 'Consulta de turno · escribiendo su código');
    assert.equal(C.describirPaso('with_agent'), 'Hablando con un asesor');
  });

  it('con el flujo conocido pero sin acción, muestra solo el flujo', () => {
    assert.equal(C.describirPaso('academico_desvincular'), 'Mi vida académica');
  });

  it('un paso desconocido se muestra tal cual en vez de ocultarse', () => {
    assert.equal(C.describirPaso('paso_nuevo_raro'), 'paso_nuevo_raro');
    assert.equal(C.describirPaso(undefined), '');
  });
});
