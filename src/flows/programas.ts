import { setSession } from '../services/session';
import { FlowContext, messaging, sendMenu, sendMenuPosgrado } from './shared';
import { parseGlobalCommand } from './commands';
import { track } from '../services/metrics';
import {
  AREAS,
  formatearSugerencias,
  parseAreaSeleccion,
  recomendarPorArea,
} from './programasCatalog';

// ── Textos informativos (sin opciones numéricas) ──────────────────────────────

const ESPECIALIZACIONES_INFO =
  '📚 *Especializaciones UTB*\n' +
  '_Duración: 2 semestres — Inscripción: $247.000_\n\n' +
  '• Telecomunicaciones y Redes — $10.2M/sem\n' +
  '• Logística del Transporte — $9.8M/sem\n' +
  '• Gestión Ambiental Sostenible — $9.8M/sem\n' +
  '• Sistemas Energéticos Sostenibles — $11.2M/sem\n' +
  '• Automatización Industrial — $11.2M/sem\n' +
  '• Gerencia de Proyectos — $12.5M/sem\n' +
  '• Análisis y Diseño Estructural — $13M/sem\n' +
  '• Ingeniería de Software _(virtual)_ — $8.3M/sem\n' +
  '• Gerencia de Servicios de Salud _(virtual)_ — $7.95M/sem\n' +
  '• Educación Mediada por TIC _(virtual)_ — $6.95M/sem';

const MAESTRIAS_INFO =
  '🎓 *Maestrías UTB*\n' +
  '_Duración: 3-4 semestres — Inscripción: $284.000_\n\n' +
  '• Gestión de la Innovación — $9.8M/sem · 4 sem\n' +
  '• Ingeniería — $10.95M/sem · 4 sem\n' +
  '• Gerencia de Proyectos — $13.4M/sem · 4 sem\n' +
  '• *MBA* — $17.9M/sem · 3 sem\n' +
  '• Gerencia Tributaria — $10.95M/sem · 3 sem\n' +
  '• *Ciberseguridad* — $13M/sem · 3 sem\n' +
  '• Educación Mediada por TIC _(virtual)_ — $6.95M/sem · 3 sem';

const DOCTORADOS_INFO =
  '🔬 *Doctorados UTB*\n' +
  '_Duración: 8 semestres — Investigación avanzada_\n\n' +
  '• Doctorado en Ingeniería — 8 SMMLV/sem\n' +
  '• Doctorado en Desarrollo Regional y Local — $15.1M/sem\n' +
  '• Doctorado en Sostenibilidad — $12.3M/sem\n\n' +
  '_Requisito: título de maestría o pregrado con alto promedio._';

// ── Helper: muestra el selector de categoría como lista interactiva ───────────

export async function sendCategoriasMenu(to: string): Promise<void> {
  await messaging.sendList({
    to,
    title: '🎓 Programas de Posgrado UTB',
    description: '¿Qué tipo de programa te interesa?',
    footer: 'Escribe menu para volver al inicio',
    buttonText: 'Ver categorías',
    sections: [
      {
        title: 'Tipo de programa',
        rows: [
          { id: '1', title: '📚 Especializaciones', description: '2 semestres · Presencial y virtual' },
          { id: '2', title: '🎓 Maestrías',          description: '3-4 semestres · Presencial y virtual' },
          { id: '3', title: '🔬 Doctorados',          description: '8 semestres · Investigación avanzada' },
          { id: '4', title: '🧭 Ayúdame a elegir',    description: 'Te sugiero según tu área profesional' },
        ],
      },
    ],
  });
}

// ── Helper: lista de áreas profesionales (subpaso de "Ayúdame a elegir") ──────
// El subpaso vive en `session.data` ({ modo: 'ayuda', fase: 'areas' }): los
// estados siguen siendo `programas_categoria` / `programas_detalle` y el
// índice de flujos no se toca.

async function sendAreasMenu(to: string): Promise<void> {
  await messaging.sendList({
    to,
    title: '🧭 Ayúdame a elegir',
    description: '¿En qué área te mueves? Te sugiero programas reales.',
    footer: 'Escribe 0 para volver',
    buttonText: 'Ver áreas',
    sections: [
      {
        title: 'Áreas profesionales',
        rows: AREAS.map((area, i) => ({
          id: String(i + 1),
          title: area.titulo,
          description: area.descripcion,
        })),
      },
    ],
  });
}

// ── Helper: botones de acción tras ver el detalle de un programa ─────────────

