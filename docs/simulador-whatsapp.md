# Simulador de WhatsApp («Probar el bot»)

## Para qué sirve

Antes, el flujo de WhatsApp solo se podía probar desplegando a `main` y escribiéndole al número real de Meta. El simulador corre **el mismo flujo** (`handleMessage`, con sesiones reales en Redis) desde el panel: el administrador escribe como si fuera un estudiante y ve las respuestas en un chat con la apariencia de WhatsApp (texto, botones, listas, imágenes y documentos). Al tocar un botón o una fila de lista se envía su id, igual que lo hace WhatsApp.

Solo lo ven y lo usan los **administradores** (pestaña *Probar el bot*, en Atender). La API (`/api/tools/simulador-whatsapp/*`) también exige el rol, valida con zod y tiene un límite por administrador: 30 mensajes por minuto y 60 conversaciones por hora.

## Cómo funciona

- Cada conversación usa un **número de la zona de pruebas**: `57 0000` seguido de 6 dígitos. Ningún número colombiano real empieza por 0 después del 57, así que no se puede confundir con el de una persona.
- El adaptador de mensajería va envuelto en `conZonaDePruebas` (`src/adapters/messaging/ZonaDePruebasAdapter.ts`). Lo que el bot manda a un número de prueba queda en un buzón en memoria y **nunca llega a Meta ni a Evolution**. La decisión se toma por el número, así que vale también para lo que salga más tarde, por ejemplo con un temporizador.
- Cada mensaje se atiende dentro de la zona de pruebas (`enZonaDePruebas`, con AsyncLocalStorage, en `src/services/simulacion.ts`). Los servicios que escriben fuera lo detectan, no escriben y dejan una **nota 🧪** en el chat con lo que habrían hecho.
- Si el bot intenta escribirle a otro número durante una conversación de prueba, el mensaje tampoco sale.

## Qué se salta y qué no

| Efecto | En el simulador |
|---|---|
| WhatsApp (Meta o Evolution) | Nunca sale. Las imágenes subidas a Meta tampoco: el flyer se dibuja y se muestra como imagen. |
| Métricas del panel (`metrics:*`, Prometheus) | No cuentan. Tampoco el ranking de preguntas de la IA ni su caché de respuestas. |
| Google Sheets (prospectos y evento de posgrados) | No escribe. Deja una nota con la fila que se habría agregado. |
| HubSpot | No escribe. Deja una nota. |
| Chatwoot | No crea el contacto ni la conversación (usa el id `-1`), y lo que se escribe «al asesor» no se reenvía. La nota muestra el resumen que habría recibido el asesor. |
| CRM del panel (notas y etiquetas) | No guarda. Deja una nota. |
| Seguimiento por inactividad, incidencias y «no reconocido» | No se programan ni se guardan. Lo no reconocido aparece como nota. |
| Correos (OTP) | No se envían. El código aparece en el chat. |
| Verificación del correo | Funciona, pero el vínculo usa un correo ficticio (`simulador.<número>@utb.edu.co`). Así nunca le quita el vínculo a un estudiante real. |
| Código estudiantil (Iceberg) y portal de notas (Banner) | No se consultan. El paso responde como apagado o como error. Nadie escribe contraseñas reales en el panel. |
| Agenda | Lee los horarios **reales**. Si no hay ninguno libre, ofrece unos de ejemplo. La cita de prueba vive en memoria: no bloquea la hora, no aparece en la agenda y no programa recordatorios. |
| Sesión, perfil, autorización de datos y baja | Se guardan en Redis como siempre, con el número de prueba. «Empezar de nuevo» lo borra todo (`*<número>*` y la lista de bajas). |
| IA (OpenAI) | **Sí se usa** y gasta como una conversación normal. Sin `OPENAI_API_KEY`, el bot responde con sus reglas y el panel lo avisa. |

## Perfiles iniciales

