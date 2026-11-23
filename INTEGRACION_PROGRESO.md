# Integración (rama `integracion`, desde main 92a0f9a)

Parches aplicados (sin commit, en el índice): seguridad, datos académicos, agenda de asesores, voz.
Nada de esto está commiteado. Los cambios de la integración también están en el índice (`git add`), sin commit.

## Registro

- [x] Conflictos resueltos (unión de ambos lados, sin elegir uno):
  - `src/flows/agentHandoff.ts`: imports de identidad (seguridad) + `ofrecerAgendaTrasHandoff` (agenda). El cuerpo ya
    traía las dos cosas: bloque de identidad `*_declarado` y, tras crear la conversación, la oferta de cita.
  - `src/index.ts`: imports de avisos académicos + webhook de voz. `/voice` sigue montado antes de `express.json`.
  - `src/routes/toolsRoutes.ts`: `agendaRouter` y `vozRouter`, los dos detrás de `requireAuth`.
  - `src/services/auditService.ts` y `src/public/app/js/core/audit.js`: las 7 acciones de agenda y las 2 de voz;
    en `AUDIT_AREAS` las citas y la devolución de llamada van a «Atención directa», ajustes a «Administración».
- [x] node_modules copiado de voz-llamadas con robocopy (sin junction).
- [x] Contrato académico ampliado (opcional y compatible): `iniciarVerificacionPorDato` y `confirmarVerificacion`.
  La lógica pasó de `servicio.ts` al núcleo (`nucleo.ts`, dep `verificacion`) para poder probarla en memoria; ahora
  pasa por el cupo anti-enumeración `permitirBusqueda`. `servicio.ts` sigue exportando las dos funciones.
- [x] Voz: con esos métodos el código va al correo institucional y lo comprueba el servicio académico; sin ellos
  (fakes/simulador) solo manda al WhatsApp si `telefonoVinculado` es un número completo. Antes mandaba a `****2233`.
- [x] Voz: recibo sin cédula → lo dice y ofrece escribir por WhatsApp (fase `ofrece_whatsapp_recibo`). Nunca la pide por voz.
- [x] Voz: el WhatsApp de la voz respeta la ventana de 24 h (`motivoVentanaCerrada`, la misma regla de la agenda).
- [x] Cableado: `src/voice/contratos.ts` (`conectarContratosVoz`) registra `academico` y `agenda` reales; lo llama
  `src/index.ts` al arrancar. Con `AGENDA_ACTIVA=false` la voz tampoco ofrece citas.
- [x] Choques silenciosos arreglados: la agenda no intercepta en pasos de contraseña, código o cédula
  (`PASOS_SIN_AGENDA` en `src/flows/index.ts`); «mi semestre» sale del flujo de agenda como «menu».
- [x] Pruebas cruzadas: `src/voice/integracion.test.ts` (5) y `src/flows/integracion.test.ts` (4). Todas fallan sin el
  cableado (comprobado quitándolo con copias en el scratchpad, sin stash).
- [x] `tools/run-tests.cjs` pasa `--experimental-test-module-mocks` solo si el Node lo admite (Node 20 del CI no:
  ahí las pruebas de `src/flows/integracion.test.ts` se saltan).

## Cifras (22-nov, Node 24, Windows)

- `npx tsc --noEmit` 0 · `npm run lint` 0 · `git -c core.whitespace=cr-at-eol diff --cached --check` limpio.
- `.env.example`: quedó mezclado CRLF/LF tras los parches; se dejó entero en CRLF como en main. Ningún otro archivo
  existente cambia su final de línea. `recibo.ts` y `turno.ts` salen casi enteros: es contenido (académico los
  redujo a «Mi semestre»), no finales de línea.
- Suite: 1114 pruebas, 1109 pasan, 4 saltadas (Redis real / Chromium), 1 fallo: `src/voice/manejador.test.ts`
  aborta al salir (ver abajo). Una corrida anterior, sin el flag de mocks, salió 1105/0 fallos.

## Auditoría de la unión

- ARREGLADO: voz + académico real mandaba el código por WhatsApp a `****2233` (src/voice/dialogo.ts, antes del cambio).
- ARREGLADO: la voz escribía por WhatsApp sin mirar la ventana de 24 h (src/voice/servicio.ts:111).
- ARREGLADO: la agenda leía el texto de los pasos de contraseña/código/cédula (src/flows/index.ts:213).
- ARREGLADO: `iniciarVerificacionPorDato` no tenía cupo anti-enumeración (src/services/academico/nucleo.ts:355).
- ARREGLADO (sesión 2): verificar por voz desde otro número movía el vínculo de WhatsApp (ver «A» abajo).
- ARREGLADO (sesión 2): `AGENDA_ACTIVA` venía encendida por defecto.
- ARREGLADO (sesión 2): el bloque de identidad decía «lo escribió la persona» aunque académico ya lo tuviera comprobado.
- ARREGLADO (sesión 2): la voz agendaba siempre en «posgrados».
- ARREGLADO (sesión 2): agendaFlow.ts logueaba `err.message` en vez de `describeError`.

## Sesión 2 (22-nov, noche): seguridad de la voz, pendientes de la auditoría y corpus

### A. Verificación por voz SOLO PARA LA LLAMADA (seguridad)

- Antes: `iniciarVerificacionPorDato` → `startVerification(telefonoLlamante, email)` y `confirmarVerificacion` →
  `checkCode`, que MOVÍA el vínculo de WhatsApp del estudiante al número que llamaba (y, con `confiarEnNumero`, dejaba
  un fijo compartido leyendo sus datos en llamadas futuras).
