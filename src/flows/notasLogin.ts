import type { NotasLoginResult } from '../services/notasService';
import type { ReglaNotas } from '../services/academico/calculos';
import { armarNotas } from '../services/academico/notasVista';
import { returnMenuStep } from './commands';
import type { SessionData } from './commands';

/**
 * Lógica de la contraseña y el MFA de las notas, SIN dependencias con efectos
 * (Redis, Playwright, WhatsApp llegan por `deps`). Está aparte de flows/notas.ts
 * para poder probar de verdad que la contraseña:
 *   - nunca se escribe en la sesión (Redis),
 *   - nunca se envía de vuelta ni a otro servicio,
 *   - nunca se loguea, ni siquiera dentro del mensaje de un error.
 *
 * Camino B (por defecto): la contraseña se usa una vez y se descarta.
 * Camino A (opcional, con consentimiento): tras el login se guarda CIFRADA la
 * sesión del navegador (cookies), nunca la contraseña.
 */

export interface DepsNotasLogin {
  obtenerCorreo(from: string): Promise<string | null>;
  iniciarLogin(from: string, email: string, password: string, opciones: { exportarEstado: boolean }): Promise<NotasLoginResult>;
  enviarMfa(from: string, codigo: string): Promise<NotasLoginResult>;
  /** Camino A. Devuelve false si no se pudo guardar (p. ej. falta la clave de cifrado). */
  guardarSesion(from: string, email: string, estado: string): Promise<boolean>;
  setSession(from: string, session: { step: string; data: SessionData }): Promise<void>;
  enviar(to: string, text: string): Promise<void>;
  track(evento: 'notas_consultadas' | 'notas_no_encontradas' | 'notas_sesion_guardada'): Promise<void>;
  regla(): ReglaNotas;
}

/** Lo único que se conserva en la sesión de Redis entre pasos: dónde volver y si hay consentimiento. */
function datosSeguros(data?: SessionData): SessionData {
  const salida: SessionData = {};
  if (data?.originArea) salida.originArea = data.originArea;
  if (data?.area) salida.area = data.area;
  if (data?.guardar === '1') salida.guardar = '1';
  return salida;
}

async function entregar(d: DepsNotasLogin, from: string, res: NotasLoginResult, data?: SessionData): Promise<void> {
  if (res.status === 'ok') {
    await d.track('notas_consultadas');
    const consentimiento = data?.guardar === '1';
    let aviso = '';
    if (consentimiento && res.estado) {
      const guardada = await d.guardarSesion(from, (await d.obtenerCorreo(from)) ?? '', res.estado).catch(() => false);
      if (guardada) {
        await d.track('notas_sesion_guardada');
        aviso = '\n\n🔒 Guardé tu sesión *cifrada* por unas horas para que no tengas que escribir la contraseña otra vez. Nunca guardo tu contraseña. Puedes borrarla en *Mi semestre*.';
      }
    }
    const texto = armarNotas(
      res.cursos.map((c) => ({ titulo: c.titulo, notaFinal: c.notaFinal })), undefined, d.regla(),
    ).paraTexto;
    await d.enviar(from, texto + aviso);
  } else if (res.status === 'error') {
    await d.track('notas_no_encontradas');
    await d.enviar(from, `No pude traer tus notas. ${res.error}\n\nEscribe *menu* para volver.`);
  }
  // Sea cual sea el resultado, la sesión de Redis queda SIN datos del login.
  await d.setSession(from, { step: returnMenuStep(data), data: {} });
}

/** Paso `notas_password`: `text` ES la contraseña. */
export async function procesarPassword(
  d: DepsNotasLogin, from: string, text: string, data?: SessionData,
): Promise<void> {
  if (/@/.test(text.trim())) {
    await d.enviar(from, 'Eso parece un correo 🙂. Necesito tu *contraseña* institucional (la de Microsoft), no el correo. Escríbela, o *menu* para cancelar.');
    return;
  }
  const email = await d.obtenerCorreo(from);
  if (!email) {
    await d.setSession(from, { step: 'menu', data: {} });
    await d.enviar(from, 'Necesitas verificar tu identidad primero. Escribe *menu* y elige *Ver notas*.');
    return;
  }

  await d.enviar(from, '🔄 Iniciando sesión en Banner por ti… (puede tardar hasta 1 min)');

  let res: NotasLoginResult;
  try {
    res = await d.iniciarLogin(from, email, text, { exportarEstado: data?.guardar === '1' });
  } catch {
    // Sin `err`: el mensaje de una excepción de automatización puede incluir el valor escrito.
    res = { status: 'error', error: 'No pude iniciar sesión en el portal. Intenta más tarde.' };
  }

  if (res.status === 'mfa') {
    await d.setSession(from, { step: 'notas_mfa', data: datosSeguros(data) });
    await d.enviar(from, `🔐 ${res.prompt}\n\n_Escribe *menu* para cancelar._`);
    return;
  }
  await entregar(d, from, res, data);
}

/** Paso `notas_mfa`: `text` es el código MFA. */
export async function procesarMfa(
  d: DepsNotasLogin, from: string, text: string, data?: SessionData,
): Promise<void> {
  await d.enviar(from, '🔄 Verificando el código…');
  let res: NotasLoginResult;
  try {
    res = await d.enviarMfa(from, text.trim());
  } catch {
    res = { status: 'error', error: 'No pude verificar el código con el portal. Vuelve a empezar.' };
  }
  await entregar(d, from, res, data);
}
