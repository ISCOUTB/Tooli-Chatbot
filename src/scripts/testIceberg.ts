/**
 * Script standalone para probar el login al portal Iceberg.
 *
 * Uso (dentro del contenedor backend):
 *   docker compose exec backend node dist/scripts/testIceberg.js T00070682 1234567890
 *
 * Modo dev (fuera de docker, sin compilar):
 *   npx tsx src/scripts/testIceberg.ts T00070682 1234567890
 *
 * Solo si TOOLI_ICEBERG_DEBUG=1 guarda capturas, HTML y PDF de la consulta en
 * /tmp/iceberg/ dentro del contenedor. Tratar esos archivos como datos sensibles.
 */
import { loginAndDownloadReceipt } from '../services/icebergService';
import { maskCode } from '../services/logSafe';

async function main() {
  const [, , codigo, cedula] = process.argv;

  if (!codigo || !cedula) {
    console.error('Uso: node testIceberg.js <codigo> <cedula>');
    process.exit(1);
  }

  console.log(`[testIceberg] iniciando con codigo=${maskCode(codigo)}, cedula=***`);

  const result = await loginAndDownloadReceipt(codigo, cedula, {
    debug: process.env.TOOLI_ICEBERG_DEBUG === '1',
    headless: true,
  });

  console.log('[testIceberg] resultado:');
  console.log('  ok:', result.ok);
  if (result.nombre) console.log('  nombre: disponible');
  if (result.cedula) console.log('  cedula: disponible');
  if (result.noRecibos) console.log('  noRecibos: true (sin recibos pendientes)');
  if (result.menuUsado) console.log('  menuUsado:', result.menuUsado);
  if (result.error) console.log('  error: consulta fallida');
  if (result.captchaAttempts?.length) {
    console.log('  captcha intentos:', result.captchaAttempts.length);
  }
  if (result.debugFiles?.length) {
    console.log('  archivos debug:', result.debugFiles.length);
  }
  if (result.pdf) {
    console.log('  pdf size:', result.pdf.length, 'bytes');
  }
}

main().catch(() => {
  console.error('[testIceberg] FATAL: consulta fallida');
  process.exit(1);
});
