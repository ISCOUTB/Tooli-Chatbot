import type { ClaseHorario } from '../tipos';

/**
 * Lector del «Horario detallado del estudiante» de Banner 8 (Self-Service).
 *
 * ESTADO: construido sobre la estructura ESTÁNDAR de Banner (tablas
 * `datadisplaytable`: una con el título del curso y el CRN, y otra «Reuniones
 * programadas» con Tipo / Hora / Días / Donde). NO se ha comprobado contra el
 * Banner real de la UTB (no hay cuenta de prueba): sus pruebas usan HTML sintético.
 * Falta confirmar con una cuenta del equipo (ver docs/datos-academicos.md):
 *   1. la URL exacta de la página (se asume bwskfshd.P_CrseSchdDetl),
 *   2. el idioma de los encabezados («Días» / «Days»),
 *   3. las letras de los días en la UTB (aquí se aceptan L M I J V S D y M T W R F S U).
 */

const DIAS: Record<string, string> = {
  L: 'lunes', M: 'martes', I: 'miércoles', J: 'jueves', V: 'viernes', S: 'sábado', D: 'domingo',
  T: 'martes', W: 'miércoles', R: 'jueves', F: 'viernes', U: 'domingo',
};

const quitarEtiquetas = (s: string): string =>
  s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** "8:00 am" -> "08:00"; "2:30 pm" -> "14:30"; "14:30" -> "14:30". */
export function hora24(texto: string): string | null {
  const m = texto.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2];
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  if (h > 23 || Number(min) > 59) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function diasDe(texto: string): string[] {
  const letras = texto.toUpperCase().replace(/[^A-Z]/g, '').split('');
  const dias = letras.map((l) => DIAS[l]).filter(Boolean);
  return Array.from(new Set(dias));
}

export function parseHorarioBanner(html: string): ClaseHorario[] {
  const tablas = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const clases: ClaseHorario[] = [];
  let materia = '';
  let crn: string | undefined;
  for (const tabla of tablas) {
    const caption = quitarEtiquetas(tabla.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? '');
    const filas = (tabla.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((f) => ({
      cabeceras: (f.match(/<th[^>]*>[\s\S]*?<\/th>/gi) ?? []).map(quitarEtiquetas),
      celdas: (f.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(quitarEtiquetas),
    }));
    if (/reuniones|scheduled meeting/i.test(caption)) {
      if (!materia) continue;
      const cab = filas.find((f) => f.cabeceras.length > 0)?.cabeceras.map((c) => c.toLowerCase()) ?? [];
      const iHora = cab.findIndex((c) => /hora|time/.test(c));
      const iDias = cab.findIndex((c) => /d[ií]as|days/.test(c));
      const iLugar = cab.findIndex((c) => /donde|dónde|where|lugar/.test(c));
      if (iHora < 0 || iDias < 0) continue;
      for (const fila of filas) {
        if (fila.celdas.length === 0) continue;
        const [ini, fin] = (fila.celdas[iHora] ?? '').split(/\s+-\s+/).map((h) => hora24(h));
        if (!ini || !fin) continue;
        const salon = iLugar >= 0 ? fila.celdas[iLugar] : undefined;
        for (const dia of diasDe(fila.celdas[iDias] ?? '')) {
          clases.push({
            materia, dia, inicio: ini, fin,
            ...(salon && !/^(por definir|tba)$/i.test(salon) ? { salon } : {}),
            ...(crn ? { crn } : {}),
          });
        }
      }
    } else if (caption) {
      materia = caption.split(' - ')[0].trim().slice(0, 120);
      const filaCrn = filas.find((f) => f.cabeceras.some((c) => /^crn$/i.test(c)));
      crn = filaCrn?.celdas[0]?.match(/\d{4,6}/)?.[0];
    }
  }
  return clases;
}