async function sendAccionesDetalle(to: string): Promise<void> {
  await messaging.sendButtons({
    to,
    title: '¿Qué quieres hacer?',
    description: 'Elige una opción para continuar',
    buttons: [
      { id: '1', displayText: '🤖 Preguntar a la IA' },
      { id: '2', displayText: '👤 Hablar con asesor' },
      { id: '3', displayText: '🔙 Otros programas' },
    ],
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/** Paso 1: el usuario elige categoría (o pide ayuda para elegir) */
export async function handleProgramasCategoria(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim();
  const data = session?.data ?? {};

  // Comandos globales: "volver" (y "0") → menú de Posgrado; "menu"/"salir" → raíz.
  const comando = parseGlobalCommand(text);
  if (comando === 'volver' || input === '0') {
    await setSession(from, { step: 'menu_posgrado', data: {} });
    await sendMenuPosgrado(from);
    return;
  }
  if (comando === 'menu' || comando === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  // Subpaso de orientación: el usuario está eligiendo área profesional.
  if (data.modo === 'ayuda') {
    const areaId = parseAreaSeleccion(input);
    const texto = areaId ? formatearSugerencias(areaId) : null;
    if (!areaId || !texto) {
      await messaging.sendText({
        to: from,
        text:
          'No reconocí esa área 🤔\n\nElige un número del *1* al *6* de la lista, o escribe *0* para volver.',
      });
      await sendAreasMenu(from);
      return;
    }
    const sugerencias = recomendarPorArea(areaId);
    await track('programas_ayuda_area');
    await setSession(from, {
      step: 'programas_detalle',
      data: {
        orientacionArea: areaId,
        programasSugeridos: JSON.stringify(sugerencias.map((s) => s.programa)),
      },
    });
    await messaging.sendText({ to: from, text: texto });
    await sendAccionesDetalle(from);
    return;
  }

  if (input === '1') {
    await setSession(from, { step: 'programas_detalle', data: { categoria: 'especializaciones' } });
    await track('programas_especializaciones');
    await messaging.sendText({ to: from, text: ESPECIALIZACIONES_INFO });
    await sendAccionesDetalle(from);
    return;
  }

  if (input === '2') {
    await setSession(from, { step: 'programas_detalle', data: { categoria: 'maestrias' } });
    await track('programas_maestrias');
    await messaging.sendText({ to: from, text: MAESTRIAS_INFO });
    await sendAccionesDetalle(from);
    return;
  }

  if (input === '3') {
    await setSession(from, { step: 'programas_detalle', data: { categoria: 'doctorados' } });
    await track('programas_doctorados');
    await messaging.sendText({ to: from, text: DOCTORADOS_INFO });
    await sendAccionesDetalle(from);
    return;
  }

  if (input === '4') {
    await setSession(from, { step: 'programas_categoria', data: { modo: 'ayuda', fase: 'areas' } });
    await track('programas_ayuda_areas');
    await messaging.sendText({
      to: from,
      text:
        '🧭 *Ayúdame a elegir*\n\nCuéntame en qué área te mueves y te sugiero programas reales con su enlace oficial 👇',
    });
    await sendAreasMenu(from);
    return;
  }

  // Input no reconocido — explicarlo y repetir lista
  await messaging.sendText({
    to: from,
    text:
      'No reconocí esa opción 🤔\n\nElige *1*, *2*, *3* o *4 (Ayúdame a elegir)*, o escribe *0* para volver.',
  });
  await sendCategoriasMenu(from);
}

/** Paso 2: el usuario elige acción tras ver el listado o las sugerencias */
export async function handleProgramasDetalle(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim();
  const data = session?.data ?? {};
  const categoria = data.categoria;
  const orientacionArea = data.orientacionArea;
  const programasSugeridos = data.programasSugeridos;

  // `0` vuelve un nivel (al selector); `volver` va al menú de Posgrado.
  // (`parseGlobalCommand('0')` es 'volver', por eso el `0` se atiende antes.)
  if (input === '0') {
    await setSession(from, { step: 'programas_categoria', data: {} });
    await sendCategoriasMenu(from);
    return;
  }

  const comando = parseGlobalCommand(text);
  if (comando === 'volver') {
    await setSession(from, { step: 'menu_posgrado', data: {} });
    await sendMenuPosgrado(from);
    return;
  }
  if (comando === 'menu' || comando === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  if (input === '1') {
    await setSession(from, {
      step: 'chatting_with_ai',
      data: {
        area: 'posgrados',
        originArea: 'posgrado',
        ...(categoria ? { categoria } : {}),
        ...(orientacionArea ? { orientacionArea } : {}),
        ...(programasSugeridos ? { programasSugeridos } : {}),
      },
    });
    await messaging.sendText({
      to: from,
      text:
        '🤖 *Asistente IA de Posgrados*\n\n' +
        '¿Qué quieres saber sobre este programa o cualquier otro?\n\n' +
        '_Escribe *asesor* para hablar con una persona, o *menu* para volver._',
    });
    return;
  }

  if (input === '2') {
    // Se conserva todo el contexto (categoría y/u orientación) en sesión
    // para el asesor; `prospecto.ts` lo arrastra con spread hasta su mensaje.
    await setSession(from, { step: 'prospecto_nombre', data: { ...data, originArea: 'posgrado' } });
    await messaging.sendText({
      to: from,
      text:
        '🧑‍💼 *Conectar con asesor de Posgrados*\n\n' +
        'Para que el asesor pueda ayudarte mejor, necesito algunos datos rápidos.\n\n' +
        '¿Cuál es tu *nombre completo*?',
    });
    await track('prospecto_iniciado');
    return;
  }

  if (input === '3') {
    await setSession(from, { step: 'programas_categoria', data: {} });
    await sendCategoriasMenu(from);
    return;
  }

  await messaging.sendText({
    to: from,
    text:
      'No reconocí esa opción 🤔\n\nElige *1* para IA, *2* para asesor o *3* para otros programas. Escribe *0* para volver o *menu* para el inicio.',
  });
  await sendAccionesDetalle(from);
}
