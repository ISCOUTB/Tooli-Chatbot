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
npm run lint
npm run build
npm test
```

`qa-panel-actions.cjs` recorre formularios y acciones de turno, recibo, recordatorios, conversaciones, CRM, selección y broadcast con plantilla sintética, evento, rangos de métricas, usuarios, revisión de mensajes e inicio y cierre de sesión. También comprueba cambios de pantalla mientras siguen pendientes consultas de turno, recibo, conversaciones y salud. El mock mantiene cambios en memoria; reiniciarlo antes de repetir esta prueba para recuperar sus datos iniciales.

`qa-panel-navigation.cjs` retrasa las respuestas locales y cambia de sección durante la carga de diez pantallas. `qa-panel-all.cjs` verifica las doce pantallas a 320, 375, 800 y 1280 píxeles y guarda capturas en `tmp/`. Además del desbordamiento del documento, detecta contenido recortado dentro del panel; en Recordatorios comprueba los controles del formulario y que el aviso oculto no deje una franja vacía.

El flujo de acciones comprueba que Recordatorios advierta según la **hora programada** cuando el adaptador es Meta, y que un teléfono mal formado llegue al validador del servidor sin perder caracteres. También comprueba que Conversaciones conserve el borrador cuando Meta rechaza texto libre sin un mensaje entrante reciente verificable. Posgrados muestra la conversión como no disponible si faltan eventos de inicio, y explica los gráficos de programas sin datos.

En CRM, actualizar el Sheet borra una selección activa: el orden de las filas puede cambiar y una posición anterior no identifica al mismo destinatario. La barra de broadcast muestra números únicos y separa los contactos sin WhatsApp válido de los números repetidos. `qa-panel-actions.cjs` simula un reordenamiento y comprueba que no se pueda enviar con la selección antigua.

Para comprobar el rol asesor, detener el mock e iniciarlo en PowerShell con:

```powershell
$env:MOCK_ROL = 'asesor'
node tools/mock-panel-server.cjs
```

En otra terminal, ejecutar `node tools/qa-panel-asesor.cjs`. La prueba confirma que no aparece la selección de broadcast y que las rutas administrativas redirigen a Inicio.

Estas pruebas usan respuestas sintéticas. La descarga PDF de prueba contiene un archivo mínimo; no entra al portal Iceberg. El trabajo de broadcast simulado marca destinatarios como enviados sin llamar a Meta. Las pruebas tampoco envían WhatsApp, consultan Google Sheets, operan Chatwoot real ni verifican el despliegue del VPS. Esas integraciones requieren las credenciales y el entorno de ensayo indicados en `PRODUCCION_SEGURIDAD.md`.

Por defecto, los scripts usan Chromium instalado por Playwright (`npx playwright install chromium`). Para otro navegador, define `QA_BROWSER_EXECUTABLE` con su ruta.
