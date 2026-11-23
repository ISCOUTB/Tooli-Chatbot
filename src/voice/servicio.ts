// Conexión de la línea de voz con el resto de Tooli: Redis, ajustes, credenciales del entorno, IA, WhatsApp para el
// código de verificación, avisos al panel y los contratos académico/agenda. Es lo único de src/voice que abre
// conexiones; las pruebas usan los módulos puros y `almacenMemoria`.
//
// Contratos: la voz NO importa las implementaciones. Se registran al arrancar con `conectarContratosVoz()`
// (src/voice/contratos.ts), que llama registrarAcademico(academico) y registrarAgenda(agenda).
// Sin registrar, la línea dice que no puede consultar datos y ofrece asesor / devolución.
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import OpenAI from 'openai';
import { config } from '../config';
import type { AcademicoApi } from '../contratos/academico';
import type { AgendaApi } from '../contratos/agenda';
import { secretoVozUsable } from '../services/academico/nucleo';
import { codigoWhatsAppVozReal } from '../services/academico/verificacionVoz';
import { describeError } from '../services/logSafe';
import { AJUSTES_DEFECTO, leerAjustes, type AjustesVoz } from './ajustes';
import { almacenRedis } from './almacenRedis';
import type { DepsTurno } from './dialogo';
import type { ClienteIa } from './entender';
import { asesoresDisponibles } from './horario';
import { crearManejador, programadorReal, type AvisoPanel } from './manejador';
import type { LlamadaVoz } from './tipos';
import { telnyxProvider } from './proveedor/telnyx';
import type { ProviderCredentials } from './proveedor/tipos';
import { crearSimulador } from './simulador';

const redis = new Redis(config.redis.url, { lazyConnect: true });
export const almacen = almacenRedis(redis);

// ------------------------------------------------------------------ contratos

let academico: AcademicoApi | null = null;
let agenda: AgendaApi | null = null;
export function registrarAcademico(api: AcademicoApi | null): void { academico = api; }
export function registrarAgenda(api: AgendaApi | null): void { agenda = api; }
export function contratosConectados() { return { academico: Boolean(academico), agenda: Boolean(agenda) }; }
/** Lo registrado ahora mismo (lo usa el manejador en cada turno; las pruebas lo leen). */
export function contratosRegistrados(): { academico: AcademicoApi | null; agenda: AgendaApi | null } { return { academico, agenda }; }

// ------------------------------------------------------------------ ajustes

const AJUSTES_KEY = 'voz:ajustes';
let cache: { at: number; valor: AjustesVoz } | null = null;

export async function leerAjustesGuardados(): Promise<AjustesVoz> {
  if (cache && Date.now() - cache.at < 15_000) return cache.valor;
  let valor = AJUSTES_DEFECTO;
  try {
    const raw = await redis.get(AJUSTES_KEY);
    valor = raw ? leerAjustes(JSON.parse(raw)) : AJUSTES_DEFECTO;
  } catch (err) {
    console.error('[voz] no se pudieron leer los ajustes:', describeError(err));
  }
  cache = { at: Date.now(), valor };
  return valor;
}

export async function guardarAjustes(cambios: unknown): Promise<AjustesVoz> {
  const actual = await leerAjustesGuardados();
  const nuevo = leerAjustes(cambios, actual);
  await redis.set(AJUSTES_KEY, JSON.stringify(nuevo));
  cache = { at: Date.now(), valor: nuevo };
  return nuevo;
}

// ------------------------------------------------------------------ credenciales (solo entorno)

export function credenciales(): ProviderCredentials | null {
  const v = config.voz;
  if (!v.telnyxApiKey || !v.telnyxPublicKey) return null;
  return { apiKey: v.telnyxApiKey, publicKey: v.telnyxPublicKey, connectionId: v.telnyxConnectionId || null };
}

export function estadoConexion() {
  const v = config.voz;
  return {
    llaveApi: Boolean(v.telnyxApiKey),
    llavePublica: Boolean(v.telnyxPublicKey),
    conexion: Boolean(v.telnyxConnectionId),
    numero: v.telnyxPhoneNumber || null,
    webhookListo: v.webhookKey.length >= 24,
    ia: Boolean(config.openai.apiKey),
    modeloIa: v.aiModel,
    ...contratosConectados(),
  };
}

// ------------------------------------------------------------------ IA (solo entiende)

const openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey, maxRetries: 0 }) : null;
export const clienteIa: ClienteIa | null = openai
  ? {
      async clasificar({ sistema, usuario, signal }) {
        const r = await openai.chat.completions.create(
          {
            model: config.voz.aiModel,
            messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
            response_format: { type: 'json_object' },
            temperature: 0,
            max_tokens: 120,
          },
          { signal },
        );
        return r.choices[0]?.message?.content ?? '{}';
      },
    }
  : null;

