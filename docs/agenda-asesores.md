# Agenda de asesores

Permite que una persona reserve una cita con un asesor (por WhatsApp o por llamada) y que cada asesor maneje su
tiempo: qué días y horas atiende, cuánto dura cada cita, cuándo descansa y cuándo está de vacaciones.

Hora de todo el sistema: **America/Bogota (UTC-5 fijo, sin horario de verano)**. Las fechas viajan como ISO 8601 con
`-05:00`.

## Cómo se usa

### Quien agenda (WhatsApp)

- Fuera del horario de atención, o dentro pero sin ningún asesor libre, después de pasar a la persona con un asesor
  el bot le ofrece un botón **Agendar cita**. Con un asesor libre en horario no cambia nada: sigue el flujo de siempre
  (`src/flows/agentHandoff.ts`).
- También puede escribir «agendar», «quiero una cita con un asesor», «reservar cita», etc. Si el bot no sabe el área
  (posgrados, pregrado o TI), la pregunta.
- El bot muestra 3 franjas en días distintos (lista de WhatsApp), la persona elige una, confirma con un botón y recibe
  la confirmación con la fecha en palabras («mañana martes 24 de noviembre a las 9:00 a. m.»), el asesor y cómo
  cancelar o reprogramar. «Ver más horarios» sigue desde la franja siguiente a la más tardía que ya vio, otra vez en
  días distintos, y recorre toda la ventana (sin saltarse días); cuando llega al final vuelve a las horas que quedaron
  atrás sin mostrarse y solo dice que no hay más cuando ya vio todas.
- **mis citas**, **cancelar cita** y **reprogramar** funcionan desde cualquier punto del bot. Solo se ven y se tocan las
  citas del propio teléfono.
- Si la persona ya está en una conversación con un asesor humano (`with_agent`), las palabras sueltas («agendar»,
  «mis citas») siguen yendo al asesor: ahí solo se agenda tocando el botón. El estado de la conversación de agendar
  vive en su propia clave de Redis (`agenda:flujo:<tel>`, 20 min) y nunca pisa la sesión del chat con el asesor.
- La agenda viene **apagada**: `AGENDA_ACTIVA=true` la enciende en WhatsApp, en la voz y en el panel (hay que hacerlo a
  propósito, con la disponibilidad de los asesores ya cargada). Apagada, el bot y la voz no ofrecen citas, la pestaña
  **Agenda** no aparece y toda la API `/api/tools/agenda/*` responde `404 agenda_apagada`: así nadie agenda desde el panel
  una cita que el bot no sabría cancelar. El panel pregunta `GET /api/tools/agenda/estado` (`{ activa }`) al abrir.

### Quien atiende (panel → **Agenda**)

- Vista de **día** o **semana**, por asesor o de todos. En la vista de día de un asesor se ven también sus huecos libres
  (tocar uno abre «Nueva cita» con esa hora), solo dentro de la ventana de días que se pueden agendar. Si al abrir el
  diálogo esa hora ya no está libre, lo dice y no elige otra por su cuenta.
- **Nueva cita**, **Mover** y **Cancelar** (hoja de la cita). Marcar **atendida** o **no asistió** solo cuando la cita ya
  empezó; hay un aviso con las que ya pasaron y siguen sin marcar.
- **Mi disponibilidad**: activar/desactivar, áreas que atiende, duración, pausa, tramos por día de la semana y
  excepciones (días libres o vacaciones, con o sin horas). El administrador edita la de cualquiera y, además, los
  **Ajustes** generales: antelación mínima, citas futuras por teléfono, días hacia adelante y festivos.
- Cada asesor edita solo lo suyo; el administrador, todo. El teléfono completo se devuelve solo al dueño de la agenda y al
  administrador; los demás ven `****1234`.
- Si el panel crea, mueve o cancela una cita, se le avisa a la persona por WhatsApp **solo si la ventana de 24 h está
  abierta** (misma comprobación que usa Conversaciones). Si no, la respuesta lo dice y el panel avisa al asesor para que
  la contacte por otro medio.

## Reglas de las franjas

