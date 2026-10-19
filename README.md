# Tooli — Chatbot de WhatsApp para la UTB

> **Estado de producción:** antes de usar datos reales, configura los secretos y
> completa la migración descrita en [PRODUCCION_SEGURIDAD.md](PRODUCCION_SEGURIDAD.md).
> Las consultas directas de notas están apagadas por defecto
> (`TOOLI_NOTAS_SSO_ENABLED=0`) porque piden una contraseña institucional por
> WhatsApp y el SSO automatizado aún no tiene validación integral. Turno y recibo
> también se dirigen al portal oficial por defecto
> (`TOOLI_ACADEMIC_LOOKUP_ENABLED=0`): la fuente actual no permite comprobar
> que el código consultado pertenece al remitente. Habilitar estos flujos exige
> resolver y aprobar esas verificaciones con la UTB.

Plataforma conversacional de la **Universidad Tecnológica de Bolívar** que atiende por WhatsApp
dos necesidades distintas de la universidad con una misma base técnica:

1. **Servicios al estudiante** — automatiza los trámites que hoy saturan al Centro de Servicios:
   consulta de notas, turno de matrícula y descarga del recibo de pago, con escalamiento a un
   asesor humano cuando el bot no basta.
2. **Captación de aspirantes a posgrado** — informa sobre programas y costos, resuelve dudas con
   un asistente de IA, y entrega al coordinador de admisiones los prospectos ya calificados.

WhatsApp es el canal principal de comunicación en Colombia: llegar por ahí elimina la fricción de
instalar una app o navegar un portal. El bot opera sobre la **API oficial de WhatsApp Cloud (Meta)**,
con número verificado por la plataforma.

---

## Por qué existe

| | Antes | Con Tooli |
|---|---|---|
| **Estudiante** | Escribe o va presencialmente por su turno, su recibo o sus notas; espera en fila o en cola de correo | Lo obtiene en segundos por WhatsApp, 24/7 |
| **Centro de Servicios** | Responde manualmente el mismo puñado de preguntas repetitivas | Atiende solo los casos que el bot escala, con el contexto ya recogido |
| **Coordinador de posgrado** | Contacta aspirantes uno por uno, sin trazabilidad de quién mostró interés | Recibe prospectos calificados con nombre, correo y programa de interés |

---

## Los dos flujos

El menú principal es una lista interactiva de WhatsApp con seis opciones. Las cinco primeras son
servicios al estudiante; la sexta abre la línea de posgrados.

### 1 · Servicios al estudiante

| Opción | Qué hace | Cómo |
|---|---|---|
| **Ver notas** | Consulta las calificaciones del período | Verificación de identidad por OTP al correo institucional, luego inicio de sesión SSO en Banner automatizado con Playwright (soporta MFA reanudable entre mensajes) |
| **Turno de matrícula** | Devuelve el turno y la ventana asignada | Lectura en vivo del listado oficial vía Google Sheets API con cuenta de servicio |
| **Recibo de matrícula** | Entrega el PDF del recibo | Automatización del portal Iceberg con Playwright; el captcha se resuelve con OCR y visión por modelo |
| **Asistente IA** | Responde dudas abiertas sobre la UTB | Modelo de lenguaje con una base de conocimiento propia: calendario académico, requisitos, costos y financiación |
| **Hablar con asesor** | Conecta con una persona | Handoff a Chatwoot, enrutado al equipo de TI o de Admisiones según el caso |

La verificación de identidad es requisito para los trámites sensibles: el bot envía un código de un
solo uso al correo `@utb.edu.co` del estudiante y solo continúa cuando lo confirma.

### 2 · Posgrados

```
Ver programas → categoría → listado con costos → ┬→ Asistente IA (resuelve dudas)
                                                 └→ Hablar con asesor
                                                       ↓
                                        nombre → correo → programa de interés
                                                       ↓
                                    Chatwoot (equipo Admisiones) + CRM HubSpot
```

- **Catálogo con costos reales**: especializaciones, maestrías y doctorados, con valor por semestre
  y duración.
- **Asistente de IA** sobre la base de conocimiento de posgrados: requisitos, calendario, opciones
  de financiación.
- **Calificación y entrega del prospecto**: al pedir asesor, el bot recoge nombre, correo y programa
  de interés, abre la conversación en Chatwoot asignada al equipo de Admisiones —etiquetada como
  `posgrado-prospecto` y con prioridad— y envía el contacto al CRM.
- **Conversación puente**: mientras dura la atención humana, lo que escribe el aspirante llega al
  asesor y la respuesta del asesor vuelve a WhatsApp, de forma transparente para ambos.

Existe además un **flujo de captación para eventos**, que se activa por configuración: pide
consentimiento explícito conforme a la Ley 1581 antes de recoger cualquier dato, registra al
prospecto en Google Sheets y en el CRM, y cierra con la información de financiación vigente.

---

## Arquitectura

