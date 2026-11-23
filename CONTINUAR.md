# Cómo continuar (estado al 23-nov-2026)

Issue guía: [#25](https://github.com/ISCOUTB/Tooli-Chatbot/issues/25). Cada issue tiene la causa con archivo:línea y lo que falta.

## Estado
| Rama | Qué tiene | Estado |
|---|---|---|
| `integracion` | Voz (Telnyx), agenda de asesores, datos académicos, seguridad; arreglos de voz (#26, #27) y de recomendaciones (#28) | **1224 pruebas, 0 fallan; tsc y lint limpios.** PR hacia `main` abierto |
| `flujo/conversacion` | No volver a preguntar lo ya dicho (#29) y cambiar el nombre (#30) | En curso, **WIP sin verificar** |
| `flujo/contacto` | Elegir chat, llamada o correo al pedir asesor (#31) | En curso, **WIP sin verificar** |
| `flujo/panel` | Detalles de Llamadas y Agenda (#32) | En curso, **WIP sin verificar** |

Las ramas WIP se guardaron a mitad del trabajo: pueden no compilar o tener pruebas rojas.

## Pasos para seguir una rama en curso
```bash
git fetch origin
git checkout flujo/conversacion        # o flujo/contacto, flujo/panel
npm ci
node tools/run-tests.cjs               # ~35 s; meta: 0 fallos
npx tsc --noEmit
npm run lint
```
1. Lee la issue de la rama y termina lo que falta. En `flujo/conversacion` aplica además el parche de `flyerEncajaConLaPersona` que está en #29.
2. Escribe primero la prueba que reproduce el fallo (debe fallar), luego arregla. Patrón de prueba de punta a punta con `mock.module`: `src/flows/integracion.test.ts`.
3. Deja todo en verde y abre el PR **hacia `integracion`**, no hacia `main`.
4. Cuando las tres estén unidas, corre la suite completa en `integracion` y prueba el bot en un número de prueba con las conversaciones de las issues.

`flujo/conversacion` y `flujo/contacto` tocan archivos distintos, pero las dos llegan a `pedirConsentimiento`: unir primero `conversacion` y luego `contacto`, y revisar ese punto.

## Antes de unir `integracion` a `main` (despliega al VPS)
Ver #37: `META_APP_SECRET` en el VPS si se usa Meta, filtros de Chatwoot, purga de `activity:*`. La agenda y los datos académicos vienen **apagados** por defecto.

## Seguridad pendiente (de la revisión del 23-nov)
- #33 (alta): «repítemelo» guarda las notas en claro en la transcripción.
- #34 (media): código por WhatsApp desde la voz sin tope diario ni bloqueo.
- #35: hallazgos menores.

## Lo que depende de personas
- #36 Telnyx (cuenta y número): sin eso la voz solo funciona en el simulador del panel.
- #37 plantillas de Meta, token de Savio, cuentas de prueba, Registro Académico.

## Registros detallados
`VOZ_PROGRESO.md`, `AGENDA_PROGRESO.md`, `ACADEMICO_PROGRESO.md`, `INTEGRACION_PROGRESO.md`, `docs/datos-academicos.md`, `docs/agenda-asesores.md`.
