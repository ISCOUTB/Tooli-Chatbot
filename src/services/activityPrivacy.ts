// El historial del panel es útil para soporte, pero nunca debe convertirse en
// un almacén de contraseñas, OTP, cédulas o datos capturados en formularios.
const PRIVATE_INPUT_STEPS = new Set([
  'verif_email', 'verif_codigo', 'notas_password', 'notas_mfa',
  'recibo_codigo', 'recibo_cedula', 'esperando_codigo',
  'registro_nombre', 'registro_email', 'registro_programa',
  'prospecto_nombre', 'prospecto_email', 'prospecto_programa',
  'pregrado_registro_nombre', 'pregrado_registro_email', 'pregrado_registro_carrera',
  'pregrado_prospecto_nombre', 'pregrado_prospecto_email', 'pregrado_prospecto_carrera',
  'posg_nombre', 'posg_correo', 'posg_programa',
]);

export function sanitizeActivityText(direction: 'in' | 'out', step: string | undefined, text: string): string {
  if (step && PRIVATE_INPUT_STEPS.has(step)) return '[contenido privado]';
  if (direction === 'out' && /(?:tus notas del per[ií]odo|recibo de matr[ií]cula|turno de matr[ií]cula|te envi[eé] un c[oó]digo)/i.test(text)) {
    return '[contenido privado]';
  }
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}