```
                    WhatsApp (estudiante / aspirante)
                                  │
                                  ▼
                    Meta WhatsApp Cloud API (oficial)
                                  │  webhook
                                  ▼
        ┌───────────────────────────────────────────────────┐
        │              Backend Express + TypeScript          │
        │                                                    │
        │   Router de flujos          API REST (JWT)         │
        │   (máquina de estados)      dashboard de asesores  │
        │           │                          │             │
        │   ┌───────┴────────┐                 │             │
        │   │ Servicios al   │  Posgrados      │             │
        │   │ estudiante     │  IA · Handoff   │             │
        │   └───────┬────────┘                 │             │
        └───────────┼──────────────────────────┼─────────────┘
                    │                          │
     ┌──────────────┼──────────────┬───────────┴────────┐
     ▼              ▼              ▼                    ▼
  Redis        Google Sheets    OpenAI              Chatwoot
 (sesiones)   (turnos, datos)  (asistente)      (atención humana)
                                                       │
                    Banner · Iceberg              CRM HubSpot
                 (portales académicos)
```

**Máquina de estados conversacional.** Cada conversación guarda en Redis el paso en que va. Al
llegar un mensaje, el router lo entrega al handler de ese paso, que responde y decide el siguiente.
Esto permite diálogos de varios turnos —pedir un dato, validarlo, pedir el siguiente— sin perder el
hilo, y que el usuario retome donde quedó. Las sesiones tienen tiempo de vida limitado.

**Capa de mensajería desacoplada.** El backend no habla directamente con WhatsApp: lo hace a través
de una interfaz de adaptador. El envío, la recepción y el formato de los mensajes quedan aislados
del código de los flujos, de modo que la lógica conversacional no depende del proveedor.

**Observabilidad.** El servicio expone métricas de uso y operación en formato Prometheus, con
tableros en Grafana y reglas de alerta.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express.js |
| Mensajería | Meta WhatsApp Cloud API |
| Sesiones y estado | Redis (ioredis), con TTL |
| Datos | Google Sheets API v4 (cuenta de servicio) |
| IA | OpenAI (asistente conversacional y visión) |
| Automatización de portales | Playwright + Tesseract.js |
| Atención humana | Chatwoot (con SSO para asesores) |
| CRM | HubSpot |
| Correo transaccional | Resend (códigos OTP) |
| Métricas | Prometheus + Grafana + Alertmanager |
| Infraestructura | Docker Compose sobre VPS en Oracle Cloud |
| Proxy y TLS | nginx + Let's Encrypt |

---

## Estructura del proyecto

```
src/
├── adapters/messaging/     Interfaz de mensajería + implementación Meta Cloud API
├── flows/                  Lógica conversacional (un archivo por flujo)
│   ├── index.ts              Router: mapea paso de sesión → handler
│   ├── menu.ts               Menú principal
│   ├── verificacion.ts       Verificación de identidad por OTP
│   ├── notas.ts              Consulta de notas (SSO + MFA)
│   ├── turno.ts              Turno de matrícula
│   ├── recibo.ts             Recibo de pago
│   ├── programas.ts          Catálogo de posgrados con costos
│   ├── prospecto.ts          Captura de prospecto → Chatwoot
│   ├── aiChat.ts             Asistente de IA
│   ├── agent*.ts             Handoff y conversación con asesor humano
│   └── posgrados-evento/     Captación para eventos (activable)
├── routes/                 Webhooks (WhatsApp, Chatwoot) y API REST
│   ├── toolsRoutes.ts        Monta la API del panel; marca qué es público
│   └── tools/                Un archivo por dominio (crm, botUsers, evento…)
├── services/               Integraciones: Sheets, Chatwoot, HubSpot, OpenAI,
│                           Banner/Iceberg, identidad, métricas, sesiones
└── public/
    ├── app/                Dashboard de asesores (privado, JWT)
    │   └── js/               Módulos ES del panel: core/, ui/, screens/
    └── posgrados/          Landing pública de captación con código QR
```

---

## Dashboard de asesores

Interfaz web privada en `/app`, con autenticación JWT y roles. Permite consultar turnos y recibos
en nombre de un estudiante, ver métricas de uso del bot, administrar las sesiones de los usuarios y
gestionar las cuentas de los asesores. Incluye inicio de sesión unificado hacia Chatwoot.

El panel es JavaScript sin framework ni paso de compilación: módulos ES nativos bajo
`src/public/app/js/` (`core/` utilidades, `ui/` componentes, `screens/` una por pantalla),
cargados desde `app.js`. Se editan y se recargan, no hay build que correr.

Para trabajar en él sin levantar Redis, Meta ni Google Sheets:

```bash
node tools/mock-panel-server.cjs        # http://localhost:4599/app/index.html
MOCK_ANON=1 node tools/mock-panel-server.cjs   # para ver la pantalla de login
```

Sirve datos de ejemplo con la misma forma que la API real y aplica las mismas cabeceras de
seguridad, para que lo que se ve en local sea lo que se ve en producción.
Con el mock en marcha, `node tools/qa-panel-all.cjs` revisa las doce pantallas
a 375, 800 y 1280 px (errores JavaScript, alertas y desbordes) y guarda capturas
en `tmp/`.

