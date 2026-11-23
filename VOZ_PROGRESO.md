# Línea de voz (Telnyx) — registro vivo

Rama `voz-llamadas` (sale de main 92a0f9a). Sin commits: todo queda en el árbol de trabajo para que el orquestador lo revise.

## Estado por punto del encargo

| # | Punto | Estado |
|---|-------|--------|
| 1 | Núcleo copiado de FastFood y pasado a Redis | Hecho |
| 2 | Configuración por entorno + ajustes en Redis | Hecho (entorno y panel) |
| 3 | Webhook `POST /voice/telnyx/:hookKey` | Hecho |
| 4 | Dominio nuevo: posgrados, datos del estudiante, asesor | Hecho |
| 5 | Que se escuche bien (barge-in, silencio, frase puente, léxico) | Hecho en código y pruebas; **sin probar con Telnyx real** |
| 6 | API del panel `/api/tools/voz/*` | Hecho |
| 7 | Pantalla «Llamadas» | Hecha; lint limpio; **sin abrirla en el navegador** |
| 8 | Pruebas | 5 archivos, ver cifras abajo |

## Archivos de FastFood copiados → destino

| FastFood (`src/lib/voice/…`) | Tooli | Cambios |
|---|---|---|
| `signature.ts` | `src/voice/signature.ts` | Tal cual |
| `providers/types.ts` | `src/voice/proveedor/tipos.ts` | + `stopSpeaking`, `interrumpir`, headers de Express |
| `providers/telnyx.ts` | `src/voice/proveedor/telnyx.ts` | axios; `playback_stop`; `interim_results`; speak que se puede encolar; sin SMS |
| `caps.ts` | `src/voice/caps.ts` | Tal cual |
| `schedule.ts` | `src/voice/horario.ts` | Reloj de Bogotá propio + horario de asesores |
| `text.ts` | `src/voice/texto.ts` | Sin restaurante; + léxico, pesos/fechas habladas, dígitos y código dictados, inyección «datos de otro» |
| `call-handler.ts` | `src/voice/manejador.ts` | Misma mecánica; + barge-in, silencio, frase puente, compare-and-set, sin cupo queda registrado |
| `callbacks-report.ts` | `src/voice/devoluciones.ts` | Resultados de Tooli; el reporte cuenta citas y consultas |
| `settings.ts` | `src/voice/ajustes.ts` + `servicio.ts` | Redis `voz:ajustes`; llaves solo por entorno |
| `types.ts` | `src/voice/tipos.ts` | Estado de diálogo nuevo |
| `dialog.ts`, `engine.ts`, `nlu.ts`, `ai.ts` | `src/voice/dialogo.ts`, `entender.ts`, `posgrados.ts` | **Reemplazados** (dominio de posgrados) |
| migraciones 0433/0446/0467/0477 | `src/voice/almacenRedis.ts` | Lua: reserva de cupo, CAS, ajuste de uso; TTL de retención |
| `api/voice/telnyx/[hookKey]/route.ts` | `src/routes/voiceWebhook.ts` | Express con `express.raw` antes de `express.json` |
| `api/voice/admin/*` | `src/routes/tools/voz.ts` | Mismos endpoints (settings, test, calls, callbacks, report, simulate) |
| `voice.test.ts`, `callbacks-report.test.ts`, `schedule-phrases.test.ts` | `src/voice/voz.test.ts`, `horario-devoluciones.test.ts` | vitest → node:test |
| `conversations.test.ts` | `src/voice/conversaciones.test.ts` | Conversaciones nuevas de posgrados |

Archivos nuevos sin equivalente: `entender.ts` (la IA solo elige herramienta), `posgrados.ts`, `almacen.ts` (interfaz + memoria),
`simulador.ts`, `simulados.ts`, `vista.ts`, `manejador.test.ts`, `src/public/app/js/screens/llamadas.js`,
`src/public/app/js/core/llamadas.js` (+ prueba).

