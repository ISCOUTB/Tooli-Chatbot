import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  armarDestinatarios, claveDePlantilla, errorDeVariables, estadoEnvio, estadoPlantilla, insertarVariable, llenarTexto,
  motivoNoEnviable, nombreTecnico, normalizarVariables, partesPlantilla, plantillaDesdeFormulario, ranurasDePlantilla,
  significadosDeFormulario, valoresDeEjemplo, variablesDePlantilla, nombreParaSaludo, valoresParaContacto, textoDePlantilla,
} from './plantillas.js';

const SIMPLE = { name: 'aviso', language: 'es_CO', components: [{ type: 'BODY', text: 'Aviso de prueba' }] };
const COMPLETA = {
  name: 'gracias', language: 'es_CO',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Gracias' },
    { type: 'body', text: 'Fue un gusto *verte*' },
    { type: 'FOOTER', text: 'UTB' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Más información' }, { type: 'URL', text: 'Ver programas', url: 'https://www.utb.edu.co' }, { type: 'URL' }] },
  ],
};
const CON_VARIABLES = {
  name: 'campana', language: 'es_CO',
  components: [{ type: 'BODY', text: 'Hola {{1}}, por tu pregrado en {{2}}… {{1}}', example: { body_text: [['Ana {{9}}', 'Sistemas']] } }],
};
const EJEMPLO = 'https://scontent.whatsapp.net/v/afiche.png?oh=firma';
const CON_IMAGEN = { name: 'afiche', language: 'es', components: [{ type: 'HEADER', format: 'IMAGE', example: { header_handle: [EJEMPLO] } }, { type: 'BODY', text: 'Mira el afiche' }] };
const IMAGEN_SIN_EJEMPLO = { name: 'afiche', language: 'es', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Mira el afiche' }] };
const CON_UBICACION = { name: 'sede', language: 'es', components: [{ type: 'HEADER', format: 'LOCATION' }, { type: 'BODY', text: 'Aquí estamos' }] };

test('separa las partes visibles de la plantilla', () => {
  assert.deepEqual(partesPlantilla(COMPLETA), {
    encabezado: 'Gracias', encabezadoMedia: '', encabezadoEjemplo: '', cuerpo: 'Fue un gusto *verte*', pie: 'UTB',
    botones: [{ texto: 'Más información', tipo: 'QUICK_REPLY' }, { texto: 'Ver programas', tipo: 'URL' }],
  });
  assert.deepEqual(partesPlantilla(SIMPLE), { encabezado: '', encabezadoMedia: '', encabezadoEjemplo: '', cuerpo: 'Aviso de prueba', pie: '', botones: [] });
  assert.equal(partesPlantilla(CON_IMAGEN).encabezadoMedia, 'IMAGE');
  assert.equal(partesPlantilla(CON_IMAGEN).encabezadoEjemplo, EJEMPLO);
  assert.equal(partesPlantilla(IMAGEN_SIN_EJEMPLO).encabezadoEjemplo, '');
  assert.deepEqual(partesPlantilla(null), { encabezado: '', encabezadoMedia: '', encabezadoEjemplo: '', cuerpo: '', pie: '', botones: [] });
});

test('cuenta las variables una vez cada una y sin mirar los ejemplos de Meta', () => {
  assert.equal(variablesDePlantilla(SIMPLE), 0);
  assert.equal(variablesDePlantilla(CON_VARIABLES), 2);
  assert.equal(variablesDePlantilla({ components: [{ type: 'BODY', text: 'Hola {{nombre}}' }] }), 1);
});

test('explica por qué una plantilla no se envía desde esta pantalla', () => {
  assert.equal(motivoNoEnviable(SIMPLE), '');
  assert.equal(motivoNoEnviable(COMPLETA), '');
  // Las variables {{1}}… se llenan en el formulario: ya no bloquean el envío.
  assert.equal(motivoNoEnviable(CON_VARIABLES), '');
  assert.match(motivoNoEnviable({ components: [{ type: 'BODY', text: 'Hola {{nombre}}' }] }), /variables con nombre/);
  // Con imagen sí se envía: sale con el archivo que Meta aprobó.
  assert.equal(motivoNoEnviable(CON_IMAGEN), '');
  assert.match(motivoNoEnviable(IMAGEN_SIN_EJEMPLO), /no entregó el archivo/);
  assert.match(motivoNoEnviable(CON_UBICACION), /ubicación/);
});

test('una plantilla se identifica por nombre e idioma', () => {
  assert.equal(claveDePlantilla(SIMPLE), 'aviso|es_CO');
  assert.notEqual(claveDePlantilla(SIMPLE), claveDePlantilla({ ...SIMPLE, language: 'en' }));
});

test('resume el estado de un envío', () => {
  assert.deepEqual(estadoEnvio({ estado: 'procesando', enviados: 1, fallidos: 0 }), { texto: 'En proceso', tono: 'info' });
  assert.deepEqual(estadoEnvio({ estado: 'completado', enviados: 3, fallidos: 0 }), { texto: 'Enviado', tono: 'ok' });
  assert.deepEqual(estadoEnvio({ estado: 'completado', enviados: 2, fallidos: 1 }), { texto: 'Con fallos', tono: 'aviso' });
  assert.deepEqual(estadoEnvio({ estado: 'completado', enviados: 0, fallidos: 3 }), { texto: 'No se envió', tono: 'error' });
});

/* nodo_recordatorio_evento, tal como está en la cuenta de Meta. */
const RECORDATORIO = {
  name: 'nodo_recordatorio_evento', language: 'es', category: 'UTILITY',
  components: [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: [EJEMPLO] } },
    { type: 'BODY', text: 'Hola {{1}}, mañana es tu evento. *{{2}}* 🗓 {{3}} 📍 {{4}}', example: { body_text: [['Manuel', 'CTW Hackathon', 'jueves 13 de agosto', 'Centro de Convenciones']] } },
    { type: 'BUTTONS', buttons: [
      { type: 'URL', text: 'Ver el evento', url: 'https://nodo-eventos.duckdns.org/eventos/{{1}}', example: ['https://nodo-eventos.duckdns.org/eventos/ctw-hackathon'] },
      { type: 'QUICK_REPLY', text: 'No podré ir' },
    ] },
  ],
};

