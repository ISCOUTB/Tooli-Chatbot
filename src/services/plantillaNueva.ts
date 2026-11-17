/**
 * Reglas para crear una plantilla de WhatsApp desde el panel, sin red: arma
 * lo que se le envía a Meta y explica en palabras del asesor qué falta.
 * Probado en plantillaNueva.test.ts; las llamadas a Meta viven en
 * plantillasMeta.ts.
 *
 * Alcance a propósito: texto fijo, sin variables {{1}}. Una plantilla con
 * variables exige ejemplos para cada una y Meta la revisa con más rigor; por
 * ahora se crean desde el administrador de Meta.
 */

export class PlantillaInvalidaError extends Error {}

export const CATEGORIAS_NUEVA = ['MARKETING', 'UTILITY'] as const;
export const IDIOMAS_NUEVA = ['es', 'es_CO', 'en_US'] as const;
export const MAX_RESPUESTAS = 3;

export interface BotonNuevo {
  tipo: 'respuesta' | 'enlace';
  texto: string;
  url?: string;
}

export interface PlantillaNuevaValidada {
  name: string;
  language: typeof IDIOMAS_NUEVA[number];
  category: typeof CATEGORIAS_NUEVA[number];
  encabezado: { tipo: 'ninguno' } | { tipo: 'texto'; texto: string } | { tipo: 'imagen' };
  cuerpo: string;
  pie: string;
  botones: BotonNuevo[];
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
    throw new PlantillaInvalidaError(
      `${primeraMayuscula(campo)} no puede llevar variables ({{1}}): desde el panel se crean plantillas de texto fijo.`,
    );
  }
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
    sinVariables(t, 'el título');
    encabezado = { tipo: 'texto', texto: t };
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
  sinVariables(cuerpo, 'el mensaje');

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
      enlaces.push({ tipo: 'enlace', texto: etiqueta, url: valida.toString() });
    } else {
      throw new PlantillaInvalidaError('Un botón no es válido.');
    }
  }
  if (respuestas.length > MAX_RESPUESTAS) throw new PlantillaInvalidaError(`Puede tener hasta ${MAX_RESPUESTAS} respuestas rápidas.`);
  if (enlaces.length > 1) throw new PlantillaInvalidaError('Puede tener un solo botón con enlace.');
  const etiquetas = [...respuestas, ...enlaces].map(b => b.texto.toLowerCase());
  if (new Set(etiquetas).size !== etiquetas.length) throw new PlantillaInvalidaError('Dos botones no pueden decir lo mismo.');

  // Meta exige agrupar los botones: primero las respuestas rápidas, luego el enlace.
  return {
    name, language: idioma as PlantillaNuevaValidada['language'], category: datos.categoria as PlantillaNuevaValidada['category'],
    encabezado, cuerpo, pie, botones: [...respuestas, ...enlaces],
  };
}

/** Lo que se le envía a Meta. `handleImagen` es el archivo de muestra ya subido. */
export function componentesParaMeta(p: PlantillaNuevaValidada, handleImagen = ''): Record<string, unknown>[] {
  const componentes: Record<string, unknown>[] = [];
  if (p.encabezado.tipo === 'texto') {
    componentes.push({ type: 'HEADER', format: 'TEXT', text: p.encabezado.texto });
  } else if (p.encabezado.tipo === 'imagen') {
    if (!handleImagen) throw new PlantillaInvalidaError('Falta la imagen del encabezado.');
    componentes.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [handleImagen] } });
  }
  componentes.push({ type: 'BODY', text: p.cuerpo });
  if (p.pie) componentes.push({ type: 'FOOTER', text: p.pie });
  if (p.botones.length) {
    componentes.push({
      type: 'BUTTONS',
      buttons: p.botones.map(b => (b.tipo === 'enlace'
        ? { type: 'URL', text: b.texto, url: b.url }
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
