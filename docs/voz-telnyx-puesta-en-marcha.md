# Línea de voz con Telnyx: puesta en marcha

Guía para conseguir el número, conectar Telnyx al bot de llamadas de Tooli y probarlo por etapas.

- **Verificada contra la documentación pública de Telnyx el 23 de noviembre de 2026.** Telnyx cambia precios y requisitos sin aviso: cada dato lleva su enlace para volver a revisarlo.
- **Código de referencia:** rama `integracion` (PR #40), ya con los arreglos de #33, #34 y #35. `main`, que es lo que despliega el CI al VPS, **aún no trae `src/voice/`**. Sin ese merge no hay webhook de voz en producción.
- Archivos del código que esta guía sigue: `src/voice/proveedor/telnyx.ts`, `src/voice/manejador.ts`, `src/voice/ajustes.ts`, `src/voice/signature.ts`, `src/routes/voiceWebhook.ts`, `src/config/index.ts` y `.env.example`.

## Lo esencial

1. Hoy una cuenta nueva de Telnyx pasa por los niveles **Pretrial → Trial → Paid → Verified**. Para llamadas reales hace falta como mínimo **Paid**. **Verified** quita el aviso en inglés que Telnyx antepone a la voz generada y las restricciones de compra de números.
2. Un **número local de Colombia** cuesta desde **US$13,50 al mes**. Telnyx pide nombre (de una persona, o del representante y la empresa) y una dirección, **sin subir documentos**. Que haya números de Cartagena (605) solo se sabe buscando en el portal.
3. Una cuenta en nivel Paid creada desde Colombia **solo puede comprar números locales de Colombia**. Para un número de EE. UU. hace falta llegar a Verified, así que no es un atajo.
4. Para probar sin comprar número: un **subdominio SIP** de la aplicación (`sip:prueba@<subdominio>.sip.telnyx.com`), llamando desde un softphone.
5. Los comandos que usa el código (`answer`, `speak`, `playback_stop`, `transcription_start`, `transfer`, `hangup` y `record_start`) existen en Call Control v2 con esos parámetros. La voz `Azure.es-CO-SalomeNeural` y el motor `Google` con idioma `es` y `interim_results` son válidos.
6. Los **tres problemas serios** que encontró la revisión ya están corregidos en `integracion`: la transcripción se detiene al transferir, la transferencia fallida hace que el bot retome, y el webhook procesa antes de responder, así que Telnyx sí reintenta. Quedan **tres comportamientos de Telnyx que solo confirma una llamada real** (sección E, «Por confirmar en vivo»).
7. Para el piloto de 300 llamadas de 4 minutos, con 30 transferencias, el costo estimado es de **US$66 a 77 al mes** (desglose en la sección D).

---

## A. Cuenta, número y aplicación

### A1. Crear la cuenta

1. Entrar a [telnyx.com/sign-up](https://telnyx.com/sign-up). Pide los datos de contacto, la empresa y una contraseña, y después hay que confirmar el correo ([Create Your Telnyx Account](https://developers.telnyx.com/docs/account-setup/create-account.md)).
   - Conviene registrarse con un **correo institucional** (`@utb.edu.co`). Telnyx revisa la edad y la reputación del dominio, la IP y el reCAPTCHA, y puede pedir un celular válido o KYC ([Account Signup](https://developers.telnyx.com/docs/account-setup/signup.md)). Si rechazan una cuenta con correo gratuito, su propia recomendación es usar un correo de empresa ([Pretrial Accounts](https://support.telnyx.com/en/articles/14327893-telnyx-pretrial-accounts)).
   - Quien la cree será el dueño. En el issue #36 le toca a Ángel. El **país de origen** de la cuenta decide qué números puede comprar en nivel Paid (ver A2), así que debe crearse desde Colombia con un celular +57.
2. La cuenta nace en **Pretrial**: US$25 en créditos de IA y un número de EE. UU., pero **sin acceso a Voz** ([Pretrial Accounts](https://support.telnyx.com/en/articles/14327893-telnyx-pretrial-accounts)). Para pasar a **Trial** hay que superar la revisión antifraude: verificación con LinkedIn o GitHub, o la evaluación con un agente de IA ([Account Upgrade](https://developers.telnyx.com/docs/account-setup/account-upgrade.md)). Al subir, los US$25 de IA se cambian por US$5 de crédito general.

### A2. Niveles de cuenta: «nivel 1 y 2» en la versión actual

Hay dos esquemas, y una cuenta está en uno u otro, nunca en ambos ([Account Levels and Capabilities](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities.md)):

- Si el portal muestra la página **Account Levels**, la cuenta usa el esquema nuevo (Pretrial/Trial/Paid/Verified), que es el de las cuentas creadas desde junio de 2025 ([Account Verification](https://support.telnyx.com/en/articles/1130595-account-verification)).
- Si muestra la pestaña **Verifications**, usa el esquema anterior de **Nivel 1 / Nivel 2**:
  - El nivel 1 llega al confirmar el correo y solo deja comprar números locales del país de origen.
  - El nivel 2 se pide en *Account Settings → Verifications* con el nombre de la empresa y un teléfono de contacto, y tarda hasta 48 horas. Abre los números internacionales, las llamadas y desvíos internacionales, y quita los topes de recarga.
  - Fuentes: [Account Verification](https://support.telnyx.com/en/articles/1130595-account-verification) y [Phone Number Ordering Restrictions](https://support.telnyx.com/en/articles/10715715-phone-number-ordering-restrictions).

Lo que importa para Tooli en el esquema nuevo:

| Nivel | Qué exige | Límites que afectan a la línea de voz |
|---|---|---|
| **Trial** | Correo verificado y revisión antifraude | US$5 de crédito. **1** número local del país de origen en toda la vida de la cuenta, que Telnyx recupera a los 30 días si no se sube de nivel. **Solo recibe llamadas del número verificado.** Máximo **10 minutos por llamada**. Antepone un aviso en inglés («This is an automated call generated on the Telnyx platform…») a `speak` y `transfer`. 1 API key ([Trial](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities/trial.md)). |
| **Paid** | Lo anterior, más celular verificado, un pago con tarjeta, 2FA activado y una *Provided Service Address* ([Account Upgrade](https://developers.telnyx.com/docs/account-setup/account-upgrade.md)) | Solo compra **números locales del país de origen**. Lista limitada de países de destino para llamadas salientes. 5 llamadas salientes a la vez. **Sigue anteponiendo el aviso en inglés** a `speak` y `transfer` ([Paid](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities/paid.md)). |
| **Verified** | Lo de Paid, más **KYC** y la evaluación con agente de IA | Sin aviso en inglés ([FAQ de Account Upgrade](https://developers.telnyx.com/docs/account-setup/account-upgrade.md)). Compra números sin restricción, salvo bloques ([Verified](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities/verified.md)). |

> La FAQ de Telnyx habla del aviso en inglés al explicar las llamadas *salientes*, pero la lista de endpoints afectados incluye `speak`. Hay que comprobar en la primera llamada si también suena en las entrantes. Si suena, **el piloto con público necesita Verified**.

### A3. Saldo y pago desde Colombia

1. En el portal: menú de perfil → **Billing** → **Make Payment**. Se puede pagar con tarjeta de crédito o débito, PayPal, Bitcoin o débito ACH ([Billing Setup](https://support.telnyx.com/en/articles/4280500-billing-setup-billing-groups)).
2. Reglas que publica Telnyx:
   - El **pago mínimo es de US$10**.
   - Una cuenta nueva puede pagar hasta **US$100 el primer día**, y el tope sube US$50 por día.
   - Cada medio de pago nuevo pasa por una **revisión de hasta 48 horas** (sin contar fines de semana).
   - **La dirección de facturación debe ser del mismo país que el celular con que se verificó la cuenta.** Con tarjeta colombiana, dirección en Colombia y celular +57 se cumple.
   - Fuente: [Billing Setup](https://support.telnyx.com/en/articles/4280500-billing-setup-billing-groups).
3. Telnyx cobra en dólares. Un posible recargo del banco por la compra en moneda extranjera no depende de Telnyx.
4. **Primera recarga sugerida: US$30.** Cubre el primer mes del número (US$13,50) y unas cien llamadas de prueba, con margen. El issue #36 calculaba US$20, que alcanzan con poco margen.

### A4. API key y clave pública (firma Ed25519)

1. **API key:** abrir [portal.telnyx.com/#/app/api-keys](https://portal.telnyx.com/#/app/api-keys) → **Create API Key**. Ponerle una etiqueta como `tooli-vps-produccion` y elegir la expiración. **El valor se muestra una sola vez**: hay que copiarlo en ese momento ([Create and manage API keys](https://developers.telnyx.com/docs/development/api-fundamentals/create-api-keys.md)). En Trial solo se permite una API key.
2. Para comprobarla desde el VPS:
   ```bash
   curl -s https://api.telnyx.com/v2/balance -H "Authorization: Bearer $TELNYX_API_KEY"
   ```
   Es la misma llamada que hace el botón «Probar conexión con Telnyx» del panel.
3. **Clave pública:** está en [portal.telnyx.com/#/api-keys/public-key](https://portal.telnyx.com/#/api-keys/public-key), en la sección *API Keys → Public Key* ([Receiving webhooks](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks.md)). Es un texto en base64 de 32 bytes y va en `TELNYX_PUBLIC_KEY`.
   - Telnyx firma cada webhook con las cabeceras `Telnyx-Signature-Ed25519` y `Telnyx-Timestamp` ([Voice API Webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks.md)).
   - El SDK oficial firma `${timestamp}|${cuerpo}` y acepta 5 minutos de diferencia ([telnyx-node, webhooks.ts](https://github.com/team-telnyx/telnyx-node/blob/master/src/lib/webhooks.ts)). `src/voice/signature.ts` hace exactamente lo mismo: ±300 s sobre el cuerpo crudo.
   - Por la ventana de 5 minutos, **el reloj del VPS debe estar sincronizado**. Revisarlo con `timedatectl status` y buscar `System clock synchronized: yes`.

### A5. Perfil de salida (Outbound Voice Profile), necesario para transferir a un celular

La aplicación de voz necesita un perfil de salida asociado para hacer llamadas salientes, y `transfer` abre una ([Getting Started](https://developers.telnyx.com/docs/voice/programmable-voice/get-started.md)).

1. En el portal, **Outbound Voice Profiles** → agregar un perfil, por ejemplo `tooli-transferencias` ([Outbound Voice Profiles](https://support.telnyx.com/en/articles/4320411-outbound-voice-profiles)).
2. En **International Allowed Destinations**, agregar **Colombia**. **Por defecto el perfil solo permite EE. UU. y Canadá** (`whitelisted_destinations` vale `["US","CA"]` según la [API de perfiles de salida](https://developers.telnyx.com/api-reference/outbound-voice-profiles/create-an-outbound-voice-profile.md)). Sin este paso, la transferencia a un +57 falla.
3. En **Associated Connections and Applications**, agregar la aplicación de voz de A6, o hacerlo desde la aplicación.
4. En **Advanced Settings**, poner topes de seguridad para el piloto ([Outbound Voice Profiles](https://support.telnyx.com/en/articles/4320411-outbound-voice-profiles)):
   - *Channel Limit*: 2.
   - *Max Destination Rate*: US$0,05 por minuto.
   - *Daily Spend Limit*: US$5. Se reinicia a las 00:00 UTC.
5. Precios de salida:
   - Llamar a un **celular de Colombia** cuesta **US$0,0125/min** de troncal, más los **US$0,002/min** de Voice API ([SIP Trunking Pricing, selector Colombia](https://telnyx.com/pricing/elastic-sip); [Voice API Pricing](https://telnyx.com/pricing/call-control)).
   - Un fijo de Colombia cuesta US$0,016/min.
   - Cada `transfer` cobra además **US$0,10 por invocación** ([Voice API Pricing](https://telnyx.com/pricing/call-control)).
6. El documento de perfiles advierte que muchos destinos exigen el nivel 2 para activarse ([Outbound Voice Profiles for SIP trunking](https://developers.telnyx.com/docs/voice/outbound-voice-profiles.md)). Si Colombia aparece bloqueado en Paid, hay que pedir el nivel siguiente.

### A6. Aplicación de voz (Voice API Application, antes «Call Control»)

En el portal: **Real-Time Communication → Voice → Programmable Voice → pestaña Voice API Applications → Create Voice App** ([Voice API Fundamentals](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-fundamentals.md)).

| Campo del portal | Valor para Tooli | Por qué |
|---|---|---|
| Application name | `tooli-voz` | Solo para identificarla |
| **Webhook URL** | `https://tooli-utb.duckdns.org/voice/telnyx/<VOICE_WEBHOOK_KEY>` | Es la ruta que monta `src/index.ts` (`app.use('/voice', …)`) con `POST /telnyx/:hookKey` (`src/routes/voiceWebhook.ts`). La clave debe tener 24 caracteres o más; si no, la ruta responde 404. |
| Webhook failover URL | Vacío | Telnyx la usa cuando la principal falla dos entregas seguidas ([Voice API Fundamentals](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-fundamentals.md)). Con un solo VPS, apuntarla al mismo servidor no sirve de nada. |
| **Webhook API version** | **v2** | El código solo entiende el formato v2 (`data.event_type`, `data.payload.call_control_id`). Al crear la aplicación por API, el valor por defecto es `"1"` ([esquema de la aplicación](https://developers.telnyx.com/api-reference/call-control-applications/create-a-call-control-application.md)). |
| Enable hang-up on timeout / Custom webhook timeout | Apagado / vacío | El webhook procesa el evento y después responde: 200 si salió bien, 500 si falló (Telnyx reintenta) y 202 si pasan 5 s, en cuyo caso sigue en segundo plano (`PLAZO_WEBHOOK_MS`). El tiempo de espera de Telnyx admite de 0 a 30 s y por defecto no tiene valor ([Voice API Webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks.md)). Si se pone uno, que sea de 10 s o más. |
| Anchor site | `Latency` | El valor por defecto |
| Enable call cost | Encendido | Telnyx manda el costo de cada llamada por webhook. El código lo trata como «otro» evento y lo ignora sin romper nada. |
| Inbound → **SIP subdomain** | Opcional: `tooli-utb-pruebas` | Permite llamar sin número (ver A7, alternativa). Si no se usa, dejarlo vacío. |
| Outbound → **Outbound voice profile** | El de A5 | Sin perfil no hay transferencia |
| Numbers | El número de A7 | Asignación del número a la aplicación |

Al terminar, abrir la aplicación y copiar su **Application ID**: ese es el `TELNYX_CONNECTION_ID`. En el portal actual, el `connection_id` es el ID de la aplicación de voz ([Voice API Fundamentals](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-fundamentals.md)), y los webhooks lo describen como «Call Control App ID (formerly Telnyx connection ID)». En el código, ese valor solo sirve para que el panel muestre «conexión: sí». Ningún comando lo usa.

### A7. Número de Colombia (+57)

**Tipos y precios** ([Numbers Pricing con el selector en Colombia](https://telnyx.com/pricing/numbers); [Colombia virtual phone numbers](https://telnyx.com/phone-numbers/colombia)):

| Tipo | Mensualidad | Llamada entrante (troncal) | Notas |
|---|---|---|---|
| **Local** (fijo de una ciudad) | **desde US$13,50** | **desde US$0,01/min** | Es el recomendado. A la troncal se suman US$0,002/min de Voice API. |
| Toll-free (01 8000) | desde US$15 | desde **US$0,20/min** | La entrante es veinte veces más cara. Pide copia de documento. |
| Móvil | desde US$20 | — | La página de precios lo ofrece, pero la tabla de documentos de Telnyx dice «N/A: no ofrecemos este tipo por ahora». Hay que confirmarlo en el portal. |

Fuentes de las tarifas entrantes: [SIP Trunking Pricing, Colombia](https://telnyx.com/pricing/elastic-sip) y [International Numbers – Required Documents](https://support.telnyx.com/en/articles/5469551-international-numbers-required-documents).

**¿Hay números de Cartagena (605)?** Telnyx no publica su inventario por ciudad. La página pública dice que se puede buscar «por Colombia o por indicativo», pero su buscador pide CAPTCHA, y esta guía no lo resolvió. Hay que buscar en el portal: **Numbers → Search & Buy Numbers**, país Colombia, indicativo `605` o ciudad Cartagena. Si no aparece, un número de Bogotá (601) u otra ciudad sirve igual, porque Telnyx pide una dirección en *cualquier* país y no una de la misma ciudad (ver abajo).

**Requisitos regulatorios exactos para un número local** ([Colombia DID Requirements](https://support.telnyx.com/en/articles/5464069-colombia-did-requirements); [International Numbers – Required Documents](https://support.telnyx.com/en/articles/5469551-international-numbers-required-documents)):

- **A nombre de una persona:** nombre y apellido.
- **A nombre de la UTB:** nombre y apellido de un representante autorizado y razón social.
- **Dirección (en cualquier país):** calle, número, código postal, ciudad y país. No pide que sea de la ciudad del indicativo.
- En la tabla general, Colombia **local = requisitos 1 y 3**: nombre, apellido, empresa y teléfonos de contacto, más la dirección. **No pide subir cédula, RUT ni comprobante de domicilio.**
- **Toll-free sí pide documento:** copia del pasaporte o la cédula para una persona, o certificado de existencia para una empresa.
- **¿Persona o UTB?** Telnyx acepta las dos. Para el piloto es más rápido a nombre de quien maneja la cuenta. Para producción conviene que quede a nombre de la UTB, con su representante. El número pertenece a la cuenta de Telnyx en cualquier caso.
- Los requisitos cambian ([Regulatory Requirements](https://developers.telnyx.com/docs/numbers/phone-numbers/regulatory-requirements.md)). Con la API key se pueden confirmar justo antes de comprar:
  ```bash
  curl -s -g "https://api.telnyx.com/v2/regulatory_requirements?filter[country_code]=CO&filter[phone_number_type]=local&filter[action]=ordering" \
    -H "Authorization: Bearer $TELNYX_API_KEY"
  ```
  Referencia: [Retrieve regulatory requirements](https://developers.telnyx.com/api-reference/regulatory-requirements/retrieve-regulatory-requirements.md).

**Tiempo de aprobación.** Telnyx no publica un plazo para Colombia. Para números internacionales con requisitos dice que el número se compra pero **la entrada de llamadas no se activa hasta verificar la información**, y que eso toma «unos días hábiles». Avisa por correo desde numbering@telnyx.com ([International Numbers – Required Documents](https://support.telnyx.com/en/articles/5469551-international-numbers-required-documents)). Como Colombia no pide documentos, debería ser rápido. Conviene contar con 1 a 3 días hábiles.

**Pasos:**
1. Con la cuenta en nivel **Paid** y saldo cargado: **Numbers → Search & Buy**, Colombia, Local, buscar 605 → agregar al carrito → comprar.
2. Llenar los requisitos (nombre y dirección) en la orden. La dirección se crea como objeto *address* ([Regulatory Requirements](https://developers.telnyx.com/docs/numbers/phone-numbers/regulatory-requirements.md)).
3. Cuando la orden quede aprobada: **Numbers → My Numbers** → el número → *Connection or App* = `tooli-voz`. También se puede asignar en el paso *Numbers* de la aplicación.
4. Guardar el número en formato E.164 (`+57605XXXXXXX`) para `TELNYX_PHONE_NUMBER`. El botón «Probar conexión» lo busca con `GET /v2/phone_numbers?filter[phone_number]=…`.

**Alternativa para probar ya, sin número**

- **Subdominio SIP (recomendada).** En la aplicación, *Inbound → SIP subdomain* = `tooli-utb-pruebas` y *receive settings* = cualquiera (*from anyone*, que es el valor por defecto). Cualquier dispositivo SIP puede llamar a `sip:prueba@tooli-utb-pruebas.sip.telnyx.com` ([Voice API Fundamentals](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-fundamentals.md); esquema `sip_subdomain_receive_settings` en la [API de aplicaciones](https://developers.telnyx.com/api-reference/call-control-applications/create-a-call-control-application.md)).
  - Se llama desde un softphone gratuito como Linphone o Zoiper, con cualquier cuenta SIP.
  - Cuesta lo mismo que una llamada real menos la troncal PSTN. Telnyx publica «SIP interface US$0,002/min» ([Voice API Pricing](https://telnyx.com/pricing/call-control)).
  - Limitaciones:
    - En Trial, la llamada entrante solo se acepta desde el número verificado, así que puede no funcionar hasta Paid.
    - El `from` que llega es una URI SIP, no un teléfono. El panel la mostrará como teléfono, y **no conviene probar por esa vía la verificación por WhatsApp**: el código saca los dígitos del `from`. Sin entre 7 y 15 dígitos, el bot dirá que no ve el número y no dejará la devolución.
    - Al terminar las pruebas, poner *receive settings* en «only my connections», porque cualquiera en internet podría llamar. Los topes de minutos del panel limitan el gasto.
- **Número de EE. UU.** Cuesta US$1 al mes y la entrada US$0,0032/min más US$0,002 de Voice API ([Numbers Pricing](https://telnyx.com/pricing/numbers); [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)). **Pero en Paid, una cuenta de origen colombiano solo compra números locales de Colombia** ([Paid](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities/paid.md)), así que hace falta Verified, y entonces ya no es más rápido. Además, para quien llama desde un celular colombiano es una llamada internacional, que cobra su operador y no Telnyx.
- **WebRTC:** es posible, pero exige credenciales SIP y el SDK de WebRTC. Para una primera prueba es más trabajo que el softphone.

---

## B. Variables del `.env` del VPS y recreación del backend

**Requisitos previos:**
- Que el código de voz esté en `main` y desplegado (PR #40). Hoy `main` no tiene `src/voice/`.
- Antes de ese merge, **`META_APP_SECRET` debe estar puesto en el `.env` del VPS**. El preflight de `integracion` lo exige y, sin él, el CI bloquea todos los despliegues. Si se activa `TOOLI_ACADEMIC_LOOKUP_ENABLED=1`, también exige `TOOLI_ACADEMICO_CLAVE` (ver `CONTINUAR.md`).

1. Entrar al VPS y respaldar el `.env`:
   ```bash
   ssh <usuario>@<ip-del-vps>
   cd ~/tooli-chatbot
   cp .env ".env.respaldo-$(date +%Y%m%d-%H%M%S)"
   openssl rand -hex 24        # 48 caracteres para VOICE_WEBHOOK_KEY
   timedatectl status          # «System clock synchronized: yes» (firma con ventana de 5 min)
   ```
2. Agregar o completar en `~/tooli-chatbot/.env`. Son los nombres exactos de `src/config/index.ts`:
   ```dotenv
   # Línea de voz (Telnyx Call Control v2)
   TELNYX_API_KEY=KEY...                 # A4: portal → API Keys (se muestra una sola vez)
   TELNYX_PUBLIC_KEY=...                 # A4: portal → API Keys → Public Key (base64, 32 bytes)
   TELNYX_CONNECTION_ID=...              # A6: Application ID de «tooli-voz» (solo informativo en el panel)
   TELNYX_PHONE_NUMBER=+57605XXXXXXX     # A7: en E.164 con «+»
   VOICE_WEBHOOK_KEY=<salida de openssl rand -hex 24>   # la misma que va en la Webhook URL de A6
   VOICE_AI_MODEL=gpt-4o-mini            # la IA solo clasifica; usa OPENAI_API_KEY
   ```
   - Sin `TELNYX_API_KEY` **y** `TELNYX_PUBLIC_KEY`, la línea no manda ningún comando y solo funciona el simulador (`credenciales()` en `src/voice/servicio.ts`).
   - Sin `OPENAI_API_KEY` válida, la línea entiende solo por reglas.
   - La Webhook URL de Telnyx y `VOICE_WEBHOOK_KEY` tienen que coincidir carácter por carácter. Si la clave está mal, el backend responde 404 y Telnyx **no reintenta** los 4xx.
3. Recrear **solo** el backend. **`docker compose restart` no vuelve a leer el `env_file`:**
   ```bash
   docker compose up -d --no-deps --no-build backend
   docker compose logs --tail=50 backend
   curl -s https://tooli-utb.duckdns.org/health/deep
   ```
4. Prueba de humo del webhook, sin Telnyx:
   ```bash
   # Clave equivocada → 404 {"error":"not_found"} (si responde HTML, nginx no está pasando /voice al backend)
   curl -s -i -X POST https://tooli-utb.duckdns.org/voice/telnyx/clave-mala-de-prueba-000000 -d '{}' | head -1
   # Clave correcta sin firma → 401 {"error":"firma_invalida"}: la ruta está montada y exige firma
   curl -s -i -X POST "https://tooli-utb.duckdns.org/voice/telnyx/$(grep ^VOICE_WEBHOOK_KEY= .env | cut -d= -f2)" -d '{}' | head -1
   ```
5. En el panel, como admin: **Llamadas → Ajustes**:
   1. **Línea encendida.** Viene apagada (`activo: false` en `AJUSTES_DEFECTO`). Apagada y sin número de desvío, el bot contesta, avisa que la línea no está atendiendo y cuelga. La llamada queda en el registro para devolverla.
   2. **Voz:** por defecto es **Gonzalo** (`Azure.es-CO-GonzaloNeural`, hombre, Colombia). **Jorge** (`Azure.es-MX-JorgeNeural`) está en la lista. Los textos cambian solos a «el asistente» o «la asistente» según la voz (ver E4).
   3. **Número de desvío a asesores:** el +57 del celular que recibe las transferencias.
   4. **Horario de asesores.** Por defecto es lunes a viernes de 8:00 a 18:00 y sábados de 8:00 a 12:00. Fuera del horario no se ofrece la transferencia en vivo.
   5. **Topes.** Por defecto son 120 minutos al día, 1.500 al mes, 10 por llamada, **30 minutos con el asesor** por transferencia y **3 llamadas al día desde un mismo número**. Los minutos con el asesor también cuentan en el cupo. Para el piloto, 120 minutos al día equivalen a unas 30 llamadas de 4 minutos.
   6. **Costo por minuto (US$):** **0,046** en lugar del 0,07 por defecto (ver D). El valor solo sirve para estimar.
   7. **Guardar** → **Probar conexión con Telnyx**. Debe mostrar el saldo y confirmar que el número está en la cuenta.

---

## C. Plan de pruebas por etapas

### C1. Simulador del panel: sin Telnyx y sin costo de telefonía

**Llamadas → Simulador.** Usa el mismo manejador que una llamada real, con un proveedor «grabador» que anota los comandos en lugar de mandarlos (`src/voice/simulador.ts`). Los datos académicos y la agenda son siempre de ejemplo, no gasta cupo y tiene un tope diario (`topeSimulacionesDia`, 60 por defecto).

| # | Qué hacer | Qué esperar |
|---|---|---|
| 1 | **Iniciar llamada simulada** | Saludo con el aviso de transcripción y de retención por 180 días |
| 2 | Escribir «quiero información de la maestría en …» | Respuesta con datos del catálogo, sin inventar fechas |
| 3 | Una pregunta ambigua o lenta | Abajo dice «dijo frase puente» si el turno tardó más de 700 ms |
| 4 | **Silencio** una vez | «¿Sigues ahí? Si necesitas algo, dímelo.» |
| 5 | **Silencio** otra vez | Despedida, **Cuelga** y «llamada terminada» |
| 6 | Nueva llamada → «quiero hablar con un asesor», dentro del horario y con número de desvío | **Transfiere a +57…** |
| 7 | Lo mismo fuera del horario, o sin número de desvío | Ofrece una cita (en el simulador la agenda es de ejemplo; en producción, solo con `AGENDA_ACTIVA=true`) o que le devuelvan la llamada. La devolución aparece en «Devolver la llamada» |
| 8 | Marcar «Llamar desde el número del estudiante de ejemplo» y pedir datos | El código de 6 dígitos aparece como línea de sistema. Al dictarlo, queda verificado |
| 9 | **Registro de llamadas** con «Incluir simuladas» | La llamada aparece con su resultado y su transcripción |

El simulador **no prueba**:
- La interrupción: en el simulador cada frase llega completa, sin resultados parciales.
- Los tiempos reales del silencio: el botón lo dispara a mano.
- La voz, la firma, la transferencia real ni los costos.

**Llamar con voz** (botón junto a *Iniciar llamada simulada*) usa el mismo simulador, pero hablando: el navegador escucha con su reconocimiento de voz y contesta con su voz (`ui/llamada-voz.js`, lógica en `core/llamada-voz.js`). Se acerca más a una llamada: el silencio corre solo a los 6 y 7 s, como `silencioMs`, y con *Puedo interrumpir (uso audífonos)* hablar encima calla al bot. Funciona en **Microsoft Edge** (trae a Gonzalo y a Salomé, las mismas voces de Azure de la línea) o en Chrome, con https o en localhost. Firefox y Safari muestran un aviso y dejan el simulador escrito. Sin audífonos, el micrófono se cierra mientras habla el bot, para que no se oiga a sí mismo. Sigue sin probar la red telefónica ni la voz de Telnyx.

Todo eso queda para C2.

### C2. Primera llamada real

**Preparación:**
1. Cuenta en **Paid** como mínimo, con saldo; perfil de salida con Colombia; aplicación en v2 con el número (o el subdominio SIP) asignado.
2. `.env` y recreación hechos (B), y la prueba de humo devuelve 404 y 401.
3. En el panel: línea encendida, número de desvío y horario que cubra la hora de la prueba.
4. Abrir los registros en otra terminal:
   ```bash
   docker compose logs -f backend | grep '\[voz\]'
   ```
   En producción solo se registran los errores y los webhooks rechazados (`webhook rechazado: firma …`). Las notas de cada evento solo aparecen fuera de producción.

**Lista de chequeo de la primera llamada.** Llamar desde un celular colombiano al número, o desde el softphone a la URI SIP.

- [ ] **Contesta y saluda** en 1 o 2 segundos, con la voz elegida y sin cortes.
- [ ] **¿Suena el aviso en inglés de Telnyx** antes del saludo o de cada frase? Si suena, para el piloto con público hace falta Verified (A2).
- [ ] **Interrumpir al bot** a mitad del saludo hablando encima: debe callarse en menos de 1 segundo y responder a lo que se dijo. Es la ruta `playback_stop` del código; Telnyx documenta que corta `speak` y emite `call.speak.ended` ([Stop audio playback](https://developers.telnyx.com/api-reference/call-commands/stop-audio-playback.md)).
- [ ] **Interrumpir con ruido o eco** (altavoz, o una tos): ¿se corta solo? Si pasa seguido, hay que afinar la interrupción.
- [ ] **Frase puente:** una pregunta que haga pensar a la IA. Primero dice «Claro, déjame revisar…» y luego la respuesta, **sin cortarse**. Telnyx encola los `speak` consecutivos ([Speak text](https://developers.telnyx.com/api-reference/call-commands/speak-text.md)).
- [ ] **Silencio de 6 s:** callar después de que el bot termine. A los ~6 s dice «¿Sigues ahí?».
- [ ] **Silencio de ~15 s:** seguir callado. El código espera **6 s**, dice la frase (unos 2 s) y espera **7 s más** (`silencioMs = [6000, 7000]` en `manejador.ts`), así que a los ~15 s se despide y cuelga.
- [ ] **Pedir asesor** («quiero hablar con una persona»): avisa que transfiere y suena el celular de desvío. El identificador que ve el asesor es **el número de la línea**, porque `transfer` sin `from` usa el `to` de la llamada original ([Transfer call](https://developers.telnyx.com/api-reference/call-commands/transfer-call.md)).
- [ ] **Hablar un minuto con el asesor:** el bot no debe meterse ni colgar a los ~15 s. El código detiene la transcripción y marca la llamada como transferida antes del `transfer` (E1).
- [ ] **Asesor que no contesta:** dejar timbrar. El bot pide 20 s de timbre (`timeout_secs: 20`, antes de que conteste el buzón de voz del celular; Telnyx usa 30 por defecto) y luego Telnyx cuelga ese tramo, pero la llamada original sigue viva ([Transfer call](https://developers.telnyx.com/api-reference/call-commands/transfer-call.md)). Con el buzón de voz del celular del asesor activo, comprobar que el bot retoma antes de que conteste el buzón. El bot debe retomar: dice que el asesor no pudo contestar, vuelve a escuchar y deja la devolución en «Devolver la llamada». Si quien llama se queda en silencio, el evento de la pata saliente no trajo el `client_state` (E2, por confirmar).
- [ ] **El asesor cuelga primero:** ¿se corta también la llamada de quien llamó, o queda abierta? Anotarlo (por confirmar en vivo).
- [ ] **Línea apagada:** apagar la línea en el panel, quitar el número de desvío y llamar. Debe contestar, dar el aviso y colgar.
- [ ] **Datos dictados:** decir un número largo («uno dos tres cuatro cinco seis», o una cédula). En **Llamadas → Registro de llamadas** → abrir la llamada, esa línea debe verse como `[dígitos]` o `[código estudiantil]`. `taparDatosDictados` tapa rachas de 4 dígitos o más.
- [ ] **Colgar** y revisar en el registro la duración, el resultado (`transferida`, `consulta`, `silencio`…) y el costo estimado.
- [ ] **Costo real en el portal:** **Reporting → Detail Records**. Hay registros de *Voice API (Call Control)*, de *Real time transcription* y de la troncal SIP por separado ([Reporting Overview](https://support.telnyx.com/en/articles/4305547-reporting-overview); [Understanding Telnyx CDR](https://support.telnyx.com/en/articles/1130662-understanding-telnyx-cdr)). Anotar el costo por minuto real, **sobre todo el de la voz Azure, que Telnyx no publica** (E5), y ajustar «Costo por minuto» en el panel.
- [ ] **Entregas de webhooks sin fallos:** sin 401 ni 404. Se puede revisar con `GET /v2/webhook_deliveries?filter[status][eq]=failed` ([Voice API Webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks.md)).

### C3. Antes del piloto con público

- [ ] Que los tres puntos «Por confirmar en vivo» de la sección E salgan bien en la lista C2. Si alguno falla, corregirlo y repetir la lista.
- [ ] Cuenta en **Verified** si el aviso en inglés suena en las llamadas entrantes.
- [ ] Decidir entre Gonzalo y Jorge, y si «Tooli» se pronuncia «Túli». El léxico de `src/voice/texto.ts` no tiene esa regla.
- [ ] Bajar el límite diario de gasto del perfil de salida a lo que el piloto justifique, y revisar los topes del panel.

---

## D. Costos

**Supuestos:**
- 300 llamadas al mes de 4 minutos con el bot, es decir **1.200 minutos**.
- 30 llamadas transferidas, con **5 minutos de asesor** cada una.
- El bot habla cerca de la mitad de la llamada. Telnyx calcula que 5 millones de caracteres son unos 6.700 minutos hablados, unos 750 caracteres por minuto ([TTS Pricing](https://telnyx.com/pricing/text-to-speech)). Eso da **unos 1.500 caracteres por llamada**, unos **450.000 al mes**.
- Número local de Colombia y grabación apagada (`grabar: false` por defecto).

| Concepto | Tarifa (fuente) | Cálculo | US$/mes |
|---|---|---|---|
| Número local Colombia | desde US$13,50/mes ([Numbers Pricing, CO](https://telnyx.com/pricing/numbers)) | 1 | **13,50** |
| Minutos entrantes con el bot | US$0,002 Voice API + US$0,01 troncal CO = US$0,012/min ([Voice API Pricing](https://telnyx.com/pricing/call-control); [SIP Trunking, CO](https://telnyx.com/pricing/elastic-sip)) | 1.200 × 0,012 | **14,40** |
| Transcripción (Google STT) | US$0,017/min ([STT Pricing](https://telnyx.com/pricing/speech-to-text)) | 1.200 × 0,017 | **20,40** |
| Voz (TTS) | Polly Neural US$0,000024/carácter; Telnyx Ultra US$0,000032; «Telnyx HD Voices» US$0,000048 ([TTS Pricing](https://telnyx.com/pricing/text-to-speech)). **Azure Neural estándar no tiene tarifa publicada.** Azure HD costaba US$0,000045 en 2025 ([nota de Telnyx](https://telnyx.com/release-notes/azure-neural-hd-voices-telnyx-tts)) y hoy figura como «BYO API key» | 450.000 × 0,000024 a 0,000048 | **10,80 a 21,60** |
| Transferencias (cargo fijo) | US$0,10 por invocación ([Voice API Pricing](https://telnyx.com/pricing/call-control)) | 30 × 0,10 | **3,00** |
| Tramo saliente a celular CO | US$0,0125 + US$0,002 = US$0,0145/min ([SIP Trunking, CO](https://telnyx.com/pricing/elastic-sip)) | 150 × 0,0145 | **2,18** |
| Tramo entrante mientras habla el asesor | US$0,012/min | 150 × 0,012 | **1,80** |
| **Total** | | | **≈ 66 a 77** (≈ COP 264.000 a 308.000 a 4.000 por dólar, la tasa que usa el panel) |

Ya no se paga transcripción durante la charla con el asesor: el código la detiene antes de transferir (E1).

- **Costo variable por minuto con el bot, sin el número:** US$0,038 con Polly Neural, US$0,046 con una voz de US$0,000045 por carácter (Azure, supuesto). Por eso se sugiere **0,046** en «Costo por minuto» y no el 0,07 por defecto, que sobreestima cerca de un 50 %. El estimado del panel no suma los US$0,10 de cada transferencia.
- **No incluido:**
  - OpenAI (`gpt-4o-mini`, solo para clasificar), que se factura aparte.
  - Impuestos y recargos del banco.
  - El redondeo por minuto: si Telnyx cobra por minuto iniciado, como supone `billedMinutes`, el promedio sube unos 0,5 minutos por llamada, unos US$4 más al mes.
- **Opción más barata de transcripción:** Deepgram Nova‑3 a US$0,005/min, con español latinoamericano `es-419` y resultados parciales ([STT Pricing](https://telnyx.com/pricing/speech-to-text); [Transcription start](https://developers.telnyx.com/api-reference/call-commands/transcription-start.md)). Ahorraría unos US$14 al mes, pero exige cambiar el código (E12).

---

## E. Lo que no coincidía entre el código y Telnyx

Estado al 23 de noviembre de 2026, con la rama `integracion`. Cada punto dice si quedó **corregido** o sigue **abierto**.

### Por confirmar en vivo

Ninguna prueba local puede confirmar estos tres comportamientos de Telnyx. La lista C2 los cubre:

1. **Que los eventos de la pata saliente traigan el `client_state` de la llamada.** El `transfer` manda `target_leg_client_state` para atar la pata del asesor a la llamada original. Si Telnyx no lo repite en `call.answered` o `call.hangup` de esa pata, el bot no sabrá que el asesor no contestó (E2).
2. **El plazo de espera del webhook.** El código responde en 5 s como máximo. Telnyx no publica cuánto espera por defecto (E3).
3. **Qué pasa cuando el asesor cuelga primero**: si Telnyx corta también la llamada de quien llamó o la deja abierta.

### Graves: corregidos

**E1. La transcripción seguía después de transferir. Corregido.**
- Telnyx detiene la transcripción **solo al colgar o con `transcription_stop`** ([Transcription start](https://developers.telnyx.com/api-reference/call-commands/transcription-start.md)).
- Ahora `transferir` (`manejador.ts`) marca primero la llamada como transferida, así lo que llegue después no dispara turnos ni silencios. Luego manda `transcription_stop` y transfiere con un tope de duración (`maxMinutosTransferencia`, 30 min por defecto). Telnyx deja hasta 4 horas si no se le pone tope.

**E2. La transferencia fallida no se manejaba. Corregido, por confirmar en vivo.**
- Si el asesor no contesta, Telnyx manda `call.hangup` **del tramo B** y deja la llamada original activa para más comandos ([Transfer call](https://developers.telnyx.com/api-reference/call-commands/transfer-call.md)).
- Ahora el `transfer` ata la pata saliente con `target_leg_client_state`. Si el asesor no contesta, da ocupado o el `transfer` falla, el bot retoma la llamada, lo dice y deja la devolución en la cola del panel.
- Falta confirmar en la primera llamada que Telnyx repite ese `client_state` en los eventos de la pata.

**E3. Responder 200 antes de procesar anulaba los reintentos. Corregido.**
- Telnyx reintenta solo ante un **5xx, un 408 o 429, o la falta de respuesta**. Un 2xx cuenta como entregado, y los otros 4xx no se reintentan ([Voice API Webhooks, Response codes](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks.md)).
- Ahora `voiceWebhook.ts` procesa el evento antes de responder: 200 si salió bien y **500 si falló, para que Telnyx reintente**. Si pasan 5 s, responde 202 y sigue en segundo plano.
- Si se pierde un `call.hangup`, un barrido consulta la llamada en Telnyx (`GET /v2/calls/{id}`) y la cierra.
- Los turnos con efectos (transferir, colgar, dejar una devolución) se aplican siempre, aunque llegue un evento nuevo en medio.

### Medias

**E4. La voz. Corregido.**
- La voz por defecto ahora es **Gonzalo** (`Azure.es-CO-GonzaloNeural`), porque a Manuel no le gustó Salomé. **Jorge** (`Azure.es-MX-JorgeNeural`, la voz que le gustó en Edge) está en `VOCES`, y Salomé sigue en la lista.
- Los textos cuadran con el género de la voz: «el asistente virtual» o «la asistente virtual» (`asistenteVirtual` en `dialogo.ts`), y el panel dice «Nombre del asistente virtual».
- Otras voces masculinas que existen en Azure ([Microsoft, language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)) y que Telnyx acepta por formato: `Azure.es-MX-JorgeMultilingualNeural`, `Azure.es-MX-CecilioNeural`, `Azure.es-MX-GerardoNeural` y `Azure.es-MX-LibertoNeural`. En Polly: `AWS.Polly.Pedro-Neural` (ya en `VOCES`) y `AWS.Polly.Andres-Neural` ([AWS Polly voices](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html)).
- Para ver lo que realmente acepta la cuenta:
  ```bash
  curl -s "https://api.telnyx.com/v2/text-to-speech/voices?provider=azure" -H "Authorization: Bearer $TELNYX_API_KEY" \
    | jq '.voices[] | select(.language|startswith("es")) | {voice_id, gender}'
  ```
  Repetir con `provider=telnyx` y `provider=aws` ([List available voices](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices.md)).

**E5. Precio de la voz Azure. Abierto.**
- La tabla actual de Telnyx no trae línea para Azure Neural estándar. Solo aparece «Azure Neural HD TTS: BYO API key (billed by Azure)» ([Voice API Pricing](https://telnyx.com/pricing/call-control)).
- La nota de 2025 cobraba Azure HD a US$0,000045 por carácter. El costo de Gonzalo o Jorge se confirma con el primer registro de costos (C2).
- Si Telnyx pidiera una llave propia de Azure, se pasa con `voice_settings` (`type: azure`, `api_key_ref`, `region`). El código no lo envía.

**E6. `call.hangup` no trae `end_time`. Corregido.**
- El esquema actual tiene `start_time` pero **no `end_time`** ([esquema `CallHangup`](https://developers.telnyx.com/api-reference/callbacks/call-hangup.md)).
- Ahora `parseTelnyxEvent` calcula la duración con `occurred_at − start_time`. Si algún día llega `end_time`, usa ese. La duración que factura Telnyx sigue saliendo de los registros de costos.

**E7. Línea apagada y sin desvío: la llamada solo timbraba. Corregido.**
- Ahora contesta, dice que la línea no está atendiendo y cuelga. La llamada queda en el registro como `linea_apagada`, sin gastar cupo, para devolverla.

**E8. Configuración de Telnyx que el código da por hecha** (no es un error del código):
- El perfil de salida debe incluir **CO**; por defecto solo trae US y CA (A5).
- La aplicación debe usar los webhooks **v2**; si se crea por API, el valor por defecto es `"1"` (A6).

### Menores o de documentación

**E9. Nombre de la sección de la clave pública. Corregido.** `.env.example` y `signature.ts` decían «Keys & Credentials → Public Key». En el portal actual es **API Keys → Public Key** ([portal.telnyx.com/#/api-keys/public-key](https://portal.telnyx.com/#/api-keys/public-key)).

**E10. El idioma del `speak`. Corregido.** El `language` del `speak` solo admite `es-ES`, `es-MX` y `es-US`. Ahora `leerAjustes` rechaza cualquier otro valor (`IDIOMAS_SPEAK`). La transcripción recorta a `es`, que es válido.

**E11. Transcripción. Abierto (mejora).**
- `transcription_engine: 'Google'` con `language: 'es'` e `interim_results: true` es válido ([Transcription start](https://developers.telnyx.com/api-reference/call-commands/transcription-start.md)). Los parciales llegan en `transcription_data.is_final = false`, que es justo lo que lee el código.
- El español de Google es genérico: no tiene variante para Colombia.
- Para mejorar sin cambiar de motor: `model` (`latest_short` o `phone_call`), `hints` o `speech_context` con nombres de programas y «UTB». Hoy el código no los envía.

**E12. Alternativa Deepgram. Abierto (mejora).** `Deepgram` con `deepgram/nova-3` y `language: 'es-419'` cuesta menos de un tercio que Google y también da parciales. Exige cambiar `listenBody`.

**E13. El issue #36 se queda corto o se equivoca en dos puntos:**
- Dice que el número pide cédula, comprobante de dirección o RUT. Para un número **local** Telnyx pide solo nombre y dirección; los documentos son para el **toll-free** (A7).
- Los US$20 iniciales alcanzan con poco margen (A3).

**E14. Lo que `VOZ_PROGRESO.md` marcaba como «sin probar» y la documentación confirma:**

| Punto de `VOZ_PROGRESO.md` | Lo que dice Telnyx |
|---|---|
| `playback_stop` corta un `speak` | Lo corta y emite `call.speak.ended` |
| Un `speak` sin `stop` se encola | «audio files will be placed in a queue» |
| Los parciales del motor Google | Existen con `interim_results` |
| `command_id` evita comandos duplicados | Se ignoran los repetidos durante 60 s ([Receiving Webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/receiving-webhooks.md)) |
| Cabeceras y contenido de la firma | Coinciden con el código |

Sigue sin documentarse si `playback_stop` con `stop: all` emite un `call.speak.ended` por cada frase en cola o uno solo. De eso depende el contador `puentes`.

**E15.** `TELNYX_CONNECTION_ID` no lo usa ningún comando: Call Control identifica la llamada con `call_control_id`. Basta con que esté puesto para que el panel muestre «conexión: sí».

---

## Fuentes (consultadas el 23 nov 2026)

**Cuenta y pagos**
- Niveles de cuenta: [índice](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities.md), [Trial](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities/trial.md), [Paid](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities/paid.md), [Verified](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities/verified.md) y [Account Upgrade](https://developers.telnyx.com/docs/account-setup/account-upgrade.md)
- Registro: [Account Signup](https://developers.telnyx.com/docs/account-setup/signup.md) y [Create Account](https://developers.telnyx.com/docs/account-setup/create-account.md)
- Soporte: [Account Verification (L1/L2)](https://support.telnyx.com/en/articles/1130595-account-verification), [Ordering Restrictions](https://support.telnyx.com/en/articles/10715715-phone-number-ordering-restrictions), [Pretrial Accounts](https://support.telnyx.com/en/articles/14327893-telnyx-pretrial-accounts) y [Billing Setup](https://support.telnyx.com/en/articles/4280500-billing-setup-billing-groups)

**Números**
- Colombia: [Colombia DID Requirements](https://support.telnyx.com/en/articles/5464069-colombia-did-requirements), [International Numbers – Required Documents](https://support.telnyx.com/en/articles/5469551-international-numbers-required-documents) y [Colombia virtual phone numbers](https://telnyx.com/phone-numbers/colombia)
- Requisitos: [Regulatory Requirements](https://developers.telnyx.com/docs/numbers/phone-numbers/regulatory-requirements.md) y [API regulatory_requirements](https://developers.telnyx.com/api-reference/regulatory-requirements/retrieve-regulatory-requirements.md)

**Precios** (los de números y troncal, consultados con el selector de país en Colombia)
- [Numbers](https://telnyx.com/pricing/numbers), [SIP Trunking](https://telnyx.com/pricing/elastic-sip), [Voice API](https://telnyx.com/pricing/call-control), [Text-to-Speech](https://telnyx.com/pricing/text-to-speech) y [Speech-to-Text](https://telnyx.com/pricing/speech-to-text)
- [Azure Neural HD en Telnyx (nota de 2025)](https://telnyx.com/release-notes/azure-neural-hd-voices-telnyx-tts)

**Voice API: configuración y webhooks**
- [Voice API Fundamentals](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-fundamentals.md), [Getting Started](https://developers.telnyx.com/docs/voice/programmable-voice/get-started.md) y [API de aplicaciones](https://developers.telnyx.com/api-reference/call-control-applications/create-a-call-control-application.md)
- [Voice API Webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks.md), [Receiving Webhooks (voz)](https://developers.telnyx.com/docs/voice/programmable-voice/receiving-webhooks.md), [Webhook fundamentals](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks.md) y [verificación en telnyx-node](https://github.com/team-telnyx/telnyx-node/blob/master/src/lib/webhooks.ts)
- [Create and manage API keys](https://developers.telnyx.com/docs/development/api-fundamentals/create-api-keys.md)

**Comandos y eventos**
- [Speak text](https://developers.telnyx.com/api-reference/call-commands/speak-text.md), [Stop audio playback](https://developers.telnyx.com/api-reference/call-commands/stop-audio-playback.md), [Transcription start](https://developers.telnyx.com/api-reference/call-commands/transcription-start.md), [Transfer call](https://developers.telnyx.com/api-reference/call-commands/transfer-call.md) y [Call hangup](https://developers.telnyx.com/api-reference/callbacks/call-hangup.md)
- [Outbound Voice Profiles (soporte)](https://support.telnyx.com/en/articles/4320411-outbound-voice-profiles), [Outbound Voice Profiles (docs)](https://developers.telnyx.com/docs/voice/outbound-voice-profiles.md) y [API de perfiles](https://developers.telnyx.com/api-reference/outbound-voice-profiles/create-an-outbound-voice-profile.md)

**Voces**
- [Text-to-Speech](https://developers.telnyx.com/docs/voice/programmable-voice/tts), [Telnyx Ultra](https://developers.telnyx.com/docs/voice/tts/providers/telnyx/naturalhd.md) y [List available voices](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices.md)
- Catálogos de los proveedores: [Microsoft (Azure)](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts) y [AWS Polly](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html)

**Reportes**
- [Reporting Overview](https://support.telnyx.com/en/articles/4305547-reporting-overview) y [Understanding Telnyx CDR](https://support.telnyx.com/en/articles/1130662-understanding-telnyx-cdr)
