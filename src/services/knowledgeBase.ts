/**
 * Base de conocimiento estática del Centro de Servicios UTB.
 * Esta info se inyecta en el system prompt del AI assistant para Admisiones.
 *
 * Fuente: https://www.utb.edu.co/inscripciones-y-admisiones/
 *         https://www.utb.edu.co/la-utb/derechos-pecuniarios/
 *         https://www.utb.edu.co/la-utb/directivas/secretaria-general/registro-academico/calendario-academico/
 *
 * Valores de matrícula: vigencia 2026. Revisar la página oficial al cambiar de año.
 *
 * Los posgrados (nombres, valores, duración y página de cada uno) se generan
 * desde `catalogoUtb.ts`, que sale de las páginas oficiales.
 */
import {
  DERECHOS_PECUNIARIOS_URL,
  NivelPrograma,
  POSGRADOS_URL,
  POSGRADOS_VIRTUALES_URL,
  VIGENCIA_VALORES,
  esVirtual,
  programasPorNivel,
  valorSemestre,
} from './catalogoUtb';

/** Una línea por posgrado vigente: nombre, modalidad, duración, valor y (opcional) página oficial. */
function lineasPosgrado(nivel: NivelPrograma, conUrl: boolean): string {
  return programasPorNivel(nivel)
    .map((p) => {
      const partes = [
        p.nombre + (esVirtual(p) ? ' (virtual)' : ''),
        !esVirtual(p) && p.modalidad && !/^presencial$/i.test(p.modalidad) ? p.modalidad.toLowerCase() : null,
        p.duracion_semestres ? `${p.duracion_semestres} semestres` : null,
        valorSemestre(p) ?? 'valor no publicado, confirmar con Posgrados',
        conUrl ? p.url : null,
      ];
      return `- ${partes.filter(Boolean).join(' — ')}`;
    })
    .join('\n');
}

