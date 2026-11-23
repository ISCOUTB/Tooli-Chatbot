/**
 * API del simulador de WhatsApp del panel («Probar el bot»): /api/tools/simulador-whatsapp/*
 *
 * Es una FÁBRICA para probarla con un Express real y dobles (como agendaRouter).
 * El montaje con el flujo real está en simuladorWhatsapp.ts.
 *
 * Reglas:
 *   - Solo administradores: el simulador corre el bot real y puede gastar IA.
 *   - Cada conversación usa un número de la zona de pruebas (57 0000…): lo que
 *     el bot responde queda en el buzón y nunca sale a Meta ni a Evolution.
 *   - Cada mensaje corre DENTRO de la zona de pruebas (`enZonaDePruebas`): los
 *     servicios con efectos fuera (Sheets, HubSpot, Chatwoot, métricas,
 *     correos…) se lo saltan y dejan una nota en la conversación.
 *   - Límite de tasa por administrador; validación con zod; errores sin detalles.
 */
import { Response, Router } from 'express';
import { z } from 'zod';
import { requireAdmin, type AuthedRequest } from '../../middleware/auth';
import type { AuditAction } from '../../services/auditService';
import { describeError } from '../../services/logSafe';
import {
  PREFIJO_SIMULADO, buzon, enZonaDePruebas, esNumeroSimulado, nuevoNumeroSimulado, type MensajeSimulado,
} from '../../services/simulacion';

export const PERFILES_SIMULADOS = ['nuevo', 'conocido', 'estudiante'] as const;
export type PerfilSimulado = typeof PERFILES_SIMULADOS[number];

export interface EstadoSimuladorWhatsapp {
  /** Hay OPENAI_API_KEY: sin ella el bot responde con sus reglas. */
  ia: boolean;
  adaptador: string;
  /** FLUJO_CONVERSACIONAL: el inicio conversacional en lugar del menú de relación. */
  conversacional: boolean;
  agenda: boolean;
  miSemestre: boolean;
  flyers: boolean;
  /** POSGRADOS_EVENTO_ACTIVO: los mensajes van primero al flujo del evento de posgrados. */
  eventoPosgrados: boolean;
}

export interface DepsSimuladorWhatsapp {
  /** Atiende un mensaje como si llegara de WhatsApp (ya va dentro de la zona de pruebas). */
  manejar(telefono: string, texto: string): Promise<void>;
  /** Paso actual de la sesión, para que quien prueba sepa dónde está el flujo. */
  paso(telefono: string): Promise<string | null>;
  /** Borra todo lo de ese número: sesión, perfil, vínculo de prueba, citas de prueba… */
  limpiar(telefono: string): Promise<void>;
  /** Deja el número como un aspirante que ya había escrito o como un estudiante verificado. */
  prepararPerfil(telefono: string, perfil: PerfilSimulado): Promise<void>;
  limite(clave: string, max: number, ventanaS: number): Promise<{ allowed: boolean; retryAfterSec: number }>;
  audit(username: string, action: AuditAction, detail?: string): Promise<void>;
  estado(): EstadoSimuladorWhatsapp;
}

const TELEFONO = z.string().refine(esNumeroSimulado, 'Solo números del simulador (57 0000 + 6 dígitos)');
const esquemaMensaje = z.object({
  telefono: TELEFONO,
  texto: z.string().trim().min(1).max(1024),
}).strict();
const esquemaConversacion = z.object({ perfil: z.enum(PERFILES_SIMULADOS).default('nuevo') }).strict();

/** Topes por administrador: holgados para probar a mano, cortos para un script que se desboque (y la IA cuesta). */
const TOPE_MENSAJES_MIN = 30;
const TOPE_CONVERSACIONES_HORA = 60;
const TOPE_CONSULTAS_MIN = 120;

/** Lo que el panel muestra en la burbuja «escribiendo…» como máximo. */
const PLAZO_FLUJO_MS = 90_000;