test('lista lo que hay que llenar, en el orden del servidor y con los ejemplos de Meta', () => {
  assert.deepEqual(ranurasDePlantilla(RECORDATORIO).map(r => [r.clave, r.etiqueta, r.ejemplo]), [
    ['cuerpo:1', '{{1}} en el mensaje', 'Manuel'],
    ['cuerpo:2', '{{2}} en el mensaje', 'CTW Hackathon'],
    ['cuerpo:3', '{{3}} en el mensaje', 'jueves 13 de agosto'],
    ['cuerpo:4', '{{4}} en el mensaje', 'Centro de Convenciones'],
    ['boton:0', 'Final del enlace «Ver el evento»', 'ctw-hackathon'],
  ]);
  assert.equal(ranurasDePlantilla(RECORDATORIO)[4].base, 'https://nodo-eventos.duckdns.org/eventos/');
  assert.deepEqual(ranurasDePlantilla(SIMPLE), []);
  assert.equal(llenarTexto('Orden #{{1}} de {{2}}', { 'cuerpo:1': '42' }, 'cuerpo'), 'Orden #42 de {{2}}');
});

test('asistentes: el nombre sale de cada persona y lo demás es igual para todos', () => {
  const ranuras = ranurasDePlantilla(RECORDATORIO);
  const origenes = {
    'cuerpo:1': { origen: 'primer_nombre' }, 'cuerpo:2': { origen: 'fijo', texto: 'Feria de posgrados' },
    'cuerpo:3': { origen: 'fijo', texto: 'viernes 20' }, 'cuerpo:4': { origen: 'fijo', texto: 'Campus Tecnológico' },
    'boton:0': { origen: 'fijo', texto: 'feria-posgrados' },
  };
  const asistentes = [
    { whatsapp: '573001234567', nombre: 'Ana María Pérez' },
    { whatsapp: '573009876543', nombre: '' },
    { whatsapp: '573001234567', nombre: 'Ana repetida' },
  ];
  assert.deepEqual(armarDestinatarios({ ranuras, origenes, fuente: 'evento', asistentes }), {
    listos: [{ telefono: '573001234567', parametros: ['Ana', 'Feria de posgrados', 'viernes 20', 'Campus Tecnológico', 'feria-posgrados'] }],
    incompletos: 1, invalidos: 0, repetidos: 1,
  });
});