---

## Pruebas

```bash
npm test          # una pasada
npm run test:watch
```

Usa el runner incluido en Node (`node:test`) con `tsx`: no hay framework de pruebas ni
dependencias extra que mantener. Los archivos viven junto al código que prueban
(`src/services/logSafe.test.ts`, `src/public/app/js/core/format.test.js`).

Se prueba lo que falla en silencio: privacidad de logs, validaciones de entrada,
recordatorios, colas de mensajes y escapado del CSV. Para verificar los scripts
Lua contra Redis real, inicia un contenedor temporal dedicado en
`127.0.0.1:6389` y usa exclusivamente la base `/15`:

```bash
docker run --rm --name tooli-redis-qa -p 127.0.0.1:6389:6379 -d redis:7-alpine
REDIS_URL=redis://127.0.0.1:6389/15 node --env-file=.env.test --import tsx tools/test-reminders-redis.mjs
REDIS_URL=redis://127.0.0.1:6389/15 node --env-file=.env.test --import tsx tools/test-inbound-redis.mjs
REDIS_URL=redis://127.0.0.1:6389/15 node --env-file=.env.test --import tsx tools/test-broadcast-redis.mjs
REDIS_URL=redis://127.0.0.1:6389/15 node --env-file=.env.test --import tsx tools/test-chatwoot-webhook-redis.mjs
REDIS_URL=redis://127.0.0.1:6389/15 node --env-file=.env.test --import tsx tools/test-nutria-redis.mjs
docker stop tooli-redis-qa
```

Estas pruebas usan datos sintéticos y no envían WhatsApp. Las integraciones con
Meta, Chatwoot, Sheets y SSO institucional siguen requiriendo validación de ensayo.

`.env.test` trae valores falsos: `src/config` valida el entorno al importarse, así que sin él no se
puede ni importar un módulo del servidor para probarlo.

---

## Variables de entorno

```env
# General
PORT=3000
WEBHOOK_SECRET=...
REDIS_URL=redis://redis:6379
SESSION_TTL_SECONDS=3600

# WhatsApp Cloud API (Meta)
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_WABA_ID=...
WHATSAPP_VERIFY_TOKEN=...

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_JSON='{...}'    # JSON de la cuenta de servicio
POSGRADO_REGISTRO_SHEET_ID=...

# OpenAI
OPENAI_API_KEY=...

# Verificación por correo (OTP)
RESEND_API_KEY=...
MAIL_FROM=...

# Chatwoot
CHATWOOT_URL=...
CHATWOOT_ACCOUNT_ID=...
CHATWOOT_INBOX_ID=...
CHATWOOT_API_TOKEN=...
CHATWOOT_TEAM_TI_ID=...
CHATWOOT_TEAM_ADMISIONES_ID=...

# CRM
HUBSPOT_ACTIVO=false
HUBSPOT_TOKEN=...

# Captación para eventos (opcional)
POSGRADOS_EVENTO_ACTIVO=false
POSGRADOS_EVENTO_SHEET_ID=...

# Dashboard de asesores
JWT_SECRET=...
ADMIN_USER=admin
ADMIN_PASSWORD=...
```

El archivo `.env.example` contiene la plantilla completa.

---

## Despliegue

```bash
docker compose build backend
docker compose up -d
docker compose logs -f backend
```

nginx actúa como proxy inverso con certificado TLS sobre el backend en el puerto `3000`.

---

## API REST

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/api/tools/turno/:codigo` | JWT | Consultar turno de matrícula |
| `POST` | `/api/tools/recibo` | JWT | Descargar recibo de pago (PDF) |
| `GET` | `/api/tools/metrics/today` | JWT | Métricas del día |
| `GET` | `/api/tools/bot-users` | JWT | Listar usuarios activos |
| `POST` | `/api/tools/bot-users/:phone/reset-session` | JWT | Reiniciar la sesión de un usuario |
| `GET` | `/health` | — | Estado del servicio |
| `GET` | `/metrics` | — | Métricas en formato Prometheus |

---

## Privacidad y tratamiento de datos (Ley 1581 de 2012)

- **Consentimiento previo**: en los flujos de captación, el bot pide autorización explícita antes de
  recoger cualquier dato. Si el usuario no autoriza, la conversación termina y no se registra nada.
- **Minimización**: se recoge únicamente lo necesario para el trámite o el contacto solicitado.
- **Credenciales**: las contraseñas institucionales se usan en el momento de la consulta y no se
  almacenan.
- **Sesiones efímeras**: el estado conversacional vive en Redis con tiempo de vida limitado.
- **Sin registro del contenido**: no se guardan en texto plano los mensajes de los usuarios.
- **Acceso acotado**: los datos en Google Sheets se leen y escriben mediante una cuenta de servicio
  con permisos restringidos a las hojas del proyecto.

---

## Otros módulos

El mismo backend aloja **NutriA**, un bot independiente para un proyecto de investigación de la
universidad: una encuesta guiada sobre hábitos de consumo y marketing digital, con registro en
Google Sheets y un tablero público de resultados en vivo.
