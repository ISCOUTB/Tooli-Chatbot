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
  return {
    encabezado: encabezado && formato === 'TEXT' ? String(encabezado.text ?? '') : '',
    /** Imagen, video o documento: el panel no puede adjuntarlo. */
    encabezadoMedia: encabezado && formato !== 'TEXT' ? formato : '',
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

/**
 * Por qué una plantilla no se puede enviar desde esta pantalla, o '' si sí.
 * Aquí todos reciben el mismo mensaje: no hay datos por persona ni adjuntos.
 */
function motivoNoEnviable(plantilla) {
  const variables = variablesDePlantilla(plantilla);
  if (variables > 0) {
    return `Usa ${variables === 1 ? 'una variable' : `${variables} variables`} ({{1}}…) que cambian por persona. ` +
      'Se envía desde CRM → Campaña por pregrado, que sí llena esos datos.';
  }
  const { encabezadoMedia } = partesPlantilla(plantilla);
  if (encabezadoMedia) {
    return 'Su encabezado lleva un archivo (imagen, video o documento) y el panel todavía no lo adjunta.';
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

export { CATEGORIAS, partesPlantilla, variablesDePlantilla, motivoNoEnviable, claveDePlantilla, estadoEnvio };
