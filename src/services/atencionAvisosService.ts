/** Avisos por correo para conversaciones que siguen sin asesor disponible. */

import Redis from 'ioredis';
import { config } from '../config';
import {
  conversacionesEnEspera,
  dentroDeHorario,
  equiposDeAtencion,
  estaConectado,
  obtenerConfigAtencionCacheada,
  obtenerEstadoAsesor,
} from './atencionEquipoService';
import type { ConversacionEnEspera, EstadoAsesor } from './atencionEquipoService';
import { correoConfigurado, enviarCorreo } from './mailService';
import { describeError } from './logSafe';

const ULTIMO_AVISO_KEY = 'atencion:ultimo-aviso-correo';
const INTERVALO_REVISION_MS = 60_000;

// Este cliente no conecta al importar: las pruebas de las funciones puras no
// deben necesitar Redis, igual que las de atencionEquipoService.
const redis = new Redis(config.redis.url, { lazyConnect: true });

type AreaAtencion = 'ti' | 'admisiones';
type ConteoPorArea = Record<AreaAtencion, number>;

export interface AsesorAvisos {
  username: string;
  email?: string;
  area?: AreaAtencion | 'all';
  vinculado: boolean;
  conectado: boolean;
  estado: EstadoAsesor;
  ultimoAviso: number;
}

export interface AvisoCorreoPlaneado {
  username: string;
  email: string;
  porArea: ConteoPorArea;
}

/* Chatwoot no dice desde cuándo una conversación está sin asesor, así que se
   anota la primera revisión en que aparece en espera. */
export function actualizarPrimeraVez(
  anterior: Map<number, number>,
  enEsperaIds: number[],
  ahora: number,
): Map<number, number> {
  return new Map(enEsperaIds.map((id): [number, number] => [id, anterior.get(id) ?? ahora]));
}

const cubreArea = (areaAsesor: AsesorAvisos['area'], area: AreaAtencion): boolean =>
  areaAsesor === 'all' || areaAsesor === area;

/**
 * El correo es para quien no está mirando: si alguien del área está Disponible
 * en el panel, esa área no avisa (la cola de espera o esa persona la atienden),
 * y quien tiene el panel abierto ya recibe el aviso del navegador. Los 2
 * minutos evitan avisar de lo que alguien toma al instante.
 */
export function planificarAvisosCorreo({
  enEspera,
  primeraVez,
  asesores,
  ahora,
  esperaMinimaMs = 2 * 60_000,
  intervaloMs = 30 * 60_000,
}: {
  enEspera: ConversacionEnEspera[];
  primeraVez: Map<number, number>;
  asesores: AsesorAvisos[];
  ahora: number;
  esperaMinimaMs?: number;
  intervaloMs?: number;
}): AvisoCorreoPlaneado[] {
  const disponibles: Record<AreaAtencion, boolean> = {
    ti: asesores.some((asesor) => asesor.vinculado && asesor.conectado && asesor.estado === 'disponible' && cubreArea(asesor.area, 'ti')),
    admisiones: asesores.some((asesor) => asesor.vinculado && asesor.conectado && asesor.estado === 'disponible' && cubreArea(asesor.area, 'admisiones')),
  };
  const esperando: ConteoPorArea = { ti: 0, admisiones: 0 };
  for (const conversacion of enEspera) {
    const desde = primeraVez.get(conversacion.id);
    if (desde !== undefined && ahora - desde >= esperaMinimaMs && !disponibles[conversacion.area]) {
      esperando[conversacion.area]++;
    }
  }

  return asesores.flatMap((asesor): AvisoCorreoPlaneado[] => {
    const email = asesor.email?.trim();
    if (!email || !asesor.vinculado || asesor.conectado || asesor.estado === 'ausente' || ahora - asesor.ultimoAviso < intervaloMs) return [];
    const porArea: ConteoPorArea = {
      ti: cubreArea(asesor.area, 'ti') ? esperando.ti : 0,
      admisiones: cubreArea(asesor.area, 'admisiones') ? esperando.admisiones : 0,
    };
    return porArea.ti || porArea.admisiones ? [{ username: asesor.username, email, porArea }] : [];
  });
}

