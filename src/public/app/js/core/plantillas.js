/* Lectura de una plantilla de Meta para mostrarla: qué dice, qué botones
   trae y si necesita datos por persona. Sin DOM, probado con node:test. */

const CATEGORIAS = {
  MARKETING: { label: 'Marketing', color: '#7c3aed' },
  UTILITY: { label: 'Utilidad', color: '#0f766e' },
  AUTHENTICATION: { label: 'Autenticación', color: '#b45309' },
};

function componente(components, tipo) {
  return (Array.isArray(components) ? components : [])
    .find(c => c && String(c.type ?? '').toUpperCase() === tipo) ?? null;
}

/** Las partes visibles del mensaje, en el orden en que WhatsApp las muestra. */
function partesPlantilla(plantilla) {
  const components = plantilla?.components;
  const encabezado = componente(components, 'HEADER');
  const formato = String(encabezado?.format ?? 'TEXT').toUpperCase();
  const botones = componente(components, 'BUTTONS');
  const ejemplos = encabezado?.example?.header_handle;
  return {
    encabezado: encabezado && formato === 'TEXT' ? String(encabezado.text ?? '') : '',
    /** IMAGE, VIDEO o DOCUMENT cuando el encabezado es un archivo. */
    encabezadoMedia: encabezado && formato !== 'TEXT' ? formato : '',
    /** El archivo con el que Meta aprobó la plantilla; es el que se envía. */
    encabezadoEjemplo: encabezado && formato !== 'TEXT' && Array.isArray(ejemplos) && typeof ejemplos[0] === 'string' ? ejemplos[0] : '',
    cuerpo: String(componente(components, 'BODY')?.text ?? ''),
    pie: String(componente(components, 'FOOTER')?.text ?? ''),
    botones: (Array.isArray(botones?.buttons) ? botones.buttons : [])
      .map(b => ({ texto: String(b?.text ?? ''), tipo: String(b?.type ?? '').toUpperCase() }))
      .filter(b => b.texto),
  };
}

/** Cuántas variables {{n}} o {{nombre}} hay en cualquier parte de la plantilla. */
function variablesDePlantilla(plantilla) {
  const encontradas = new Set();
  for (const c of Array.isArray(plantilla?.components) ? plantilla.components : []) {
    // Los ejemplos que Meta guarda junto al texto no son variables.
    const texto = JSON.stringify({ ...c, example: undefined });
    for (const m of texto.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) encontradas.add(m[1]);
  }
  return encontradas.size;
}

const VARIABLE = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/**
 * Los lugares que hay que llenar al enviar, en el mismo orden que usa el
 * servidor (broadcastValidation.ts): cuerpo, título y final de los enlaces.
 * Cada uno trae el valor de ejemplo con que Meta aprobó la plantilla.
 * Lanza un Error si la plantilla usa variables que el panel no llena.
 */
function ranurasDePlantilla(plantilla) {
  const cuerpo = [];
  const titulo = [];
  const botones = [];
  const numeros = (texto) => {
    const nombres = [...String(texto ?? '').matchAll(VARIABLE)].map(m => m[1]);
    if (nombres.some(n => !/^\d+$/.test(n))) throw new Error('Usa variables con nombre ({{nombre}}); el panel solo llena {{1}}, {{2}}…');
    return nombres.map(Number);
  };
  for (const c of Array.isArray(plantilla?.components) ? plantilla.components : []) {
    const tipo = String(c?.type ?? '').toUpperCase();
    if (tipo === 'BODY') {
      const ejemplos = Array.isArray(c.example?.body_text?.[0]) ? c.example.body_text[0] : [];
      const maximo = Math.max(0, ...numeros(c.text));
      for (let n = 1; n <= maximo; n++) {
        cuerpo.push({ lugar: 'cuerpo', numero: n, clave: `cuerpo:${n}`, etiqueta: `{{${n}}} en el mensaje`, ejemplo: String(ejemplos[n - 1] ?? '') });
      }
    } else if (tipo === 'HEADER' && String(c.format ?? 'TEXT').toUpperCase() === 'TEXT') {
      for (const n of new Set(numeros(c.text))) {
        titulo.push({ lugar: 'encabezado', numero: n, clave: `encabezado:${n}`, etiqueta: `{{${n}}} en el título`, ejemplo: String(c.example?.header_text?.[0] ?? '') });
      }
    } else if (tipo === 'BUTTONS' && Array.isArray(c.buttons)) {
      c.buttons.forEach((b, indice) => {
        const enUrl = String(b?.type ?? '').toUpperCase() === 'URL' ? numeros(b.url) : [];
        if (enUrl.length) {
          const base = String(b.url).split('{{')[0];
          const ejemplo = String(Array.isArray(b.example) ? b.example[0] ?? '' : '');
          botones.push({
            lugar: 'boton', indice, numero: enUrl[0], clave: `boton:${indice}`, base,
            etiqueta: `Final del enlace «${String(b.text ?? 'botón')}»`,
            ejemplo: ejemplo.startsWith(base) ? ejemplo.slice(base.length) : '',
          });
        } else if (JSON.stringify({ ...b, example: undefined }).includes('{{')) {
          throw new Error('Tiene un botón con variables que el panel todavía no llena.');
        }
      });
    }
  }
  return [...cuerpo, ...titulo, ...botones];
}

