import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type {
  AcademicoApi, Estudiante, ResultadoConfirmacion, ResultadoConsulta, ResultadoEnvioVerificacion, TipoConsulta,
} from '../../contratos/academico';
import { RECURSOS_ACADEMICOS } from '../academicoLinks';
import type { ReglaNotas } from './calculos';
import { armarNotas } from './notasVista';
import type { Interruptores } from './interruptores';
import { enmascararCorreo, enmascararTelefono, normalizarCedula, normalizarCodigo } from './identidadAcademica';
import { formatearPesos } from './pesos';
import type {
  ClaseHorario, DatosEstudiante, ProveedorCursos, ProveedorHorario, ProveedorNotas, ProveedorRecibo, ProveedorTurno,
  TareaProxima, TurnoDato, Vencimiento,
} from './tipos';
import {
  fechaConDiaEnPalabras, fechaEnPalabras, horaEnPalabras, limpiarParaVoz, montoEnPalabras,
  numeroEnPalabras, unirConY,
} from './voz';

/**
 * Orquestador de datos académicos. NO importa Redis, Playwright ni googleapis:
 * recibe todo por `deps`, de modo que cada prueba lo arma con fakes. La
 * conexión con las integraciones reales vive en ./servicio.ts.
 */

export interface IdentidadVigente {
  email: string;
  codigo?: string;
  codigoVerificado?: boolean;
  nombre?: string;
  programa?: string;
  nivel?: 'pregrado' | 'posgrado';
}

export interface DepsNucleo {
  identidad: {
    obtener(telefono: string): Promise<IdentidadVigente | null>;
    porCodigo(codigo: string): Promise<{ telefono: string; email: string } | null>;
    porCedula(cedula: string): Promise<{ telefono: string; email: string } | null>;
  };
  /** ¿Existe ese código en una fuente oficial (la hoja de turnos)? Solo para buscarParaVerificar. */
  existeCodigoEnFuente(codigo: string): Promise<boolean>;
  /** Cédula descifrada del estudiante, si quedó guardada al vincular. */
  cedulaDe(telefono: string): Promise<string | null>;
  interruptores: Interruptores;
  proveedores: {
    notas?: ProveedorNotas;
    recibo?: ProveedorRecibo;
    turno?: ProveedorTurno;
    horario?: ProveedorHorario;
    cursos?: ProveedorCursos;
  };
  /**
   * false si se agotó el cupo de búsquedas por código/cédula (anti-enumeración). Con `telefonoLlamante` (la voz)
   * se gasta primero el cupo de ese número y solo después el global, que es un techo alto (H4).
   */
  permitirBusqueda(telefonoLlamante?: string): Promise<boolean>;
  regla(): ReglaNotas;
  ahora(): Date;
  /**
   * Verificación por dato (la voz, desde otro número). Sin esto `crearAcademico`
   * no ofrece `iniciarVerificacionPorDato` ni `confirmarVerificacion`.
   *
   * Es una verificación SOLO PARA LA LLAMADA: nunca toca el vínculo de WhatsApp
   * (antes usaba checkCode de identityService, que movía el vínculo al número que
   * llamaba). El código es propio de la voz, se guarda como HMAC atado a
   * (número que llama, teléfono del vínculo encontrado), vence a los 10 min y
   * admite 3 intentos.
   */
  verificacion?: {
    /** Manda el código al correo institucional (misma plantilla que el OTP de WhatsApp). */
    enviarCorreo(email: string, codigo6: string): Promise<void>;
    /** Pendientes de la voz, uno por número que llama. */
    pendientes: AlmacenPendientesVoz;
    /** Secreto del HMAC (el código nunca se guarda en claro). */
    secreto: string;
    generarCodigo?: () => string;
  };
}

/** Código de voz pendiente. Vive solo en el servidor (Redis); `telefonoEstudiante` nunca se dice por voz. */
export interface PendienteVoz {
  huella: string;
  telefonoEstudiante: string;
  email: string;
  intentos: number;
  /** ms epoch */
  expira: number;
  creado: number;
}

/** Topes de envío y bloqueos de la voz (auditoría 22-nov: H1). */
export interface LimitesVoz {
  /** Marca de espera por número que llama: sobrevive al borrado del pendiente (éxito o 3 fallos). */
  esperaMs: number;
  maxHoraLlamante: number;
  maxDiaLlamante: number;
  /** Por estudiante destino: cubre al que rota o falsifica el número que llama. */
  maxHoraDestino: number;
  maxDiaDestino: number;
  horaMs: number;
  diaMs: number;
  maxIntentos: number;
  /** Agotar los intentos tantas veces en `horaMs` bloquea al número que llama durante `bloqueoMs`. */
  agotamientosLlamante: number;
  /** Agotar los intentos tantas veces en `diaMs` (desde cualquier número) bloquea al destino durante `bloqueoMs`. */
  agotamientosDestino: number;
  bloqueoMs: number;
}

