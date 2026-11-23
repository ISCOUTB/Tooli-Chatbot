import { setSession } from '../services/session';
import { getIdentity } from '../services/identityService';
import { track } from '../services/metrics';
import { FlowContext, messaging, sendMenu } from './shared';
import { startVerificationFlow } from './verificacion';
import { parseGlobalCommand, parseOriginArea, returnMenuStep } from './commands';
import { config } from '../config';
import type { FlowArea } from './commands';
import type { TipoConsulta } from '../contratos/academico';
import { academico, borrarSesionDeNotas, haySesionDeNotas, vincularCodigoEstudiantil } from '../services/academico/servicio';
import { caminoNotas, interruptoresDeEntorno } from '../services/academico/interruptores';
import { reglaNotas, leerNotasEscritas } from '../services/academico/calculos';
import { armarCalculo } from '../services/academico/notasVista';
import { normalizarCedula, normalizarCodigo } from '../services/academico/identidadAcademica';
import { iniciarConsultaDeNotas } from './notas';
import { RECURSOS_ACADEMICOS } from '../services/academicoLinks';

/**
 * «Mi semestre»: la puerta de los estudiantes verificados a sus datos
 * (notas, horario, cursos y tareas, turno, recibo, cuánto necesito para pasar).
 * Todo sale de `academico.consultar`, la misma API que usa la voz.
 *
 * Pasos: semestre_menu, semestre_calculo, vincular_codigo, vincular_cedula.
 */

type Accion = 'turno' | 'recibo';

async function seguirEnMenu(from: string, area: FlowArea): Promise<void> {
  await setSession(from, { step: 'semestre_menu', data: { originArea: area } });
}

export async function sendMenuSemestre(from: string, area: FlowArea): Promise<void> {
  const i = interruptoresDeEntorno;
  const identidad = await getIdentity(from);
  const sinCodigo = !identidad?.codigoVerificado;
  const hayBorrable = await haySesionDeNotas(from);
  await setSession(from, { step: 'semestre_menu', data: { originArea: area } });
  await messaging.sendList({
    to: from,
    title: '📅 Mi semestre',
    description: `Tus datos académicos, solo para ti${identidad?.nombre ? `, ${identidad.nombre.split(' ')[0]}` : ''}.`,
    footer: 'Universidad Tecnológica de Bolívar',
    buttonText: 'Ver opciones',
    sections: [{
      title: 'Qué quieres ver',
      rows: [
        // Solo lo que está encendido: una opción apagada solo diría «Por ahora no consulto…».
        ...(i.notas() ? [{ id: '1', title: '📊 Mis notas', description: 'Notas del período y promedio' }] : []),
        ...(i.horario() ? [{ id: '2', title: '🗓️ Mi horario', description: 'Clases de hoy y de la semana' }] : []),
        ...(i.cursos() ? [{ id: '3', title: '📚 Cursos y tareas', description: 'Savio: cursos y entregas próximas' }] : []),
        ...(i.turno() ? [{ id: '4', title: '📋 Mi turno', description: 'Turno y fecha de matrícula' }] : []),
        ...(i.recibo() ? [{ id: '5', title: '🧾 Mi recibo', description: 'Recibo de matrícula, valor y fecha límite' }] : []),
        { id: '6', title: '🧮 ¿Cuánto necesito?', description: 'Qué nota te falta para pasar' },
        ...(sinCodigo && interruptoresDeEntorno.recibo()
          ? [{ id: '7', title: '🔗 Vincular mi código', description: 'Una sola vez: código estudiantil y cédula' }] : []),
        ...(hayBorrable
          ? [{ id: '8', title: '🗑️ Olvidar mi sesión', description: 'Borra la sesión de notas que guardé' }] : []),
        { id: '0', title: '🔙 Volver', description: 'Regresar al menú anterior' },
      ],
    }],
  });
  await track('academico_semestre');
}

/**
 * Sin vínculo hay que verificar el correo, pero el código va por correo (Resend): sin RESEND_API_KEY la verificación
 * no puede terminar, así que no se abre. Mismo criterio que «Mi cuenta vinculada» (academicAccount.ts).
 */
async function verificarOAvisar(from: string, area: FlowArea, after: string): Promise<void> {
  if (!config.mail.apiKey) {
    await setSession(from, { step: returnMenuStep({ originArea: area }), data: {} });
    await messaging.sendText({
      to: from,
      text: 'Para mostrarte tus datos primero tengo que verificar tu correo institucional, y esa verificación todavía no está disponible. 🙏\n\n' +
        'Mientras tanto, consúltalos en los canales oficiales de la UTB. Escribe *menu* para volver.',
    });
    return;
  }
  await startVerificationFlow(from, after, area);
}

