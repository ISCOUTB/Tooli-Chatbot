# Pendientes — Panel de asesores (Tooli)

Estado de las funciones grandes discutidas para el panel: algunas ya están
implementadas y otras dependen de una decisión de producto, credenciales
externas o un sistema de la universidad que aún no está conectado. Se
documenta qué funciona hoy y qué requiere integración o pruebas reales.

## 1. Semestre y carrera del estudiante

Hoy el bot **no pregunta** semestre ni carrera *actual* (la de un estudiante ya
matriculado) en ningún flujo — solo captura nombre, correo y programa/carrera
*de interés* de un aspirante (ver `src/flows/registro.ts`, `src/flows/prospecto.ts`,
`src/flows/pregrado.ts`, `src/flows/posgrados-evento/flow.ts`). El campo
`session.data` en `botUserService.ts` solo tiene lo que esos flujos guardan.

Cuando la universidad tenga un sistema (SIA, Banner, etc.) con el que
integrarse, el camino natural es:
- Un flujo del bot que pida el código estudiantil y consulte ese sistema
  (similar a como `turnosService.ts` / `icebergService.ts` ya hacen login
  contra el portal de matrículas).
- O una importación periódica (CSV / API) que enriquezca los perfiles del CRM
  (`src/public/app/index.html`, sección `renderRegistros`) con semestre y
  carrera reales, cruzando por código estudiantil o email.

**No implementar esto con datos inventados en el frontend.** El día que haya
un sistema real contra el cual consultar, se agrega el campo a
`BotUserInfo`/`registroService.ts` y se muestra en el CRM y en la bandeja de
Conversaciones (ya tienen espacio reservado en el layout de la tarjeta).

## 2. Agendar en Google Calendar

Requiere decidir: ¿cuenta de servicio de Google Workspace de la universidad?
¿calendario compartido por asesor o uno solo del área? Con eso se puede:
- Agregar un botón "Agendar cita" en la bandeja de Conversaciones y en el CRM.
- Backend: `googleapis` ya es dependencia del proyecto (se usa para Sheets),
  así que añadir Calendar API es una extensión natural, no una librería nueva.

## 3. Enviar correos desde el panel

Requiere SMTP o Gmail API con las credenciales de un remitente autorizado por
la universidad (para que no caiga en spam / no se use una cuenta personal).
Una vez se tenga eso, un botón "Enviar correo" en el CRM (ya tiene el email
del prospecto) es sencillo de conectar.

## 4. Actividad / rendimiento de asesores — ✅ implementado

Construido de punta a punta: `auditService.ts` registra cada acción (login,
turno consultado, recibo descargado, reset de sesión, baneos, toggle de IA)
etiquetada por `req.user.username`, expuesto en `/api/tools/audit/summary` y
mostrado en el panel como un dashboard real (podio + gráfico de barras +
detalle por tipo de acción) en `renderActividad` dentro de
`src/public/app/index.html`.

## 6. Mensajes masivos con plantillas — ✅ implementado; pendiente ensayo real

El CRM permite a un administrador seleccionar prospectos filtrados y escoger
una plantilla aprobada. La API lista las plantillas de Meta, comprueba que la
elegida no necesite parámetros, crea un trabajo persistente en Redis y evita
repetir el mismo envío durante 24 horas. El worker procesa destinatarios de
forma individual; un resultado incierto queda registrado para revisión y no
se reenvía automáticamente. El panel muestra avance, éxitos y fallos. La
selección se borra al actualizar registros, porque el Sheet puede reordenar
las filas, y los números repetidos se cuentan una sola vez.

La prueba de navegador usa una plantilla y un trabajo sintéticos; las pruebas
de cola usan Redis temporal. **Aún falta** ensayar con el WABA institucional,
plantillas aprobadas y contactos autorizados, verificar los resultados en Meta
y definir el procedimiento operativo para fallos inciertos. Las plantillas
con variables `{{1}}` todavía no se admiten. Fuera de la ventana de 24 horas,
Meta solo permite iniciar contacto mediante plantillas aprobadas; el panel no
ofrece texto libre masivo.

## 5. Multi-universidad / integración con la app móvil de la UTB

La arquitectura actual (adaptadores de mensajería intercambiables, flujos por
"área") ya está pensada para poder replicarse en otra institución cambiando
configuración y contenido, no código base. Conectarlo con una app móvil
existente de la UTB implicaría exponer parte de esta API REST (`toolsRoutes.ts`)
con autenticación de esa app — es una conversación de arquitectura/seguridad
con quien mantenga esa app, no un cambio que se pueda improvisar sin ese
contacto.

## 7. Flujo de Pregrado en WhatsApp — ✅ implementado (pendiente probar en producción)