export type ResultadoReservaVoz = 'ok' | 'espera' | 'bloqueado';
export type ResultadoIntentoVoz = 'ok' | 'no_coincide' | 'demasiados' | 'vencido';

export interface AlmacenPendientesVoz {
  leer(telefonoLlamante: string): Promise<PendienteVoz | null>;
  guardar(telefonoLlamante: string, p: PendienteVoz, ttlMs: number): Promise<void>;
  borrar(telefonoLlamante: string): Promise<void>;
  /**
   * ATÓMICO (Lua en Redis): mira bloqueos, marca de espera y topes del llamante y del destino; si todo cabe, deja la
   * marca de espera, cuenta el envío y guarda el pendiente, en un solo paso (H1, H3).
   * Si el almacén no lo trae (fakes de prueba), el núcleo usa uno en memoria del proceso, serializado.
   */
  crearSiCabe?(telefonoLlamante: string, p: PendienteVoz, ttlMs: number, ahora: number, l: LimitesVoz): Promise<ResultadoReservaVoz>;
  /**
   * ATÓMICO: comprueba que el pendiente siga siendo el de `telefonoEstudiante`, compara la huella, suma el intento y
   * consume el pendiente (al acertar o al agotar intentos) en un solo paso (H2). Al agotar cuenta para el bloqueo.
   */
  intentar?(telefonoLlamante: string, telefonoEstudiante: string, huella: string, ahora: number, l: LimitesVoz): Promise<ResultadoIntentoVoz>;
}

export const VOZ_OTP_TTL_MS = 10 * 60_000;
export const VOZ_OTP_MAX_INTENTOS = 3;
/** Un número que llama no puede pedir otro código antes de esto (mismo enfriamiento que el OTP de WhatsApp). */
export const VOZ_OTP_ESPERA_MS = 60_000;
export const LIMITES_VOZ: LimitesVoz = {
  esperaMs: VOZ_OTP_ESPERA_MS,
  maxHoraLlamante: 5, maxDiaLlamante: 10,
  maxHoraDestino: 5, maxDiaDestino: 10,
  horaMs: 3600_000, diaMs: 24 * 3600_000,
  maxIntentos: VOZ_OTP_MAX_INTENTOS,
  agotamientosLlamante: 2, agotamientosDestino: 3,
  bloqueoMs: 3600_000,
};

/** Claves del estado de la voz (las mismas en Redis y en la versión en memoria). */
export const clavesVoz = {
  pendiente: (llamante: string) => `voz-otp:${llamante}`,
  espera: (llamante: string) => `voz-otp-espera:${llamante}`,
  horaLlamante: (llamante: string) => `voz-otp-n:hora:llamante:${llamante}`,
  diaLlamante: (llamante: string) => `voz-otp-n:dia:llamante:${llamante}`,
  horaDestino: (destino: string) => `voz-otp-n:hora:destino:${destino}`,
  diaDestino: (destino: string) => `voz-otp-n:dia:destino:${destino}`,
  agotLlamante: (llamante: string) => `voz-otp-agot:llamante:${llamante}`,
  agotDestino: (destino: string) => `voz-otp-agot:destino:${destino}`,
  bloqLlamante: (llamante: string) => `voz-otp-bloq:llamante:${llamante}`,
  bloqDestino: (destino: string) => `voz-otp-bloq:destino:${destino}`,
};

/**
 * Versión en memoria de `crearSiCabe`/`intentar` para almacenes que solo traen leer/guardar/borrar (fakes de prueba).
 * Serializa todo con una cola: dentro del proceso es tan atómica como el Lua. En producción se usa el Lua de
 * identityService (pendientesVoz), que vale entre procesos.
 */
