# Pendientes de flujo/conversacion (cierre por batería, 23-nov-2026)

## Hecho (sin commit)
- `src/flows/conversacionView.ts`: `datosDeLaFrase`, `carreraEnLaFrase`, `buscaNivel`, `esCorreccion`, `soloCuentaDatos`, `cambioDeNombre`, `nombreCambiado`, `carreraAnotada`; pendiente nuevo `nombre_nuevo`; `detectarPerfil` reconoce más formas de la relación; «no» seguido de datos sigue siendo «no».
- `src/flows/conversacion.ts`: `conLoQueDijo` (fusiona relación, carrera, nivel y modo en toda respuesta y en la IA), `cambiarNombre` (sesión, perfil, nota en el CRM y `actualizarRegistroProspecto`), el nombre del primer mensaje se toma al autorizar.
- Pruebas: `src/flows/conversacionFlujo.test.ts` (nueva, punta a punta) y casos nuevos en `conversacionView.test.ts`.

## Medido
- Suite: 1223 pruebas, 1218 pasan, 0 fallan, 5 saltadas. `npx tsc --noEmit` limpio. `npm run lint` limpio.

## Falta
- Revisar el diff antes del commit (no hice commit ni push).
- La métrica `conv_cambio_nombre` no existe en `MetricEvent` (`src/services/metrics.ts`, no es mío): no se mide el cambio de nombre.
- `actualizarRegistroProspecto` reescribe toda la fila B:F: si la hoja tenía un correo que la sesión no tiene, lo borra.