Una franja es libre si cumple todo esto (`src/services/agendaLogica.ts`, `calcularFranjasAsesor`):

1. Cae en un tramo de la semana del asesor, que está activo y atiende esa área. Los tramos se parten en citas de la
   duración configurada, más la pausa entre una y otra.
2. No sale del **horario del equipo** (`atencion:config`): es un tope. Si ese horario está desactivado no recorta.
3. No es un festivo (config) ni cae en una excepción del asesor.
4. No es del pasado ni empieza en menos de la **antelación mínima** (por defecto 120 min).
5. Está dentro de la ventana de días (por defecto 14): empieza antes de la medianoche de hoy + `diasVentana`. Es el
   mismo límite para ofrecer (bot y panel, aunque se pida un día lejano) y para reservar.
6. No choca con una cita ya confirmada del asesor. Una cita que termina justo cuando empieza otra **no** choca (pausa 0);
   con pausa, deben quedar separadas.

`franjasLibres({ area })` junta a todos los asesores del área y, a la misma hora, ofrece **uno solo**: el de menos citas
en la ventana. Para ver los de un asesor concreto (panel) se usa `franjasDeAsesor`.

## Atomicidad y límites

- `reservar` revisa la franja en JS (que siga siendo real) y luego escribe con un script Lua que, en una sola operación de
  Redis, comprueba choques con el asesor, el límite de citas futuras del teléfono y que el mismo teléfono no tenga ya otra
  cita a esa hora. Dos reservas simultáneas de la misma franja: gana una, la otra recibe `ocupada`.
- `cancelar(id, telefono)` solo funciona si la cita es de ese teléfono y está confirmada (otro script Lua).
- Reprogramar = reservar la nueva (ignorando la propia cita en choques y en el límite) y recién entonces cancelar la
  vieja; si la vieja ya no se puede cancelar, se deshace la nueva.
- Una cita ya guardada no cambia de horario: mover crea una cita nueva (`reprogramadaDe` apunta a la vieja) y deja la
  vieja `cancelada`.

## Renombrar o borrar a un asesor

Las claves de la agenda usan el nombre de usuario (`agenda:disp:<u>`, `agenda:asesor:<u>`, `cita.asesor`).

- **Renombrar** (`usersService.renameUser`) llama a `agendaServicio.renombrarAsesor(viejo, nuevo)`: un solo script Lua
  (`LUA_RENOMBRAR_ASESOR`) mueve la disponibilidad, une la ocupación en el ZSET nuevo y cambia `asesor` (y `creadaPor`)
  en todas las citas guardadas, conservando su vencimiento. Antes la agenda del nombre nuevo nacía vacía y la hora que el
  asesor ya tenía tomada se podía volver a reservar.
- **Borrar** (`usersService.deleteUser`) llama a `agendaServicio.asesorBorrado(u)` (`LUA_ASESOR_BORRADO`): se borran su
  disponibilidad y su ocupación (un usuario nuevo con el mismo nombre empieza limpio) y **sus citas quedan marcadas
  `sinAsesor`**. Decisión: la persona conserva su cita (sigue en «mis citas» y con sus recordatorios) hasta que el equipo
  decida; no se le avisa sola. En el panel esas citas salen como «Sin asesor», solo el administrador puede moverlas
  (a otro asesor) o cancelarlas, y la Agenda le muestra un aviso con cuántas citas futuras hay así y un botón para ir a la
  primera. Al filtrar por asesor no aparecen (no son de nadie).

## Datos en Redis

| Clave | Contenido |
|---|---|
| `agenda:config` | antelación, máximo de citas futuras, ventana, festivos |
| `agenda:disp:<asesor>` | disponibilidad del asesor |
| `agenda:cita:<id>` | la cita (se conserva 90 días tras terminar) |
| `agenda:asesor:<asesor>` | ZSET de citas que lo ocupan (`inicio:fin:id`) |
| `agenda:tel:<tel>` | ZSET de citas confirmadas del teléfono |
| `agenda:todas` | índice por fecha para el panel |
| `agenda:rec:<id>` | ids de los recordatorios programados |
| `agenda:flujo:<tel>` | estado de la conversación de agendar (20 min) |

