/* Lista de una campaña por pregrado: lo que el admin pega en el panel
   (copiado de Excel o de un CSV) → destinatarios { telefono, nombre, pregrado }.
   Puro: el servidor vuelve a validar todo, esto solo da el resumen previo. */

export const MAX_DESTINATARIOS_CAMPANA = 200;

export const RELACIONES_CAMPANA = [
  { id: 'egresado_utb', label: 'Egresados UTB' },
  { id: 'estudiante_utb', label: 'Estudiantes UTB' },
  { id: 'externo', label: 'Otra universidad' },
];

/* Divide por `sep` respetando campos entre comillas ("Finanzas, Negocios"). */
function dividir(linea, sep) {
  const partes = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') { actual += '"'; i++; } else enComillas = !enComillas;
    } else if (c === sep && !enComillas) {
      partes.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  partes.push(actual.trim());
  return partes;
}

/* Excel pega columnas separadas por tabulación; un CSV, por punto y coma o coma. */
function partirLinea(linea) {
  const sep = linea.includes('\t') ? '\t' : linea.includes(';') ? ';' : ',';
  const partes = dividir(linea, sep);
  // Con comas sin comillas, un pregrado que traiga coma no debe partirse en dos columnas.
  if (sep === ',' && partes.length > 3) return [partes[0], partes[1], partes.slice(2).join(', ')];
  return partes;
}

/* Celular colombiano de 10 dígitos sin indicativo (3xx…) → con 57 adelante.
   Sin esto, "3001112233" pasaría la validación y la plantilla iría a otro país. */
export function normalizarTelefonoCampana(raw) {
  const digitos = String(raw ?? '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(digitos)) return `57${digitos}`;
  return digitos;
}

const esEncabezado = (celdas) => !/\d/.test(celdas[0] ?? '') && /tel|cel|whats|n[uú]mero|phone/i.test(celdas[0] ?? '');

/**
 * Lee la lista pegada. Columnas: teléfono, nombre, pregrado. Devuelve los
 * destinatarios válidos y, por línea, lo que no se pudo usar.
 */
export function parseListaCampana(texto) {
  const destinatarios = [];
  const errores = [];
  const vistos = new Set();
  let duplicados = 0;

  const lineas = String(texto ?? '').split(/\r?\n/);
  lineas.forEach((linea, i) => {
    if (!linea.trim()) return;
    const celdas = partirLinea(linea);
    if (i === 0 && esEncabezado(celdas)) return;
    const [telRaw = '', nombre = '', pregrado = ''] = celdas;
    const telefono = normalizarTelefonoCampana(telRaw);
    if (!/^[1-9]\d{9,14}$/.test(telefono)) { errores.push({ linea: i + 1, motivo: 'teléfono inválido' }); return; }
    if (!nombre) { errores.push({ linea: i + 1, motivo: 'falta el nombre' }); return; }
    if (vistos.has(telefono)) { duplicados++; return; }
    vistos.add(telefono);
    destinatarios.push({ telefono, nombre, pregrado });
  });

  return {
    destinatarios,
    errores,
    duplicados,
    sinPregrado: destinatarios.filter(d => !d.pregrado).length,
    excedeMaximo: destinatarios.length > MAX_DESTINATARIOS_CAMPANA,
  };
}