/** Entrada desde los menús. `accion`: turno o recibo, si llegó desde esas opciones. */
export async function iniciarMiSemestre(from: string, area: FlowArea, accion?: Accion): Promise<void> {
  if (!(await getIdentity(from))) {
    await verificarOAvisar(from, area, accion ?? 'semestre');
    return;
  }
  if (accion) {
    await seguirEnMenu(from, area);
    await ejecutar(from, area, accion);
    return;
  }
  await sendMenuSemestre(from, area);
}

async function ejecutar(from: string, area: FlowArea, tipo: TipoConsulta): Promise<void> {
  const r = await academico.consultar(from, tipo);
  if (!r.ok) {
    if (r.motivo === 'no_verificado') return verificarOAvisar(from, area, 'semestre');
    if (r.motivo === 'sin_codigo') return iniciarVinculo(from, area, tipo === 'turno' || tipo === 'recibo' ? tipo : undefined);
    if (r.motivo === 'sin_sesion' && tipo === 'notas') return iniciarConsultaDeNotas(from, area);
    if (r.motivo === 'sin_sesion' && tipo === 'horario' && caminoNotas() === 'B') {
      const url = RECURSOS_ACADEMICOS.find((x) => x.id === 'horario')?.url ?? 'https://autoservicio4prod.utb.edu.co';
      await messaging.sendText({
        to: from,
        text: `Por ahora el horario solo se puede mostrar con la sesión guardada, que está desactivada. Míralo en el autoservicio oficial: ${url}\n\nNo envíes tu contraseña por WhatsApp.`,
      });
      return;
    }
    if (r.motivo === 'sin_sesion' && tipo === 'horario') return iniciarConsultaDeNotas(from, area);
    await messaging.sendText({ to: from, text: r.paraTexto });
    return;
  }
  if (tipo === 'recibo') {
    const datos = r.datos as { pdf?: Buffer; nombre?: string | null };
    if (datos.pdf) {
      await messaging.sendDocument({
        to: from, buffer: datos.pdf, fileName: 'recibo-matricula.pdf', mimetype: 'application/pdf',
        caption: `🧾 Recibo de matrícula${datos.nombre ? ` — ${datos.nombre}` : ''}`,
      });
    }
  }
  if (tipo === 'notas') await track('notas_consultadas');
  await messaging.sendText({ to: from, text: r.paraTexto });
}

export async function handleSemestreMenu(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  const area = parseOriginArea(session?.data.originArea);
  if (!area) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  const input = text.trim();
  if (input === '0' || command === 'volver') {
    const { sendMenuAcademico } = await import('./academico');
    await sendMenuAcademico(from, area);
    return;
  }
  switch (input) {
    case '1': return ejecutar(from, area, 'notas');
    case '2': return ejecutar(from, area, 'horario');
    case '3': return ejecutar(from, area, 'cursos');
    case '4': return ejecutar(from, area, 'turno');
    case '5': return ejecutar(from, area, 'recibo');
    case '6':
      await setSession(from, { step: 'semestre_calculo', data: { originArea: area } });
      await messaging.sendText({
        to: from,
        text:
          '🧮 Escribe las notas que ya sacaste en la materia, en orden y separadas por espacio.\n' +
          'Ejemplo: *3.5 4.0* (corte 1 y corte 2). Te digo cuánto necesitas en lo que falta.\n\n_Escribe *0* para volver._',
      });
      return;
    case '7': return iniciarVinculo(from, area);
    case '8':
      await borrarSesionDeNotas(from);
      await messaging.sendText({ to: from, text: '✅ Borré la sesión de notas que tenía guardada. La próxima vez te pediré la contraseña de nuevo.' });
      return sendMenuSemestre(from, area);
    default:
      await messaging.sendText({ to: from, text: 'No reconocí esa opción 🤔 Elige una de la lista, *0* para volver o *menu* para el inicio.' });
      return sendMenuSemestre(from, area);
  }
}

export async function handleSemestreCalculo(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const command = parseGlobalCommand(text);
  const area = parseOriginArea(session?.data.originArea);
  if (command === 'menu' || command === 'salir' || !area) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  if (command === 'volver') return sendMenuSemestre(from, area);
  const notas = leerNotasEscritas(text);
  if (notas.length === 0) {
    await messaging.sendText({ to: from, text: 'No encontré notas válidas (entre 0 y 5). Escríbelas separadas por espacio, por ejemplo *3.5 4.0*, o *0* para volver.' });
    return;
  }
  const regla = reglaNotas();
  if (notas.length > regla.pesosCortes.length) {
    await messaging.sendText({ to: from, text: `Solo hay ${regla.pesosCortes.length} cortes. Escribe como máximo ${regla.pesosCortes.length} notas.` });
    return;
  }
  await messaging.sendText({ to: from, text: armarCalculo(notas, regla).paraTexto });
  await sendMenuSemestre(from, area);
}

