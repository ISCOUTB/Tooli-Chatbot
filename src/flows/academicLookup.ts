import { setSession } from '../services/session';
import { RECURSOS_ACADEMICOS } from '../services/academicoLinks';
import { returnMenuStep } from './commands';
import type { SessionData } from './commands';
import { messaging } from './shared';

// La hoja de turnos no tiene correo institucional para comprobar que el código
// consultado pertenece al remitente. El portal Iceberg solo pide código/cédula.
// No se envían datos académicos por el bot hasta validar titularidad con la UTB.
export function academicLookupEnabled(): boolean {
  return process.env.TOOLI_ACADEMIC_LOOKUP_ENABLED === '1';
}

export async function sendAcademicPortal(
  from: string,
  resource: 'turno' | 'recibo',
  data?: SessionData,
): Promise<void> {
  const url = resource === 'recibo'
    ? RECURSOS_ACADEMICOS.find((r) => r.id === 'recibo')?.url ?? 'https://iceberg-niif.utb.edu.co/iceberg-pf/'
    : RECURSOS_ACADEMICOS.find((r) => r.id === 'notas')?.url ?? 'https://autoservicio4prod.utb.edu.co';
  await setSession(from, { step: returnMenuStep(data), data: {} });
  await messaging.sendText({
    to: from,
    text: resource === 'recibo'
      ? `Consulta y descarga tu recibo desde el portal oficial de la UTB: ${url}\n\nPor seguridad, no envíes tu cédula por WhatsApp. Escribe *menu* para otras opciones.`
      : `Consulta tu turno de matrícula en los canales académicos oficiales de la UTB: ${url}\n\nPor seguridad, no compartas tu código estudiantil por WhatsApp. Escribe *menu* para otras opciones.`,
  });
}
