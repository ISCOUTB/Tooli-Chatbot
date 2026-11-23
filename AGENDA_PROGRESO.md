# Agenda de asesores: registro vivo

Rama `agenda-asesores` (sale de main 92a0f9a). Contrato: `src/contratos/agenda.ts` (no se toca).

## Decisiones
- Hora fija America/Bogota (UTC-5 sin horario de verano), igual que `atencionEquipoService`.
- Lógica pura (franjas, fechas en palabras, textos) separada del Redis para probarla sin sockets.
- Reserva y cambios de estado atómicos con Lua. Concurrencia probada contra Redis real en
  `tools/test-agenda-redis.mjs` (contenedor temporal) y con un doble en la suite.
- El estado de la conversación de agendar vive en `agenda:flujo:<tel>`: no pisa la sesión `with_agent` de Chatwoot.
- `usersService`/`reminderService` abren Redis al importarse: se cargan con import dinámico detrás de puertos inyectables.
- Recordatorios con Meta: solo se programa lo que cae dentro de las 24 h de la reserva; el resto queda como
  `recordatoriosPendientes` (falta plantilla aprobada). Ver docs/agenda-asesores.md.

## Avance (todo hecho)
- [x] agendaLogica.ts (franjas puras) + pruebas
- [x] agendaService.ts (Redis, Lua, contrato) + pruebas (incluye concurrencia)
- [x] agendaFlow.ts / agendaFlowRuntime.ts (WhatsApp) + enganche en agentHandoff e index + pruebas de punta a punta
- [x] recordatorios 24 h / 1 h (con la salvedad de la ventana de Meta)
- [x] rutas /api/tools/agenda/* (zod, auditoría, teléfono enmascarado) + pruebas contra Express real
- [x] pantalla Agenda del panel (router, menú, atajo g a, CSS, mock del panel) + pruebas de funciones puras
- [x] mutaciones: 13 de 13 mutantes de JS y 5 de 5 del Lua mueren
- [x] docs/agenda-asesores.md