test('números: datos iguales para todos o una línea por persona pegada desde Excel', () => {
  const ranuras = ranurasDePlantilla({ components: [{ type: 'BODY', text: 'Orden #{{1}}, total {{2}}' }] });
  assert.deepEqual(
    armarDestinatarios({ ranuras, origenes: { 'cuerpo:1': { texto: '42' }, 'cuerpo:2': { texto: '$35.000' } }, fuente: 'numeros', texto: '3001234567, 3009876543\nhola' }),
    { listos: [{ telefono: '573001234567', parametros: ['42', '$35.000'] }, { telefono: '573009876543', parametros: ['42', '$35.000'] }], incompletos: 0, invalidos: 1, repetidos: 0 },
  );
  assert.deepEqual(
    armarDestinatarios({ ranuras, fuente: 'numeros', porPersona: true, texto: '3001234567; 42; Lavado, encerado\n+57 300 987 6543\t43\t$20.000\n3011112222; 44\nabc; 1; 2' }),
    {
      listos: [
        { telefono: '573001234567', parametros: ['42', 'Lavado, encerado'] },
        { telefono: '573009876543', parametros: ['43', '$20.000'] },
      ],
      incompletos: 1, invalidos: 1, repetidos: 0,
    },
  );
  // Sin variables solo cuentan los números.
  assert.deepEqual(armarDestinatarios({ ranuras: [], fuente: 'numeros', texto: '3001234567' }).listos, [{ telefono: '573001234567', parametros: [] }]);
});

test('solo una plantilla aprobada se envía, y el rechazo se explica', () => {
  assert.equal(motivoNoEnviable({ ...SIMPLE, status: 'APPROVED' }), '');
  assert.match(motivoNoEnviable({ ...SIMPLE, status: 'PENDING' }), /revisando/);
  assert.match(motivoNoEnviable({ ...SIMPLE, status: 'REJECTED', rejectedReason: 'PROMOTIONAL' }), /rechazó.*marketing/);
  assert.deepEqual(
    [estadoPlantilla({}).texto, estadoPlantilla({ status: 'paused' }).texto, estadoPlantilla({ status: 'RARO' }).aprobada],
    ['Aprobada', 'Pausada', false],
  );
});

test('el formulario de nueva plantilla se ve como la plantilla que creará', () => {
  assert.equal(nombreTecnico('Invitación Feria 2026!'), 'invitacion_feria_2026');
  assert.equal(nombreTecnico('2026'), 'plantilla_2026');
  const p = plantillaDesdeFormulario({
    nombre: 'Gracias por venir', categoria: 'MARKETING', encabezado: 'texto', titulo: 'Gracias',
    cuerpo: 'Fue un gusto', pie: 'UTB',
    botones: [{ tipo: 'enlace', texto: 'Ver', url: 'https://utb.edu.co' }, { tipo: 'respuesta', texto: 'Quiero info' }, { tipo: 'respuesta', texto: '' }],
  });
  assert.equal(p.name, 'gracias_por_venir');
  assert.deepEqual(partesPlantilla(p), {
    encabezado: 'Gracias', encabezadoMedia: '', encabezadoEjemplo: '', cuerpo: 'Fue un gusto', pie: 'UTB',
    botones: [{ texto: 'Quiero info', tipo: 'QUICK_REPLY' }, { texto: 'Ver', tipo: 'URL' }],
  });
  assert.equal(partesPlantilla(plantillaDesdeFormulario({ encabezado: 'imagen', imagen: 'data:image/jpeg;base64,AAAA', cuerpo: 'x' })).encabezadoEjemplo, 'data:image/jpeg;base64,AAAA');
});