El bot completo estaba marcado como "Posgrados UTB" — no existía registro de
interés ni asesor propio para aspirantes de pregrado, solo Turno/Recibo de
matrícula. Se agregó (`src/flows/pregrado.ts`, `src/flows/menu.ts`,
`src/flows/shared.ts`): el menú inicial ahora pregunta Pregrado o Posgrado
primero, y cada rama tiene su propio registro de interés (carrera como texto
libre — no hay un listado de carreras de pregrado en el sistema, así que no
se inventó uno) y su propio asesor vía Chatwoot (etiqueta `pregrado-prospecto`).
El asistente IA de pregrado reutiliza el área `admisiones` de `aiAssistant.ts`,
que ya tenía su propia base de conocimiento y busca páginas `/pregrado/` — no
se creó una nueva.

Los prospectos de pregrado y posgrado ahora comparten el mismo Google Sheet,
distinguidos por una columna de área nueva (retrocompatible: filas viejas sin
esa columna se leen como "Posgrado"). El panel (CRM, Actividad de asesores,
bandeja de Conversaciones) ya distingue el área en badges y filtros.

**Honestidad sobre las pruebas:** se verificó con `tsc --noEmit` (compila
limpio) y revisión manual cuidadosa, y se probó en navegador la parte del
panel (CRM). **No se pudo probar el flujo conversacional real de WhatsApp
end-to-end** en este entorno porque no hay Redis ni credenciales de Meta
disponibles aquí — antes de considerar esto "en producción", conviene
probarlo manualmente por WhatsApp (o en el ambiente de staging que exista)
siguiendo el camino completo: menú → elegir Pregrado → registrarse → ver
que la fila aparece en el CRM con área "Pregrado".

---

## Actualización — 14 de septiembre de 2026

### 8. Hub "Mi vida académica" en WhatsApp — ✅ implementado (con un límite honesto)

El bot solo servía a *aspirantes*. Un estudiante ya matriculado que preguntaba por
sus notas, su horario o una tarea no tenía a dónde ir. Se agregó
`src/flows/academico.ts` + `src/services/academicoLinks.ts`: un hub que lo lleva a
la plataforma correcta diciéndole con qué credenciales entra y qué va a encontrar.

Las URLs **no son inventadas**: salen de `src/services/knowledgeBaseTI.ts`, que ya
documentaba las plataformas reales de la universidad (Banner/autoservicio, Savio,
Iceberg, Office 365) y de los enlaces institucionales que ya usaban otros flujos.

**Lo que sigue sin ser posible:** consultar la nota o el horario *en vivo*. No hay
API académica accesible desde este repo. La costura está definida en la interfaz
`AcademicoProvider` (en `academicoLinks.ts`) y deliberadamente **no tiene
implementación**: el día que exista el acceso se implementa ese contrato y el flujo
pasa a mostrar el dato donde hoy entrega el enlace. No implementarlo con datos
simulados — un estudiante decidiendo con una nota inventada es un daño real.

### 9. Recordatorios programados — ✅ implementado (el disparo por datos académicos sigue pendiente)

Antes solo se podía enviar un recordatorio "ahora mismo". Ahora
`src/services/reminderService.ts` los programa para una fecha futura con una cola
en Redis y un worker que los dispara solo, con endpoints
`POST/GET/DELETE /api/tools/recordatorios` y pantalla propia en el panel.

**Lo que sigue sin ser posible:** que el disparo salga automáticamente de un dato
académico ("se vence tu tarea", "subieron tus notas") — eso depende del mismo
sistema universitario del punto 1. Cuando exista, solo tiene que llamar a
`scheduleReminder()`; no hay que reescribir nada.

### 10. Responder por WhatsApp desde el panel — ✅ implementado (limitado por Meta, no por el código)

La bandeja era de solo lectura. Ahora el asesor responde desde el panel
(`POST /api/tools/bot-users/:phone/reply`) y el mensaje aparece en el hilo.

**Límite real de la plataforma:** fuera de las 24h desde el último mensaje del
estudiante, Meta no acepta texto libre. El endpoint valida esa ventana ANTES de
intentar el envío y responde 409 explicando cuántas horas pasaron, en vez de
fallar con un error críptico de la Graph API. Para retomar contacto fuera de esa
ventana hace falta una plantilla aprobada — ver el punto 6.

### 11. Fichas de seguimiento del CRM — ✅ implementado

`src/services/crmService.ts`: notas del equipo, estado del embudo, etiquetas y
asignación por prospecto, en Redis e indexadas por teléfono. Visible en el CRM
(badge y filtros), en el hilo de conversación y en la vista de asesores (cartera
de cada uno).

**Ojo con la honestidad aquí:** lo que un asesor escribe en una nota es una nota,
no un dato del sistema académico. No usar estos campos para "rellenar" semestre o
carrera del punto 1.