// ------------------------------------------------------------------ código por WhatsApp

async function enviarWhatsApp(telefono: string, texto: string): Promise<boolean> {
  try {
    const to = telefono.replace(/\D/g, '');
    // Con Meta, fuera de las 24 h solo sale una plantilla: no se promete un mensaje que no va a llegar.
    const { motivoVentanaCerrada } = await import('../routes/tools/shared');
    if (await motivoVentanaCerrada(to)) return false;
    const { messaging } = await import('../flows/shared');
    await messaging.sendText({ to, text: texto });
    return true;
  } catch (err) {
    console.error('[voz] no se pudo escribir por WhatsApp:', describeError(err));
    return false;
  }
}

async function enviarCodigoWhatsApp(telefono: string, codigo: string): Promise<boolean> {
  return enviarWhatsApp(
    telefono,
    `Tu código para la llamada con Posgrados UTB es ${codigo}. Díctalo en la llamada. Si no estás llamando, ignora este mensaje.`,
  );
}

// ------------------------------------------------------------------ avisos al panel

const AVISOS_KEY = 'voz:avisos';
export async function avisar(aviso: AvisoPanel): Promise<void> {
  if (aviso.simulada) return;
  try {
    await redis.multi().lpush(AVISOS_KEY, JSON.stringify({ ...aviso, at: new Date().toISOString() })).ltrim(AVISOS_KEY, 0, 49).expire(AVISOS_KEY, 7 * 86_400).exec();
  } catch (err) {
    console.error('[voz] aviso al panel falló:', describeError(err));
  }
}
export async function avisosRecientes(): Promise<unknown[]> {
  const raw = await redis.lrange(AVISOS_KEY, 0, 19);
  return raw.flatMap((r) => { try { return [JSON.parse(r)]; } catch { return []; } });
}

// ------------------------------------------------------------------ manejador y simulador

/**
 * Dependencias del turno de una llamada real. La huella del código usa la MISMA clave que la verificación por correo
 * (`secretoVozUsable`): nunca un JWT_SECRET por defecto, de ejemplo o corto; con uno así la voz no verifica (#34).
 */
export function depsTurnoReales(l: LlamadaVoz, a: AjustesVoz): DepsTurno {
  return {
    academico,
    agenda,
    ia: clienteIa,
    enviarCodigo: enviarCodigoWhatsApp,
    enviarWhatsApp,
    secreto: secretoVozUsable(config.auth.jwtSecret, process.env.NODE_ENV === 'test'),
    ahora: () => new Date(),
    telefonoLlamante: l.telefono,
    asesoresEnVivo: Boolean(a.numeroDesvio) && asesoresDisponibles(a.horarioAsesores),
  };
}

export const manejador = crearManejador({
  almacen,
  proveedor: telnyxProvider,
  credenciales,
  ajustes: leerAjustesGuardados,
  programador: programadorReal,
  avisarPanel: (a) => void avisar(a),
  depsTurno: depsTurnoReales,
  // Código por WhatsApp por el almacén atómico del correo: topes por hora y día y bloqueo, entre instancias (#34).
  codigoWhatsApp: codigoWhatsAppVozReal,
});

let barrido: NodeJS.Timeout | null = null;
let barriendo = false;
let vueltas = 0;
/**
 * Barrido de los controles de silencio (fechas límite en Redis) y, cada 5 vueltas, del tope duro de las llamadas
 * (punto 8: cuelga la que pasó su máximo y cierra la que ya no tiene call.hangup). Cada instancia lo corre; no se
 * pisan: cada fecha la cumple una sola (compare-and-set en el estado de la llamada). Seguro llamarlo más de una vez.
 */
export function iniciarBarridoSilencios(cadaMs = 1000): void {
  if (barrido) return;
  barrido = setInterval(() => {
    if (barriendo) return;
    barriendo = true;
    const plazos = vueltas++ % 5 === 0;
    manejador.barrerSilencios()
      .then(() => (plazos ? manejador.barrerPlazos() : 0))
      .catch((err) => console.error('[voz] barrido de silencios y plazos falló:', describeError(err)))
      .finally(() => { barriendo = false; });
  }, cadaMs);
  barrido.unref?.();
}

// El simulador firma sus códigos (simulados, en memoria) con una clave propia del proceso, nunca con JWT_SECRET.
export const simulador = crearSimulador({
  almacen,
  ajustes: leerAjustesGuardados,
  ia: clienteIa,
  secreto: randomBytes(32).toString('hex'),
});

export async function probarConexion() {
  const creds = credenciales();
  if (!creds) return { ok: false, message: 'Faltan TELNYX_API_KEY y TELNYX_PUBLIC_KEY en el entorno del servidor.' };
  return telnyxProvider.testConnection(creds, config.voz.telnyxPhoneNumber || null);
}
