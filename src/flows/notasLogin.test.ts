import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { procesarMfa, procesarPassword, type DepsNotasLogin } from './notasLogin';
import type { NotasLoginResult } from '../services/notasService';
import { sanitizeActivityText } from '../services/activityPrivacy';
import { describeError } from '../services/logSafe';

/**
 * PRIVACIDAD DE LA CONTRASEÑA. La contraseña institucional llega como texto por
 * WhatsApp. Estas pruebas siguen su rastro por TODO lo que el flujo puede tocar
 * (sesión de Redis, mensajes, logs, métricas, almacenamiento de sesión) y exigen
 * que no aparezca en ninguna parte. Además hay un control positivo: se comprueba
 * que la contraseña SÍ llegó al login, para que la prueba no pase por vacía.
 */

const PASSWORD = 'Cl4ve-Instit#2026!';
const MFA = '918273';
const FROM = '573001112233';
const EMAIL = 'ana.perez@utb.edu.co';
const COOKIES = JSON.stringify({ cookies: [{ name: 'ASP.NET_SessionId', value: 'cookie-de-sesion-123' }] });

interface Rastro {
  sesiones: unknown[];
  mensajes: string[];
  metricas: string[];
  guardadas: Array<{ from: string; email: string; estado: string }>;
  loginRecibio: Array<{ password: string; opciones: { exportarEstado: boolean } }>;
  logs: string[];
}

function armar(login: () => Promise<NotasLoginResult>, over: Partial<DepsNotasLogin> = {}) {
  const r: Rastro = { sesiones: [], mensajes: [], metricas: [], guardadas: [], loginRecibio: [], logs: [] };
  const deps: DepsNotasLogin = {
    obtenerCorreo: async () => EMAIL,
    iniciarLogin: async (_f, _e, password, opciones) => { r.loginRecibio.push({ password, opciones }); return login(); },
    enviarMfa: async () => login(),
    guardarSesion: async (from, email, estado) => { r.guardadas.push({ from, email, estado }); return true; },
    setSession: async (_f, s) => { r.sesiones.push(structuredClone(s)); },
    enviar: async (_t, text) => { r.mensajes.push(text); },
    track: async (e) => { r.metricas.push(e); },
    regla: () => ({ notaMinima: 3, notaMaxima: 5, pesosCortes: [30, 30, 40], sinConfirmar: true }),
    ...over,
  };
  return { deps, r };
}

const OK: NotasLoginResult = { status: 'ok', cursos: [{ titulo: 'Cálculo', notaFinal: '4.2' }] };

let originales: Record<string, typeof console.log>;
let capturado: string[];
beforeEach(() => {
  capturado = [];
  originales = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const nivel of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    console[nivel] = (...args: unknown[]) => { capturado.push(args.map(String).join(' ')); };
  }
});
afterEach(() => { Object.assign(console, originales); });

const todoLoRastreado = (r: Rastro): string =>
  JSON.stringify({ s: r.sesiones, m: r.mensajes, t: r.metricas, g: r.guardadas, l: capturado });

describe('la contraseña no queda en ninguna parte (camino B, por defecto)', () => {
  it('login correcto: no aparece en sesión, mensajes, métricas ni logs', async () => {
    const { deps, r } = armar(async () => OK);
    await procesarPassword(deps, FROM, PASSWORD, { originArea: 'pregrado' });
    assert.deepEqual(r.loginRecibio.map((x) => x.password), [PASSWORD], 'control positivo: la contraseña sí llegó al login');
    assert.equal(r.loginRecibio[0].opciones.exportarEstado, false, 'sin consentimiento no se exporta sesión');
    assert.ok(!todoLoRastreado(r).includes(PASSWORD));
    assert.deepEqual(r.guardadas, []);
    assert.deepEqual(r.sesiones.at(-1), { step: 'menu_pregrado', data: {} }, 'la sesión de Redis termina sin datos del login');
    assert.ok(r.mensajes.some((m) => m.includes('Cálculo')));
  });

  it('login fallido: tampoco', async () => {
    const { deps, r } = armar(async () => ({ status: 'error', error: 'Correo o contraseña incorrectos.' }));
    await procesarPassword(deps, FROM, PASSWORD, {});
    assert.ok(!todoLoRastreado(r).includes(PASSWORD));
    assert.ok(r.metricas.includes('notas_no_encontradas'));
  });

  it('una excepción cuyo mensaje trae la contraseña no se loguea ni se muestra', async () => {
    const { deps, r } = armar(async () => { throw new Error(`page.fill("${PASSWORD}") timeout 20000ms`); });
    await procesarPassword(deps, FROM, PASSWORD, {});
    assert.ok(!todoLoRastreado(r).includes(PASSWORD));
    assert.ok(r.mensajes.some((m) => /No pude iniciar sesión/.test(m)));
    assert.equal(capturado.length, 0, 'el flujo no escribe NADA en consola');
  });

  it('MFA: la contraseña no pasa a la sesión de Redis y el código MFA tampoco', async () => {
    const { deps, r } = armar(async () => ({ status: 'mfa', prompt: 'Escribe el código de verificación (MFA).' }));
    await procesarPassword(deps, FROM, PASSWORD, { originArea: 'posgrado', guardar: '1' });
    assert.deepEqual(r.sesiones.at(-1), { step: 'notas_mfa', data: { originArea: 'posgrado', guardar: '1' } });
    assert.ok(!todoLoRastreado(r).includes(PASSWORD));
    const segundo = armar(async () => OK);
    await procesarMfa(segundo.deps, FROM, MFA, { originArea: 'posgrado' });
    assert.ok(!todoLoRastreado(segundo.r).includes(MFA));
  });

  it('si el usuario escribió su correo en vez de la contraseña, se le avisa sin llamar al portal', async () => {
    const { deps, r } = armar(async () => OK);
    await procesarPassword(deps, FROM, EMAIL, {});
    assert.equal(r.loginRecibio.length, 0);
    assert.match(r.mensajes[0], /contraseña/);
  });

  it('sin vínculo verificado no se intenta ningún login', async () => {
    const { deps, r } = armar(async () => OK, { obtenerCorreo: async () => null });
    await procesarPassword(deps, FROM, PASSWORD, {});
    assert.equal(r.loginRecibio.length, 0);
    assert.deepEqual(r.sesiones.at(-1), { step: 'menu', data: {} });
  });
});