export const KB_ADMISIONES = `
# UNIVERSIDAD TECNOLÓGICA DE BOLÍVAR (UTB) — Centro de Servicios

## REQUISITOS DE ADMISIÓN (PREGRADO)
- Puntaje ICFES (Pruebas Saber 11) mínimo: 200 puntos
- NO se requiere Sisbén
- NO hay entrevista ni examen de admisión
- Documentos obligatorios: notas de bachillerato, certificado de graduación, afiliación al sistema de salud
- Si faltan documentos al momento de inscribirte, la universidad emite carta de compromiso
- La universidad responde la admisión en 2 días hábiles vía email

## PROCESO DE INSCRIPCIÓN
- El costo de inscripción y posibles exenciones deben confirmarse en la página oficial de derechos pecuniarios o con Admisiones; las páginas institucionales publican información distinta según el trámite y la campaña.
- Se hace en línea desde la página de la UTB
- Después de admitido, debes pagar la matrícula y cargar documentos
- Email para envío de documentos: admisiones@utb.edu.co

## CALENDARIO ACADÉMICO 2026
Estas fechas son de 2026. Si ya pasaron o el usuario pregunta por otra vigencia, consulta el calendario oficial enlazado abajo; no las presentes como próximas.

### Primer Período 2026 (febrero – mayo)
- Inscripciones nuevos estudiantes: 29 ago 2025 – 15 ene 2026
- Inscripciones reintegros/transferencias: 29 ago 2025 – 8 ene 2026
- Matrícula financiera nuevos: 3 sep – 18 dic 2025
- Matrícula financiera antiguos: 18 nov – 18 dic 2025
- Matrícula extraordinaria: hasta 24 ene 2026
- Matrícula académica: 22-28 ene 2026
- Inducción nuevos estudiantes: 28-30 ene 2026
- Inicio de clases: 2 feb 2026
- Fin de clases: 30 may 2026

### Segundo Período 2026 (agosto – noviembre)
- Inscripciones nuevos estudiantes: 9 mar – 23 jul 2026
- Inscripciones reintegros/transferencias: 9 mar – 16 jul 2026
- Matrícula financiera nuevos: 9 mar – 26 jun 2026
- Matrícula financiera antiguos: 11 may – 26 jun 2026
- Matrícula académica: 23-29 jul 2026
- Inducción nuevos estudiantes: 29-31 jul 2026
- Inicio de clases: 3 ago 2026
- Fin de clases: 28 nov 2026

### Cursos Intersemestrales 2026 (junio-julio)
- Publicación de oferta: 11 may 2026
- Matrícula financiera: 9-17 jun 2026
- Inicio de clases: 22 jun 2026
- Fin de clases: 17 jul 2026

## COSTOS POR PROGRAMA — PREGRADO 2026 (semestre, COP)
Estos valores corresponden a 2026. Para otra vigencia, no los presentes como actuales: remite a https://www.utb.edu.co/la-utb/derechos-pecuniarios/.

### Escuela de Ingeniería, Arquitectura y Diseño
- Ingeniería Eléctrica: $7.880.000 (nuevos) / $7.266.000 (antiguos)
- Ingeniería Electrónica: $7.880.000 / $7.266.000
- Ingeniería Civil: $8.040.000 / $7.266.000
- Ingeniería Ambiental: $7.880.000 / $7.266.000
- Ingeniería Química: $7.880.000 / $7.266.000
- Ingeniería Biomédica: $7.880.000 / $7.266.000
- Ingeniería Mecánica: $8.363.000 / $7.712.000
- Ingeniería Mecatrónica: $8.363.000 / $7.712.000
- Ingeniería Naval: $8.363.000 / $7.712.000
- Ingeniería Industrial: $8.602.000 / $8.082.000
- Arquitectura: $8.040.000 / $7.413.000
- Diseño: $8.040.000

### Escuela de Negocios, Leyes y Sociedad
- Psicología: $7.967.000 / $7.346.000
- Ciencia Política y Relaciones Internacionales: $6.703.000 / $6.180.000
- Derecho: $6.871.000 / $6.455.000
- Contaduría Pública: $4.849.000 / $4.555.000
- Administración de Empresas: $7.723.000 / $7.121.000
- Finanzas y Negocios Internacionales: $7.723.000 / $7.121.000
- Economía: $5.977.000 / $5.562.000

### Escuela de Transformación Digital
- Ingeniería de Sistemas y Computación: $7.284.000 / $6.595.000
- Comunicación Social: $7.865.000 / $7.281.000
- Marketing y Transformación Digital: $7.865.000 / $7.253.000
- Ciencia de Datos: $7.932.000

### Programas Virtuales
- Contaduría Pública (virtual): $2.950.000 (8 semestres)

### Tecnológicos
- Tecnología en Sistemas: $1.926.000
- Tecnología en Logística de Transporte Internacional de Mercancías: $1.926.000
- Tecnología en Operación de Plantas Petroquímicas: $1.926.000
- Tecnología en Gestión Contable y Financiera (presencial y virtual): $1.926.000

## COSTOS POSGRADO ${VIGENCIA_VALORES}
Estos valores corresponden a ${VIGENCIA_VALORES}. Para otra vigencia, no los presentes como actuales: remite a ${DERECHOS_PECUNIARIOS_URL}.

### Especializaciones
${lineasPosgrado('especializacion', false)}

### Maestrías
${lineasPosgrado('maestria', false)}

### Doctorados
${lineasPosgrado('doctorado', false)}

## OTROS COSTOS
Los derechos de inscripción y otros trámites dependen de la vigencia y de condiciones particulares. Confirma el valor aplicable en https://www.utb.edu.co/la-utb/derechos-pecuniarios/ o con Admisiones. Los importes siguientes son referencias publicadas para 2026, no promesas de cobro:
- Homologación interna: $68.000
- Homologación externa pregrado: $385.000
- Homologación externa posgrado: $422.000
- Examen de homologación de inglés: $137.000
- Reingreso: $200.000
- Derechos de grado: $400.000
- Derechos de grado doctorado sostenibilidad: $981.200
- Certificados y constancias: $21.000
- Certificados de notas (egresados): $36.000 – $195.000
- Duplicado de diploma: $211.000
- Duplicado de carné estudiantil: $52.000
- Examen preparatorio de Derecho: $242.000 c/u

## OPCIONES DE FINANCIACIÓN
- Becas (consultar requisitos en https://www.utb.edu.co/apoyo-financiero/becas/)
- Crédito ICETEX (https://www.utb.edu.co/apoyo-financiero/credito-icetex/)
- Planes de pago directos con la UTB
- Portafolio financiero (https://www.utb.edu.co/apoyo-financiero)

## PROGRAMAS DE PREGRADO DISPONIBLES
Ingeniería: Eléctrica, Electrónica, Civil, Ambiental, Química, Biomédica, Mecánica, Mecatrónica, Naval, Industrial, de Sistemas y Computación.
Diseño y Arquitectura: Arquitectura, Diseño.
Negocios: Administración de Empresas, Contaduría Pública, Finanzas y Negocios Internacionales, Economía, Marketing y Transformación Digital.
Sociedad: Psicología, Derecho, Ciencia Política y Relaciones Internacionales, Comunicación Social.
Transformación Digital: Ciencia de Datos, Ingeniería de Sistemas y Computación.

## CONTACTOS — INSCRIPCIONES
### Pregrado
- Email: infoinscripciones@utb.edu.co
- Teléfonos: +57 605 6931919, 323 5668731, 311 3417981, 323 5668733, 323 5668730, 311 3400661, 323 5668729, 316 7301597

### Posgrado
- Email: mercadeoposgrado@utb.edu.co
- Teléfonos: 311 3405776, 310 6508107, 311 3406556, 321 6085653, 316 4837199

### Educación Continua (CEP)
- Teléfonos: 321 6086917, 310 6508127

### Sede principal
- +57 605 6931919

## PÁGINAS ÚTILES
- Inscripciones: https://www.utb.edu.co/inscripciones-y-admisiones/
- Becas: https://www.utb.edu.co/apoyo-financiero/becas/
- Calendario: https://www.utb.edu.co/la-utb/directivas/secretaria-general/registro-academico/calendario-academico/
- Costos detallados: https://www.utb.edu.co/la-utb/derechos-pecuniarios/
`.trim();

