# Cómo continuar (estado al 23-nov-2026)

Issue guía: [#25](https://github.com/ISCOUTB/Tooli-Chatbot/issues/25). Cada issue tiene la causa con archivo:línea y lo que se hizo.

Lo que se hizo el 23-nov, commit por commit, y lo que queda: [`HANDOFF.md`](HANDOFF.md).

## 23-nov en la tarde (Ángel): rama `flujo/listo-para-probar`, encima de `integracion`

Sale de `e92abc8` (lo de Manuel). **1.595 pruebas, 0 fallan, 7 saltadas; tsc y lint limpios; Redis real: 13 de voz e identidad y 9 de agenda.** Objetivo: dejar listo probar las llamadas y todo el flujo de WhatsApp.

- **«Probar el bot» (panel, solo administradores):** simulador de WhatsApp con el flujo REAL. Números `570000xxxxxx` que nunca salen a Meta; Sheets, HubSpot, Chatwoot, CRM, métricas y correos se saltan y se muestran como notas 🧪. Guía y 12 conversaciones de prueba: [`docs/simulador-whatsapp.md`](docs/simulador-whatsapp.md). Se recorrió contra el backend real con Redis.
- **Voz, antes de la primera llamada real** (revisión independiente con pruebas de concepto, `src/voice/revision23nov*.test.ts`):
  - sin bucle de transferencias si el asesor no contesta al cierre de la llamada;
  - un 500 de Telnyx después de reservar ya no deja la llamada sin contestar; el reintento de una frase no corre el turno dos veces;
  - colgar mientras se reserva una cita ya no pierde el aviso;
  - el asesor timbra 20 s (`timeout_secs`), antes de que conteste su buzón;
  - la pata del asesor que solo timbró no se cobra;
  - el tope diario de códigos se distingue de la espera corta (`tope_dia`: «podrás intentarlo mañana»);
  - «Tooli» se pronuncia «Túli».
- **Agenda:** los recordatorios que no cabían en la ventana de 24 h se reintentan cuando la persona vuelve a escribir (`agenda:rec-pend:<tel>`, Lua `LUA_ANOTAR_RECORDATORIOS`).
- **WhatsApp:** pedir un asesor con palabras funciona también con el flujo clásico y en el chat con la IA; decir el canal durante el consentimiento ya no repite el mensaje largo; el consentimiento ya no dice que el correo es obligatorio.
- **Diseño:** Llamadas, Agenda y Métricas con contraste AA, objetivos de 44 px, foco atrapado en los diálogos y 320 px sin cortes (68/68 en el QA). Capturas antes y después, fuera del repo.

**Ojo antes de probar en el VPS:** los atajos de la conversación (no repetir lo dicho, cambiar el nombre, #29-#31) solo corren con `FLUJO_CONVERSACIONAL=true`, y por defecto viene en `false`. Revisar qué tiene el `.env` del VPS. El recuadro «Cómo está el bot» de *Probar el bot* lo muestra.

## Estado
Todo está unido en `integracion` (PR #40 hacia `main`): **1.547 pruebas, 0 fallan, 7 saltadas; tsc y lint limpios.** Las pruebas contra Redis real también pasan (12 de identidad y voz, 8 de agenda).

| Rama (ya unida a `integracion`) | Qué cerró |
|---|---|
| `flujo/whatsapp` | No volver a preguntar lo ya dicho (#29), cambiar el nombre (#30) y elegir chat, llamada o correo al pedir asesor (#31) |
| `flujo/panel` | Llamadas y Agenda en el QA del panel, Métricas sin desborde en el celular (#32) |
| `flujo/voz-seguridad` | Notas tapadas en la transcripción (#33), código por WhatsApp con tope y bloqueo (#34), hallazgos menores (#35) y la revisión de la voz del 23-nov |
| `flujo/agenda-academico` | Agenda apagada de verdad, recordatorios en la ventana de 24 h, festivos, identidad académica y clave propia de los índices (#38) |

La tanda de pruebas ya no pierde suites en silencio: `tools/run-tests.cjs` corre sin `--test-force-exit` y los clientes de Redis usan `lazyConnect`.

## Comprobar la rama
```bash
git fetch origin
git checkout integracion
npm ci
node tools/run-tests.cjs               # meta: 0 fallos
npx tsc --noEmit
npm run lint
# Contra Redis real (docker run -d -p 6392:6379 redis:7-alpine):
TOOLI_TEST_REDIS=1 REDIS_URL=redis://localhost:6392 node --env-file=.env.test --import tsx --test --experimental-test-module-mocks $(git ls-files '*.redis.test.ts')
```
Panel: `tools/QA_PANEL.md` (`qa-panel-all.cjs` y `qa-panel-voz-agenda.cjs` contra `tools/mock-panel-server.cjs`).

## Antes de unir `integracion` a `main` (despliega al VPS)
1. **`META_APP_SECRET` en el `.env` del VPS.** El preflight lo exige con `MESSAGING_ADAPTER=meta`: sin él, el CI bloquea todos los despliegues.
2. Lo demás de #37: filtros de Chatwoot y purga de `activity:*`.
3. La agenda (`AGENDA_ACTIVA=false`) y los datos académicos (`TOOLI_ACADEMIC_LOOKUP_ENABLED=0`) vienen **apagados**. La línea de voz viene apagada desde el panel.

## Variables nuevas del `.env`
| Variable | Cuándo | Cómo |
|---|---|---|
| `TOOLI_ACADEMICO_CLAVE` | **Obligatoria** si `TOOLI_ACADEMIC_LOOKUP_ENABLED=1`: sin ella el preflight detiene el despliegue y el arranque lo avisa. También la piden `TOOLI_NOTAS_CAMINO=A` y `TOOLI_HORARIO_ENABLED=1` | `openssl rand -hex 32` |
| `TOOLI_BUSQUEDA_CLAVE` | Recomendada (#38): clave propia de los índices por código y cédula. Sin ella se sigue usando `TOOLI_ACADEMICO_CLAVE` o `JWT_SECRET` | `openssl rand -hex 32`, y después migrar (abajo). **No cambiarla después** |
| `TELNYX_*`, `VOICE_WEBHOOK_KEY`, `VOICE_AI_MODEL` | Solo para la línea de voz | `docs/voz-telnyx-puesta-en-marcha.md`, sección B |

Al poner `TOOLI_BUSQUEDA_CLAVE` en el VPS:
```bash
docker compose up -d --no-deps --no-build backend      # restart no relee el .env
docker compose exec backend node -e "require('./dist/services/identityService').migrarIndicesDeBusqueda({ aplicar: false }).then((r) => { console.log(r); process.exit(0); })"   # simulacro
docker compose exec backend node -e "require('./dist/services/identityService').migrarIndicesDeBusqueda({ aplicar: true }).then((r) => { console.log(r); process.exit(0); })"
```
Es idempotente: una segunda corrida debe dar 0 y 0. Para soltar un código que ató quien no era el dueño: `tools/soltar-codigo.ts` (ver `docs/datos-academicos.md`).

## Ajustes nuevos de la voz en el panel (Llamadas → Ajustes)
- **Voz:** Gonzalo (hombre, Colombia) por defecto; Jorge (México) y Salomé en la lista. Los textos dicen «el asistente» o «la asistente» según la voz.
- **Máximo de minutos con el asesor:** 30 por defecto. Telnyx deja hasta 4 h si no se le pone tope.
- **Llamadas por día desde un mismo número:** 3 por defecto.
- **Costo por minuto:** poner 0,046 (el 0,07 por defecto sobreestima; ver la sección D de la guía de Telnyx).

## Lo que queda abierto
- **Voz, por confirmar en la primera llamada real** (guía de Telnyx, sección E): que la pata del asesor traiga el `client_state`, el plazo del webhook y qué pasa si el asesor cuelga primero.
- El tope diario de la voz y la espera de 60 s responden igual (`espera`): el registro no los distingue.
- Los recordatorios que no se pudieron programar no se reprograman cuando la persona vuelve a escribir.
- Falta la plantilla de Meta para recordatorios fuera de la ventana de 24 h (#37).
- La medición de #38 con la IA real necesita el corpus de Ángel.

## Lo que depende de personas
- #36 Telnyx (cuenta y número): sin eso la voz solo funciona en el simulador del panel. Pasos en `docs/voz-telnyx-puesta-en-marcha.md`. El número **local** de Colombia pide nombre y dirección, sin documentos; la primera recarga sugerida es de US$30.
- #37 plantillas de Meta, token de Savio, cuentas de prueba, Registro Académico.

## Registros detallados
`VOZ_PROGRESO.md`, `AGENDA_PROGRESO.md`, `ACADEMICO_PROGRESO.md`, `INTEGRACION_PROGRESO.md`, `docs/datos-academicos.md`, `docs/agenda-asesores.md`, `docs/voz-telnyx-puesta-en-marcha.md`.
