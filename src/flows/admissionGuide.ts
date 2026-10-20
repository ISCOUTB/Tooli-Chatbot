import type { FlowArea } from './commands';

const PREGRADO_URL = 'https://www.utb.edu.co/inscripciones-y-admisiones/inscripciones-pregrado/primera-vez/';
const POSGRADO_URL = 'https://www.utb.edu.co/inscripciones-y-admisiones/inscripciones-posgrado/';
const DERECHOS_URL = 'https://www.utb.edu.co/la-utb/derechos-pecuniarios/';

/** Guía breve basada en las páginas oficiales; no guarda datos ni inicia la inscripción. */
export function formatAdmissionGuide(area: FlowArea): string {
  if (area === 'pregrado') {
    return (
      '🏫 *Inscribirte a Pregrado UTB (primera vez)*\n\n' +
      '1. Revisa los requisitos: título de bachiller y prueba Saber 11.\n' +
      '2. Prepara los documentos que pida el formulario oficial.\n' +
      '3. Inscríbete con tu correo, conserva el enlace que recibas y selecciona *Finalizar y enviar*.\n' +
      '4. Revisa tu correo para conocer el resultado; si eres admitido, allí recibirás las instrucciones de matrícula.\n\n' +
      `Guía oficial y otras modalidades (transferencia, reingreso): ${PREGRADO_URL}\n` +
      `Valores y derechos vigentes: ${DERECHOS_URL}\n\n` +
      '_Esta guía no envía tu solicitud. Completa el formulario en la página oficial. Escribe *menu* para otras opciones._'
    );
  }
  return (
    '🎓 *Inscribirte a Posgrado UTB (primera vez)*\n\n' +
    '1. Revisa los requisitos de tu programa; la guía general pide título profesional.\n' +
    '2. Prepara identificación, foto, hoja de vida y diploma o acta de grado según corresponda.\n' +
    '3. Diligencia y finaliza el formulario oficial; revisa tu correo para el resultado.\n' +
    '4. Si eres admitido, sigue las instrucciones de matrícula que te envíe la UTB.\n\n' +
    `Guía oficial, modalidades virtuales y otras vías de ingreso: ${POSGRADO_URL}\n` +
    `Valores y derechos vigentes: ${DERECHOS_URL}\n\n` +
    '_Esta guía no envía tu solicitud. Completa el formulario en la página oficial. Escribe *menu* para otras opciones._'
  );
}