describe('camino A: se guarda la sesión (cookies), nunca la contraseña, y solo con consentimiento', () => {
  it('con consentimiento: exporta y guarda las cookies, y la contraseña no viaja a ningún lado', async () => {
    const { deps, r } = armar(async () => ({ ...OK, estado: COOKIES } as NotasLoginResult));
    await procesarPassword(deps, FROM, PASSWORD, { originArea: 'pregrado', guardar: '1' });
    assert.equal(r.loginRecibio[0].opciones.exportarEstado, true);
    assert.deepEqual(r.guardadas, [{ from: FROM, email: EMAIL, estado: COOKIES }]);
    assert.ok(!todoLoRastreado(r).includes(PASSWORD));
    assert.ok(r.metricas.includes('notas_sesion_guardada'));
    assert.ok(r.mensajes.some((m) => /cifrada/.test(m)), 'se le avisa que quedó guardada');
    assert.deepEqual(r.sesiones.at(-1), { step: 'menu_pregrado', data: {} });
  });

  it('sin consentimiento NO se guarda aunque el servicio devolviera la sesión', async () => {
    const { deps, r } = armar(async () => ({ ...OK, estado: COOKIES } as NotasLoginResult));
    await procesarPassword(deps, FROM, PASSWORD, { originArea: 'pregrado', guardar: '0' });
    assert.deepEqual(r.guardadas, []);
    assert.equal(r.loginRecibio[0].opciones.exportarEstado, false);
  });

  it('si el almacén no puede guardar (falta la clave), no se promete nada', async () => {
    const { deps, r } = armar(async () => ({ ...OK, estado: COOKIES } as NotasLoginResult), { guardarSesion: async () => false });
    await procesarPassword(deps, FROM, PASSWORD, { guardar: '1' });
    assert.ok(!r.mensajes.some((m) => /cifrada/.test(m)));
    assert.ok(!r.metricas.includes('notas_sesion_guardada'));
  });

  it('el MFA conserva el consentimiento y guarda al terminar', async () => {
    const { deps, r } = armar(async () => ({ ...OK, estado: COOKIES } as NotasLoginResult));
    await procesarMfa(deps, FROM, MFA, { guardar: '1' });
    assert.equal(r.guardadas.length, 1);
    assert.ok(!todoLoRastreado(r).includes(MFA));
  });
});

describe('el historial del panel y los logs no ven la contraseña', () => {
  it('activityPrivacy oculta lo que se escribe en cada paso del login y del vínculo', () => {
    for (const paso of ['notas_password', 'notas_mfa', 'notas_consentimiento', 'vincular_codigo', 'vincular_cedula', 'semestre_calculo']) {
      assert.equal(sanitizeActivityText('in', paso, PASSWORD), '[contenido privado]', paso);
    }
  });

  it('activityPrivacy oculta lo que el bot dice con datos académicos', () => {
    for (const salida of [
      '📊 *Tus notas del período*\n• Cálculo: *4.2*',
      '🗓️ *Tu horario*\nLunes',
      '📝 *Tareas próximas*',
      '📈 Promedio: tu promedio es 3.85',
      '🧾 Recibo de matrícula — Ana',
    ]) {
      assert.equal(sanitizeActivityText('out', 'semestre_menu', salida), '[contenido privado]', salida);
    }
    assert.equal(sanitizeActivityText('in', 'semestre_menu', '1'), '1');
  });

  it('describeError (logSafe) NO esconde una contraseña: por eso el flujo no loguea errores del login', () => {
    const texto = describeError(new Error(`fill("${PASSWORD}") falló`));
    assert.ok(texto.includes(PASSWORD), 'si esto fallara, logSafe habría mejorado y esta guardia puede relajarse');
  });

  it('guardia estática: los ficheros del login no escriben en consola ni usan describeError', () => {
    for (const ruta of ['src/flows/notasLogin.ts', 'src/flows/notas.ts', 'src/services/notasService.ts', 'src/services/academico/sesionNotas.ts', 'src/services/academico/proveedores/notasBanner.ts']) {
      const fuente = readFileSync(join(process.cwd(), ruta), 'utf8');
      assert.ok(!/console\.(log|error|warn|info|debug)/.test(fuente), `${ruta} escribe en consola`);
      assert.ok(!/describeError\(/.test(fuente), `${ruta} usa describeError`);
    }
  });

  it('guardia estática: la contraseña nunca va a Redis, Chatwoot ni métricas desde el flujo de notas', () => {
    const fuente = readFileSync(join(process.cwd(), 'src/flows/notasLogin.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/chatwoot|redis|sendIncomingMessage|addPrivateNote/i.test(fuente));
    // La única llamada que recibe `text` como contraseña es el login.
    assert.equal((fuente.match(/d\.iniciarLogin\(/g) ?? []).length, 1);
  });
});