const ENTIDADES_HTML: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escaparHtml = (valor: string): string => valor.replace(/[&<>"']/g, (caracter) => ENTIDADES_HTML[caracter]);

const fraseConteo = (cantidad: number, area: string): string =>
  `${cantidad} ${cantidad === 1 ? 'conversación' : 'conversaciones'} de ${area}`;

export function textoAvisoCorreo(porArea: ConteoPorArea, panelUrl: string): { subject: string; text: string; html: string } {
  const partes = [
    porArea.admisiones ? fraseConteo(porArea.admisiones, 'Admisiones') : '',
    porArea.ti ? fraseConteo(porArea.ti, 'TI') : '',
  ].filter(Boolean);
  const conteo = partes.length === 2 ? `${partes[0]} y ${partes[1]}` : partes[0] ?? '';
  const base = panelUrl.replace(/\/+$/, '');
  const enlace = `${base}/app/#atencion`;
  const motivo = 'Recibes este correo porque perteneces al equipo de esas áreas, tienes el panel cerrado y no estás Ausente.';
  const mensaje = `Hay ${conteo} esperando asesor, y nadie de esas áreas está disponible en el panel.`;
  const subject = 'Tooli: conversaciones esperando asesor';
  const text = `${mensaje}\n\n${motivo}\n\nAbrir el panel: ${enlace}`;
  const enlaceHtml = escaparHtml(enlace);
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #172033;">
      <h2 style="color: #005BFF;">Conversaciones esperando asesor</h2>
      <p>${mensaje}</p>
      <p style="color: #64748b; font-size: 13px;">${motivo}</p>
      <p><a href="${enlaceHtml}" style="display: inline-block; padding: 11px 18px; border-radius: 8px; background: #005BFF; color: #ffffff; text-decoration: none;">Abrir el panel</a></p>
    </div>`;
  return { subject, text, html };
}

let primeraVez = new Map<number, number>();
let iniciado = false;
let revisando = false;
let correoSinConfigurarInformado = false;

async function ejecutarRevisionAvisos(): Promise<void> {
  const configuracion = await obtenerConfigAtencionCacheada();
  if (!configuracion.avisosCorreo || !dentroDeHorario(configuracion.horario, new Date())) {
    primeraVez = new Map();
    return;
  }
  if (!correoConfigurado()) {
    if (!correoSinConfigurarInformado) {
      correoSinConfigurarInformado = true;
      console.info('[atencionAvisos] avisos habilitados, pero el correo no está configurado');
    }
    return;
  }

  const { listUsers } = await import('./usersService');
  const usuarios = await listUsers();
  const estados = await Promise.all(usuarios.map((usuario) => obtenerEstadoAsesor(usuario.username)));
  const hayDestinatario = usuarios.some((usuario, i) =>
    Boolean(usuario.email?.trim() && usuario.chatwootUserId && !estaConectado(usuario.username) && estados[i] !== 'ausente'));
  if (!hayDestinatario) return;

  const { listarConversaciones } = await import('./chatwootAtencion');
  const { conversaciones } = await listarConversaciones('open');
  const enEspera = conversacionesEnEspera(conversaciones, equiposDeAtencion());
  const ahora = Date.now();
  primeraVez = actualizarPrimeraVez(primeraVez, enEspera.map((conversacion) => conversacion.id), ahora);
  if (!enEspera.length) return;

  const usernames = usuarios.map((usuario) => usuario.username.toLowerCase());
  const ultimos = await redis.hmget(ULTIMO_AVISO_KEY, ...usernames);
  const asesores: AsesorAvisos[] = usuarios.map((usuario, i) => ({
    username: usuario.username,
    email: usuario.email,
    area: usuario.area,
    vinculado: Boolean(usuario.chatwootUserId),
    conectado: estaConectado(usuario.username),
    estado: estados[i],
    ultimoAviso: Number(ultimos[i]) || 0,
  }));
  const avisos = planificarAvisosCorreo({ enEspera, primeraVez, asesores, ahora });

  let enviados = 0;
  for (const aviso of avisos) {
    try {
      await enviarCorreo({ to: aviso.email, ...textoAvisoCorreo(aviso.porArea, config.publicUrls.panel) });
      enviados++;
    } catch (err) {
      // No se incluye el destinatario ni la respuesta de Resend: el motivo
      // operativo basta y el siguiente ciclo reintenta solo lo necesario.
      console.error(`[atencionAvisos] no se pudo enviar un aviso: ${describeError(err)}`);
      continue;
    }
    try {
      await redis.hset(ULTIMO_AVISO_KEY, aviso.username.toLowerCase(), Date.now());
    } catch (err) {
      // El correo ya salió; se informa solo el fallo operativo de Redis.
      console.error(`[atencionAvisos] no se pudo guardar el intervalo de un aviso: ${describeError(err)}`);
    }
  }
  if (enviados) console.info(`[atencionAvisos] avisos enviados: ${enviados}`);
}

export async function revisarAvisos(): Promise<void> {
  if (revisando) return;
  revisando = true;
  try {
    await ejecutarRevisionAvisos();
  } catch (err) {
    console.error(`[atencionAvisos] falló la revisión: ${describeError(err)}`);
  } finally {
    revisando = false;
  }
}

/** Se registra una sola vez al arrancar el servidor. */
export function iniciarAvisosCorreo(): void {
  if (iniciado) return;
  iniciado = true;
  setInterval(() => void revisarAvisos(), INTERVALO_REVISION_MS).unref();
}
