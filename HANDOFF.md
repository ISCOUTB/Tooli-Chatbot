# Handoff del 23-nov-2026: lo que se hizo sobre `integracion` y cómo seguir

De: Manuel. Para: Ángel y el equipo que siga con Tooli.

Este documento cuenta **todo lo que se hizo el 23 de noviembre** sobre la rama `integracion` (PR #40), por qué, cómo se verificó y qué queda. El plan general sigue en [`CONTINUAR.md`](CONTINUAR.md); la puesta en marcha de la voz, en [`docs/voz-telnyx-puesta-en-marcha.md`](docs/voz-telnyx-puesta-en-marcha.md).

## En una mirada

- Se revisó todo lo que Ángel subió (`integracion` y las ramas `flujo/*`), se terminaron las ramas a medias y se corrigió lo que encontró la revisión.
- Quedaron resueltas **#29, #30, #31, #32, #33, #34 y #35**, y **#38 salvo la medición del corpus** con la IA real.
- **Verificación:** 1.547 pruebas, 1.540 pasan, **0 fallan**, 7 saltadas (las de Redis real, que se corren aparte). `tsc` y lint limpios. Contra Redis real: 12 de 12 (identidad y voz) y 8 de 8 (agenda). QA del panel: las 17 pantallas en 320, 375, 800 y 1280 px, más el recorrido de Llamadas y Agenda.
- **Nada de esto está en `main`.** Unir `integracion` a `main` despliega al VPS, y **antes hay que poner `META_APP_SECRET`** en el `.env` del servidor (ver «Antes de unir a `main`»).
- **Nunca hubo una llamada real.** La voz se probó con el simulador y con pruebas; falta la cuenta de Telnyx (#36).

## Cómo se organizó

Las ramas de Ángel (`flujo/conversacion`, `flujo/contacto`, `flujo/panel` y `flujo/recomendacion`) ya están **completas dentro de `integracion`**, con sus commits originales. El trabajo nuevo se hizo en cuatro frentes, cada uno en su rama y unido con un merge propio:

| Frente | Merge en `integracion` | Issues |
|---|---|---|
| `flujo/panel` + arreglos | `5610b1c`, `dd01ae2`, `b70919f` | #32 |
| `flujo/whatsapp` (une `flujo/conversacion` y `flujo/contacto`) | `20b9426` | #29, #30, #31, parte de #38 |
| `flujo/agenda-academico` | `459fbd4` | Revisión de agenda y datos académicos, #38 |
| `flujo/voz-seguridad` | `c7832ed` | #33, #34, #35 y la revisión de la voz |
| Arnés de pruebas y documentos | `547e05a`, `d7887fc`, `619014a` y este archivo | — |

Las ramas `origin/flujo/*` se pueden borrar cuando quieran: todo lo suyo ya está en `integracion`. Las ramas locales `flujo/whatsapp`, `flujo/agenda-academico` y `flujo/voz-seguridad` no se subieron, porque sus commits ya están en `integracion`.

## WhatsApp (#29, #30, #31)

Se partió de lo que Ángel dejó en `c70eaf6` (recordar carrera, relación y nivel; cambiar el nombre) y `7a2d848` (elegir el canal del asesor).

**#29. No volver a preguntar lo ya dicho**
- `d9ca1b2`: «Busco la maestría en finanzas», sin signo de pregunta, se tomaba como dato del perfil y el programa se perdía. Ahora `nombraUnPosgrado` lo manda a la IA y no se vuelve a preguntar «¿Ya tienes un posgrado en mente?».
- `cc0e44c`: se aplicó el parche de la issue. `flyerEncajaConLaPersona` existía, pero nadie la llamaba. El flyer de un programa de otra área solo va si la persona lo nombró.
- `be08b17`: los afines traen su gemela virtual (por ejemplo, la SST presencial y la virtual). Si la persona pide un nivel o una modalidad que no está entre los afines, la IA dice cuáles tiene la UTB, aclarando que son de otra área, en vez de decir que no hay (`REGLA_AFINES`).

**#30. Cambiar el nombre**
- `d47d524`: «olvídalo», «mejor no», «no» o «cancelar» salen del paso y nunca se guardan como nombre.
- `7f98073`: «me llamo Laura» o «quiero cambiar mi nombre» funcionan en cualquier paso de recomendaciones y del canal del asesor (`atenderNombreEnPaso`), sin falsos positivos como «me llamó la atención».
- `e4c0178`: cambiar el nombre escribe **solo la columna B** de la hoja (`actualizarNombreProspecto`). Antes se reescribían las columnas B a F y se podía borrar el correo. Hay una métrica nueva, `conv_cambio_nombre`, que el panel muestra en Métricas («Cambió su nombre», `b70919f`).

**#31. Elegir chat, llamada o correo**

Se decidió hacerlo como pide la issue, **conservando lo bueno de `92a0f9a`**: el correo nunca es obligatorio, «💬 Por este chat» va primero, HubSpot solo recibe contactos con correo y, si la persona ya dijo el canal, no se le pregunta. Los arreglos de la revisión (`025cc11`):
- La llamada solo se ofrece si la piden de verdad. «No puedo contestar llamadas» ya no la pide.
- «Llámenme mañana» es el día, no la franja: se pregunta la franja.
- Solo se ofrecen las franjas del horario del equipo (lunes a viernes de 8 a 18, sin noche).
- «Quiero hablar con un asesor» dentro de un paso del asesor sigue por el chat, sin volver a la IA.
- Cambiar de la llamada a otro canal limpia el número y la franja. `recordarPerfil` ya no borra el canal, el correo ni el nombre.

Se borraron los `PENDIENTES_flujo-*.md`: lo que listaban está hecho.

## Panel (#32)

- `dd01ae2`: `qa-panel-all.cjs` recorre también Llamadas y Agenda, y `tools/QA_PANEL.md` explica `qa-panel-voz-agenda.cjs`. El simulador de Llamadas ya no baja la vista si el asesor subió a leer.
- Métricas se desbordaba a 320 y 375 px; eso ya pasaba en `main`. Ahora las filas se acomodan en dos líneas.

## Agenda y datos académicos

**Agenda**
- `c532d7a`: con `AGENDA_ACTIVA=false`, la API responde 404 `agenda_apagada`, salvo `GET /agenda/estado`, y el panel esconde la pestaña. Antes un asesor podía crear citas de un flujo apagado.
- `a8692b8`: los recordatorios cuentan la ventana de 24 h de Meta desde el último mensaje entrante (`activity:<tel>`). Lo que no cabe queda «sin recordatorio» con su motivo, visible en el panel.
- `537e7eb`: renombrar a un asesor migra su agenda (`LUA_RENOMBRAR_ASESOR`). Al borrarlo, sus citas quedan «sin asesor» a la vista del administrador (`LUA_ASESOR_BORRADO`).
- `bf63422`: «ver más horarios» recorre toda la ventana sin saltarse días.
- `16711cd`: tocar «Libre» en el panel ya no agenda otra hora en silencio; ofrecer y reservar usan el mismo límite.
- `f936675`: los festivos de Colombia se calculan solos (Ley Emiliani y Pascua), probados contra 2026 y 2027.
- `34b5c70`: lo que no es de la agenda sale del flujo y lo atiende el bot. Antes la persona quedaba atrapada 20 minutos.

**Datos académicos e identidad**
- `16c4afb`: con todo apagado (lo de fábrica), «Mi semestre» no existe y el bot es el de `main`.
- `793ad68`: el código solo se ata si el portal mostró la cédula y coincide.
- `de32b82`: el dueño real puede recuperar su código. TI lo suelta con `tools/soltar-codigo.ts` (ver `docs/datos-academicos.md`).
- `5d95203`: `TOOLI_ACADEMICO_CLAVE` es obligatoria con `TOOLI_ACADEMIC_LOOKUP_ENABLED=1`. Lo exigen el preflight y el arranque.
- `e41f34f` (#38): los índices por código y cédula tienen clave propia, `TOOLI_BUSQUEDA_CLAVE`, derivada con HKDF. Se migran con `tools/migrar-indices-busqueda.ts`, que es idempotente. El índice de cédula solo se crea con la cédula confirmada.
- `1d119f1`: AES-GCM exige la etiqueta completa de 16 bytes (`authTagLength: 16`).

## Voz y seguridad (#33, #34, #35 y la revisión de la voz)

| Commit | Qué arregla |
|---|---|
| `e067460` | #33: «repítemelo» ya no deja las notas en claro en la transcripción |
| `3b14134` | #34 y R6: el código por WhatsApp usa el almacén atómico del correo (`crearSiCabe`/`intentar`), con espera, topes por hora y día y bloqueo |
| `8d96b41` | #35 R3: un solo lector (`numeroDictado`) entiende y tapa los números dictados, incluso «T 000 y 123 y 45» |
| `288cd5b` | #35 R4: sin número que llama (anónimo o SIP), no se ofrece verificación ni se gasta el cupo global |
| `9ed99ca` | #35 R5: tope duro de la llamada (índice `voz:plazos` y barrido), `speak` fallido y avisos con solo parciales |
| `00616df` | #35: el panel dice cuándo la verificación por voz quedó en pausa |
| `b42b10b` | El webhook procesa antes de responder: 200, 500 para que Telnyx reintente, o 202 a los 5 s. Un reconciliador cierra las llamadas cuyo `call.hangup` se perdió (`GET /v2/calls/{id}`) |
| `0a598ef` | Al transferir: `transcription_stop`, la pata del asesor atada con `target_leg_client_state` y, si el asesor no contesta, el bot retoma y deja la devolución |
| `288b808` | Los turnos con efectos (verificar, gastar un intento, mandar un código, reservar) se aplican aunque llegue otra frase en medio |
| `1c061ee` | Al colgar se borran el código dictado, el teléfono verificado y la última respuesta |
| `7aa84e7` | Los minutos con el asesor cuentan en el cupo, con un tope de llamadas por número al día (`maxLlamadasNumeroDia`, 3) |
| `b97d451` | Las llaves de Redis de la voz tienen vencimiento |
| `1794523` | Con la línea apagada y sin desvío: contesta, avisa y cuelga (antes solo timbraba) |
| `bb75e9c` | Voz de hombre por defecto (Gonzalo, con Jorge en la lista), y los textos cuadran con el género de la voz |
| `c65958f` | La duración sale de `occurred_at − start_time`, porque `call.hangup` no trae `end_time` |
| `dfdc2aa` | El `language` del `speak` se limita a es-ES, es-MX y es-US |

Cambió el Lua de la voz: `RESERVAR_SCRIPT` ahora tiene 7 llaves, `AJUSTAR_SCRIPT` cambió y se quitó `CUPO_CODIGO_SCRIPT`. Todo se probó contra Redis real (`src/voice/almacenRedis.redis.test.ts`). Hay dos ajustes nuevos en el panel: `maxMinutosTransferencia` (30) y `maxLlamadasNumeroDia` (3).

## Arnés de pruebas (importante para lo que escriban)

- **`547e05a`:** la tanda perdía suites en silencio. Daba entre 1.360 y 1.439 pruebas según la corrida, y siempre «0 fallan». La causa era `--test-force-exit`, que corta la salida de cada proceso hijo. Se quitó, y los 11 clientes de Redis a nivel de módulo usan `{ lazyConnect: true }` para que el proceso termine solo. Ahora da 1.547, estable.
  - **No vuelvan a poner `--test-force-exit`.**
  - **Un cliente de Redis nuevo a nivel de módulo va con `lazyConnect: true`.**
- **`d7887fc`:** en un archivo de prueba, no cierren la conexión compartida de un servicio dentro de una prueba: la siguiente falla con «Connection is closed». Ciérrenla en un `after()`.
- Las pruebas **nunca llaman servicios reales** (OpenAI, Meta, Telnyx, Google). Una versión intermedia de las pruebas de voz llegó a llamar a `GET /v2/calls/…` de Telnyx con una clave falsa; ya está corregido con espías.

## Cómo verificar

```bash
git checkout integracion && npm ci
node tools/run-tests.cjs        # 1.547 pruebas, 0 fallan
npx tsc --noEmit
npm run lint
```

Contra Redis real:

```bash
docker run -d --rm --name tooli-redis-prueba -p 6392:6379 redis:7-alpine
TOOLI_TEST_REDIS=1 REDIS_URL=redis://localhost:6392 node --env-file=.env.test --import tsx --test --experimental-test-module-mocks $(git ls-files '*.redis.test.ts')
```

La agenda contra Redis real se corre con `tools/test-agenda-redis.mjs`. Exige exactamente `redis://127.0.0.1:6391/15` y `--import tsx`:

```bash
docker run -d --rm --name tooli-redis-agenda -p 6391:6379 redis:7-alpine
REDIS_URL=redis://127.0.0.1:6391/15 node --env-file=.env.test --import tsx tools/test-agenda-redis.mjs
```

QA del panel (ver `tools/QA_PANEL.md`):

```bash
PORT=4610 node tools/mock-panel-server.cjs &
QA_BASE_URL=http://localhost:4610 node tools/qa-panel-all.cjs
QA_BASE_URL=http://localhost:4610 node tools/qa-panel-voz-agenda.cjs
```

Si Playwright no encuentra el navegador después de un `npm ci`, apunten `QA_BROWSER_EXECUTABLE` al `chrome-headless-shell` que tengan en `~/Library/Caches/ms-playwright/`.

## Antes de unir a `main`

1. **`META_APP_SECRET` en el `.env` del VPS.** El preflight la exige con `MESSAGING_ADAPTER=meta` y hoy está vacía. El CI hace `git merge --ff-only` en el VPS y luego corre el preflight: sin la variable, **se congelan todos los despliegues**.
2. El resto de #37: filtros de Chatwoot y purga de `activity:*`.
3. Decidir si se activa `TOOLI_BUSQUEDA_CLAVE`. Si se pone, hay que correr la migración. Los pasos están en `CONTINUAR.md`.
4. Todo lo nuevo viene apagado: la agenda, los datos académicos y la línea de voz, que se enciende desde el panel.

## Lo que queda abierto

| Qué | Dónde | Quién |
|---|---|---|
| Cuenta y número de Telnyx | #36 y `docs/voz-telnyx-puesta-en-marcha.md` | Ángel |
| Primera llamada real: confirmar que la pata del asesor trae el `client_state`, el plazo del webhook y qué pasa si el asesor cuelga primero | Guía de Telnyx, secciones C2 y E | Quien tenga el número |
| Precio real de la voz Azure (Gonzalo o Jorge) y ajustar «Costo por minuto» | Guía, E5 | Con la primera factura |
| Medir el corpus de 347 llamadas con la IA real | #38, `tools/corpus-voz.ts` | Ángel (el corpus está en su equipo) |
| El tope diario de la voz y la espera de 60 s responden igual (`espera`), así que el registro no los distingue | `src/voice/` | Código |
| Los recordatorios que no se pudieron programar no se reprograman cuando la persona vuelve a escribir | `agendaService`, `reminderService` | Código |
| Plantilla de Meta para recordatorios fuera de las 24 h | #37 | Equipo |
| Pronunciación de «Tooli» («Túli») en el léxico de la voz | `src/voice/texto.ts` | Código |
| Mejoras de transcripción (`hints`, `model`, Deepgram) | Guía, E11 y E12 | Opcional |
| Corregir #36: un número **local** pide solo nombre y dirección, sin documentos, y conviene una primera recarga de US$30 en vez de US$20 | #36 | Quien la edite |
| Poner al día la issue #25 con este estado | #25 | Quien la edite |

## Issues

- **Se cierran al unir el PR #40:** #26, #27, #28, #29, #30, #31, #32, #33, #34 y #35.
- **#38:** está hecho todo menos medir el corpus con la IA real. Ya están la clave de búsqueda, la imagen Docker con Node 22 (el CI la construye y pasa), los Lua contra Redis real y la tabla de recomendaciones.
- **Dependen de personas:** #36 y #37. **Ideas:** #39.