Cambiados: `src/index.ts` (monta el webhook antes de `express.json`), `src/config/index.ts` y `.env.example` (variables opcionales),
`src/routes/toolsRoutes.ts`, `src/services/auditService.ts` + `src/public/app/js/core/audit.js` (2 acciones de auditoría),
`src/public/app/js/app.js` y `core/router.js` (pantalla y menú).

## Decisiones

- **La IA solo entiende.** Devuelve JSON (herramienta, programa, aspecto, nivel, tipo) validado con zod; todo lo que se dice lo arma el
  servidor con datos del catálogo o el `paraVoz` del contrato. Timeout 5 s → reglas. Lo que las reglas ya resuelven (asesor, datos
  propios, programa nombrado sin ambigüedad) no gasta IA.
- **Nunca inventa:** fechas de inscripción/inicio no están en `programas-utb.json` → lo dice y ofrece asesor. Requisitos y financiación
  son los de `KB_POSGRADOS`; una prueba de conversaciones exige que toda cifra dicha esté en el catálogo.
- **Verificación:** aunque el número que llama esté vinculado (`estudianteDe`), por defecto igual se manda el código al WhatsApp y se
  dicta, porque el identificador de llamadas se puede falsificar. Ajuste `confiarEnNumero` (apagado) para saltarlo. El código se
  guarda como HMAC, vence a los 10 min, 3 intentos.
- **Simulador:** mismo manejador con un proveedor «grabador»; academico y agenda SIEMPRE simulados (código de ejemplo T00012345; el
  código de 6 dígitos aparece como línea de sistema). No gasta cupo, tiene tope diario.
- **Compare-and-set:** cada escritura sube la versión. Cada frase final se numera: si llega una más nueva mientras otra piensa, la vieja
  se descarta y no se dice.
- **Retención:** la llamada y su transcripción vencen solas (PEXPIREAT) a los `retencionDias` (180 por defecto). El saludo lo avisa.
- **Avisos al panel:** lista `voz:avisos` (50, 7 días) que la pantalla muestra; no hay push en vivo.
- Teléfono enmascarado salvo admin en el registro; en la cola de devoluciones va completo (hay que llamar de vuelta). En la
  transcripción de llamadas reales se tapan secuencias de 6 dígitos (el código dictado).

## Qué depende de Telnyx real y no se pudo probar

1. Que `playback_stop` corte un `speak` en curso (barge-in) y si después llega `call.speak.ended`.
2. Que `transcription_start` con `interim_results: true` (motor Google) mande parciales con `is_final: false`.
3. Que un `speak` sin `stop: current` se encole detrás del anterior (respuesta detrás de la frase puente).
4. Los tiempos reales de `speak_ended` (el control de silencio cuenta desde ahí) y la pronunciación del léxico con Salomé.
5. Firma, `answer`, `transfer`, `record_start`: probados solo con eventos simulados y llaves Ed25519 generadas en la prueba.
6. El código por WhatsApp: con Meta Cloud fuera de la ventana de 24 h el texto libre no sale; haría falta una plantilla aprobada.

## Riesgos

- Temporizadores de silencio en memoria del proceso: con varias instancias o tras un reinicio se pierden (la llamada sigue, sin «¿sigues
  ahí?»).
- El contador de frases puente asume un `speak_ended` por frase; si Telnyx no lo manda al cortar, la acción pendiente podría
  retrasarse hasta la siguiente frase.
- Sin `registrarAcademico` / `registrarAgenda` en `src/index.ts`, la línea responde posgrados y ofrece devolución, pero no lee datos ni
  agenda. Falta ese cableado cuando lleguen las otras ramas.

## Falta

- Registrar los contratos reales al arrancar (`registrarAcademico(academico)`, `registrarAgenda(agenda)` de `src/voice/servicio.ts`).
- Probar con una cuenta Telnyx (número, aplicación de voz con webhook `https://<dominio>/voice/telnyx/<VOICE_WEBHOOK_KEY>`).
- Revisar la pantalla en el navegador.
- Prueba del almacén Redis con Redis real (los Lua no se ejercitan en la suite; el almacén en memoria replica sus reglas).
