/**
 * Revisa lo que responde la IA de posgrados antes de enviarlo. En la prueba con
 * 500 conversaciones reales, 29 de 3.864 respuestas llamaron "maestría" a una
 * especialización ("Maestría en Gerencia de Servicios de Salud") y algunas
 * traían un enlace inventado. Aquí se corrige lo que se puede corregir con
 * certeza a partir del catálogo; lo demás se deja como está.
 */
import { NivelPrograma, POSGRADOS_URL, PROGRAMAS_UTB, POSGRADOS_UTB, ProgramaUtb } from './catalogoUtb';

const NIVEL_TEXTO: Record<Exclude<NivelPrograma, 'pregrado'>, string> = {
  especializacion: 'Especialización', maestria: 'Maestría', doctorado: 'Doctorado',
};

function normalizar(texto: string): string {
  return (texto ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** "Maestría en Administración de Empresas-MBA (virtual)" → "administracion de empresas". */
function nucleo(nombre: string): string {
  return normalizar(nombre.replace(/\([^)]*\)/g, ' ').replace(/\s*[-–]\s*MBA\b/i, ' '))
    .replace(/^(maestria|especializacion|doctorado)( en| de)? /, '').replace(/\b(mba|virtual|presencial)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const POR_NIVEL = new Map<string, { programa: ProgramaUtb; nucleo: string }[]>();
for (const p of POSGRADOS_UTB) {
  const lista = POR_NIVEL.get(p.nivel) ?? [];
  lista.push({ programa: p, nucleo: nucleo(p.nombre) });
  POR_NIVEL.set(p.nivel, lista);
}

function nivelDe(texto: string): Exclude<NivelPrograma, 'pregrado'> {
  const n = normalizar(texto);
  return n.startsWith('maestr') ? 'maestria' : n.startsWith('doctor') ? 'doctorado' : 'especializacion';
}

/** El programa de ese nivel cuyo nombre coincide con el núcleo escrito, si lo hay. */
function buscar(nivel: string, escrito: string): ProgramaUtb | null {
  if (escrito.split(' ').length < 2 && escrito.length < 6) return null;
  const candidatos = (POR_NIVEL.get(nivel) ?? []).filter((x) => x.nucleo === escrito || x.nucleo.startsWith(`${escrito} `) || escrito.startsWith(`${x.nucleo} `) || escrito === x.nucleo);
  return candidatos.length === 1 ? candidatos[0].programa : candidatos.find((x) => x.nucleo === escrito)?.programa ?? null;
}

const NOMBRE = /\b([Mm]aestr[íi]a|[Ee]specializaci[óo]n|[Dd]octorado)( en| de)((?: [\p{L}\p{N}&]+){1,10})/gu;

/**
 * "Maestría en X" que no existe, cuando X sí existe con otro nivel, pasa a ese
 * nivel. Se prueba con las primeras palabras del nombre para no depender de lo
 * que la IA escriba después ("… es virtual y dura un año").
 */
function corregirNiveles(texto: string): { texto: string; cambios: number } {
  let cambios = 0;
  const salida = texto.replace(NOMBRE, (completo: string, nivelEscrito: string, prep: string, resto: string) => {
    const palabras = resto.trim().split(' ');
    const nivel = nivelDe(nivelEscrito);
    for (let k = Math.min(palabras.length, 10); k >= 1; k--) {
      const escrito = nucleo(palabras.slice(0, k).join(' '));
      if (!escrito) continue;
      if (buscar(nivel, escrito)) return completo;       // existe tal cual
      const otros = (['especializacion', 'maestria', 'doctorado'] as const).filter((n) => n !== nivel)
        .map((n) => buscar(n, escrito)).filter((p): p is ProgramaUtb => !!p);
      if (otros.length === 1 && otros[0].nivel !== 'pregrado') {
        cambios++;
        const nuevo = NIVEL_TEXTO[otros[0].nivel];
        return `${nivelEscrito[0] === nivelEscrito[0].toLowerCase() ? nuevo.toLowerCase() : nuevo}${prep}${resto}`;
      }
    }
    return completo;
  });
  return { texto: salida, cambios };
}

const URLS_VALIDAS = new Set(PROGRAMAS_UTB.map((p) => p.url.replace(/\/+$/, '')));
const URL_POSGRADO = /https?:\/\/(?:www\.)?utb\.edu\.co\/posgrados?\/[a-z0-9-]*\/?/gi;

/** Un enlace de posgrado que no está en el catálogo se cambia por el del programa (si se deduce) o por la página general. */
function corregirEnlaces(texto: string): { texto: string; cambios: number } {
  let cambios = 0;
  const salida = texto.replace(URL_POSGRADO, (url: string) => {
    const limpio = url.replace(/\/+$/, '');
    if (URLS_VALIDAS.has(limpio) || limpio.replace(/^http:/, 'https:') === POSGRADOS_URL.replace(/\/+$/, '')) return url;
    const slug = limpio.split('/').pop() ?? '';
    const variantes = [slug.replace(/^maestria-en-/, 'especializacion-en-'), slug.replace(/^maestria-en-/, 'especializacion-'),
      slug.replace(/^especializacion-en-/, 'maestria-en-'), slug.replace(/^especializacion-/, 'especializacion-en-')];
    const encontrado = PROGRAMAS_UTB.find((p) => variantes.some((v) => p.url.replace(/\/+$/, '').endsWith(`/${v}`)));
    cambios++;
    return encontrado ? encontrado.url : POSGRADOS_URL;
  });
  return { texto: salida, cambios };
}

export function corregirRespuestaIa(texto: string): { texto: string; cambios: number } {
  const niveles = corregirNiveles(texto ?? '');
  const enlaces = corregirEnlaces(niveles.texto);
  return { texto: enlaces.texto, cambios: niveles.cambios + enlaces.cambios };
}
