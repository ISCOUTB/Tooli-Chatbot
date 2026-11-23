/**
 * Migra los índices de búsqueda por código y cédula (`identity-codigo:*`, `identity-cedula:*`) a la clave propia
 * TOOLI_BUSQUEDA_CLAVE (issue #38). Idempotente: se puede correr las veces que haga falta.
 *
 * Sin --aplicar solo cuenta lo que haría. Nunca imprime teléfonos, correos, códigos ni cédulas.
 *
 * Local o en el servidor con Node:
 *   node --env-file=.env --import tsx tools/migrar-indices-busqueda.ts            # simulacro
 *   node --env-file=.env --import tsx tools/migrar-indices-busqueda.ts --aplicar
 * Dentro del contenedor (la imagen solo trae dist/):
 *   docker compose exec backend node -e "require('./dist/services/identityService').migrarIndicesDeBusqueda({ aplicar: true }).then((r) => { console.log(r); process.exit(0); })"
 *
 * Ver docs/datos-academicos.md («Índices de búsqueda»).
 */
import { claveBusquedaValida } from '../src/services/academico/indicesBusqueda';

async function main(): Promise<number> {
  const aplicar = process.argv.includes('--aplicar');
  if (!claveBusquedaValida(process.env.TOOLI_BUSQUEDA_CLAVE)) {
    console.error('Falta TOOLI_BUSQUEDA_CLAVE (32 caracteres o más, p. ej. `openssl rand -hex 32`): no hay a qué migrar.');
    return 1;
  }
  const { migrarIndicesDeBusqueda, closeIdentityService } = await import('../src/services/identityService');
  try {
    const r = await migrarIndicesDeBusqueda({ aplicar });
    console.log(aplicar ? 'Migración aplicada:' : 'Simulacro (sin --aplicar no se escribe nada):');
    console.log(`  vínculos con código revisados: ${r.revisados}`);
    console.log(`  índices de código pasados a la clave nueva: ${r.codigos}`);
    console.log(`  índices de cédula pasados a la clave nueva: ${r.cedulas}`);
    console.log(`  cédulas que siguen con la clave vieja (sin cédula cifrada que abrir; se leen con el respaldo): ${r.cedulasPendientes}`);
    console.log(`  conflictos (el índice nuevo ya es de otro vínculo; revisar a mano): ${r.conflictos}`);
    return 0;
  } finally {
    closeIdentityService();
  }
}

main().then((codigo) => process.exit(codigo), (err) => {
  console.error('La migración falló:', err instanceof Error ? err.name : 'error');
  process.exit(1);
});