export function atomicoEnMemoria(
  base: Pick<AlmacenPendientesVoz, 'leer' | 'guardar' | 'borrar'>,
): Required<Pick<AlmacenPendientesVoz, 'crearSiCabe' | 'intentar'>> {
  const hasta = new Map<string, number>();                         // marcas con vencimiento (espera, bloqueos)
  const cuentas = new Map<string, { n: number; hasta: number }>(); // contadores de ventana fija
  let cola: Promise<unknown> = Promise.resolve();
  const enCola = <T>(f: () => Promise<T>): Promise<T> => {
    const r = cola.then(f, f);
    cola = r.catch(() => undefined);
    return r;
  };
  const vive = (k: string, ahora: number) => (hasta.get(k) ?? 0) > ahora;
  const cuenta = (k: string, ahora: number) => { const c = cuentas.get(k); return c && c.hasta > ahora ? c.n : 0; };
  const sumar = (k: string, ahora: number, ventana: number) => {
    const c = cuentas.get(k);
    const vigente = c && c.hasta > ahora;
    const n = vigente ? c.n + 1 : 1;
    cuentas.set(k, { n, hasta: vigente ? c.hasta : ahora + ventana });
    return n;
  };
  return {
    crearSiCabe: (ll, p, ttlMs, ahora, l) => enCola(async () => {
      const d = p.telefonoEstudiante;
      if (vive(clavesVoz.bloqLlamante(ll), ahora) || vive(clavesVoz.bloqDestino(d), ahora)) return 'bloqueado';
      if (vive(clavesVoz.espera(ll), ahora)) return 'espera';
      if (cuenta(clavesVoz.horaLlamante(ll), ahora) >= l.maxHoraLlamante
        || cuenta(clavesVoz.diaLlamante(ll), ahora) >= l.maxDiaLlamante
        || cuenta(clavesVoz.horaDestino(d), ahora) >= l.maxHoraDestino
        || cuenta(clavesVoz.diaDestino(d), ahora) >= l.maxDiaDestino) return 'espera';
      hasta.set(clavesVoz.espera(ll), ahora + l.esperaMs);
      sumar(clavesVoz.horaLlamante(ll), ahora, l.horaMs);
      sumar(clavesVoz.diaLlamante(ll), ahora, l.diaMs);
      sumar(clavesVoz.horaDestino(d), ahora, l.horaMs);
      sumar(clavesVoz.diaDestino(d), ahora, l.diaMs);
      await base.guardar(ll, p, ttlMs);
      return 'ok';
    }),
    intentar: (ll, destino, huella, ahora, l) => enCola(async () => {
      const p = await base.leer(ll);
      if (!p || p.telefonoEstudiante !== destino) return 'vencido';
      if (ahora > p.expira) { await base.borrar(ll); return 'vencido'; }
      if (p.intentos >= l.maxIntentos) { await base.borrar(ll); return 'demasiados'; }
      if (mismaHuella(huella, p.huella)) { await base.borrar(ll); return 'ok'; }
      const intentos = p.intentos + 1;
      if (intentos < l.maxIntentos) {
        await base.guardar(ll, { ...p, intentos }, Math.max(1, p.expira - ahora));
        return 'no_coincide';
      }
      await base.borrar(ll);
      if (sumar(clavesVoz.agotLlamante(ll), ahora, l.horaMs) >= l.agotamientosLlamante) hasta.set(clavesVoz.bloqLlamante(ll), ahora + l.bloqueoMs);
      if (sumar(clavesVoz.agotDestino(destino), ahora, l.diaMs) >= l.agotamientosDestino) hasta.set(clavesVoz.bloqDestino(destino), ahora + l.bloqueoMs);
      return 'demasiados';
    }),
  };
}

/**
 * Cupos anti-enumeración (H4). Sin número que llama (buscarParaVerificar) queda el cupo global de siempre. Con número
 * (la voz) se gasta primero el de ese número y, solo si cabe, un global aparte y alto: un solo llamante no puede
 * agotarlo. Un atacante que rota números sí podría; lo frenan los topes por estudiante destino de `LIMITES_VOZ`.
 */
export const CUPOS_BUSQUEDA = {
  sinLlamante: { clave: 'academico-buscar', max: 30, ventanaS: 60 },
  porLlamante: { clave: 'academico-buscar-llamante', max: 10, ventanaS: 600 },
  vozGlobal: { clave: 'academico-buscar-voz', max: 300, ventanaS: 60 },
};
export type ComprobarCupo = (clave: string, max: number, ventanaS: number) => Promise<{ allowed: boolean }>;
export function crearPermisoBusqueda(comprobar: ComprobarCupo): (telefonoLlamante?: string) => Promise<boolean> {
  const c = CUPOS_BUSQUEDA;
  return async (telefonoLlamante) => {
    if (!telefonoLlamante) return (await comprobar(c.sinLlamante.clave, c.sinLlamante.max, c.sinLlamante.ventanaS)).allowed;
    if (!(await comprobar(`${c.porLlamante.clave}:${telefonoLlamante}`, c.porLlamante.max, c.porLlamante.ventanaS)).allowed) return false;
    return (await comprobar(c.vozGlobal.clave, c.vozGlobal.max, c.vozGlobal.ventanaS)).allowed;
  };
}

/**
 * La clave del HMAC de voz no puede ser pública: si es el valor por defecto de config, el de .env.example o falta,
 * la verificación por voz se apaga (devuelve 'error') salvo en las pruebas.
 */