/** El texto con cada {{n}} reemplazado por su valor, si se conoce. */
function llenarTexto(texto, valores, lugar) {
  return String(texto ?? '').replace(VARIABLE, (todo, n) => {
    const valor = valores?.[`${lugar}:${n}`];
    return valor ? valor : todo;
  });
}

/* Estados de una plantilla en Meta. Solo una aprobada se puede enviar. */
const ESTADOS_PLANTILLA = {
  APPROVED: { texto: 'Aprobada', tono: 'ok' },
  PENDING: { texto: 'En revisión', tono: 'info', motivo: 'Meta todavía la está revisando. Suele tardar de minutos a 24 horas; cuando la apruebe se podrá enviar.' },
  IN_APPEAL: { texto: 'En apelación', tono: 'info', motivo: 'Meta está revisando la apelación del rechazo.' },
  REJECTED: { texto: 'Rechazada', tono: 'error', motivo: 'Meta la rechazó y no se puede enviar.' },
  PAUSED: { texto: 'Pausada', tono: 'aviso', motivo: 'Meta la pausó por quejas o poca respuesta de quienes la recibieron.' },
  DISABLED: { texto: 'Deshabilitada', tono: 'error', motivo: 'Meta la deshabilitó y ya no se puede enviar.' },
};

const MOTIVOS_RECHAZO = {
  ABUSIVE_CONTENT: 'Meta lo consideró contenido inapropiado.',
  INVALID_FORMAT: 'El formato no es válido: revisa saltos de línea, emojis en el título o el enlace.',
  INCORRECT_CATEGORY: 'La categoría no corresponde al contenido: prueba con la otra.',
  PROMOTIONAL: 'Es promocional: debe crearse como marketing.',
  TAG_CONTENT_MISMATCH: 'El contenido no coincide con la categoría o el idioma elegidos.',
  SCAM: 'Meta lo marcó como posible fraude.',
};

/** Una plantilla sin `status` viene de la lista de aprobadas. */
function estadoPlantilla(plantilla) {
  const status = String(plantilla?.status ?? 'APPROVED').toUpperCase();
  const base = ESTADOS_PLANTILLA[status] ?? { texto: status.toLowerCase(), tono: 'info', motivo: 'Meta no la tiene aprobada.' };
  const detalle = status === 'REJECTED' && MOTIVOS_RECHAZO[plantilla?.rejectedReason] ? ` ${MOTIVOS_RECHAZO[plantilla.rejectedReason]}` : '';
  return { ...base, aprobada: status === 'APPROVED', motivo: base.motivo ? base.motivo + detalle : '' };
}

/** "Invitación Feria 2026" → "invitacion_feria_2026"; el servidor aplica la misma regla. */
function nombreTecnico(raw) {
  const base = String(raw ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/, '');
  return /^[a-z]/.test(base) ? base : base ? `plantilla_${base}`.slice(0, 60) : '';
}

/** Lo que escribe el asesor en el formulario, con la forma de una plantilla de Meta, para la vista previa. */
function plantillaDesdeFormulario(f) {
  const components = [];
  if (f.encabezado === 'texto' && f.titulo) components.push({ type: 'HEADER', format: 'TEXT', text: f.titulo });
  if (f.encabezado === 'imagen') components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: f.imagen ? [f.imagen] : [] } });
  components.push({ type: 'BODY', text: f.cuerpo || '' });
  if (f.pie) components.push({ type: 'FOOTER', text: f.pie });
  const botones = (f.botones ?? []).filter(b => b.texto);
  if (botones.length) {
    components.push({ type: 'BUTTONS', buttons: [
      ...botones.filter(b => b.tipo === 'respuesta').map(b => ({ type: 'QUICK_REPLY', text: b.texto })),
      ...botones.filter(b => b.tipo === 'enlace').map(b => ({ type: 'URL', text: b.texto, url: b.url })),
    ] });
  }
  return { name: nombreTecnico(f.nombre), language: f.idioma || 'es', category: f.categoria, components };
}

