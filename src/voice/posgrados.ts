// Herramienta «posgrados» de la llamada: respuestas habladas armadas SOLO con el catálogo (src/data/programas-utb.json
// vía catalogoUtb) y con lo general que ya publica la base de conocimiento (requisitos y financiación de
// KB_POSGRADOS). Vara: una IA que habla en voz alta no puede inventar. Aquí no hay IA: si un dato no está, se dice que
// no está y se ofrece un asesor. Puro.
import {
  NIVELES_POSGRADO, POSGRADOS_UTB, VIGENCIA_VALORES, buscarPrograma, esVirtual, nombreCorto,
  type NivelPrograma, type ProgramaUtb,
} from '../services/catalogoUtb';
import { normalizeSpeech, pesosParaVoz } from './texto';

export type Aspecto = 'general' | 'costo' | 'duracion' | 'modalidad' | 'requisitos' | 'fechas' | 'financiacion' | 'titulo';
export const ASPECTOS: readonly Aspecto[] = ['general', 'costo', 'duracion', 'modalidad', 'requisitos', 'fechas', 'financiacion', 'titulo'];

/** Copiados de KB_POSGRADOS (src/services/knowledgeBase.ts). Una prueba exige que sigan allí: si cambian, falla. */
export const REQUISITOS_GENERALES = [
  'Título profesional universitario',
  'Hoja de vida actualizada',
  'Carta de motivación',
  'Dos cartas de referencia (maestrías y doctorados)',
  'Entrevista con director del programa (según programa)',
] as const;
export const FINANCIACION = [
  'Crédito ICETEX para posgrado',
  'Planes de pago directos con la UTB',
  'Descuentos para egresados UTB (consultar condiciones)',
] as const;

const NIVEL_HABLADO: Record<NivelPrograma, [string, string]> = {
  pregrado: ['pregrado', 'pregrados'],
  especializacion: ['especialización', 'especializaciones'],
  maestria: ['maestría', 'maestrías'],
  doctorado: ['doctorado', 'doctorados'],
};

const VACIAS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'para', 'por', 'a', 'con', 'programa', 'especializacion',
  'maestria', 'magister', 'doctorado', 'virtual', 'presencial', 'utb', 'gerencia', 'gestion', 'mba',
]);
const ALIAS: Record<string, readonly string[]> = {
  mba: ['maestria-en-administracion'],
  sst: ['especializacion-en-gerencia-de-la-seguridad-y-salud-en-el-trabajo', 'virtual-seguridad-y-salud-trabajo'],
};

function nivelEn(t: string): NivelPrograma | null {
  if (/\bespecializacion(es)?\b/.test(t)) return 'especializacion';
  if (/\b(maestria|maestrias|magister|mba)\b/.test(t)) return 'maestria';
  if (/\bdoctorado(s)?\b/.test(t)) return 'doctorado';
  return null;
}

/** Programas de posgrado que la persona nombró dentro de una frase larga («cuánto vale la maestría en finanzas»). */
export function programasMencionados(texto: string): ProgramaUtb[] {
  const t = normalizeSpeech(texto);
  const palabras = new Set(t.split(' '));
  // «doctorado en administración… tesis de maestría»: valen todos los niveles nombrados, no solo el primero.
  const niveles = nivelesMencionados(t);
  const pideVirtual = palabras.has('virtual');
  const alias = [...palabras].flatMap((w) => ALIAS[w] ?? []);
  const puntuados: { p: ProgramaUtb; score: number }[] = [];
  for (const p of POSGRADOS_UTB) {
    let score = 0;
    if (alias.includes(p.id)) score = 10;
    else {
      const clave = normalizeSpeech(nombreCorto(p)).split(' ').filter((w) => w && !VACIAS.has(w));
      if (!clave.length || !clave.every((w) => palabras.has(w))) continue;
      score = clave.length;
    }
    if (niveles.length && !niveles.includes(p.nivel)) continue;
    if (pideVirtual === esVirtual(p)) score += 0.5;
    puntuados.push({ p, score });
  }
  if (!puntuados.length) {
    // «la maestría en administración cuánto vale»: se prueba con lo que sigue a «… en» contra el buscador del catálogo.
    const m = t.match(/\b(especializacion|maestria|doctorado) en ([a-z ñ]+)/);
    if (!m) return [];
    const frase = m[2].split(/\b(cuanto|que|cuales|como|cuando|para|me|y|por|la|el)\b/)[0].trim();
    return frase ? buscarPrograma(`${m[1]} en ${frase}`, NIVELES_POSGRADO).slice(0, 3) : [];
  }
  puntuados.sort((a, b) => b.score - a.score);
  const mejor = puntuados[0].score;
  return puntuados.filter((x) => x.score === mejor).slice(0, 3).map((x) => x.p);
}

