import type { AcademicoApi } from '../../contratos/academico';
import { config } from '../../config';
import { reglaNotas } from './calculos';
import { descifrar, leerClave } from './cifrado';
import { caminoNotas, interruptoresDeEntorno, proveedorHorario } from './interruptores';
import { crearAcademico, crearPermisoBusqueda, secretoVozUsable, type DepsNucleo } from './nucleo';
import { normalizarCedula } from './identidadAcademica';
import { AcademicoProviderSimulado, crearProveedorHorarioBanner, proveedorHorarioDesdeAcademico } from './proveedores/horario';
import { crearProveedorNotasBanner, type AlmacenSesionNotas } from './proveedores/notasBanner';
import { crearProveedorReciboIceberg, crearVerificadorCodigoIceberg } from './proveedores/reciboIceberg';
import { crearProveedorTurnoSheets } from './proveedores/turnoSheets';
import { crearProveedorCursosSavio } from './proveedores/cursosSavio';
import { vincularCodigoEstudiantil as vincularConDeps, type EstadoVinculo } from './vinculo';

/**
 * Punto de entrada de los datos académicos: `academico` implementa el contrato
 * src/contratos/academico.ts y lo usan WhatsApp y la voz.
 *
 * Todo lo que toca Redis, Playwright o Google se importa DENTRO de las funciones
 * (import dinámico): así importar este módulo no abre conexiones ni deja vivo el
 * proceso, y las pruebas usan ./nucleo.ts con fakes.
 */

// ── Carga perezosa de los módulos con efectos ───────────────────────────────
const identidad = () => import('../identityService');
const notasSvc = () => import('../notasService');
const icebergSvc = () => import('../icebergService');
const turnosSvc = () => import('../turnosService');
const savioSvc = () => import('../savioService');
const sesiones = () => import('./sesionNotas');

const almacenPerezoso: AlmacenSesionNotas = {
  leer: async (t) => (await sesiones()).almacenSesionNotas.leer(t),
  borrar: async (t) => (await sesiones()).almacenSesionNotas.borrar(t),
};

const loginIceberg = async (codigo: string, cedula: string) => (await icebergSvc()).loginAndDownloadReceipt(codigo, cedula);

const proveedorNotas = crearProveedorNotasBanner({
  camino: () => caminoNotas(),
  almacen: almacenPerezoso,
  leerConSesion: async (estado) => (await notasSvc()).consultarNotasConSesion(estado),
});

const horarioBanner = crearProveedorHorarioBanner({
  camino: () => caminoNotas(),
  almacen: almacenPerezoso,
  leerHtmlConSesion: async (estado) => {
    const r = await (await notasSvc()).consultarHorarioHtmlConSesion(estado);
    return r.status === 'ok' ? { status: 'ok' as const, html: r.valor } : r;
  },
});
const horarioSimulado = proveedorHorarioDesdeAcademico(new AcademicoProviderSimulado(), true);

const proveedorRecibo = crearProveedorReciboIceberg(loginIceberg);
const verificadorCodigo = crearVerificadorCodigoIceberg(loginIceberg);
const consultarFilaTurno = async (codigo: string) => (await turnosSvc()).consultarTurno(codigo);
const proveedorTurno = crearProveedorTurnoSheets(consultarFilaTurno);
const proveedorCursos = crearProveedorCursosSavio(async (email) => {
  const token = process.env.SAVIO_WS_TOKEN?.trim() ?? '';
  return (await savioSvc()).getSavioResumenForEmail(email, token);
});