// ── Vincular el código estudiantil (una sola vez) ───────────────────────────

export async function iniciarVinculo(from: string, area: FlowArea, despues?: Accion): Promise<void> {
  if (!interruptoresDeEntorno.recibo()) {
    await messaging.sendText({
      to: from,
      text: 'Por ahora no puedo consultar tu turno ni tu recibo desde el bot. Hazlo en los canales oficiales de la UTB.',
    });
    await seguirEnMenu(from, area);
    return;
  }
  await setSession(from, { step: 'vincular_codigo', data: { originArea: area, ...(despues ? { despues } : {}) } });
  await messaging.sendText({
    to: from,
    text:
      '🔗 *Vincular tu código estudiantil*\n\n' +
      'Lo hago una sola vez para que nadie más pueda ver tu turno ni tu recibo. Escribe tu *código estudiantil* (ejemplo: T12345678).\n\n' +
      '_Escribe *0* para volver._',
  });
}

export async function handleVincularCodigo(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const command = parseGlobalCommand(text);
  const area = parseOriginArea(session?.data.originArea);
  if (command === 'menu' || command === 'salir' || !area) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  if (command === 'volver') return sendMenuSemestre(from, area);
  const codigo = normalizarCodigo(text);
  if (!codigo) {
    await messaging.sendText({ to: from, text: 'El código no es válido. Debe tener el formato T seguido de 8 dígitos.\nEjemplo: T12345678\n\nInténtalo de nuevo o escribe *0* para volver.' });
    return;
  }
  await setSession(from, { step: 'vincular_cedula', data: { ...session?.data, codigo } });
  await messaging.sendText({ to: from, text: 'Ahora escribe tu *número de cédula* (solo dígitos). La uso para comprobar con el portal que el código es tuyo.' });
}

export async function handleVincularCedula(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const command = parseGlobalCommand(text);
  const area = parseOriginArea(session?.data.originArea);
  if (command === 'menu' || command === 'salir' || !area) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  if (command === 'volver') return sendMenuSemestre(from, area);
  const cedula = normalizarCedula(text);
  const codigo = session?.data.codigo;
  if (!cedula) {
    await messaging.sendText({ to: from, text: 'La cédula no es válida. Debe tener entre 6 y 12 dígitos.\n\nInténtalo de nuevo o escribe *0* para volver.' });
    return;
  }
  if (!codigo) return iniciarVinculo(from, area);
  const despues = session?.data.despues === 'turno' || session?.data.despues === 'recibo' ? session.data.despues : undefined;
  // La cédula NO se guarda en la sesión: se usa aquí y se descarta.
  await seguirEnMenu(from, area);
  await messaging.sendText({ to: from, text: '🔄 Comprobando tu código con el portal (puede tardar hasta 1 minuto)…' });
  let resultado;
  try {
    resultado = await vincularCodigoEstudiantil(from, codigo, cedula);
  } catch {
    resultado = { estado: 'error' as const };
  }
  switch (resultado.estado) {
    case 'ok':
      await track('codigo_vinculado');
      await messaging.sendText({ to: from, text: `✅ Listo${resultado.nombre ? `, *${resultado.nombre.split(' ')[0]}*` : ''}. Tu código quedó vinculado a este WhatsApp.` });
      if (despues) return ejecutar(from, area, despues);
      return sendMenuSemestre(from, area);
    case 'no_coincide':
      await track('codigo_vinculo_fallido');
      await messaging.sendText({ to: from, text: 'El portal no reconoce ese código con esa cédula. Revisa los datos y vuelve a intentarlo desde *Vincular mi código*.' });
      return;
    case 'en_uso':
      await track('codigo_vinculo_fallido');
      await messaging.sendText({ to: from, text: 'Ese código ya está vinculado a otra cuenta institucional. Si es tuyo, escribe *asesor* para que lo revisemos.' });
      return;
    case 'sin_identidad':
      return startVerificationFlow(from, 'semestre', area);
    case 'apagado':
      await messaging.sendText({ to: from, text: 'Por ahora no puedo comprobar códigos desde el bot.' });
      return;
    default:
      await track('codigo_vinculo_fallido');
      await messaging.sendText({ to: from, text: 'No pude completar la comprobación ahora. Intenta más tarde desde *Vincular mi código*.' });
  }
}

/** Una consulta puntual (p. ej. el horario desde «Mi vida académica»), con la verificación de identidad si falta. */
export async function consultarEnSemestre(from: string, area: FlowArea, tipo: TipoConsulta): Promise<void> {
  if (!(await getIdentity(from))) {
    await verificarOAvisar(from, area, 'semestre');
    return;
  }
  await seguirEnMenu(from, area);
  await ejecutar(from, area, tipo);
}