/**
 * Nombró un posgrado concreto que NO está en el catálogo: «la maestría en medicina», «el doctorado en astrología».
 * Devuelve lo que nombró (para decir que no está) o null si nombró uno que existe, un área con programas, o nada.
 */
export function programaInexistente(texto: string): string | null {
  const t = normalizeSpeech(texto);
  if (programasMencionados(texto).length) return null;
  const m = t.match(/\b(especializacion|maestria|doctorado|posgrado|master|magister) (en|de) ([a-z ñ]+)/);
  if (!m) return null;
  const frase = m[3].split(/\b(cuanto|que|cuales|como|cuando|para|pa|me|y|o|por|la|el|si|es|esa|ese|eso|alla|aca|aqui|ahi|existe|hay)\b/)[0].trim();
  const contenido = frase.split(' ').filter((w) => w.length >= 4 && !VACIAS.has(w));
  if (!contenido.length) return null;
  const nivel = nivelEn(m[1]);
  if (programasDeAreas(areasMencionadas(frase), nivel ? [nivel] : [], false).length) return null;
  return `${m[1]} en ${frase}`;
}

// ------------------------------------------------------------------ áreas

/**
 * Áreas del catálogo: cómo las nombra la gente (`dice`) y qué programas caen en cada una (`programa`, sobre el nombre
 * normalizado). Sirve para «qué posgrados hay en derecho» o «algo de plata y negocios»: se lista lo que hay.
 */
const AREAS: readonly { clave: string; nombre: string; dice: RegExp; programa: RegExp }[] = [
  { clave: 'derecho', nombre: 'derecho', dice: /\b(derecho|derechos|leyes|juridic\w*|abogad\w*|legal|legales)\b/, programa: /derech|contratacion/ },
  { clave: 'educacion', nombre: 'educación', dice: /\b(educacion|educativ\w*|docencia|docentes?|pedagog\w*|ensenanza|profesores)\b/, programa: /educa|ensenanza/ },
  { clave: 'ingenieria', nombre: 'ingeniería', dice: /\b(ingenieria|ingenierias|ingeniero|ingenieros)\b/, programa: /ingenier|estructural|geotecnia|automatizacion|telecomunicaciones|mantenimiento|industria 4|energetic|produccion/ },
  { clave: 'tecnologia', nombre: 'tecnología y software', dice: /\b(software|sistemas|informatica|tecnologia|tecnologias|programacion|datos|ciberseguridad|digital|computacion)\b/, programa: /software|ciberseguridad|datos|telecomunicaciones|transformacion digital|tecnologias disruptivas|industria 4/ },
  { clave: 'finanzas', nombre: 'finanzas', dice: /\b(finanzas|financier[oa]s?|plata|dinero|contabilidad|contable|contador\w*|tributari\w*|impuestos|auditoria)\b/, programa: /finanzas|contabilidad|tributari/ },
  { clave: 'negocios', nombre: 'administración y negocios', dice: /\b(negocios|administracion|administrar|empresas|empresarial|gerencia|mercadeo|marketing|emprendimiento|mba)\b/, programa: /administracion|negocios|empresarial|mercadeo|management|proyectos|planeacion|logistica|talento|gestion humana|innovacion/ },
  { clave: 'salud', nombre: 'salud', dice: /\b(salud|sst|psicologia|psicosocial)\b/, programa: /salud|psicosocial/ },
  { clave: 'ambiente', nombre: 'ambiente y sostenibilidad', dice: /\b(ambiental|ambiente|sostenibilidad|sostenible|energia|energias)\b/, programa: /ambiental|sostenib|energetic/ },
  { clave: 'social', nombre: 'ciencias sociales y cultura', dice: /\b(social|sociales|cultura|cultural|patrimonio|turismo)\b/, programa: /cultural|social|desarrollo regional|derechos humanos|patrimonio/ },
];

