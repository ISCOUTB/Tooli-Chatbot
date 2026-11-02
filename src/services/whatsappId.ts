// El BSUID identifica una cuenta de WhatsApp sin teléfono: CC.[ENT.] seguido de hasta 128 caracteres.
const BSUID = /^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]{1,128}$/;

export function isBsuid(id: unknown): boolean {
  return typeof id === 'string' && BSUID.test(id);
}

export function normalizeContactId(input: unknown): string {
  const value = String(input ?? '').trim();
  // Un BSUID ya es un identificador canónico; quitarle signos destruiría su formato.
  return isBsuid(value) ? value : value.replace(/\D/g, '');
}

/** Campo de destinatario que espera Meta para teléfonos y BSUID. */
export function metaRecipient(id: string): { to: string } | { recipient: string } {
  return isBsuid(id) ? { recipient: id } : { to: id };
}

export function contactIdLabel(id: string): string {
  return isBsuid(id) ? 'Usuario de WhatsApp' : `+${id}`;
}
