# Datos académicos de Tooli

Qué hace: entrega a cada estudiante **su propia** información (notas, horario, cursos y tareas, turno, recibo) por WhatsApp y por voz. Todo sale de una sola API, `academico` (`src/services/academico/servicio.ts`), que cumple el contrato `src/contratos/academico.ts`.

Todas las integraciones vienen **apagadas**. Las integraciones que ya existían (Banner por SSO, Iceberg, hoja de turnos, Savio) no se borraron: ahora están detrás de una capa de proveedores.

## Arquitectura

```
WhatsApp (flows/miSemestre.ts)  ┐
Voz (usa `academico`)           ┴─> academico.consultar(telefono, tipo)         [nucleo.ts]
                                      │ interruptor -> identidad -> proveedor -> paraVoz / paraTexto
        proveedores/ (puertos en tipos.ts)
          notasBanner      <- notasService (Playwright, SSO Microsoft) + sesionNotas (camino A)
          reciboIceberg    <- icebergService (+ verificador de código)
          turnoSheets      <- turnosService (hoja de Google)
          cursosSavio      <- savioService (token de servicio Moodle)
          horario          <- simulado (pruebas) | Banner (misma sesión de notas)
```

`nucleo.ts` no importa Redis ni Playwright: recibe todo por `deps` (por eso se prueba con fakes). `servicio.ts` hace la conexión real con imports dinámicos.

## Cómo encender cada integración

| Integración | Variables | Notas |
|---|---|---|
| Notas | `TOOLI_NOTAS_SSO_ENABLED=1` | Camino B por defecto. Probar antes con cuenta real (ver lista abajo). |
| Notas camino A (opcional) | `TOOLI_NOTAS_CAMINO=A`, `TOOLI_ACADEMICO_CLAVE`, `TOOLI_NOTAS_SESION_HORAS` (1-72, def. 12) | Sin clave válida cae a B. Necesario para horario y para que la voz lea notas. |
| Turno, recibo y comprobar código | `TOOLI_ACADEMIC_LOOKUP_ENABLED=1` | Un solo interruptor para las tres. Además `TOOLI_ACADEMICO_CLAVE` si se quiere guardar la cédula (recibo por voz). |
| Cursos y tareas (Savio) | `TOOLI_SAVIO_ENABLED=1`, `SAVIO_WS_TOKEN` | El servicio Moodle debe permitir además `mod_assign_get_assignments` y `mod_assign_get_submission_status`. |
| Horario | `TOOLI_HORARIO_ENABLED=1` (+ camino A) | `TOOLI_HORARIO_PROVEEDOR=simulado` solo fuera de producción. |
| Avisos proactivos | `TOOLI_AVISOS_ACADEMICOS_ENABLED=1` | Tareas a menos de 48 h y turno de hoy/mañana. Una corrida diaria tras las 8:00, nunca de noche, una vez por aviso, respeta «baja». Solo dentro de las 24 h de WhatsApp (fuera haría falta plantilla de Meta: pendiente). |
| Regla de notas | `TOOLI_NOTA_MINIMA`, `TOOLI_CORTES_PESOS`, `TOOLI_REGLA_NOTAS_CONFIRMADA` | La regla de la UTB **no está** en `knowledgeBase*.ts`. Por defecto 3.0 y 30/30/40 **sin confirmar** (así lo dicen los textos). |

Clave: `openssl rand -hex 32`. Rotarla invalida las sesiones guardadas y los índices por código/cédula (hay que volver a vincular); los vínculos siguen valiendo.

## Identidad fuerte

- El vínculo `identity:<tel>` ahora admite campos opcionales: `codigo`, `codigoVerificado`, `codigoFuente`, `nombre`, `programa`, `nivel`, `cedulaCifrada`. Los vínculos viejos siguen valiendo (probado contra Redis real).
- Cómo se ata el código (`vincularCodigoEstudiantil`, WhatsApp: *Mi semestre > Vincular mi código*): correo verificado por OTP + código + cédula aceptados por Iceberg. Solo entonces `codigoVerificado=true`. Con la fuente apagada no se ata nada.
- Un código pertenece a un solo correo vigente (Lua atómico). Renovar con el mismo correo conserva el código; verificar el mismo correo desde otro número lo hereda (la cédula cifrada no viaja); otro correo no hereda nada.
- Turno y recibo usan **solo** el código atado al número de quien escribe. Los pasos viejos (`esperando_codigo`, `recibo_*`) ahora redirigen a *Mi semestre*: ya no se puede pedir el recibo de otra persona escribiendo su código y cédula.
- `buscarParaVerificar`: no devuelve datos; solo `encontrado`, teléfono y correo enmascarados. Cupo global de 30 búsquedas/min (no hay identidad del que llama; si el contrato pasara el número del llamante, el límite sería por llamante).
- Para la voz (parte opcional del contrato): `iniciarVerificacionPorDato` manda un código de 6 dígitos PROPIO DE LA VOZ al correo institucional (misma plantilla que el OTP, `sendOtpEmail`) sin revelarlo. Se guarda como HMAC en `voz-otp:<número que llama>`, atado a ese número y al vínculo encontrado, vence a los 10 min, admite 3 intentos y es de un solo uso. `confirmarVerificacion` NO vincula ni mueve nada: devuelve `{ ok: true, telefonoEstudiante }` y la voz consulta con ese teléfono solo durante esa llamada (nunca lo dice ni consulta con el número de quien llama). Antes usaba `checkCode` y movía el WhatsApp del estudiante al número que llamaba (auditoría de la integración, 22-nov-2026).