/**
 * Por qué una plantilla no se puede enviar desde esta pantalla, o '' si sí.
 * Las variables {{1}}… se llenan en el formulario; las que llevan imagen,
 * video o documento salen con el archivo que Meta aprobó.
 */
function motivoNoEnviable(plantilla) {
  const estado = estadoPlantilla(plantilla);
  if (!estado.aprobada) return estado.motivo;
  try {
    ranurasDePlantilla(plantilla);
  } catch (err) {
    return err.message;
  }
  const { encabezadoMedia, encabezadoEjemplo } = partesPlantilla(plantilla);
  if (encabezadoMedia && !['IMAGE', 'VIDEO', 'DOCUMENT'].includes(encabezadoMedia)) {
    return 'Su encabezado es de un tipo que el panel no envía (por ejemplo, una ubicación).';
  }
  if (encabezadoMedia && !encabezadoEjemplo) {
    return 'Su encabezado lleva un archivo, pero Meta no entregó el archivo con el que fue aprobada.';
  }
  return '';
}

function claveDePlantilla(plantilla) {
  return `${plantilla?.name ?? ''}|${plantilla?.language ?? ''}`;
}

/** Estado de un envío en palabras, a partir de su resumen. */
function estadoEnvio(job) {
  if (job.estado !== 'completado') return { texto: 'En proceso', tono: 'info' };
  if (!job.fallidos) return { texto: 'Enviado', tono: 'ok' };
  if (!job.enviados) return { texto: 'No se envió', tono: 'error' };
  return { texto: 'Con fallos', tono: 'aviso' };
}

function primerNombre(nombre) {
  return String(nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

function celularDe(texto) {
  const crudo = String(texto ?? '').trim();
  let digitos = /^\+?[\d\s().-]+$/.test(crudo) ? crudo.replace(/\D/g, '') : '';
  if (digitos.length === 10 && digitos[0] === '3') digitos = `57${digitos}`;
  return /^[1-9]\d{9,14}$/.test(digitos) ? digitos : '';
}

/**
 * Quiénes reciben la plantilla y con qué valores, en el orden de `ranuras`.
 *
 * - `origenes[clave]`: { origen: 'fijo' | 'primer_nombre' | 'nombre', texto }.
 * - Evento: `asistentes` ya filtrados (autorizaron y tienen celular).
 * - Números con `porPersona`: una persona por línea, `número; valor1; valor2…`
 *   (también sirven tabulador o barra, como al pegar desde Excel).
 * A quien le falte un valor se cuenta en `incompletos` y no se envía.
 */
function armarDestinatarios({ ranuras, origenes = {}, fuente, asistentes = [], texto = '', porPersona = false }) {
  const resultado = { listos: [], incompletos: 0, invalidos: 0, repetidos: 0 };
  const vistos = new Set();
  const agregar = (telefono, parametros) => {
    if (vistos.has(telefono)) { resultado.repetidos++; return; }
    vistos.add(telefono);
    if (parametros.some(v => !String(v ?? '').trim())) { resultado.incompletos++; return; }
    resultado.listos.push({ telefono, parametros: parametros.map(v => String(v).trim()) });
  };
  const fijo = (r) => String(origenes[r.clave]?.texto ?? '').trim();
  if (fuente === 'evento') {
    for (const a of asistentes) {
      agregar(a.whatsapp, ranuras.map(r => {
        const origen = origenes[r.clave]?.origen ?? 'fijo';
        if (origen === 'primer_nombre') return primerNombre(a.nombre);
        if (origen === 'nombre') return String(a.nombre ?? '').trim();
        return fijo(r);
      }));
    }
    return resultado;
  }
  const lineas = String(texto ?? '').split(/\n/).map(l => l.trim()).filter(Boolean);
  if (porPersona && ranuras.length) {
    for (const linea of lineas) {
      const [numero, ...valores] = linea.split(/\t|;|\|/).map(v => v.trim());
      const telefono = celularDe(numero);
      if (!telefono) { resultado.invalidos++; continue; }
      agregar(telefono, ranuras.map((_r, i) => valores[i] ?? ''));
    }
    return resultado;
  }
  for (const parte of lineas.flatMap(l => l.split(/[,;]+/))) {
    if (!parte.trim()) continue;
    const telefono = celularDe(parte);
    if (!telefono) { resultado.invalidos++; continue; }
    agregar(telefono, ranuras.map(fijo));
  }
  return resultado;
}

export {
  CATEGORIAS, partesPlantilla, variablesDePlantilla, ranurasDePlantilla, llenarTexto, motivoNoEnviable,
  claveDePlantilla, estadoEnvio, armarDestinatarios, estadoPlantilla, nombreTecnico, plantillaDesdeFormulario,
};