- Ahora (`src/services/academico/nucleo.ts`, dep `verificacion` nueva): código de 6 dígitos propio de la voz, guardado
  como HMAC (`huellaCodigoVoz`: número que llama + teléfono del vínculo + código), 10 min, 3 intentos, un solo uso,
  enfriamiento de 60 s por número que llama, y al confirmar se comprueba que el vínculo sigue siendo el mismo (mismo
  correo). Devuelve `{ ok: true, telefonoEstudiante }`; NO toca `identity:*` ni `identity-email:*`.
- Real (`servicio.ts`): correo con `sendOtpEmail` (la misma plantilla del OTP de WhatsApp), pendientes en Redis
  `voz-otp:<llamante>` (`pendientesVoz` en identityService.ts), secreto `JWT_SECRET`. Ya no usa `startVerification`
  ni `checkCode`.
- Contrato (`src/contratos/academico.ts`): `ResultadoConfirmacion` ok lleva `telefonoEstudiante`; la cabecera explica
  por qué. Compatible para quien consume; quien implementa debe devolverlo.
- Voz (`src/voice/dialogo.ts`, `confirmarPorCorreo`): `verificado = telefonoEstudiante` (vive en el estado del
  servidor; al panel solo va un booleano) y `consultar(telefonoEstudiante, tipo)`; nunca el número de quien llama.
  `confiarEnNumero` y el número ya vinculado no llaman a nada que cambie vínculos (prueba nueva).
- Pruebas: `src/services/academico/verificacionVoz.test.ts` (8: vínculo intacto, un solo uso, segundo llamante con
  el mismo código, vencido, 3 intentos, vínculo cambiado, enfriamiento, y el cableado real con Redis en memoria que
  falla si se llama a `startVerification`/`checkCode`) y `src/voice/integracion.test.ts` (+5).
  Sin el arreglo: con todo lo viejo fallan 14 de 16; solo con `dialogo.ts` viejo fallan 3 (vínculo intacto,
  verificado = vínculo real); solo con `servicio.ts` viejo falla la del cableado (usa `startVerification`).
  Comprobado con copias en el scratchpad, sin stash.

### B. Pendientes de la auditoría

1. `AGENDA_ACTIVA` APAGADA por defecto (`src/config/index.ts:27` → `=== 'true'`, `.env.example`,
   `docs/agenda-asesores.md`, `src/voice/contratos.ts`). `src/flows/integracion.test.ts` la enciende a propósito.
   Pruebas: el cableado sin `AGENDA_ACTIVA` no registra agenda y «quiero hablar con un asesor» no ofrece citas (fallan
   las 2 con el config viejo).
2. `src/flows/identidadAsesor.ts`: si el vínculo tiene `codigoVerificado` (y es el mismo correo), el bloque dice
   «código estudiantil comprobado por académico» y muestra el comprobado (avisa si el escrito no coincide);
   `agentHandoff.ts` le pasa el vínculo. Prueba en `identidadAsesor.test.ts` y aserción en
   `src/flows/integracion.test.ts` (las dos fallan sin el arreglo).
3. Voz: área de la cita (`areaParaCita` en dialogo.ts): soporte técnico → «ti» (manda la necesidad), estudiante
   verificado de pregrado → «pregrado», si no «posgrados». Estado nuevo `areaCita` y `soporte` (tipos.ts). 4 pruebas
   con la agenda real y un asesor por área; 2 fallan sin el arreglo (la tercera y cuarta son el caso por defecto).
4. `agendaFlow.ts`: `describeError(err)`. Prueba: el log no lleva el teléfono ni el correo del error (falla sin él).
5. Node 22 LTS en CI (`node-version: '22'`) y Dockerfile (`node:22-bookworm-slim` en las dos etapas: bookworm fijo
   porque los paquetes de Chromium tienen nombres de Debian 12). Dependencias revisadas: ningún `engines` lo impide,
   sin módulos nativos (bcryptjs es JS), Playwright 1.50 admite 22. `@types/node` sigue en ^20 (no cambia el
   lockfile). README a Node 22. No se construyó la imagen (sin Docker en esta máquina por regla).

### Cifras (sesión 2, Node 24, Windows)

- `npx tsc --noEmit` 0 · `npm run lint` 0 · pruebas tocadas sin errores de tipos (tsc aparte, `--lib es2022`).
- Suite completa (`npm test -- --test-concurrency=4`): 1132 pruebas, 1128 pasan, 4 saltadas (Redis real /
  Chromium), 0 fallos. `manejador.test.ts` ya no aborta (lo cambió el orquestador en el árbol, sin pasar por el índice).

### C. Corpus de llamadas simuladas (solo medir)

- `tools/corpus-voz.ts` (+ `tools/corpus-voz-juicio.ts`, juicio manual de cada falla):
  `node --env-file=.env.test --import tsx tools/corpus-voz.ts`. Simulador del panel, académico y agenda simulados,
  SIN IA (entendedor por reglas), sin asesor en vivo. Escribe `resultados.json` y `RESULTADOS.md` junto al corpus
  (corpus.json solo se lee).
- 347 llamadas: intención 70.0 %, acción 76.7 %, todo bien 61.1 % (66.0 % descontando 17 fallas de la etiqueta).
  0 cifras ni fechas inventadas. 118 fallas del bot o de ambos.
- Propuestas (no aplicadas): devolución de llamada (24), aspectos/listas por área (22), consultas de estudiante (15),
  repetir/ruido (15), fuera de alcance (14); sexta pedir persona (11).

## Pendiente / avisos

- `src/voice/manejador.test.ts` tiene cambios en el árbol que no están en el índice (los hizo otro); con ellos pasa.
- Construir la imagen Docker con Node 22 en CI antes de desplegar (aquí no se pudo).