## Notas: seguridad de la contraseña

- Camino B: la contraseña se usa una vez en `startNotasLogin` y no se guarda. La sesión de Redis solo guarda el paso y el área.
- Camino A: con consentimiento (botones, nunca texto libre) se guarda la **sesión del navegador** cifrada con AES-256-GCM, atada al teléfono, con vencimiento; se borra al desvincular o desde *Mi semestre*. La contraseña nunca se guarda.
- Pruebas (`src/flows/notasLogin.test.ts`): rastrean la contraseña por sesión, mensajes, métricas y consola, incluso si el error de automatización la trae; `activityPrivacy` oculta todos los pasos; guardia estática contra `console.*`/`describeError` en los ficheros del login (`logSafe.describeError` **no** oculta contraseñas).
- Riesgo que no se puede cerrar desde el código: lo que la persona escribe queda en el historial de WhatsApp y en lo que Meta/Evolution retengan. Alternativa más segura a medio plazo: un enlace a una página de inicio de sesión en lugar de pedir la contraseña por chat.

## Cálculos

`calculos.ts`: promedio, avance por corte y «cuánto necesitas para pasar» (`necesarioParaPasar`). Banner solo da notas definitivas por materia; las notas **por corte** solo aparecen cuando una fuente las entregue (falta ese selector). Mientras tanto *Mi semestre > ¿Cuánto necesito?* las pide a la persona.

## Qué falta para probar con cuentas reales del equipo

1. Una cuenta de estudiante del equipo con Microsoft y MFA. Con `TOOLI_NOTAS_SSO_ENABLED=1` en un entorno de prueba, pedir notas y revisar los selectores de `notasService.ts` (correo, contraseña, MFA, «mantener sesión», tabla `P_ViewTermGrde`). Nunca se probó end-to-end.
2. Confirmar con Registro Académico la regla de notas y poner `TOOLI_REGLA_NOTAS_CONFIRMADA=1`.
3. Horario: abrir `bwskfshd.P_CrseSchdDetl` con la sesión de prueba, guardar el HTML y comparar con `proveedores/bannerHorarioParser.ts` (URL, idioma de «Días»/«Hora», letras de los días). Hoy solo se probó con HTML sintético.
4. Notas por corte: localizar en Banner la página de calificaciones parciales y añadir su lector a `notasService.ts`.
5. Iceberg: con código y cédula del equipo, comprobar que `vincularCodigoEstudiantil` da `ok`, que el valor del recibo se lee (`leerValorPesos` sobre la fila de la tabla; si no aparece, el recibo sale sin valor) y que el correo del portal coincide.
6. Hoja de turnos: confirmar columnas I y J (fecha y hora límite) y el formato de fechas.
7. Savio: crear el servicio Moodle de solo lectura con las cuatro funciones, token en `SAVIO_WS_TOKEN`, y probar tareas y estados de entrega con una cuenta con cursos.
8. Camino A: generar `TOOLI_ACADEMICO_CLAVE`, activar y comprobar que tras un login la sesión se reutiliza, que expira y que desvincular la borra.
9. Avisos: confirmar la política de plantillas de Meta antes de avisar fuera de las 24 h.
10. Redis real: `TOOLI_TEST_REDIS=1 REDIS_URL=redis://localhost:6392 npm test` ejecuta `identidadFuerte.redis.test.ts` (Lua).

## Menú de WhatsApp

*Mi semestre* aparece en los menús de pregrado y posgrado (fila 10) solo para verificados, en lugar de *Cómo inscribirme* (WhatsApp permite 10 filas). También se puede escribir «mi semestre». Turno y recibo de los menús llevan allí. Eventos nuevos de métricas: `academico_semestre`, `codigo_vinculado`, `codigo_vinculo_fallido`, `notas_sesion_guardada`, `avisos_academicos_enviados`.

## Qué se tomó de nutriIA (solo lectura)

Tomado: la **idea de la capa de adaptadores** (`IEnrollmentAdapter` + `IcebergEnrollmentAdapter` que envuelve `loginAndDownloadReceipt`) como los puertos de `proveedores/`; las formas `StudentGrade`/`ScheduleClass` (CRN) para `CursoNota`/`ClaseHorario`; la advertencia de tratar los scrapers como frágiles (errores sin detalle, sin reintentos agresivos).

No tomado: `tenancy/` y `mobileApi.ts` (multi-universidad y app móvil: fuera de este alcance y acoplados a mensajería); `UtbAcademicApiAdapter` (api.utb.edu.co exige un token Azure AD delegado que Tooli no puede obtener desde WhatsApp; sus rutas no están confirmadas); `peoplesoftService`/`PeopleSoftEnrollmentAdapter` (es Unisinú, heurístico y sin selectores); `glpi/` (tickets, no datos académicos). Se puede reabrir `UtbAcademicApiAdapter` como proveedor si la UTB entrega un token de servicio.
