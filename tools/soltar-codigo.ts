/**
 * Suelta un código estudiantil atado a un vínculo de WhatsApp (docs/datos-academicos.md, «Soltar un código»).
 *
 * Atar un código prueba que alguien conocía el par código+cédula, no que sea el dueño: si otra persona lo ató
 * primero, el dueño real recibe «Ese código ya está vinculado a otra cuenta». TI confirma por otro medio quién es el
 * titular y lo suelta con esto; después el dueño lo vincula desde *Mi semestre*. El vínculo de correo de quien lo
 * tenía sigue (sin código, nombre, programa ni cédula). Solo muestra teléfono y correo enmascarados.
 *
 *   node --env-file=.env --import tsx tools/soltar-codigo.ts T00012345              # a quién se lo quitaría
 *   node --env-file=.env --import tsx tools/soltar-codigo.ts T00012345 --aplicar
 * Dentro del contenedor (solo trae dist/):
 *   docker compose exec backend node -e "require('./dist/services/identityService').soltarCodigoEstudiantil('T00012345', { aplicar: true }).then((r) => { console.log(r.estado); process.exit(0); })"
 */
import { enmascararCorreo, enmascararTelefono } from '../src/services/academico/identidadAcademica';

async function main(): Promise<number> {
  const codigo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const aplicar = process.argv.includes('--aplicar');
  if (!codigo) {
    console.error('Uso: tools/soltar-codigo.ts <código estudiantil> [--aplicar]');
    return 1;
  }
  const { soltarCodigoEstudiantil, closeIdentityService } = await import('../src/services/identityService');
  try {
    const r = await soltarCodigoEstudiantil(codigo, { aplicar });
    if (r.estado === 'formato') { console.error('El código debe ser T seguido de 8 dígitos.'); return 1; }
    if (r.estado === 'no_encontrado') { console.log('Ningún vínculo vigente tiene ese código.'); return 0; }
    const quien = `${enmascararTelefono(r.telefono)} (${enmascararCorreo(r.email)})`;
    if (r.estado === 'simulado') console.log(`Lo tiene ${quien}. Vuelve a correrlo con --aplicar para soltarlo.`);
    else if (r.estado === 'listo') console.log(`Listo: se soltó de ${quien}. El dueño ya lo puede vincular desde Mi semestre.`);
    else console.log(`El vínculo de ${quien} cambió mientras tanto; no se tocó. Vuelve a intentarlo.`);
    return r.estado === 'cambio' ? 1 : 0;
  } finally {
    closeIdentityService();
  }
}

main().then((codigo) => process.exit(codigo), (err) => {
  console.error('No se pudo soltar el código:', err instanceof Error ? err.name : 'error');
  process.exit(1);
});
