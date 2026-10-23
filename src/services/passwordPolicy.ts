export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72; // bcrypt truncates input after this boundary.

export function isAcceptableNewPassword(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= MIN_PASSWORD_LENGTH &&
    Buffer.byteLength(value) <= MAX_PASSWORD_BYTES;
}
