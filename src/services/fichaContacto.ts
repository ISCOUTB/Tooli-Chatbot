/**
 * Ficha de la persona para el chat de Atención: todo lo que el panel ya sabe
 * de ella, junto, para que el asesor no tenga que ir al CRM, a Asistencia y a
 * Plantillas por separado.
 *
 * Cada fuente se consulta por su cuenta y, si falla, esa parte queda vacía con
 * su aviso: una hoja de Google que no responde no debe dejar al asesor sin ver
 * el resto. `armarFicha` es pura y se prueba sin red (fichaContacto.test.ts).
 */
import { config } from '../config';
import { VENTANA_TEXTO_LIBRE_MS, ultimoEntranteVerificable } from './replyWindow';
import { isBsuid } from './whatsappId';

export interface DatosFicha {
  telefono: string;
  ahora: number;
  ventanaAplica: boolean;
  mensajesBot: Array<{ ts: number; direction: 'in' | 'out'; text?: string }> | null;
  sesionBot: Record<string, string> | null;
  crm: {
    estado: string; asignadoA?: string; etiquetas: string[];
    notas: Array<{ texto: string; autor: string; ts: number }>;
  } | null;
  registro: string[] | null;
  asistencias: Array<{ evento: string; sector: string; fecha: string; origen: string; registradoEn: number }> | null;
  plantillas: Array<{ templateName: string; createdAt: number; createdBy: string; resultado: string; error?: string }> | null;
  bajaCampanas: boolean | null;
}

export interface FichaContacto {
  telefono: string;
  /** El envío de plantillas solo acepta números con indicativo, no el identificador sin número. */
  puedeRecibirPlantilla: boolean;
  /** null cuando el canal no es Meta: ahí no hay ventana de 24 h. */
  ventana: { abierta: boolean; ultimoEntranteTs: number | null; cierraTs: number | null } | null;
  interes: { nombre: string; correo: string; programa: string; area: string; relacion: string; registradoEl: string };
  crm: DatosFicha['crm'];
  asistencias: NonNullable<DatosFicha['asistencias']>;
  plantillas: NonNullable<DatosFicha['plantillas']>;
  bajaCampanas: boolean | null;
  /** Fuentes que no respondieron: la ficha las nombra en vez de mostrarlas vacías. */
  sinDatos: string[];
}

const RELACIONES: Record<string, string> = {
  estudiante_utb: 'Estudiante UTB', egresado_utb: 'Egresado UTB', externo: 'De otra universidad',
};

function primero(...valores: Array<string | undefined | null>): string {
  return valores.map(v => String(v ?? '').trim()).find(Boolean) ?? '';
}

export function armarFicha(d: DatosFicha): FichaContacto {
  const sinDatos: string[] = [];

  let ventana: FichaContacto['ventana'] = null;
  if (d.ventanaAplica) {
    if (d.mensajesBot === null) {
      sinDatos.push('historial con el bot');
    } else {
      const ultimo = ultimoEntranteVerificable(d.mensajesBot, d.ahora);
      const cierra = ultimo === null ? null : ultimo + VENTANA_TEXTO_LIBRE_MS;
      ventana = { abierta: cierra !== null && cierra > d.ahora, ultimoEntranteTs: ultimo, cierraTs: cierra };
    }
  }

  // Registro del Sheet: A fecha, B nombre, C correo, D WhatsApp, E programa, F área.
  const fila = d.registro ?? [];
  const sesion = d.sesionBot ?? {};
  const interes = {
    nombre: primero(fila[1], sesion.nombre),
    correo: primero(fila[2], sesion.correo, sesion.email),
    programa: primero(fila[4], sesion.programaNombre, sesion.programa, sesion.carrera),
    area: primero(fila[5]),
    relacion: RELACIONES[sesion.relacion] ?? '',
    registradoEl: primero(fila[0]),
  };

  if (d.asistencias === null) sinDatos.push('eventos');
  if (d.plantillas === null) sinDatos.push('plantillas enviadas');
  if (d.crm === null) sinDatos.push('CRM');

  return {
    telefono: d.telefono,
    puedeRecibirPlantilla: !isBsuid(d.telefono) && /^[1-9]\d{9,14}$/.test(d.telefono),
    ventana,
    interes,
    crm: d.crm ? { ...d.crm, notas: d.crm.notas.slice(-3).reverse() } : null,
    asistencias: d.asistencias ?? [],
    plantillas: d.plantillas ?? [],
    bajaCampanas: d.bajaCampanas,
    sinDatos: [...new Set(sinDatos)],
  };
}

/** Las variantes con que puede estar escrito el mismo número en el Sheet. */
export function mismoNumero(a: string, b: string): boolean {
  const x = String(a ?? '').replace(/\D/g, '');
  const y = String(b ?? '').replace(/\D/g, '');
  if (!x || !y) return false;
  const sin57 = (n: string) => (n.length === 12 && n.startsWith('57') ? n.slice(2) : n);
  return x === y || sin57(x) === sin57(y);
}

// El Sheet de registros se lee para todas las fichas: una copia de pocos
// minutos evita gastar la cuota de Google en cada conversación abierta.
const CACHE_REGISTROS_MS = 5 * 60 * 1000;
let registrosCache: { filas: string[][]; at: number } | null = null;

async function registroDe(telefono: string): Promise<string[] | null> {
  if (!registrosCache || Date.now() - registrosCache.at > CACHE_REGISTROS_MS) {
    const { leerRegistrosPosgrado } = await import('./registroService');
    registrosCache = { filas: await leerRegistrosPosgrado(), at: Date.now() };
  }
  // La fila más reciente de esa persona: el Sheet se llena de arriba a abajo.
  const filas = registrosCache.filas.filter(f => mismoNumero(f[3], telefono));
  return filas.length ? filas[filas.length - 1] : null;
}

/** Junta las fuentes; cada una que falle queda en null y la ficha lo dice. */
export async function cargarFicha(telefono: string): Promise<FichaContacto> {
  const [
    { getBotUser }, { getFicha }, { asistenciasPorWhatsapp }, { enviosAContacto }, { estaDadoDeBaja },
  ] = await Promise.all([
    import('./botUserService'), import('./crmService'), import('./asistenciaService'),
    import('./broadcastJobService'), import('./campanaService'),
  ]);
  const seguro = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [bot, crm, registro, asistencias, plantillas, baja] = await Promise.all([
    seguro(getBotUser(telefono)),
    seguro(getFicha(telefono)),
    registroDe(telefono).catch(() => null),
    seguro(asistenciasPorWhatsapp(telefono)),
    seguro(enviosAContacto(telefono)),
    seguro(estaDadoDeBaja(telefono)),
  ]);
  return armarFicha({
    telefono,
    ahora: Date.now(),
    ventanaAplica: config.messagingAdapter === 'meta',
    mensajesBot: bot ? bot.recentMessages : null,
    sesionBot: bot?.session?.data ?? null,
    crm: crm ? { estado: crm.estado, asignadoA: crm.asignadoA, etiquetas: crm.etiquetas, notas: crm.notas.map(n => ({ texto: n.texto, autor: n.autor, ts: n.ts })) } : null,
    registro,
    asistencias,
    plantillas,
    bajaCampanas: baja,
  });
}