/** Claves de las áreas que nombra un texto. */
export function areasMencionadas(texto: string): string[] {
  const t = normalizeSpeech(texto);
  return AREAS.filter((a) => a.dice.test(t)).map((a) => a.clave);
}

/** Niveles nombrados (todos, no el primero): «doctorados o maestrías». */
export function nivelesMencionados(texto: string): NivelPrograma[] {
  const t = normalizeSpeech(texto);
  const out: NivelPrograma[] = [];
  if (/\bespecializacion(es)?\b/.test(t)) out.push('especializacion');
  if (/\b(maestria|maestrias|magister|mba)\b/.test(t)) out.push('maestria');
  if (/\bdoctorados?\b/.test(t)) out.push('doctorado');
  return out;
}

/** Programas de esas áreas; con un solo nivel nombrado, solo de ese nivel; con `virtual`, solo los virtuales. */
export function programasDeAreas(claves: readonly string[], niveles: readonly NivelPrograma[], virtual: boolean): ProgramaUtb[] {
  if (!claves.length) return [];
  const areas = AREAS.filter((a) => claves.includes(a.clave));
  return POSGRADOS_UTB.filter((p) => {
    const n = normalizeSpeech(p.nombre);
    if (!areas.some((a) => a.programa.test(n))) return false;
    if (niveles.length === 1 && p.nivel !== niveles[0]) return false;
    return !virtual || esVirtual(p);
  });
}

