/* Reglas de los nombres de usuario, como en las redes sociales: 3 a 30
   caracteres, solo a-z, números, punto y guion bajo, sin tildes, ñ ni espacios.
   Es la copia del panel de src/services/usernamePolicy.ts, para avisar mientras
   se escribe; el servidor vuelve a validar. */

const MAX_USERNAME_LENGTH = 30;

function normalizarUsuario(texto) {
  return String(texto ?? '').trim().toLowerCase();
}

function sugerirUsuario(nombreCompleto) {
  return normalizarUsuario(nombreCompleto)
    .replace(/ñ/g, 'n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, MAX_USERNAME_LENGTH);
}

function validarUsuario(username) {
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

export { normalizarUsuario, sugerirUsuario, validarUsuario };
