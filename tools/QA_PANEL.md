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

`qa-panel-actions.cjs` recorre formularios y acciones de turno, recibo, recordatorios, conversaciones, CRM, evento, usuarios, revisión de mensajes e inicio y cierre de sesión. También comprueba cambios de pantalla mientras siguen pendientes consultas de turno, recibo, conversaciones y salud. El mock mantiene cambios en memoria; reiniciarlo antes de repetir esta prueba para recuperar sus datos iniciales.

`qa-panel-navigation.cjs` retrasa las respuestas locales y cambia de sección durante la carga de diez pantallas. `qa-panel-all.cjs` verifica las doce pantallas a 375, 800 y 1280 píxeles y guarda capturas en `tmp/`.

Estas pruebas usan respuestas sintéticas. La descarga PDF de prueba contiene un archivo mínimo; no entra al portal Iceberg. Tampoco envían WhatsApp, consultan Google Sheets, operan Chatwoot real ni verifican el despliegue del VPS. Esas integraciones requieren las credenciales y el entorno de ensayo indicados en `PRODUCCION_SEGURIDAD.md`.
