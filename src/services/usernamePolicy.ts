/**
 * Reglas para los nombres de usuario del panel, como en las redes sociales:
 * de 3 a 30 caracteres, solo a-z, números, punto y guion bajo, sin tildes, ñ ni
 * espacios. Un usuario como "ángel acero" se escribe distinto en cada teclado y
 * nadie lo recuerda igual; "angelacero" no deja dudas.
 *
 * Solo aplican al crear o cambiar un usuario. Iniciar sesión no las exige: los
 * usuarios que ya existían así siguen entrando hasta que un admin los renombre.
 * El panel tiene una copia de estas reglas en src/public/app/js/core/usuario.js.
 */

const MAX_USERNAME_LENGTH = 30;

export function normalizarUsuario(texto: string): string {
  return String(texto ?? '').trim().toLowerCase();
}

export function sugerirUsuario(nombreCompleto: string): string {
  return normalizarUsuario(nombreCompleto)
    .replace(/ñ/g, 'n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, MAX_USERNAME_LENGTH);
}

export function validarUsuario(username: string): string | null {
  const valor = normalizarUsuario(username);
  if (/[ñáéíóúü]/i.test(valor) || valor.normalize('NFD') !== valor) {
    const sugerencia = sugerirUsuario(valor);
    return `El usuario no puede llevar tildes ni ñ${sugerencia ? `: usa «${sugerencia}»` : ''}`;
  }
  if (/\s/.test(valor)) return 'El usuario no puede llevar espacios';
  if (valor.length < 3 || valor.length > MAX_USERNAME_LENGTH) return 'El usuario debe tener entre 3 y 30 caracteres';
  if (!/^[a-z0-9._]+$/.test(valor)) return 'El usuario solo puede llevar letras a-z, números, punto y guion bajo';
  if (valor.startsWith('.') || valor.endsWith('.')) return 'El usuario no puede empezar ni terminar en punto';
  if (valor.includes('..')) return 'El usuario no puede llevar dos puntos seguidos';
  if (!/[a-z]/.test(valor)) return 'El usuario debe incluir al menos una letra';
  return null;
}
