# Pendientes del flujo de contacto (rama flujo/contacto)

## Hecho (medido el 23-nov, tras el último cambio)
- `npx tsc --noEmit`: 0 errores. `npm run lint`: 0 errores.
- `node tools/run-tests.cjs`: 1284 pruebas, 1279 pasan, 0 fallan, 5 saltadas (antes: 1187).
- Canal de contacto con 3 botones (💬 chat / 📞 llamada / 📧 correo) y respuestas escritas:
  - `src/flows/contactoView.ts` (nuevo): textos, botones y parsers puros.
  - `src/flows/recomendacion.ts` sección 7: `pedirDatosDeContacto`, `handleRecoContacto`, `handleRecoContactoRepetir`,
    `handleRecoLlamadaNumero`, `handleRecoLlamadaFranja`; `handleRecoNombre` y `handleRecoCorreo` adaptados;
    la línea del canal va a Chatwoot, a la nota del CRM y a las etiquetas (`contacto-<canal>`).
  - `src/flows/index.ts`: pasos nuevos en HANDLERS, PASOS_DE_OPCION/PASOS_DE_TEXTO/DATO_QUE_FALTA; la agenda no se
    come «agendar» en el paso de la franja; las preguntas sueltas recuerdan el paso.
  - Fuera de mis archivos (cambios mínimos): `src/flows/prospecto.ts` (`aviso` opcional en `conectarConAsesorPosgrado`,
    para no decir «en breve» a quien pidió llamada o correo) y `src/services/perfilService.ts` (campos
    `contactoCanal`, `contactoTel`, `contactoFranja` en el perfil, para «igual que la vez pasada»).
- Pruebas nuevas: `src/flows/contactoView.test.ts` (unidad, ~70 respuestas raras) y
  `src/flows/contactoAsesor.test.ts` (punta a punta, 26 casos). Comprobé con mutaciones que fallan al quitar las guardas de `index.ts`.

## Falta
- Revisión humana de los textos y de los dos cambios fuera de mis archivos (prospecto.ts, perfilService.ts).
- `conversacion.ts` (`recordarPerfil`) reescribe el perfil entero con la sesión: si una sesión llega sin los campos
  `contacto*`, se pierden. Para el dueño de ese archivo.
- Probarlo en WhatsApp real (lista de franjas y la cita con la agenda encendida).
- Nada de esto tiene commit propio: el último commit de la rama es el WIP que hizo Ángel.