/** «En derecho tengo 5 posgrados, por ejemplo: … ¿Cuál te interesa?». Corto para el oído: hasta 4 nombres. */
export function listaAreaHablada(claves: readonly string[], programas: readonly ProgramaUtb[]): string {
  const nombresArea = AREAS.filter((a) => claves.includes(a.clave)).map((a) => a.nombre);
  const area = nombresArea.length > 1 ? `${nombresArea.slice(0, -1).join(', ')} y ${nombresArea[nombresArea.length - 1]}` : nombresArea[0] ?? 'esa área';
  if (!programas.length) {
    return `En la oferta publicada de la UTB no veo posgrados de ${area}. ¿Quieres que te cuente de otra área o que te comunique con un asesor?`;
  }
  const vistos = new Set<string>();
  const nombres: string[] = [];
  for (const p of programas) {
    const k = `${p.nivel}:${nombreCorto(p).toLowerCase()}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    nombres.push(nombreHablado(p).replace(/ virtual$/, ''));
  }
  if (nombres.length === 1) return `En ${area} tengo una opción: ${nombres[0]}. ¿Quieres que te cuente de ella?`;
  const muestra = nombres.slice(0, 4);
  const resto = nombres.length > muestra.length ? ', entre otros' : '';
  return `En ${area} tengo ${nombres.length} posgrados, por ejemplo: ${muestra.slice(0, -1).join(', ')} y ${muestra[muestra.length - 1]}${resto}. ¿Cuál te interesa?`;
}

/** El nombre que dio la IA, validado contra el catálogo (nunca se usa un programa que no exista). */
export function programaPorNombre(nombre: string): ProgramaUtb[] {
  return buscarPrograma(nombre, NIVELES_POSGRADO).slice(0, 3);
}

export function getPosgrado(id: string | null): ProgramaUtb | null {
  return id ? POSGRADOS_UTB.find((p) => p.id === id) ?? null : null;
}

/** «la Maestría en Finanzas virtual». */
export function nombreHablado(p: ProgramaUtb): string {
  const virtual = esVirtual(p) && !/virtual/i.test(p.nombre) ? ' virtual' : '';
  return `la ${p.nombre.replace(/-MBA$/, ' MBA')}${virtual}`.replace(/^la Doctorado/, 'el Doctorado');
}

function modalidadHablada(p: ProgramaUtb): string | null {
  if (!p.modalidad) return null;
  if (/virtual/i.test(p.modalidad)) return '100 % virtual';
  return p.modalidad.toLowerCase();
}

function duracionHablada(p: ProgramaUtb): string | null {
  if (p.duracion_semestres) return `${p.duracion_semestres} ${p.duracion_semestres === 1 ? 'semestre' : 'semestres'}`;
  return p.duracion ? p.duracion.toLowerCase() : null;
}

export function costoHablado(p: ProgramaUtb): string | null {
  if (p.inversion_cop != null) {
    const sem = `${pesosParaVoz(p.inversion_cop)} por semestre`;
    const total = p.duracion_semestres && p.duracion_semestres > 1 ? `, para un total de ${pesosParaVoz(p.inversion_cop * p.duracion_semestres)} por los ${p.duracion_semestres} semestres` : '';
    return `${sem}${total}`;
  }
  return p.inversion_texto ? p.inversion_texto.replace(/\bSMMLV\b/g, 'salarios mínimos') : null;
}

const OFRECE = '¿Quieres que te comunique con un asesor?';

/** Respuesta hablada de un aspecto de un programa. `ofreceAsesor` = la respuesta termina ofreciendo asesor. */
export function respuestaPrograma(p: ProgramaUtb, aspecto: Aspecto): { texto: string; ofreceAsesor: boolean } {
  const r = respuestaCruda(p, aspecto);
  return { ...r, texto: r.texto.replace(/\bde el\b/g, 'del').replace(/\ba el\b/g, 'al') };
}

function respuestaCruda(p: ProgramaUtb, aspecto: Aspecto): { texto: string; ofreceAsesor: boolean } {
  const nombre = nombreHablado(p);
  switch (aspecto) {
    case 'costo': {
      const c = costoHablado(p);
      return c
        ? { texto: `El valor de matrícula ${VIGENCIA_VALORES} de ${nombre} es de ${c}. ¿Quieres saber cómo financiarlo?`, ofreceAsesor: false }
        : { texto: `La UTB no tiene publicado el valor de ${nombre}, así que prefiero no darte una cifra. ${OFRECE}`, ofreceAsesor: true };
    }
    case 'duracion': {
      const d = duracionHablada(p);
      return d
        ? { texto: `${cap(nombre)} dura ${d}.${modalidadHablada(p) ? ` Es ${modalidadHablada(p)}.` : ''}`, ofreceAsesor: false }
        : { texto: `No tengo publicada la duración de ${nombre}. ${OFRECE}`, ofreceAsesor: true };
    }
    case 'modalidad': {
      const m = modalidadHablada(p);
      return m
        ? { texto: `${cap(nombre)} es ${m}.`, ofreceAsesor: false }
        : { texto: `No tengo publicada la modalidad de ${nombre}. ${OFRECE}`, ofreceAsesor: true };
    }
    case 'titulo':
      return p.titulo_otorgado
        ? { texto: `Con ${nombre} obtienes el título de ${p.titulo_otorgado}.`, ofreceAsesor: false }
        : { texto: `No tengo publicado el título exacto que otorga ${nombre}. ${OFRECE}`, ofreceAsesor: true };
    case 'requisitos':
      return { texto: requisitosHablados(p.nivel), ofreceAsesor: false };
    case 'financiacion':
      return { texto: financiacionHablada(), ofreceAsesor: true };
    case 'fechas':
      return { texto: FECHAS_NO_PUBLICADAS, ofreceAsesor: true };
    case 'general':
    default: {
      const partes = [`${cap(nombre)}`];
      const m = modalidadHablada(p);
      const d = duracionHablada(p);
      if (m && d) partes.push(` es ${m} y dura ${d}.`);
      else if (m) partes.push(` es ${m}.`);
      else if (d) partes.push(` dura ${d}.`);
      else partes.push(' está en la oferta de este año.');
      const c = costoHablado(p);
      if (c) partes.push(` La matrícula ${VIGENCIA_VALORES} es de ${c}.`);
      partes.push(' ¿Quieres saber los requisitos, la financiación o hablar con un asesor?');
      return { texto: partes.join(''), ofreceAsesor: false };
    }
  }
}

const SIN_PREGUNTA_FINAL = (s: string) => s.replace(/\s*¿[^¿?]*\?\s*$/, '').trim();

/**
 * Varios aspectos a la vez («qué título dan y si es virtual»): se contesta cada uno, sin la pregunta del final de cada
 * respuesta, y se cierra con una sola. Con `p` null, solo los aspectos generales (requisitos, financiación, fechas).
 */
export function respuestaAspectos(p: ProgramaUtb | null, aspectos: readonly Aspecto[], nivel: NivelPrograma | null = null): { texto: string; ofreceAsesor: boolean } | null {
  const partes = aspectos.flatMap((a) => {
    if (p) return [respuestaPrograma(p, a)];
    if (a === 'requisitos') return [{ texto: requisitosHablados(nivel), ofreceAsesor: false }];
    if (a === 'financiacion') return [{ texto: financiacionHablada(), ofreceAsesor: true }];
    if (a === 'fechas') return [{ texto: FECHAS_NO_PUBLICADAS, ofreceAsesor: true }];
    return [];
  });
  if (!partes.length) return null;
  if (partes.length === 1) return partes[0];
  const ofreceAsesor = partes.some((x) => x.ofreceAsesor);
  const ultima = partes[partes.length - 1].texto.match(/¿[^¿?]*\?\s*$/)?.[0] ?? '';
  const cierre = ofreceAsesor ? OFRECE : ultima;
  return { texto: `${partes.map((x) => SIN_PREGUNTA_FINAL(x.texto)).join(' ')} ${cierre}`.trim(), ofreceAsesor };
}

export const FECHAS_NO_PUBLICADAS =
  'Las fechas de inscripción y de inicio de clases no las tengo publicadas, y no quiero darte una fecha equivocada. Un asesor te las confirma. ¿Quieres que te comunique con uno?';

export function requisitosHablados(nivel?: NivelPrograma | null): string {
  const base = 'Los requisitos generales para un posgrado en la UTB son: título profesional universitario, hoja de vida actualizada y carta de motivación';
  const ref = nivel === 'especializacion' ? '' : nivel ? ', y para maestrías y doctorados, dos cartas de referencia' : '. Para maestrías y doctorados se piden además dos cartas de referencia';
  const doc = nivel === 'doctorado' || !nivel ? ' Para doctorado se pide título de maestría, o de pregrado con alto promedio.' : '';
  return `${base}${ref}. Según el programa puede haber una entrevista con el director.${doc}`;
}

export function financiacionHablada(): string {
  return 'Para financiar tu posgrado la UTB tiene crédito ICETEX, planes de pago directos con la universidad y descuentos para egresados UTB. Las condiciones exactas te las confirma un asesor. ¿Quieres que te comunique con uno?';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Tenemos 20 maestrías, por ejemplo: …». Corto para el oído: cuenta y hasta 5 nombres. */
export function listaHablada(nivel: NivelPrograma | null): string {
  if (!nivel) {
    const n = (k: NivelPrograma) => POSGRADOS_UTB.filter((p) => p.nivel === k).length;
    return `La UTB tiene ${n('especializacion')} especializaciones, ${n('maestria')} maestrías y ${n('doctorado')} doctorados. ¿Te interesa alguna área en particular, por ejemplo ingeniería, negocios, educación o derecho?`;
  }
  const lista = POSGRADOS_UTB.filter((p) => p.nivel === nivel);
  const vistos = new Set<string>();
  const nombres: string[] = [];
  for (const p of lista) {
    const c = nombreCorto(p).replace(/-MBA$/, '').replace(/\s*\(.*\)$/, '');
    if (vistos.has(c.toLowerCase())) continue;
    vistos.add(c.toLowerCase());
    nombres.push(c);
    if (nombres.length >= 5) break;
  }
  const [uno, muchos] = NIVEL_HABLADO[nivel];
  const total = lista.length;
  if (total === 0) return `En este momento no tengo ${muchos} en la oferta publicada. ¿Quieres hablar con un asesor?`;
  const resto = total > nombres.length ? ', entre otras' : '';
  return `Tenemos ${total} ${total === 1 ? uno : muchos}, por ejemplo en ${nombres.join(', ')}${resto}. ¿Cuál te interesa?`;
}

/** Montos que la llamada puede decir sobre posgrados (para la guardia de montos en las pruebas). */
export function montosDelCatalogo(): Set<number> {
  const s = new Set<number>();
  for (const p of POSGRADOS_UTB) {
    if (p.inversion_cop == null) continue;
    s.add(p.inversion_cop);
    if (p.duracion_semestres) s.add(p.inversion_cop * p.duracion_semestres);
  }
  return s;
}

export function nivelMencionado(texto: string): NivelPrograma | null {
  return nivelEn(normalizeSpeech(texto));
}
