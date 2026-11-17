/**
 * Reglas para crear una plantilla de WhatsApp desde el panel, sin red: arma
 * lo que se le envía a Meta y explica en palabras del asesor qué falta.
 * Probado en plantillaNueva.test.ts; las llamadas a Meta viven en
 * plantillasMeta.ts.
 *
 * Admite variables numeradas ({{1}}, {{2}}…) en el mensaje, una en el título
 * y una al final del enlace, como el administrador de Meta. Meta exige un
 * ejemplo de cada una para revisarla. Además se guarda qué significa cada
 * variable (primer nombre, programa…) para llenarla sola al enviar.
 */

export class PlantillaInvalidaError extends Error {}

export const CATEGORIAS_NUEVA = ['MARKETING', 'UTILITY'] as const;
export const IDIOMAS_NUEVA = ['es', 'es_CO', 'en_US'] as const;
export const MAX_RESPUESTAS = 3;

export interface BotonNuevo {
  tipo: 'respuesta' | 'enlace';
  texto: string;
  /** Sin la variable: si el enlace es dinámico, Meta le agrega {{1}} al final. */
  url?: string;
  /** El final del enlace cambia por persona. */
  dinamico?: boolean;
  /** Lo que iría al final del enlace en el ejemplo para Meta. */
  ejemplo?: string;
}

/** Qué dato va en cada variable; el panel lo usa para llenarla al enviar. */
export const SIGNIFICADOS = ['primer_nombre', 'nombre_completo', 'programa', 'fecha', 'lugar', 'otro'] as const;
export type Significado = typeof SIGNIFICADOS[number];

export interface PlantillaNuevaValidada {
  name: string;
  language: typeof IDIOMAS_NUEVA[number];
  category: typeof CATEGORIAS_NUEVA[number];
  encabezado: { tipo: 'ninguno' } | { tipo: 'texto'; texto: string; ejemplo?: string } | { tipo: 'imagen' };
  cuerpo: string;
  /** Un ejemplo por variable del mensaje, en orden ({{1}}, {{2}}…). */
  ejemplosCuerpo: string[];
  pie: string;
  botones: BotonNuevo[];
  /** 'cuerpo:1', 'encabezado:1' o 'boton:<índice>' → qué dato es. */
  significados: Record<string, Significado>;
}

/** "Invitación Feria 2026" → "invitacion_feria_2026", el nombre que Meta acepta. */
export function nombreTecnico(raw: unknown): string {
  const base = String(raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/, '');
  return /^[a-z]/.test(base) ? base : base ? `plantilla_${base}`.slice(0, 60) : '';
}

function texto(raw: unknown): string {
  return String(raw ?? '').replace(/\r\n?/g, '\n').trim();
}

function unaLinea(raw: unknown, campo: string, maximo: number, obligatorio: boolean): string {
  const valor = texto(raw);
  if (!valor) {
    if (obligatorio) throw new PlantillaInvalidaError(`Escribe ${campo}.`);
    return '';
  }
  if (valor.includes('\n')) throw new PlantillaInvalidaError(`${primeraMayuscula(campo)} va en una sola línea.`);
  if (valor.length > maximo) throw new PlantillaInvalidaError(`${primeraMayuscula(campo)} puede tener hasta ${maximo} caracteres.`);
  return valor;
}

function primeraMayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sinVariables(valor: string, campo: string): void {
  if (/\{\{|\}\}/.test(valor)) {
    throw new PlantillaInvalidaError(`${primeraMayuscula(campo)} no puede llevar datos variables.`);
  }
}

/** Los números de las variables {{n}} del texto; rechaza las que no son números. */
function numerosEn(texto: string, campo: string): number[] {
  const llaves = texto.match(/\{\{[^{}]*\}\}/g) ?? [];
  const sueltas = texto.replace(/\{\{[^{}]*\}\}/g, '');
  if (/\{\{|\}\}/.test(sueltas)) throw new PlantillaInvalidaError(`${primeraMayuscula(campo)} tiene llaves {{ }} sin cerrar.`);
  return llaves.map((llave) => {
    const m = /^\{\{\s*(\d+)\s*\}\}$/.exec(llave);
    if (!m) throw new PlantillaInvalidaError(`${primeraMayuscula(campo)} solo admite datos numerados como {{1}}.`);
    return Number(m[1]);
  });
}