export function crearSimuladorWhatsappRouter(deps: DepsSimuladorWhatsapp): Router {
  const r = Router();
  r.use('/simulador-whatsapp', requireAdmin);

  const fallo = (res: Response, op: string, err: unknown, extra: Record<string, unknown> = {}) => {
    console.error(`[tools/simulador-whatsapp/${op}] error:`, describeError(err));
    res.status(500).json({ error: 'simulador_error', message: 'El simulador no pudo atender el mensaje.', ...extra });
  };
  const invalido = (res: Response) => res.status(400).json({ error: 'datos_invalidos' });
  const usuario = (req: AuthedRequest) => req.user!.username;
  async function dentroDelTope(req: AuthedRequest, res: Response, clave: string, max: number, ventanaS: number): Promise<boolean> {
    const l = await deps.limite(`simulador-wa:${clave}:${usuario(req)}`, max, ventanaS);
    if (l.allowed) return true;
    res.setHeader('Retry-After', String(l.retryAfterSec));
    res.status(429).json({ error: 'too_many_requests', retryAfterSec: l.retryAfterSec, message: 'Vas muy rápido. Espera un momento.' });
    return false;
  }
  const respuesta = async (telefono: string): Promise<{ mensajes: MensajeSimulado[]; paso: string | null }> => ({
    mensajes: buzon.sacar(telefono),
    paso: await deps.paso(telefono).catch(() => null),
  });

  r.get('/simulador-whatsapp/estado', (_req, res) => {
    res.json({ ...deps.estado(), prefijo: PREFIJO_SIMULADO, perfiles: PERFILES_SIMULADOS });
  });

  r.post('/simulador-whatsapp/conversaciones', async (req: AuthedRequest, res) => {
    const datos = esquemaConversacion.safeParse(req.body ?? {});
    if (!datos.success) return invalido(res);
    try {
      if (!(await dentroDelTope(req, res, 'conversaciones', TOPE_CONVERSACIONES_HORA, 60 * 60))) return;
      const telefono = nuevoNumeroSimulado();
      // Por si el número ya se usó antes (son aleatorios): se empieza siempre desde cero.
      await deps.limpiar(telefono);
      buzon.borrar(telefono);
      await enZonaDePruebas(telefono, () => deps.prepararPerfil(telefono, datos.data.perfil));
      await deps.audit(usuario(req), 'simulador_whatsapp_iniciado', `perfil ${datos.data.perfil}`);
      res.json({ telefono, perfil: datos.data.perfil, ...(await respuesta(telefono)) });
    } catch (err) { fallo(res, 'conversaciones', err); }
  });

  r.post('/simulador-whatsapp/mensajes', async (req: AuthedRequest, res) => {
    const datos = esquemaMensaje.safeParse(req.body ?? {});
    if (!datos.success) return invalido(res);
    const { telefono, texto } = datos.data;
    try {
      if (!(await dentroDelTope(req, res, 'mensajes', TOPE_MENSAJES_MIN, 60))) return;
      let plazo: NodeJS.Timeout | undefined;
      const tarde = new Promise<'tarde'>((ok) => { plazo = setTimeout(() => ok('tarde'), PLAZO_FLUJO_MS); });
      try {
        const fin = await Promise.race([enZonaDePruebas(telefono, () => deps.manejar(telefono, texto)).then(() => 'listo' as const), tarde]);
        // Si tardó demasiado, lo que llegue después se recoge con GET /mensajes.
        res.json({ ...(await respuesta(telefono)), pendiente: fin === 'tarde' });
      } finally { clearTimeout(plazo); }
    } catch (err) {
      // Lo que el bot alcanzó a mandar antes del fallo también se ve: así se encuentra dónde falló.
      fallo(res, 'mensajes', err, await respuesta(telefono).catch(() => ({})));
    }
  });

  r.get('/simulador-whatsapp/mensajes', async (req: AuthedRequest, res) => {
    const tel = TELEFONO.safeParse(req.query.telefono);
    if (!tel.success) return invalido(res);
    try {
      if (!(await dentroDelTope(req, res, 'consultas', TOPE_CONSULTAS_MIN, 60))) return;
      res.json(await respuesta(tel.data));
    } catch (err) { fallo(res, 'consultar', err); }
  });

  r.delete('/simulador-whatsapp/conversaciones/:telefono', async (req: AuthedRequest, res) => {
    const tel = TELEFONO.safeParse(req.params.telefono);
    if (!tel.success) return invalido(res);
    try {
      await deps.limpiar(tel.data);
      buzon.borrar(tel.data);
      res.json({ ok: true });
    } catch (err) { fallo(res, 'reiniciar', err); }
  });

  return r;
}
