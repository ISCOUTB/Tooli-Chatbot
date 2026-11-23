/**
 * API de la agenda para el panel: /api/tools/agenda/*
 *
 * Es una FÁBRICA (`crearAgendaRouter`) para poder probarla con un servidor de
 * Express real y dobles, sin Redis ni WhatsApp. El montaje con las
 * dependencias de verdad está en agenda.ts. Todo cuelga de `requireAuth`
 * (ver toolsRoutes.ts), así que `req.user` siempre existe.
 *
 * Reglas:
 *   - Cada asesor edita SU disponibilidad y SUS citas; el administrador, las de todos.
 *   - Toda escritura queda en la auditoría: quién, qué y sobre quién (teléfono enmascarado).
 *   - El teléfono completo solo se devuelve al dueño de la agenda y al administrador.
 */

import { Response, Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../../middleware/auth';
import type { AuditAction } from '../../services/auditService';
import {
  AgendaValidacionError, fechaEnPalabras, fechaValida, inicioDelDia, msDeIso, sumarDias,
} from '../../services/agendaLogica';
import type { AgendaServicio, CitaAgenda } from '../../services/agendaService';
import { AgendaError } from '../../services/agendaService';
import { textoConfirmacion, textoReprogramada } from '../../services/agendaTextos';
import { describeError, maskPhone } from '../../services/logSafe';

export interface AvisoPersona { enviado: boolean; motivo?: string }

export interface DepsRouterAgenda {
  servicio: AgendaServicio;
  audit: (username: string, action: AuditAction, detail?: string) => Promise<void>;
  /** Avisa por WhatsApp a la persona respetando la ventana de 24 h. Nunca lanza. */
  avisar: (telefono: string, texto: string) => Promise<AvisoPersona>;
  ahora?: () => number;
}

const HORA = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const FECHA = z.string().refine(fechaValida, 'Fecha AAAA-MM-DD inválida');
const AREA = z.enum(['posgrados', 'pregrado', 'ti']);
const ID_CITA = /^cita_[a-z0-9]{1,40}$/;
const ISO = z.string().refine((v) => Number.isFinite(msDeIso(v)), 'Fecha y hora ISO 8601 con zona (ej. 2026-11-24T09:00:00-05:00)');

export const esquemaDisponibilidad = z.object({
  activo: z.boolean(),
  areas: z.array(AREA).max(3),
  duracionMin: z.number().int(),
  pausaMin: z.number().int().optional(),
  semana: z.array(z.object({ dia: z.number().int().min(0).max(6), desde: HORA, hasta: HORA })).max(70),
  excepciones: z.array(z.object({
    desde: FECHA, hasta: FECHA, horaDesde: HORA.optional(), horaHasta: HORA.optional(), motivo: z.string().max(120).optional(),
  })).max(200).optional(),
}).strict();

export const esquemaConfig = z.object({
  antelacionMin: z.number().int(),
  maxCitasFuturas: z.number().int(),
  diasVentana: z.number().int(),
  festivos: z.array(FECHA).max(400).optional(),
}).strict();

export const esquemaCrearCita = z.object({
  telefono: z.string().min(1).max(40),
  nombre: z.string().max(120).optional(),
  area: AREA,
  asesor: z.string().min(1).max(60),
  inicio: ISO,
  fin: ISO.optional(),
  motivo: z.string().max(300).optional(),
  forzar: z.boolean().optional(),
}).strict();

export const esquemaMover = z.object({
  inicio: ISO,
  fin: ISO.optional(),
  asesor: z.string().min(1).max(60).optional(),
  forzar: z.boolean().optional(),
}).strict();

export const esquemaEstado = z.object({ estado: z.enum(['atendida', 'no_asistio']) }).strict();

const esquemaConsultaCitas = z.object({
  desde: FECHA,
  dias: z.coerce.number().int().min(1).max(31).default(7),
  asesor: z.string().max(60).optional(),
  estado: z.enum(['confirmada', 'cancelada', 'atendida', 'no_asistio']).optional(),
});

const esquemaConsultaFranjas = z.object({
  asesor: z.string().min(1).max(60),
  desde: FECHA.optional(),
  dias: z.coerce.number().int().min(1).max(31).default(7),
});

const MENSAJE_RESERVA = {
  ocupada: 'Ese horario ya está ocupado.',
  invalida: 'El horario no es válido: ya pasó, está fuera de la disponibilidad del asesor o el teléfono no es correcto.',
  limite: 'Esa persona ya tiene el máximo de citas futuras.',
} as const;

const STATUS_CODIGO: Record<string, number> = {
  no_encontrada: 404, ajena: 403, estado_invalido: 409, futura: 409, ocupada: 409, invalida: 400, limite: 409, asesor_invalido: 404,
};

export function crearAgendaRouter(deps: DepsRouterAgenda): Router {
  const router = Router();
  const { servicio } = deps;
  const ahora = () => (deps.ahora ?? Date.now)();

  const puedeEditar = (req: AuthedRequest, asesor: string) =>
    req.user!.role === 'admin' || req.user!.username.toLowerCase() === asesor.toLowerCase();

  const prohibido = (res: Response) => {
    res.status(403).json({ error: 'forbidden', message: 'Solo puedes modificar tu propia agenda.' });
  };

  const invalido = (res: Response, error: z.ZodError | string) => {
    const message = typeof error === 'string' ? error : error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`).join('; ');
    res.status(400).json({ error: 'validation_error', message });
  };

  const fallo = (res: Response, tag: string, err: unknown) => {
    if (err instanceof AgendaValidacionError) { res.status(400).json({ error: 'validation_error', message: err.message }); return; }
    if (err instanceof AgendaError) { res.status(STATUS_CODIGO[err.code] ?? 400).json({ error: err.code, message: err.message }); return; }
    console.error(`[tools/agenda] ${tag}:`, describeError(err));
    res.status(500).json({ error: 'internal_error', message: 'No se pudo completar la operación' });
  };

  const auditar = async (req: AuthedRequest, accion: AuditAction, detalle: string) => {
    try {
      await deps.audit(req.user!.username, accion, detalle);
    } catch (err) {
      console.error('[tools/agenda] auditoría no disponible:', describeError(err));
    }
  };

  const detalleCita = (c: Pick<CitaAgenda, 'id' | 'asesor' | 'telefono' | 'inicio'>) =>
    `${c.id} · asesor ${c.asesor} · persona ${maskPhone(c.telefono)} · ${c.inicio}`;

  /** Lo que ve el panel de una cita: el teléfono completo solo si puede editarla. */
  const paraPanel = (req: AuthedRequest, c: CitaAgenda) => {
    const editar = puedeEditar(req, c.asesor);
    const { telefono, ...resto } = c;
    return { ...resto, telefonoMasc: maskPhone(telefono), ...(editar ? { telefono } : {}), puedeEditar: editar };
  };

  /* ── Asesores y disponibilidad ──────────────────────────────────────── */

  router.get('/agenda/asesores', async (req: AuthedRequest, res: Response) => {
    try {
      const asesores = await servicio.asesores();
      res.json({
        asesores: asesores.map((a) => ({
          username: a.username, nombre: a.nombre, role: a.role,
          activo: a.disponibilidad.activo, areas: a.disponibilidad.areas, duracionMin: a.disponibilidad.duracionMin,
          esYo: a.username.toLowerCase() === req.user!.username.toLowerCase(), puedeEditar: puedeEditar(req, a.username),
        })),
      });
    } catch (err) { fallo(res, 'asesores', err); }
  });

  router.get('/agenda/disponibilidad/:asesor', async (req: AuthedRequest, res: Response) => {
    const asesor = String(req.params.asesor).toLowerCase();
    if (!puedeEditar(req, asesor)) return prohibido(res);
    try { res.json({ disponibilidad: await servicio.disponibilidadDe(asesor) }); } catch (err) { fallo(res, 'disponibilidad', err); }
  });

  router.put('/agenda/disponibilidad/:asesor', async (req: AuthedRequest, res: Response) => {
    const asesor = String(req.params.asesor).toLowerCase();
    if (!puedeEditar(req, asesor)) return prohibido(res);
    const parsed = esquemaDisponibilidad.safeParse(req.body);
    if (!parsed.success) return invalido(res, parsed.error);
    try {
      const disponibilidad = await servicio.guardarDisponibilidad(asesor, parsed.data);
      await auditar(req, 'agenda_disponibilidad_actualizada',
        `asesor ${asesor} · ${disponibilidad.activo ? 'activa' : 'inactiva'} · ${disponibilidad.semana.length} tramos · ${disponibilidad.excepciones.length} excepciones`);
      res.json({ ok: true, disponibilidad });
    } catch (err) { fallo(res, 'guardar disponibilidad', err); }
  });

  router.get('/agenda/config', async (_req, res: Response) => {
    try { res.json({ config: await servicio.obtenerConfig() }); } catch (err) { fallo(res, 'config', err); }
  });

  router.put('/agenda/config', async (req: AuthedRequest, res: Response) => {
    if (req.user!.role !== 'admin') { res.status(403).json({ error: 'forbidden', message: 'Solo el administrador cambia la configuración general.' }); return; }
    const parsed = esquemaConfig.safeParse(req.body);
    if (!parsed.success) return invalido(res, parsed.error);
    try {
      const config = await servicio.guardarConfig({ festivos: [], ...parsed.data });
      await auditar(req, 'agenda_config_actualizada',
        `antelación ${config.antelacionMin} min · máx ${config.maxCitasFuturas} citas · ventana ${config.diasVentana} días · ${config.festivos.length} festivos`);
      res.json({ ok: true, config });
    } catch (err) { fallo(res, 'guardar config', err); }
  });

  /* ── Citas ──────────────────────────────────────────────────────────── */

  router.get('/agenda/franjas', async (req: AuthedRequest, res: Response) => {
    const parsed = esquemaConsultaFranjas.safeParse(req.query);
    if (!parsed.success) return invalido(res, parsed.error);
    try {
      const franjas = await servicio.franjasDeAsesor(parsed.data.asesor, {
        desde: parsed.data.desde ? new Date(inicioDelDia(parsed.data.desde)) : undefined, dias: parsed.data.dias,
      });
      res.json({ franjas });
    } catch (err) { fallo(res, 'franjas', err); }
  });

  router.get('/agenda/citas', async (req: AuthedRequest, res: Response) => {
    const parsed = esquemaConsultaCitas.safeParse(req.query);
    if (!parsed.success) return invalido(res, parsed.error);
    const { desde, dias, asesor, estado } = parsed.data;
    try {
      const citas = await servicio.listarCitas({
        desdeMs: inicioDelDia(desde), hastaMs: inicioDelDia(sumarDias(desde, dias)), asesor, estado,
      });
      res.json({ desde, dias, citas: citas.map((c) => paraPanel(req, c)) });
    } catch (err) { fallo(res, 'listar citas', err); }
  });

  router.post('/agenda/citas', async (req: AuthedRequest, res: Response) => {
    const parsed = esquemaCrearCita.safeParse(req.body);
    if (!parsed.success) return invalido(res, parsed.error);
    const d = parsed.data;
    if (!puedeEditar(req, d.asesor)) return prohibido(res);
    try {
      const disp = await servicio.disponibilidadDe(d.asesor);
      const inicioMs = msDeIso(d.inicio);
      const finMs = d.fin ? msDeIso(d.fin) : inicioMs + disp.duracionMin * 60_000;
      const r = await servicio.reservarPanel({
        telefono: d.telefono, nombre: d.nombre, area: d.area, motivo: d.motivo,
        franja: { asesor: d.asesor, asesorNombre: d.asesor, inicio: d.inicio, fin: new Date(finMs).toISOString() },
      }, req.user!.username, d.forzar === true);
      if (!r.ok) { res.status(STATUS_CODIGO[r.motivo]).json({ error: r.motivo, message: MENSAJE_RESERVA[r.motivo] }); return; }
      await auditar(req, 'agenda_cita_creada', detalleCita(r.cita));
      const aviso = await deps.avisar(r.cita.telefono, `${textoConfirmacion(r.cita, ahora())}\n\n_Esta cita la agendó el equipo de asesores._`);
      res.status(201).json({ ok: true, cita: paraPanel(req, r.cita as CitaAgenda), aviso });
    } catch (err) { fallo(res, 'crear cita', err); }
  });

  /** Carga la cita y comprueba que quien llama puede tocarla. */
  async function citaEditable(req: AuthedRequest, res: Response): Promise<CitaAgenda | null> {
    const id = String(req.params.id ?? '');
    if (!ID_CITA.test(id)) { res.status(400).json({ error: 'validation_error', message: 'id de cita inválido' }); return null; }
    const cita = await servicio.obtenerCita(id);
    if (!cita) { res.status(404).json({ error: 'no_encontrada', message: 'Esa cita ya no existe.' }); return null; }
    if (!puedeEditar(req, cita.asesor)) { prohibido(res); return null; }
    return cita;
  }

  router.post('/agenda/citas/:id/mover', async (req: AuthedRequest, res: Response) => {
    const parsed = esquemaMover.safeParse(req.body);
    if (!parsed.success) return invalido(res, parsed.error);
    try {
      const cita = await citaEditable(req, res);
      if (!cita) return;
      const destino = (parsed.data.asesor ?? cita.asesor).toLowerCase();
      if (!puedeEditar(req, destino)) return prohibido(res);
      const duracionMs = msDeIso(cita.fin) - msDeIso(cita.inicio);
      const inicioMs = msDeIso(parsed.data.inicio);
      const finMs = parsed.data.fin ? msDeIso(parsed.data.fin) : inicioMs + duracionMs;
      const r = await servicio.moverPanel(cita.id, {
        asesor: destino, asesorNombre: destino, inicio: parsed.data.inicio, fin: new Date(finMs).toISOString(),
      }, req.user!.username, parsed.data.forzar === true);
      if (!r.ok) { res.status(STATUS_CODIGO[r.motivo]).json({ error: r.motivo, message: MENSAJE_RESERVA[r.motivo] }); return; }
      await auditar(req, 'agenda_cita_movida', `${detalleCita(cita)} -> ${r.cita.inicio} (${r.cita.id})`);
      const aviso = await deps.avisar(r.cita.telefono, textoReprogramada(r.cita, ahora()));
      res.json({ ok: true, cita: paraPanel(req, r.cita as CitaAgenda), aviso });
    } catch (err) { fallo(res, 'mover cita', err); }
  });

  router.post('/agenda/citas/:id/cancelar', async (req: AuthedRequest, res: Response) => {
    try {
      const cita = await citaEditable(req, res);
      if (!cita) return;
      const cancelada = await servicio.cancelarPanel(cita.id);
      await auditar(req, 'agenda_cita_cancelada', detalleCita(cita));
      const aviso = await deps.avisar(cita.telefono,
        `Tu cita del ${fechaEnPalabras(msDeIso(cita.inicio), ahora())} con ${cita.asesorNombre} fue cancelada por el equipo. ` +
        'Si quieres agendar otra, escribe *agendar*.');
      res.json({ ok: true, cita: paraPanel(req, cancelada), aviso });
    } catch (err) { fallo(res, 'cancelar cita', err); }
  });

  router.post('/agenda/citas/:id/estado', async (req: AuthedRequest, res: Response) => {
    const parsed = esquemaEstado.safeParse(req.body);
    if (!parsed.success) return invalido(res, parsed.error);
    try {
      const cita = await citaEditable(req, res);
      if (!cita) return;
      const marcada = await servicio.marcarPanel(cita.id, parsed.data.estado);
      await auditar(req, parsed.data.estado === 'atendida' ? 'agenda_cita_atendida' : 'agenda_cita_no_asistio', detalleCita(cita));
      res.json({ ok: true, cita: paraPanel(req, marcada) });
    } catch (err) { fallo(res, 'marcar cita', err); }
  });

  return router;
}
