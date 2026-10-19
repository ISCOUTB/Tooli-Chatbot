# Seguridad del despliegue

La configuración de Compose ahora publica los puertos 3000, 8081, 3001, 9090, 9093 y 3002 solo en `127.0.0.1` por defecto. El proxy inverso del VPS debe conectarse a esos puertos desde el mismo host. Si el proxy corre en otro host o contenedor, configura una red privada y cambia `BIND_ADDRESS` solo para esa interfaz; no uses `0.0.0.0` sin controles de red.

## Antes de desplegar esta revisión

1. En `.env`, define valores aleatorios nuevos para `EVOLUTION_DB_PASSWORD` y `GRAFANA_PASSWORD`. La contraseña de Evolution está dentro de una URL PostgreSQL: si contiene caracteres reservados (`@`, `:`, `/`, `%`, `#`, `?`), codifícalos para la URL. En una instalación existente, **cambiar solo la variable no cambia la contraseña almacenada en PostgreSQL**. Actualiza primero el usuario de la base de datos o conserva la contraseña actual hasta planificar la migración; el valor anterior `pass` debe rotarse.
2. Genera `CHATWOOT_WEBHOOK_TOKEN` con al menos 32 caracteres aleatorios y configura el webhook de Chatwoot v3.16 con la URL interna `http://backend:3000/chatwoot-webhook?token=<valor>`. No publiques esa URL ni registres query strings en el proxy. Chatwoot v3.16 no firma las entregas; sin el token el endpoint responde 503 y no reenvía mensajes.
3. Si usas Meta Cloud API, define `META_APP_SECRET` con el *App Secret* de la aplicación Meta. Las entregas POST deben traer `X-Hub-Signature-256`; sin firma válida se rechazan antes de procesar el mensaje. El GET de verificación sigue usando `WHATSAPP_VERIFY_TOKEN`. Sin `META_APP_SECRET`, los POST responden 503.
4. Haz copia de seguridad de los volúmenes PostgreSQL y de `/app/storage` del contenedor `chatwoot-app` **antes** de añadir el nuevo volumen `chatwoot-storage`. Montar un volumen vacío oculta los archivos que ya estaban en esa ruta del contenedor. Copia esos archivos al volumen nuevo antes de reiniciar Chatwoot para conservar adjuntos existentes.
5. Redis de Tooli y Chatwoot usan ahora AOF con volúmenes. Incluye `redis-data` y `chatwoot-redis-data` en las copias de seguridad y limita acceso a sus snapshots: pueden contener sesiones, usuarios, mensajes y tareas. El Redis anterior no persistía datos; los datos ya perdidos por reinicios no se recuperan con este cambio.
6. Los registros históricos `activity:*` en Redis pudieron contener contraseñas SSO, OTP y cédulas durante 30 días. Antes de activar la persistencia, púrgales o redáctalos siguiendo el procedimiento de datos de UTB. La redacción nueva solo evita almacenar esos datos en pasos sensibles futuros.

Después de configurar los secretos, verifica `docker compose config --quiet`, inicia los servicios y prueba el webhook legítimo de cada proveedor. La configuración de Compose se puede revisar sin secretos locales con `docker compose --env-file .env.example config --no-env-resolution --quiet`; esto solo valida la sintaxis, no las conexiones ni la persistencia real.

Los QR NutriA nuevos usan diez caracteres aleatorios. El escáner acepta también los códigos anteriores de cuatro caracteres hasta que caduquen. La reserva y el canje atómicos pasaron pruebas sintéticas concurrentes contra Redis real temporal; antes de un evento, prueba el QR y el escáner físicos con dos canjes simultáneos en un entorno de ensayo.

## Bandeja de webhooks entrantes

Meta, Evolution y Chatwoot guardan cada evento manejable en Redis antes de responder HTTP 200. El worker de entrada se inicia junto con la aplicación. La clave `inbound:ready` contiene contactos pendientes; `inbound:processing` contiene leases activos y `inbound:review` contiene resultados inciertos. Un fallo del handler o un lease vencido bloquea únicamente la conversación afectada para evitar un reenvío automático que podría duplicar respuestas.

En **Estado del sistema**, un administrador ve «Mensajes por revisar». Debe contrastar el número, el ID del mensaje y la hora con el historial de Conversaciones y, cuando corresponda, el proveedor. «Marcar revisado» desbloquea los mensajes siguientes sin procesar de nuevo ese mensaje. «Reintentar» vuelve a procesarlo; úsalo solo tras confirmar que no hubo efecto externo. La API administrativa equivalente es `GET /api/tools/inbound/reviews` y `POST /api/tools/inbound/reviews/:id/resolve` con `{"decision":"acknowledge"}` o `{"decision":"retry"}`. Estos endpoints requieren sesión de administrador. No purgues `inbound:*` para resolver incidentes: destruirías la deduplicación y el orden por contacto.

El envío desde Chatwoot puede incluir varios adjuntos: si alguno falla o el proceso cae durante el envío, la conversación queda en revisión. Consulta el historial de WhatsApp y Chatwoot antes de elegir «Reintentar», porque parte del mensaje pudo haberse entregado.

El flujo de CI despliega automáticamente al hacer push a `main`. Este cambio solo está en la rama local hasta que se publique y se complete la preparación anterior.
