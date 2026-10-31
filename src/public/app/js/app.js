/* Punto de entrada del panel de asesores.
 *
 * Antes todo el panel vivía en un único <script> de ~3.800 líneas dentro de
 * index.html. Ahora cada pantalla es un módulo propio y este archivo es lo
 * único que las conoce a todas: las registra en el router y arranca la app.
 *
 * Orden de dependencias (siempre en un sentido, sin ciclos):
 *   app.js → screens/* → ui/* → core/*
 */

import { init, registrarPantallas } from './core/router.js';
import './core/shortcuts.js';   // atajos de teclado (módulo de solo efecto)
import './core/offline.js';     // banda "sin conexión" + service worker

import { renderHome } from './screens/home.js';
import { renderTurno } from './screens/turno.js';
import { renderRecibo } from './screens/recibo.js';
import { renderMetricas } from './screens/metricas.js';
import { renderConversaciones } from './screens/conversaciones.js';
import { renderAtencion } from './screens/atencion.js';
import { renderPosgrados } from './screens/posgrados.js';
import { renderRegistros } from './screens/registros.js';
import { renderEventoPosgrado } from './screens/evento.js';
import { renderRecordatorios } from './screens/recordatorios.js';
import { renderHealth } from './screens/health.js';
import { renderUsuarios } from './screens/usuarios.js';
import { renderActividad } from './screens/actividad.js';
import { renderInformes } from './screens/informes.js';

registrarPantallas({
  home: renderHome,
  turno: renderTurno,
  recibo: renderRecibo,
  metricas: renderMetricas,
  conversaciones: renderConversaciones,
  atencion: renderAtencion,
  posgrados: renderPosgrados,
  registros: renderRegistros,
  'evento-posgrado': renderEventoPosgrado,
  recordatorios: renderRecordatorios,
  health: renderHealth,
  usuarios: renderUsuarios,
  actividad: renderActividad,
  informes: renderInformes,
});

init();