test('insertar un dato pone {{n}} donde está el cursor y renumbera en orden', () => {
  let r = insertarVariable('Hola, te esperamos en ', 6, [], 'primer_nombre');
  assert.equal(r.texto, 'Hola, {{1}} te esperamos en ');
  assert.equal(r.cursor, 12);
  assert.deepEqual(r.variables, [{ tipo: 'primer_nombre', ejemplo: 'Ana' }]);
  r = insertarVariable(r.texto, r.texto.length, r.variables, 'lugar');
  assert.equal(r.texto, 'Hola, {{1}} te esperamos en {{2}}');
  assert.equal(insertarVariable('Hola,', 4, [], 'otro').texto, 'Hola {{1}},', 'antes de una coma no agrega espacio');
  // Un dato puesto antes de los demás pasa a ser {{1}} y los otros se corren.
  r = insertarVariable('Hola {{1}}, nos vemos en {{2}}.', 0, [{ tipo: 'primer_nombre', ejemplo: 'Ana' }, { tipo: 'lugar', ejemplo: 'Campus' }], 'fecha');
  assert.equal(r.texto, '{{1}} Hola {{2}}, nos vemos en {{3}}.');
  assert.deepEqual(r.variables.map(v => v.tipo), ['fecha', 'primer_nombre', 'lugar']);
  assert.equal(r.cursor, 6);
});

test('borrar un dato deja la numeración seguida y conserva los ejemplos', () => {
  const vars = [{ tipo: 'primer_nombre', ejemplo: 'Ana' }, { tipo: 'fecha', ejemplo: 'viernes' }, { tipo: 'lugar', ejemplo: 'Campus' }];
  assert.deepEqual(normalizarVariables('Hola {{1}}, en {{3}}.', vars), {
    texto: 'Hola {{1}}, en {{2}}.', variables: [vars[0], vars[2]],
  });
  assert.deepEqual(normalizarVariables('Hola {{2}} y {{2}} otra vez', vars), {
    texto: 'Hola {{1}} y {{1}} otra vez', variables: [vars[1]],
  });
  assert.deepEqual(normalizarVariables('Sin datos', vars), { texto: 'Sin datos', variables: [] });
});

test('avisa antes de enviar a Meta lo que rechazaría por las variables', () => {
  const base = { cuerpo: 'Hola {{1}}, te esperamos.', variables: [{ tipo: 'primer_nombre', ejemplo: 'Ana' }], botones: [] };
  assert.equal(errorDeVariables(base), '');
  assert.match(errorDeVariables({ ...base, cuerpo: '{{1}}, te esperamos.' }), /empezar ni terminar/);
  assert.match(errorDeVariables({ ...base, variables: [{ tipo: 'otro', ejemplo: ' ' }] }), /ejemplo para \{\{1\}\}/);
  assert.match(errorDeVariables({ ...base, encabezado: 'texto', titulo: 'Hola {{1}}' }), /dato del título/);
  assert.match(errorDeVariables({ ...base, botones: [{ tipo: 'enlace', dinamico: true, ejemplo: 'a b' }] }), /espacios/);
});