## API del panel

Todo bajo `/api/tools/agenda/*`, detrás de `requireAuth`, con validación `zod` y auditoría en `auditService`
(quién, qué y sobre quién, con el teléfono enmascarado): `GET estado` (responde siempre), `GET asesores`, `GET|PUT disponibilidad/:asesor`,
`GET|PUT config` (PUT solo admin), `GET franjas`, `GET|POST citas`, `POST citas/:id/{mover,cancelar,estado}`.

## Recordatorios (24 h y 1 h antes)

Se programan con el servicio existente (`reminderService`, `createdBy: 'agenda'`) y se cancelan al cancelar,
reprogramar o marcar la cita.

**Limitación de WhatsApp (Meta Cloud):** el texto libre solo se acepta dentro de las 24 h siguientes al **último mensaje
entrante** de la persona. La agenda lee esa marca del historial `activity:<tel>` (la misma que usa Conversaciones para
avisar de la ventana) y solo programa lo que sale antes de `último mensaje + 24 h` (con 5 min de margen). Quien agenda por
WhatsApp acaba de escribir, así que típicamente entra el de 1 h de una cita para el día siguiente; una cita que crea un
asesor desde el panel, o que se tomó por llamada, puede no tener ventana y no lleva ninguno. Lo que no se programa queda
anotado en la cita (`recordatoriosPendientes` + `motivoSinRecordatorio`) y el panel la muestra con «sin recordatorio» y
el porqué; lo programado queda en `recordatorios`. La confirmación no promete recordatorio y la reprogramación solo dice
«Te avisaremos» si de verdad quedó uno. Con Evolution (Baileys) no hay ventana y se programan los dos.

Motivos de «sin recordatorio»: `ventana` (Meta, fuera de las 24 h; falta plantilla), `sin_telefono` (contacto con BSUID:
`reminderService` solo envía a teléfonos, así que ni se intenta) y `error` (el programador falló). Si la persona vuelve a
escribir después, la ventana se reabre pero los recordatorios no se reprograman solos.

**Pendiente para cerrarlo:** crear y aprobar en Meta una plantilla de recordatorio de cita (por ejemplo
`recordatorio_cita_asesor` con fecha, hora y asesor) y hacer que el worker use esa plantilla cuando la ventana esté
cerrada. Hoy `reminderService` envía solo texto y `broadcastService` solo plantillas sin parámetros.

## Pruebas

- `npm test`: lógica de franjas, servicio (con un Redis falso cuyos `eval` son un port de los scripts Lua; las
  operaciones se intercalan como en Redis real), flujo de WhatsApp de punta a punta con adaptador falso, API del
  panel contra un Express real y funciones puras del panel.
- `tools/test-agenda-redis.mjs`: los **scripts Lua de verdad** contra un Redis temporal (40 reservas simultáneas de la
  misma franja, límite por teléfono bajo concurrencia, cancelación doble, renombrar y borrar a un asesor). Instrucciones en el encabezado del archivo.

## Qué falta / ideas

- Sincronizar con **Google Calendar** del asesor (ya hay `googleapis` en el proyecto): crear el evento al confirmar,
  y leer ocupado/libre para no ofrecer horas en que tiene otra cosa. Queda como opción futura.
- Plantilla aprobada de Meta para recordatorios fuera de la ventana de 24 h (arriba).
- El bot de llamadas importa `agenda` desde `src/services/agendaService.ts` (contrato en `src/contratos/agenda.ts`);
  falta que esa rama lo inyecte.
- Reparto entre asesores a la misma hora: hoy gana el de menos citas en la ventana; podría ponderar por área principal
  o por presencia en el panel.
- Los festivos se escriben a mano en Ajustes; podría precargarse el calendario de Colombia.
- Una sola réplica del backend: los avisos en vivo del panel usan un EventEmitter (ver `atencionEventos.ts`); la agenda
  no depende de eso, pero el panel no se refresca solo cuando otra persona agenda: se actualiza al cambiar de vista o al
  tocar el botón de actualizar.
