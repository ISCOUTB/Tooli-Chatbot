export function maskInstitutionalEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[correo institucional]';
  return `${local[0]}***@${domain}`;
}
