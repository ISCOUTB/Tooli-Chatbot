# Verificación local del panel

Desde la raíz del repositorio, iniciar el servidor de datos sintéticos:

```powershell
node tools/mock-panel-server.cjs
```

En otra terminal, ejecutar:

```powershell
node tools/qa-panel-actions.cjs
node tools/qa-panel-navigation.cjs
node tools/qa-panel-all.cjs
node tools/qa-panel-atencion-movil.cjs
node tools/qa-panel-ficha.cjs
node tools/qa-panel-voz-agenda.cjs
node tools/qa-panel-probar-bot.cjs
npm run lint
npm run build
npm test
```

`qa-panel-actions.cjs` recorre formularios y acciones de turno, recibo, recordatorios, conversaciones, CRM, selección y broadcast con plantilla sintética, evento, rangos de métricas, usuarios, revisión de mensajes e inicio y cierre de sesión. También comprueba cambios de pantalla mientras siguen pendientes consultas de turno, recibo, conversaciones y salud. El mock mantiene cambios en memoria; reiniciarlo antes de repetir esta prueba para recuperar sus datos iniciales.

`qa-panel-navigation.cjs` retrasa las respuestas locales y cambia de sección durante la carga de once pantallas. `qa-panel-all.cjs` verifica las diecisiete pantallas, Llamadas y Agenda incluidas, a 320, 375, 800 y 1280 píxeles y guarda capturas en `tmp/`. Además del desbordamiento del documento, detecta contenido recortado dentro del panel; en Recordatorios comprueba los controles del formulario y que el aviso oculto no deje una franja vacía.

`qa-panel-atencion-movil.cjs` abre una conversación de Atención a 320, 375, 768 y 812 píxeles con pantalla táctil emulada. Mide que el hilo cubra la pantalla, que los mensajes ocupen al menos 65 % del alto a 375x812, que no haya desbordes, que cada ícono quede centrado en un botón de 44 píxeles y que la hoja Detalles conserve foco, Esc y `aria-expanded`. Después recorre asesor, equipo, etiquetas, nota privada, adjunto, Macros, Pendiente, Resolver, Historial, conversaciones resueltas y datos largos. Crea sus propias conversaciones, así que no exige reiniciar el mock. La emulación no abre un teclado real ni reproduce las barras de Safari: `--kb` se prueba con un `visualViewport` fingido.

`qa-panel-ficha.cjs` revisa la ficha de la persona en Atención a 1440, 1100, 375 y 320 píxeles: que en pantallas anchas vaya al lado del chat sin tapar el nombre, que en las angostas se abra encima sin tapar Resolver y que en el celular salga de Detalles a pantalla completa. Recorre el resumen con IA y *Actualizar*, el aviso de 24 horas, el rechazo de texto libre fuera de la ventana y el envío de una plantilla desde el chat: solo aprobadas, datos que vienen llenos, aviso de campañas, envío repetido y nota privada. Con `QA_CAPTURAS=<carpeta>` guarda capturas. Envía plantillas al mock, así que conviene reiniciarlo antes de repetirla.

`qa-panel-voz-agenda.cjs` revisa Llamadas y Agenda a 375, 800 y 1280 píxeles: que la barra de pestañas del celular no tape la línea de estado del simulador, que una cita sin nombre diga «Sin nombre · ****0101», que «Marcar devuelta» abra el diálogo propio del panel (foco, Tab, Escape y envío) y no `window.prompt`, y que no haya desbordes ni botones de menos de 44 píxeles. Marca una devolución como hecha, así que conviene reiniciar el mock antes de repetirla. Con `QA_CAPTURAS=<carpeta>` guarda capturas.

El flujo de acciones comprueba que Recordatorios advierta según la **hora programada** cuando el adaptador es Meta, y que un teléfono mal formado llegue al validador del servidor sin perder caracteres. También comprueba que Conversaciones conserve el borrador cuando Meta rechaza texto libre sin un mensaje entrante reciente verificable. Posgrados muestra la conversión como no disponible si faltan eventos de inicio, y explica los gráficos de programas sin datos.

En CRM, actualizar el Sheet borra una selección activa: el orden de las filas puede cambiar y una posición anterior no identifica al mismo destinatario. La barra de broadcast muestra números únicos y separa los contactos sin WhatsApp válido de los números repetidos. `qa-panel-actions.cjs` simula un reordenamiento y comprueba que no se pueda enviar con la selección antigua.

`qa-panel-probar-bot.cjs` revisa el simulador de WhatsApp («Probar el bot») a 320, 375, 800 y 1280 píxeles: enviar con Enter, la lista desplegable (foco atrapado, Escape, flechas y Enviar), los botones de respuesta rápida, la imagen, las palomitas que pasan a azul, las notas de prueba, que el chat no baje solo si se subió a leer y «Empezar de nuevo», además de desbordes y botones de menos de 44 píxeles. El mock tarda `MOCK_SIM_ESPERA_MS` (1.200 ms por defecto) en responder, para poder ver el «escribiendo…». Con `QA_CAPTURAS=<carpeta>` guarda capturas. Detalles del simulador: `docs/simulador-whatsapp.md`.

Para comprobar el rol asesor, detener el mock e iniciarlo en PowerShell con:

```powershell
$env:MOCK_ROL = 'asesor'
node tools/mock-panel-server.cjs
```

En otra terminal, ejecutar `node tools/qa-panel-asesor.cjs`. La prueba confirma que el asesor sí tiene la selección para enviar plantillas y que las rutas administrativas redirigen a Inicio.

Estas pruebas usan respuestas sintéticas. La descarga PDF de prueba contiene un archivo mínimo; no entra al portal Iceberg. El trabajo de broadcast simulado marca destinatarios como enviados sin llamar a Meta. Las pruebas tampoco envían WhatsApp, consultan Google Sheets, operan Chatwoot real ni verifican el despliegue del VPS. Esas integraciones requieren las credenciales y el entorno de ensayo indicados en `docs/produccion-seguridad.md`.

Por defecto, los scripts usan Chromium instalado por Playwright (`npx playwright install chromium`). Para otro navegador, define `QA_BROWSER_EXECUTABLE` con su ruta.