function ejemplo(raw: unknown, que: string): string {
  const valor = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!valor) throw new PlantillaInvalidaError(`Escribe un ejemplo para ${que}: Meta lo pide para revisar la plantilla.`);
  if (valor.length > 200) throw new PlantillaInvalidaError(`El ejemplo para ${que} puede tener hasta 200 caracteres.`);
  if (/\{\{|\}\}/.test(valor)) throw new PlantillaInvalidaError(`El ejemplo para ${que} no puede llevar llaves.`);
  return valor;
}

function significadosValidos(raw: unknown): Record<string, Significado> {
  const out: Record<string, Significado> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [clave, valor] of Object.entries(raw as Record<string, unknown>)) {
    if (/^(cuerpo:\d{1,2}|encabezado:1)$/.test(clave) && (SIGNIFICADOS as readonly unknown[]).includes(valor)) {
      out[clave] = valor as Significado;
    }
  }
  return out;
}

export function validarPlantillaNueva(input: unknown): PlantillaNuevaValidada {
  const datos = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  const name = nombreTecnico(datos.nombre);
  if (name.length < 3) throw new PlantillaInvalidaError('Ponle un nombre a la plantilla (al menos 3 letras).');

  if (!(CATEGORIAS_NUEVA as readonly unknown[]).includes(datos.categoria)) {
    throw new PlantillaInvalidaError('Elige si la plantilla es de marketing o de utilidad.');
  }
  const idioma = datos.idioma ?? 'es';
  if (!(IDIOMAS_NUEVA as readonly unknown[]).includes(idioma)) throw new PlantillaInvalidaError('El idioma no es válido.');

  const enc = (datos.encabezado && typeof datos.encabezado === 'object' ? datos.encabezado : { tipo: 'ninguno' }) as Record<string, unknown>;
  let encabezado: PlantillaNuevaValidada['encabezado'];
  if (enc.tipo === 'texto') {
    const t = unaLinea(enc.texto, 'el título', 60, true);
    const enTitulo = numerosEn(t, 'el título');
    if (enTitulo.length > 1 || (enTitulo.length && enTitulo[0] !== 1)) {
      throw new PlantillaInvalidaError('El título admite un solo dato variable.');
    }
    encabezado = enTitulo.length
      ? { tipo: 'texto', texto: t, ejemplo: ejemplo(enc.ejemplo, 'el dato del título') }
      : { tipo: 'texto', texto: t };
  } else if (enc.tipo === 'imagen') {
    encabezado = { tipo: 'imagen' };
  } else if (enc.tipo === 'ninguno' || enc.tipo === undefined) {
    encabezado = { tipo: 'ninguno' };
  } else {
    throw new PlantillaInvalidaError('El encabezado no es válido.');
  }

  const cuerpo = texto(datos.cuerpo);
  if (!cuerpo) throw new PlantillaInvalidaError('Escribe el mensaje.');
  if (cuerpo.length > 1024) throw new PlantillaInvalidaError('El mensaje puede tener hasta 1.024 caracteres.');
  // Meta exige variables seguidas desde {{1}} y que el mensaje no empiece ni termine con una.
  const enCuerpo = [...new Set(numerosEn(cuerpo, 'el mensaje'))];
  const total = enCuerpo.length ? Math.max(...enCuerpo) : 0;
  if (enCuerpo.length !== total) {
    throw new PlantillaInvalidaError('Los datos del mensaje deben ir numerados en orden: {{1}}, {{2}}, {{3}}…');
  }
  if (/^\{\{/.test(cuerpo) || /\}\}$/.test(cuerpo)) {
    throw new PlantillaInvalidaError('El mensaje no puede empezar ni terminar con un dato variable: agrega texto antes o después.');
  }
  const crudosEjemplos = Array.isArray(datos.ejemplosCuerpo) ? datos.ejemplosCuerpo : [];
  const ejemplosCuerpo = Array.from({ length: total }, (_x, i) => ejemplo(crudosEjemplos[i], `{{${i + 1}}}`));

  const pie = unaLinea(datos.pie, 'el pie', 60, false);
  sinVariables(pie, 'el pie');

  const crudos = Array.isArray(datos.botones) ? datos.botones : [];
  const respuestas: BotonNuevo[] = [];
  const enlaces: BotonNuevo[] = [];
  for (const raw of crudos) {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const etiqueta = unaLinea(b.texto, 'el texto del botón', 25, true);
    sinVariables(etiqueta, 'el texto del botón');
    if (b.tipo === 'respuesta') {
      respuestas.push({ tipo: 'respuesta', texto: etiqueta });
    } else if (b.tipo === 'enlace') {
      const url = texto(b.url);
      let valida: URL | null = null;
      try { valida = new URL(url); } catch { /* se informa abajo */ }
      if (!valida || valida.protocol !== 'https:' || url.length > 2000 || /\s/.test(url)) {
        throw new PlantillaInvalidaError(`El enlace del botón «${etiqueta}» debe ser una dirección completa que empiece por https://`);
      }
      sinVariables(url, 'el enlace');
      if (b.dinamico === true) {
        const final = ejemplo(b.ejemplo, 'el final del enlace');
        if (/\s/.test(final)) throw new PlantillaInvalidaError('El ejemplo del final del enlace no puede tener espacios.');
        enlaces.push({ tipo: 'enlace', texto: etiqueta, url, dinamico: true, ejemplo: final });
      } else {
        enlaces.push({ tipo: 'enlace', texto: etiqueta, url: valida.toString() });
      }
    } else {
      throw new PlantillaInvalidaError('Un botón no es válido.');
    }
  }
  if (respuestas.length > MAX_RESPUESTAS) throw new PlantillaInvalidaError(`Puede tener hasta ${MAX_RESPUESTAS} respuestas rápidas.`);
  if (enlaces.length > 1) throw new PlantillaInvalidaError('Puede tener un solo botón con enlace.');
  const etiquetas = [...respuestas, ...enlaces].map(b => b.texto.toLowerCase());
  if (new Set(etiquetas).size !== etiquetas.length) throw new PlantillaInvalidaError('Dos botones no pueden decir lo mismo.');

  // Meta exige agrupar los botones: primero las respuestas rápidas, luego el enlace.
  const botones = [...respuestas, ...enlaces];
  const significados = significadosValidos(datos.significados);
  // Solo se guardan los de variables que de verdad quedaron en la plantilla.
  for (const clave of Object.keys(significados)) {
    const [lugar, n] = clave.split(':');
    const existe = lugar === 'cuerpo' ? Number(n) <= total : encabezado.tipo === 'texto' && !!encabezado.ejemplo;
    if (!existe) delete significados[clave];
  }
  return {
    name, language: idioma as PlantillaNuevaValidada['language'], category: datos.categoria as PlantillaNuevaValidada['category'],
    encabezado, cuerpo, ejemplosCuerpo, pie, botones, significados,
  };
}