- **Aspirante nuevo:** nunca le ha escrito al bot.
- **Aspirante que vuelve:** ya autorizó sus datos y dio su nombre («Laura Prueba», egresada de otra universidad).
- **Estudiante verificado:** vínculo de correo ya hecho, con el correo ficticio. Con «Mi semestre» encendido, ve ese menú; los datos académicos salen vacíos porque el correo no existe.

Cambiar de perfil empieza otra conversación.

## Cómo se usa

**En el VPS:** entrar al panel como administrador → *Probar el bot*. No necesita variables nuevas. Los interruptores (`FLUJO_CONVERSACIONAL`, `AGENDA_ACTIVA`, `TOOLI_*`, `POSGRADOS_EVENTO_ACTIVO`, `FOTOS_PROGRAMAS`) son los del servidor, y el recuadro «Cómo está el bot» los muestra.

**En local, con el bot real:** `npm run dev` con Redis y un `.env` de desarrollo. Las integraciones pueden quedar vacías, porque el simulador no las llama.

**En local, sin Redis (solo la pantalla):**

```bash
PORT=4620 node tools/mock-panel-server.cjs
QA_BASE_URL=http://localhost:4620 node tools/qa-panel-probar-bot.cjs   # QA_CAPTURAS=<carpeta> guarda capturas
```

El mock responde con un guion corto que recorre todos los tipos de mensaje. No es el bot real.

## Conversaciones de prueba recomendadas

Haz cada una con «Empezar de nuevo» y revisa las notas 🧪 en cada paso.

1. **Recomendación de posgrados:** «Hola» → relación (egresado UTB / otra universidad) → carrera → nivel → resultados (flyer si hay Meta y `FOTOS_PROGRAMAS`) → ficha → 👍.
2. **No volver a preguntar:** «Busco la maestría en finanzas» como primer mensaje. No debe volver a preguntar «¿Ya tienes un posgrado en mente?».
3. **Cambio de nombre:** en mitad del flujo, «me llamo Laura» y luego «quiero cambiar mi nombre». Debe confirmar el nombre nuevo sin salir del paso. «olvídalo» o «cancelar» no se guardan como nombre.
4. **Asesor por chat:** «Quiero hablar con un asesor» → nombre → «💬 Por este chat». Notas: Sheets, HubSpot, CRM y Chatwoot con el resumen. Paso: *Con un asesor*.
5. **Asesor por llamada:** igual, pero «📞 Una llamada» → número → franja. Prueba también «Llámenme mañana» (debe preguntar la franja) y «no puedo contestar llamadas».
6. **Asesor por correo:** «✉️ Al correo» → un correo cualquiera, y prueba también cambiar de idea («mejor por acá»).
7. **Perfil que vuelve:** con *Aspirante que vuelve*, pide un asesor. No debe pedir otra vez el nombre ni la autorización.
8. **Agenda** (con `AGENDA_ACTIVA=true`): «agendar» → área → horario → confirmar; después «mis citas», «reprogramar» y «cancelar».
9. **Mi semestre** (con alguna integración académica encendida): con *Estudiante verificado*, «mi semestre». Con *Aspirante nuevo*, pide el correo y el código aparece como nota.
10. **Baja:** «BAJA» en cualquier paso, y después «hola».
11. **Preguntas sueltas a la IA:** «¿Cuánto cuesta y cuándo empieza?», «¿Hay becas?», «¿Es virtual?», en el inicio y en mitad de un paso (por ejemplo, mientras pide el correo). Sin IA, revisa la respuesta de respaldo.
12. **Ruido y confusión:** «?», «no entiendo», un saludo en mitad del flujo, un número de opción que no existe.

## Límites conocidos

- El buzón vive en la memoria del proceso. Si el backend llega a tener varias réplicas, hay que pasarlo a Redis.
- No simula audios, imágenes enviadas por la persona, el QR de asistencia a eventos ni las plantillas de Meta (campañas).
- El lado del asesor (responder desde Chatwoot) no se simula.
