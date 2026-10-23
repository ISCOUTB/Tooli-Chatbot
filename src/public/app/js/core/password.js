const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;

function newPasswordError(value) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    return 'La contraseña debe tener al menos 12 caracteres.';
  }
  if (new TextEncoder().encode(value).length > MAX_PASSWORD_BYTES) {
    return 'La contraseña no puede superar 72 bytes. Los acentos y emojis ocupan más de un byte.';
  }
  return null;
}

export { newPasswordError };