test('la vista previa usa los ejemplos y el servidor recibe qué dato es cada variable', () => {
  const f = {
    nombre: 'Recordatorio', categoria: 'UTILITY', encabezado: 'texto', titulo: 'Hola {{1}}', tituloVariable: { tipo: 'primer_nombre', ejemplo: 'Ana' },
    cuerpo: 'Te esperamos el {{1}} en {{2}}.', variables: [{ tipo: 'fecha', ejemplo: 'viernes' }, { tipo: 'lugar', ejemplo: 'Campus' }],
    botones: [{ tipo: 'enlace', texto: 'Ver evento', url: 'https://utb.edu.co/e/', dinamico: true, ejemplo: 'feria' }],
  };
  const p = plantillaDesdeFormulario(f);
  assert.deepEqual(valoresDeEjemplo(f), { 'cuerpo:1': 'viernes', 'cuerpo:2': 'Campus', 'encabezado:1': 'Ana' });
  assert.equal(llenarTexto(partesPlantilla(p).cuerpo, valoresDeEjemplo(f), 'cuerpo'), 'Te esperamos el viernes en Campus.');
  assert.deepEqual(significadosDeFormulario(f), { 'cuerpo:1': 'fecha', 'cuerpo:2': 'lugar', 'encabezado:1': 'primer_nombre' });
  assert.equal(ranurasDePlantilla(p).at(-1).clave, 'boton:0', 'el enlace dinámico se ve como una variable del envío');
});

test('el programa de cada asistente también se llena solo', () => {
  const ranuras = ranurasDePlantilla({ components: [{ type: 'BODY', text: 'Hola, te contamos de {{1}}.' }] });
  assert.deepEqual(
    armarDestinatarios({ ranuras, origenes: { 'cuerpo:1': { origen: 'programa' } }, fuente: 'evento', asistentes: [{ whatsapp: '573001234567', programa: 'Maestría en Ingeniería' }] }).listos,
    [{ telefono: '573001234567', parametros: ['Maestría en Ingeniería'] }],
  );
});


test('un nombre para saludar: sin el número ni el «Usuario de WhatsApp»', () => {
  assert.equal(nombreParaSaludo('ANA MARÍA PÉREZ'), 'Ana María Pérez');
  assert.equal(nombreParaSaludo('  luis  ángel '), 'Luis Ángel');
  assert.equal(nombreParaSaludo('María de los Ángeles'), 'María de los Ángeles', 'lo que ya viene bien escrito no se toca');
  assert.equal(nombreParaSaludo('Usuario de WhatsApp'), '');
  assert.equal(nombreParaSaludo('+57 300 123 4567'), '');
  assert.equal(nombreParaSaludo(undefined), '');
});

test('al enviarle a una persona, los datos conocidos ya vienen puestos', () => {
  const plantilla = {
    ...CON_VARIABLES,
    components: [{ type: 'BODY', text: 'Hola {{1}}, sobre {{2}} el {{3}}' }],
    significados: { 'cuerpo:1': 'primer_nombre', 'cuerpo:2': 'programa', 'cuerpo:3': 'fecha' },
  };
  assert.deepEqual(valoresParaContacto(plantilla, { nombre: 'ANA MARÍA PÉREZ', programa: 'Maestría en Ingeniería' }),
    { 'cuerpo:1': 'Ana', 'cuerpo:2': 'Maestría en Ingeniería', 'cuerpo:3': '' });
  assert.deepEqual(valoresParaContacto({ ...plantilla, significados: { 'cuerpo:1': 'nombre_completo' } }, { nombre: 'Usuario de WhatsApp' }),
    { 'cuerpo:1': '', 'cuerpo:2': '', 'cuerpo:3': '' }, 'sin nombre real queda para escribirlo');
  assert.deepEqual(valoresParaContacto(SIMPLE, { nombre: 'Ana' }), {});
});

test('el texto que salió, para dejarlo como nota', () => {
  assert.equal(textoDePlantilla(COMPLETA, null), 'Gracias\n\nFue un gusto *verte*\n\nUTB');
  assert.equal(textoDePlantilla(CON_VARIABLES, { 'cuerpo:1': 'Ana', 'cuerpo:2': 'Sistemas' }), 'Hola Ana, por tu pregrado en Sistemas… Ana');
});