/** Lo que se le envía a Meta. `handleImagen` es el archivo de muestra ya subido. */
export function componentesParaMeta(p: PlantillaNuevaValidada, handleImagen = ''): Record<string, unknown>[] {
  const componentes: Record<string, unknown>[] = [];
  if (p.encabezado.tipo === 'texto') {
    componentes.push({
      type: 'HEADER', format: 'TEXT', text: p.encabezado.texto,
      ...(p.encabezado.ejemplo ? { example: { header_text: [p.encabezado.ejemplo] } } : {}),
    });
  } else if (p.encabezado.tipo === 'imagen') {
    if (!handleImagen) throw new PlantillaInvalidaError('Falta la imagen del encabezado.');
    componentes.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [handleImagen] } });
  }
  componentes.push({
    type: 'BODY', text: p.cuerpo,
    ...(p.ejemplosCuerpo.length ? { example: { body_text: [p.ejemplosCuerpo] } } : {}),
  });
  if (p.pie) componentes.push({ type: 'FOOTER', text: p.pie });
  if (p.botones.length) {
    componentes.push({
      type: 'BUTTONS',
      buttons: p.botones.map(b => (b.tipo === 'enlace'
        ? (b.dinamico
          ? { type: 'URL', text: b.texto, url: `${b.url}{{1}}`, example: [`${b.url}${b.ejemplo}`] }
          : { type: 'URL', text: b.texto, url: b.url })
        : { type: 'QUICK_REPLY', text: b.texto })),
    });
  }
  return componentes;
}

/** Motivos de rechazo de Meta, en palabras del asesor. */
export const MOTIVOS_RECHAZO: Record<string, string> = {
  ABUSIVE_CONTENT: 'Meta lo consideró contenido inapropiado.',
  INVALID_FORMAT: 'El formato no es válido (revisa saltos de línea, emojis en el título o el enlace).',
  INCORRECT_CATEGORY: 'La categoría no corresponde al contenido: prueba con la otra.',
  PROMOTIONAL: 'Es promocional: debe crearse como marketing.',
  TAG_CONTENT_MISMATCH: 'El contenido no coincide con la categoría o el idioma elegidos.',
  SCAM: 'Meta lo marcó como posible fraude.',
};