export const SECRETOS_PUBLICOS = [
  'cambia-este-secreto-largo-para-jwt-tooli-2026',
  'cambia_esto_por_un_secreto_largo_y_aleatorio_para_jwt',
];
export function secretoVozUsable(secreto: string | undefined, esPrueba: boolean): string {
  const s = (secreto ?? '').trim();
  if (!s) return '';
  if (!esPrueba && (SECRETOS_PUBLICOS.includes(s) || s.length < 16)) return '';
  return s;
}

/** HMAC del código, atado al número que llama Y al vínculo encontrado: otro llamante o otro vínculo no coinciden. */
export function huellaCodigoVoz(secreto: string, telefonoLlamante: string, telefonoEstudiante: string, codigo6: string): string {
  return createHmac('sha256', secreto).update(`voz-academico:${telefonoLlamante}:${telefonoEstudiante}:${codigo6}`).digest('hex');
}

function mismaHuella(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

type Falla = Extract<ResultadoConsulta, { ok: false }>;
type Exito = Extract<ResultadoConsulta, { ok: true }>;

const NOMBRE: Record<TipoConsulta, string> = {
  notas: 'tus notas', recibo: 'tu recibo', turno: 'tu turno de matrícula', horario: 'tu horario', cursos: 'tus cursos de Savio',
};

const urlDe = (id: string, respaldo: string): string => RECURSOS_ACADEMICOS.find((r) => r.id === id)?.url ?? respaldo;
const PORTAL: Record<TipoConsulta, string> = {
  notas: urlDe('notas', 'https://autoservicio4prod.utb.edu.co'),
  recibo: urlDe('recibo', 'https://iceberg-niif.utb.edu.co/iceberg-pf/'),
  turno: urlDe('calendario', 'https://www.utb.edu.co'),
  horario: urlDe('horario', 'https://autoservicio4prod.utb.edu.co'),
  cursos: urlDe('savio', 'https://savio.utb.edu.co/my/'),
};

/** Frase de voz siempre limpia (sin emojis ni markdown) y terminada en punto. */
function voz(texto: string): string {
  const limpio = limpiarParaVoz(texto);
  return /[.!?]$/.test(limpio) ? limpio : `${limpio}.`;
}

function falla(tipo: TipoConsulta, motivo: Falla['motivo'], paraVoz: string, paraTexto: string): Falla {
  return { ok: false, tipo, motivo, paraVoz: voz(paraVoz), paraTexto };
}

function exito(tipo: TipoConsulta, datos: unknown, paraVoz: string, paraTexto: string): Exito {
  return { ok: true, tipo, datos, paraVoz: voz(paraVoz), paraTexto };
}

const fallaError = (tipo: TipoConsulta): Falla => falla(
  tipo, 'error',
  `En este momento no pude consultar ${NOMBRE[tipo]}. Intenta de nuevo en un rato.`,
  `No pude consultar ${NOMBRE[tipo]} ahora. Intenta más tarde o entra directamente: ${PORTAL[tipo]}`,
);

// Hora de Colombia (UTC-5, sin horario de verano).
const enColombia = (d: Date): Date => new Date(d.getTime() - 5 * 3600_000);
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ORDEN_DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function rangoEnPalabras(c: ClaseHorario): string {
  return `de ${horaEnPalabras(c.inicio)} a ${horaEnPalabras(c.fin)}`;
}

export function crearAcademico(deps: DepsNucleo): AcademicoApi {
  // Pasos atómicos de la voz: los del almacén (Lua en Redis) o, si no los trae, los de memoria serializados.
  const almacenVoz = deps.verificacion?.pendientes;
  const enMemoria = almacenVoz && !(almacenVoz.crearSiCabe && almacenVoz.intentar) ? atomicoEnMemoria(almacenVoz) : null;
  const atomico = {
    crearSiCabe: (...a: Parameters<NonNullable<AlmacenPendientesVoz['crearSiCabe']>>) =>
      (enMemoria ? enMemoria.crearSiCabe(...a) : almacenVoz!.crearSiCabe!(...a)),
    intentar: (...a: Parameters<NonNullable<AlmacenPendientesVoz['intentar']>>) =>
      (enMemoria ? enMemoria.intentar(...a) : almacenVoz!.intentar!(...a)),
  };
  async function estudianteDe(telefono: string): Promise<Estudiante | null> {
    const id = await deps.identidad.obtener(telefono);
    if (!id) return null;
    return {
      telefono, email: id.email,
      ...(id.codigo ? { codigo: id.codigo } : {}),
      ...(id.nombre ? { nombre: id.nombre } : {}),
      ...(id.programa ? { programa: id.programa } : {}),
      ...(id.nivel ? { nivel: id.nivel } : {}),
    };
  }

  const interruptor = (tipo: TipoConsulta): boolean => deps.interruptores[tipo]();

  function apagado(tipo: TipoConsulta): Falla {
    return falla(
      tipo, 'apagado',
      `Por ahora no puedo consultar ${NOMBRE[tipo]} desde aquí. Puedes verlo en el portal oficial de la universidad.`,
      `Por ahora no consulto ${NOMBRE[tipo]} desde el bot. Hazlo en el portal oficial de la UTB: ${PORTAL[tipo]}\n\nNo envíes tu contraseña por WhatsApp.`,
    );
  }

  const noVerificado = (tipo: TipoConsulta): Falla => falla(
    tipo, 'no_verificado',
    'Antes de darte esa información necesito confirmar que eres estudiante. Escríbele a Tooli por WhatsApp con tu correo institucional para vincular tu número, y luego vuelve a pedirlo.',
    '🔐 Primero verifica tu identidad: escribe *menu* y elige *Mi vida académica* para vincular tu correo institucional.',
  );

  const sinCodigo = (tipo: TipoConsulta, extra = ''): Falla => falla(
    tipo, 'sin_codigo',
    `Para ${tipo === 'turno' ? 'ver tu turno' : 'consultar eso'} necesito asociar tu código estudiantil a tu número. ${extra}Escríbele a Tooli por WhatsApp y elige Mi semestre para vincularlo.`.replace(/\s+/g, ' '),
    '🔗 Falta vincular tu *código estudiantil*. Escribe *menu*, entra a *Mi semestre* y sigue los pasos (te pediré el código y la cédula una sola vez).',
  );

  const sinSesion = (tipo: TipoConsulta): Falla => falla(
    tipo, 'sin_sesion',
    `Para ver ${NOMBRE[tipo]} necesito que inicies sesión una vez en el portal. Te dejé las instrucciones en el chat de Tooli por WhatsApp.`,
    `🔑 Para ver ${NOMBRE[tipo]} necesito que inicies sesión. Escribe *menu*, entra a *Mi semestre* y elige la opción correspondiente.`,
  );

  // ── Notas ───────────────────────────────────────────────────────────────────
  async function notas(e: DatosEstudiante): Promise<ResultadoConsulta> {
    if (!deps.proveedores.notas) return apagado('notas');
    const r = await deps.proveedores.notas.consultar(e);
    if (r.estado === 'sin_sesion') return sinSesion('notas');
    if (r.estado === 'error') return fallaError('notas');
    const v = armarNotas(r.cursos, r.periodo, deps.regla());
    return exito('notas', v.datos, v.paraVoz, v.paraTexto);
  }

  // ── Recibo ──────────────────────────────────────────────────────────────────
  function frasesVencimiento(v: Vencimiento, ahora: Date): string {
    const valor = v.valor ? `, por ${montoEnPalabras(v.valor)}` : '';
    const recargo = v.recargo && v.recargo !== '0%'
      ? `, con ${numeroEnPalabras(parseInt(v.recargo, 10))} por ciento de recargo` : '';
    const nombre = v.tipo === 'ORDINARIA' ? 'matrícula ordinaria'
      : v.tipo === 'EXTRAORDINARIA' ? 'matrícula extraordinaria' : 'matrícula extemporánea';
    return `${nombre}: paga hasta ${fechaEnPalabras(v.fecha, ahora)}${valor}${recargo}`;
  }

  async function recibo(e: DatosEstudiante): Promise<ResultadoConsulta> {
    if (!deps.proveedores.recibo) return apagado('recibo');
    if (!e.codigo || !e.codigoVerificado) return sinCodigo('recibo');
    const cedula = await deps.cedulaDe(e.telefono);
    if (!cedula) {
      return falla(
        'recibo', 'sin_codigo',
        'Para bajar tu recibo necesito tu cédula, que no tengo guardada. Escríbele a Tooli por WhatsApp, elige Mi semestre y pide el recibo.',
        '🧾 Para bajar tu recibo necesito tu *cédula* (no la tengo guardada). Escribe *menu*, entra a *Mi semestre* y elige *Recibo*.',
      );
    }
    const r = await deps.proveedores.recibo.consultar(e.codigo, cedula);
    if (r.estado === 'error') return fallaError('recibo');
    if (r.estado === 'credenciales') {
      return falla(
        'recibo', 'sin_codigo',
        'El portal ya no reconoce tu código con tu cédula. Vuelve a vincular tu código desde Tooli por WhatsApp.',
        '⚠️ El portal ya no reconoce tu código con tu cédula. Escribe *menu*, entra a *Mi semestre* y vuelve a vincular tu código.',
      );
    }
    if (r.estado === 'sin_recibos') {
      return exito('recibo', { pendiente: false, nombre: r.nombre ?? null },
        'No tienes recibos pendientes de pago en este momento.',
        `${r.nombre ? `Hola *${r.nombre}*. ` : ''}No tienes recibos pendientes en el portal en este momento.\n\n_Escribe *menu* para volver al inicio._`);
    }
    const ahora = deps.ahora();
    const datos = { pendiente: true, nombre: r.nombre ?? null, vencimientos: r.vencimientos, pdf: r.pdf };
    const ord = r.vencimientos.find((v) => v.tipo === 'ORDINARIA');
    const partes = (ord ? [ord, ...r.vencimientos.filter((v) => v !== ord)] : r.vencimientos)
      .slice(0, 2).map((v) => frasesVencimiento(v, ahora));
    const textoVoz = partes.length
      ? `Tu recibo de matrícula está listo. ${partes.join('. ')}.`
      : 'Tu recibo de matrícula está listo.';
    let texto = `🧾 *Recibo de matrícula*${r.nombre ? ` — ${r.nombre}` : ''}\n`;
    for (const v of r.vencimientos) {
      const etiqueta = v.tipo === 'ORDINARIA' ? 'Ordinaria' : v.tipo === 'EXTRAORDINARIA' ? 'Extraordinaria' : 'Extemporánea';
      texto += `\n📅 *${etiqueta}:* hasta el *${v.fecha}*${v.valor ? ` · ${formatearPesos(v.valor)}` : ''}${v.recargo && v.recargo !== '0%' ? ` (+${v.recargo} de recargo)` : ''}`;
    }
    texto += '\n\n_Escribe *menu* para volver al inicio._';
    return exito('recibo', datos, textoVoz, texto);
  }

  // ── Turno ───────────────────────────────────────────────────────────────────
  async function turno(e: DatosEstudiante): Promise<ResultadoConsulta> {
    if (!deps.proveedores.turno) return apagado('turno');
    if (!e.codigo || !e.codigoVerificado) return sinCodigo('turno');
    let t: TurnoDato | null;
    try { t = await deps.proveedores.turno.consultar(e.codigo); } catch { return fallaError('turno'); }
    if (!t) {
      return falla(
        'turno', 'no_encontrado',
        'No encontré tu turno de matrícula todavía. Puede que no esté publicado; revisa más adelante.',
        'No encontré un turno para tu código. Puede que aún no esté publicado. Escribe *menu* para volver.',
      );
    }
    const ahora = deps.ahora();
    const numero = /^\d+$/.test(t.turno.trim()) ? numeroEnPalabras(Number(t.turno)) : t.turno;
    let textoVoz = `Tu turno de matrícula es el número ${numero}. Te toca ${fechaEnPalabras(t.fecha, ahora)} a ${horaEnPalabras(t.hora)}.`;
    if (t.fechaLimite) {
      textoVoz += ` Tienes hasta ${fechaEnPalabras(t.fechaLimite, ahora)}${t.horaLimite ? ` a ${horaEnPalabras(t.horaLimite)}` : ''}.`;
    }
    const texto = `📋 *Turno de matrícula*\n\n👤 ${t.nombre}\n🎓 ${t.programa}\n🔢 Turno: *${t.turno}*\n📅 Fecha: ${t.fecha}\n⏰ Hora: ${t.hora}`
      + `${t.fechaLimite ? `\n⌛ Límite: ${t.fechaLimite}${t.horaLimite ? ` ${t.horaLimite}` : ''}` : ''}\n\n_Escribe *menu* para volver al inicio._`;
    return exito('turno', t, textoVoz, texto);
  }

  // ── Horario ─────────────────────────────────────────────────────────────────
  async function horario(e: DatosEstudiante): Promise<ResultadoConsulta> {
    if (!deps.proveedores.horario) return apagado('horario');
    const r = await deps.proveedores.horario.consultar(e);
    if (r.estado === 'sin_sesion') return sinSesion('horario');
    if (r.estado === 'error') return fallaError('horario');
    const ahora = deps.ahora();
    const co = enColombia(ahora);
    const hoyNombre = DIAS_SEMANA[co.getUTCDay()];
    const ordenadas = [...r.clases].sort((a, b) =>
      ORDEN_DIAS.indexOf(a.dia) - ORDEN_DIAS.indexOf(b.dia) || a.inicio.localeCompare(b.inicio));
    const deHoy = ordenadas.filter((c) => c.dia === hoyNombre);
    let textoVoz: string;
    if (r.clases.length === 0) {
      textoVoz = 'No veo clases en tu horario de este periodo.';
    } else if (deHoy.length > 0) {
      const lista = deHoy.map((c) => `${c.materia} ${rangoEnPalabras(c)}${c.salon ? `, en ${c.salon}` : ''}`);
      textoVoz = `Hoy ${hoyNombre} tienes ${unirConY(lista)}.`;
    } else {
      const idx = ORDEN_DIAS.indexOf(hoyNombre);
      const siguiente = ordenadas.find((c) => (ORDEN_DIAS.indexOf(c.dia) - idx + 7) % 7 > 0)
        ?? ordenadas[0];
      textoVoz = `Hoy no tienes clases. Tu próxima clase es el ${siguiente.dia}: ${siguiente.materia} ${rangoEnPalabras(siguiente)}.`;
    }
    if (r.simulado) textoVoz = `Atención, estos son datos de ejemplo. ${textoVoz}`;
    let texto = `${r.simulado ? '⚠️ _Datos de ejemplo (modo prueba)_\n\n' : ''}🗓️ *Tu horario*\n`;
    let diaActual = '';
    for (const c of ordenadas) {
      if (c.dia !== diaActual) { diaActual = c.dia; texto += `\n*${c.dia.charAt(0).toUpperCase()}${c.dia.slice(1)}*\n`; }
      texto += `• ${c.inicio}–${c.fin}  ${c.materia}${c.salon ? ` (${c.salon})` : ''}\n`;
    }
    texto += '\n_Escribe *menu* para volver al inicio._';
    return exito('horario', { clases: ordenadas, simulado: Boolean(r.simulado) }, textoVoz, texto);
  }

  // ── Cursos y tareas (Savio) ─────────────────────────────────────────────────
  async function cursos(e: DatosEstudiante): Promise<ResultadoConsulta> {
    if (!deps.proveedores.cursos) return apagado('cursos');
    const r = await deps.proveedores.cursos.consultar(e.email);
    if (r.estado === 'error') return fallaError('cursos');
    if (r.estado === 'no_encontrado') {
      return falla(
        'cursos', 'no_encontrado',
        'No encontré una cuenta de Savio con tu correo institucional. Revisa tu acceso o escribe a soporte de tecnología.',
        `No encontré en Savio una cuenta con tu correo institucional. Revisa tu acceso en ${PORTAL.cursos} o consulta con Soporte TI.`,
      );
    }
    const ahora = deps.ahora();
    const tareas: TareaProxima[] = r.tareas;
    let textoVoz = r.cursos.length === 0
      ? 'No aparecen cursos asociados a tu cuenta de Savio en este momento.'
      : `Estás inscrito en ${r.cursos.length === 1 ? 'un curso' : `${numeroEnPalabras(r.cursos.length)} cursos`} en Savio.`;
    if (tareas.length === 0) {
      if (r.cursos.length > 0) textoVoz += ' No tienes tareas por vencer en los próximos treinta días.';
    } else {
      const primeras = tareas.slice(0, 3).map((t) => `${t.titulo} de ${t.curso}, ${fechaConDiaEnPalabras(t.vence, ahora)}`);
      textoVoz += ` Tienes ${tareas.length === 1 ? 'una tarea próxima' : `${numeroEnPalabras(tareas.length)} tareas próximas`}: ${primeras.join('; ')}.`;
    }
    let texto = '📚 *Tus cursos en Savio*\n\n';
    texto += r.cursos.slice(0, 10).map((c) => `• ${c.nombre}\n  ${c.url}`).join('\n') || 'Sin cursos por ahora.';
    if (tareas.length) {
      texto += '\n\n📝 *Tareas próximas*\n';
      texto += tareas.slice(0, 10).map((t) => `• ${t.titulo} (${t.curso}) — vence ${t.vence.slice(0, 10)}`).join('\n');
    }
    texto += `\n\nEntra al portal: ${PORTAL.cursos}\n_Escribe *menu* para otras opciones._`;
    return exito('cursos', { cursos: r.cursos, tareas }, textoVoz, texto);
  }

  async function consultar(telefono: string, tipo: TipoConsulta): Promise<ResultadoConsulta> {
    if (!interruptor(tipo)) return apagado(tipo);
    try {
      const id = await deps.identidad.obtener(telefono);
      if (!id) return noVerificado(tipo);
      const e: DatosEstudiante = {
        telefono, email: id.email, codigo: id.codigo, codigoVerificado: id.codigoVerificado,
        nombre: id.nombre, programa: id.programa, nivel: id.nivel,
      };
      switch (tipo) {
        case 'notas': return await notas(e);
        case 'recibo': return await recibo(e);
        case 'turno': return await turno(e);
        case 'horario': return await horario(e);
        case 'cursos': return await cursos(e);
        default: return fallaError(tipo);
      }
    } catch {
      // Nunca se propaga el mensaje del error: puede traer correos, códigos o tokens.
      return fallaError(tipo);
    }
  }

  async function buscarParaVerificar(dato: { codigo?: string; cedula?: string }) {
    const nada = { encontrado: false } as const;
    if (!(await deps.permitirBusqueda())) return nada;
    const codigo = normalizarCodigo(dato.codigo);
    const cedula = normalizarCedula(dato.cedula);
    const vinculado = codigo ? await deps.identidad.porCodigo(codigo)
      : cedula ? await deps.identidad.porCedula(cedula) : null;
    if (vinculado) {
      return {
        encontrado: true,
        telefonoVinculado: enmascararTelefono(vinculado.telefono),
        emailEnmascarado: enmascararCorreo(vinculado.email),
      };
    }
    // Conocido por la fuente pero sin WhatsApp vinculado: se confirma que existe, sin destino ni datos.
    if (codigo && await deps.existeCodigoEnFuente(codigo).catch(() => false)) return { encontrado: true };
    return nada;
  }

  async function iniciarVerificacionPorDato(
    telefonoLlamante: string, dato: { codigo?: string; cedula?: string },
  ): Promise<ResultadoEnvioVerificacion> {
    const v = deps.verificacion;
    if (!v || !v.secreto) return { estado: 'error' };
    // Cupo anti-enumeración: primero el del número que llama, después el global (H4).
    if (!(await deps.permitirBusqueda(telefonoLlamante))) return { estado: 'espera' };
    const codigo = normalizarCodigo(dato.codigo);
    const cedula = normalizarCedula(dato.cedula);
    const vinculado = codigo ? await deps.identidad.porCodigo(codigo)
      : cedula ? await deps.identidad.porCedula(cedula) : null;
    // Un código sin WhatsApp vinculado no tiene correo conocido (no se consulta la fuente: no se confirma que exista).
    if (!vinculado) return { estado: codigo ? 'sin_destino' : 'no_encontrado' };
    const ahora = deps.ahora().getTime();
    try {
      const codigo6 = v.generarCodigo?.() ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
      const p: PendienteVoz = {
        huella: huellaCodigoVoz(v.secreto, telefonoLlamante, vinculado.telefono, codigo6),
        telefonoEstudiante: vinculado.telefono, email: vinculado.email,
        intentos: 0, expira: ahora + VOZ_OTP_TTL_MS, creado: ahora,
      };
      // Un solo paso: bloqueos + marca de espera (que sobrevive al pendiente) + topes por llamante y por destino +
      // guardar. Dos inicios simultáneos: solo uno manda correo (H1, H3).
      const reserva = await atomico.crearSiCabe(telefonoLlamante, p, VOZ_OTP_TTL_MS, ahora, LIMITES_VOZ);
      if (reserva !== 'ok') return { estado: reserva };
      try {
        await v.enviarCorreo(vinculado.email, codigo6);
      } catch {
        await v.pendientes.borrar(telefonoLlamante).catch(() => undefined);
        return { estado: 'error' };
      }
    } catch {
      return { estado: 'error' };
    }
    return { estado: 'enviado', emailEnmascarado: enmascararCorreo(vinculado.email) };
  }

  async function confirmarVerificacion(telefonoLlamante: string, codigo6: string): Promise<ResultadoConfirmacion> {
    const v = deps.verificacion;
    if (!v || !v.secreto) return { ok: false, motivo: 'vencido' };
    // Esta lectura solo da el vínculo para calcular la huella; la decisión (comparar, sumar el intento, consumir)
    // la toma `intentar` en un solo paso, que además rechaza si el pendiente cambió de destino entretanto (H2).
    const p = await v.pendientes.leer(telefonoLlamante);
    if (!p) return { ok: false, motivo: 'vencido' };
    const ahora = deps.ahora().getTime();
    const dictado = String(codigo6 ?? '').replace(/\D/g, '');
    const huella = huellaCodigoVoz(v.secreto, telefonoLlamante, p.telefonoEstudiante, dictado);
    const r = await atomico.intentar(telefonoLlamante, p.telefonoEstudiante, huella, ahora, LIMITES_VOZ);
    if (r !== 'ok') return { ok: false, motivo: r };
    // El vínculo tiene que seguir siendo el mismo (mismo número, mismo correo) que cuando se mandó el código.
    const vigente = await deps.identidad.obtener(p.telefonoEstudiante);
    if (!vigente || vigente.email !== p.email) return { ok: false, motivo: 'vencido' };
    return { ok: true, telefonoEstudiante: p.telefonoEstudiante };
  }

  return {
    estudianteDe, buscarParaVerificar, consultar,
    ...(deps.verificacion ? { iniciarVerificacionPorDato, confirmarVerificacion } : {}),
  };
}