/**
 * Base de conocimiento enfocada en Posgrados UTB.
 * Inyectada en el system prompt del AI assistant para el bot Tooli Posgrados.
 */
export const KB_POSGRADOS = `
# UNIVERSIDAD TECNOLÓGICA DE BOLÍVAR (UTB) — Posgrados

Formato: programa — modalidad si no es presencial — duración — valor de matrícula ${VIGENCIA_VALORES} por semestre — página oficial.
Comparte la página oficial del programa cuando el usuario pida más información.

## ESPECIALIZACIONES
${lineasPosgrado('especializacion', true)}

## MAESTRÍAS
${lineasPosgrado('maestria', true)}

## DOCTORADOS
${lineasPosgrado('doctorado', true)}

## COSTOS DE INSCRIPCIÓN
Confirma el valor aplicable, promociones y exenciones con Posgrados UTB o en https://www.utb.edu.co/la-utb/derechos-pecuniarios/. No asegures que la inscripción sea gratuita ni cites un importe fijo sin confirmar la vigencia.

## REQUISITOS GENERALES
- Título profesional universitario
- Hoja de vida actualizada
- Carta de motivación
- Dos cartas de referencia (maestrías y doctorados)
- Entrevista con director del programa (según programa)
- Para doctorados: título de maestría o pregrado con alto promedio

## FINANCIACIÓN
- Crédito ICETEX para posgrado
- Planes de pago directos con la UTB
- Descuentos para egresados UTB (consultar condiciones)

## CONTACTO POSGRADOS UTB
- Email: mercadeoposgrado@utb.edu.co
- Teléfonos: 311 3405776 / 310 6508107 / 321 6085653
- Todos los posgrados: ${POSGRADOS_URL}
- Posgrados virtuales (UTB Virtual): ${POSGRADOS_VIRTUALES_URL}
- Valores de matrícula: ${DERECHOS_PECUNIARIOS_URL}
`.trim();