// ── Dependencias reales del núcleo ───────────────────────────────────────────
const depsReales: DepsNucleo = {
  identidad: {
    async obtener(telefono) {
      return (await identidad()).getIdentity(telefono);
    },
    async porCodigo(codigo) {
      const r = await (await identidad()).buscarIdentidadPorCodigo(codigo);
      return r ? { telefono: r.telefono, email: r.identity.email } : null;
    },
    async porCedula(cedula) {
      const r = await (await identidad()).buscarIdentidadPorCedula(cedula);
      return r ? { telefono: r.telefono, email: r.identity.email } : null;
    },
  },
  async existeCodigoEnFuente(codigo) {
    if (!interruptoresDeEntorno.turno()) return false;
    return (await consultarFilaTurno(codigo)) !== null;
  },
  async cedulaDe(telefono) {
    const id = await (await identidad()).getIdentity(telefono);
    const clave = leerClave();
    if (!id?.cedulaCifrada || !clave) return null;
    try { return normalizarCedula(descifrar(id.cedulaCifrada, `cedula:${telefono}`, clave)); } catch { return null; }
  },
  // Sin TOOLI_ACADEMICO_CLAVE la cédula no se guarda: el recibo falla claro (ver nucleo.ts y problemasConfigAcademica).
  puedeGuardarCedula: () => leerClave() !== null,
  interruptores: interruptoresDeEntorno,
  proveedores: {
    notas: proveedorNotas,
    recibo: proveedorRecibo,
    turno: proveedorTurno,
    horario: { consultar: (e) => (proveedorHorario() === 'simulado' ? horarioSimulado : horarioBanner).consultar(e) },
    cursos: proveedorCursos,
  },
  // Con número que llama (voz): primero su cupo y después un global alto; sin él, el global de siempre (H4).
  // Ver CUPOS_BUSQUEDA en ./nucleo.ts y docs/datos-academicos.md.
  permitirBusqueda: crearPermisoBusqueda(async (clave, max, ventanaS) =>
    (await import('../rateLimit')).checkRateLimit(clave, max, ventanaS)),
  regla: () => reglaNotas(),
  ahora: () => new Date(),
  // Verificación por voz SOLO PARA LA LLAMADA: código propio guardado como HMAC (voz-otp:<llamante>), mismo
  // correo y plantilla que el OTP de WhatsApp (sendOtpEmail). Nunca pasa por checkCode: no mueve el vínculo.
  verificacion: {
    async enviarCorreo(email, codigo6) {
      await (await import('../mailService')).sendOtpEmail(email, codigo6);
    },
    pendientes: {
      leer: async (t) => (await identidad()).pendientesVoz.leer(t),
      guardar: async (t, p, ttl) => (await identidad()).pendientesVoz.guardar(t, p, ttl),
      borrar: async (t) => (await identidad()).pendientesVoz.borrar(t),
      // Atómicos (Lua): espera + topes + guardar, y comparar + sumar intento + consumir (H1, H2, H3).
      crearSiCabe: async (t, p, ttl, ahora, l) => (await identidad()).pendientesVoz.crearSiCabe(t, p, ttl, ahora, l),
      intentar: async (t, d, h, ahora, l) => (await identidad()).pendientesVoz.intentar(t, d, h, ahora, l),
    },
    // Nunca una clave pública: con JWT_SECRET por defecto, de ejemplo o ausente la voz no verifica (salvo pruebas).
    get secreto() { return secretoVozUsable(config.auth.jwtSecret, process.env.NODE_ENV === 'test'); },
  },
};

export const academico: AcademicoApi = crearAcademico(depsReales);

// ── Extras que NO son parte del contrato (los usan los flujos y la voz) ──────

/** Ata el código estudiantil al vínculo, comprobando código+cédula contra Iceberg. */
export async function vincularCodigoEstudiantil(
  telefono: string, codigo: string, cedula: string,
): Promise<{ estado: EstadoVinculo; nombre?: string }> {
  const id = await identidad();
  return vincularConDeps({
    interruptores: interruptoresDeEntorno,
    verificador: verificadorCodigo,
    tieneVinculo: async (t) => (await id.getIdentity(t)) !== null,
    guardar: async (t, datos) => id.guardarCodigoEstudiantil(t, datos),
  }, { telefono, codigo, cedula });
}

export type { ResultadoEnvioVerificacion } from '../../contratos/academico';

/**
 * Para quien llama desde OTRO número: busca el vínculo por código o cédula y
 * manda el código de 6 dígitos AL CORREO INSTITUCIONAL de ese estudiante (nunca
 * se le dice el correo completo a quien llama). Si quien llama lee el código que
 * llegó a ese correo, `confirmarVerificacion` devuelve el teléfono del vínculo real
 * para consultar SOLO durante esa llamada; no vincula ni mueve nada.
 * Desde la integración son parte (opcional) del contrato: ver src/contratos/academico.ts.
 */
export const iniciarVerificacionPorDato = academico.iniciarVerificacionPorDato!;
export const confirmarVerificacion = academico.confirmarVerificacion!;

/** Camino A: guarda la sesión de notas (cifrada) tras un login exitoso con consentimiento. */
export async function guardarSesionDeNotas(telefono: string, email: string, estado: string): Promise<boolean> {
  if (caminoNotas() !== 'A') return false;
  return (await sesiones()).guardarSesionNotas(telefono, email, estado);
}

export async function borrarSesionDeNotas(telefono: string): Promise<void> {
  await (await sesiones()).almacenSesionNotas.borrar(telefono);
}

export async function haySesionDeNotas(telefono: string): Promise<boolean> {
  if (caminoNotas() !== 'A') return false;
  return (await sesiones()).almacenSesionNotas.existe(telefono);
}
