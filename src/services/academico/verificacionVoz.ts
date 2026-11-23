/**
 * Código de verificación por WHATSAPP desde la voz (issue #34). Antes vivía en el estado de la llamada: espera de
 * 60 s y 5 por hora por número destino, sin tope diario ni bloqueo, y los 3 intentos se contaban solo dentro de la
 * llamada (en 24 h, con un número falsificado: 120 mensajes a la víctima y 360 conjeturas). Ahora pasa por el MISMO
 * almacén atómico que el código al correo (`crearSiCabe`/`intentar` de nucleo.ts; Lua en identityService):
 *   - marca de espera, topes por hora y por día del número que llama y del estudiante destino, compartidos con el
 *     correo (los dos canales suman al mismo tope);
 *   - comparar, sumar el intento y consumir en un solo paso (dos frases casi juntas cuentan los dos intentos, R6);
 *   - agotar los intentos bloquea al número que llama y al destino (LIMITES_VOZ).
 * El código nunca se guarda en claro: HMAC atado a (número que llama, destino) con un dominio propio, distinto del
 * código al correo (un código no sirve en el otro canal). Sin clave usable (`secretoVozUsable`), no se manda nada.
 */
import { createHmac, randomInt } from 'node:crypto';
import {
  LIMITES_VOZ, VOZ_OTP_TTL_MS, atomicoEnMemoria, type AlmacenPendientesVoz, type LimitesVoz, type PendienteVoz,
} from './nucleo';

export type EnvioCodigoVoz = 'enviado' | 'espera' | 'bloqueado' | 'error';
export type IntentoCodigoVoz = 'ok' | 'no_coincide' | 'demasiados' | 'vencido';

export interface CodigoWhatsAppVoz {
  /** Aparta el envío en el almacén atómico y, si cabe, manda el código con `enviar`. */
  iniciar(a: {
    llamante: string; destino: string; secreto: string; ahora: number;
    enviar: (telefono: string, codigo: string) => Promise<boolean>; generarCodigo?: () => string;
  }): Promise<EnvioCodigoVoz>;
  /** Compara, cuenta el intento y consume el pendiente en un solo paso. */
  confirmar(a: { llamante: string; destino: string; secreto: string; codigo: string; ahora: number }): Promise<IntentoCodigoVoz>;
}

export function huellaWhatsAppVoz(secreto: string, llamante: string, destino: string, codigo6: string): string {
  return createHmac('sha256', secreto).update(`voz-whatsapp:${llamante}:${destino}:${codigo6}`).digest('hex');
}

const numero = (t: string, min: number) => new RegExp(`^\\d{${min},15}$`).test(t);

export function crearCodigoWhatsAppVoz(pendientes: AlmacenPendientesVoz, limites: LimitesVoz = LIMITES_VOZ): CodigoWhatsAppVoz {
  const atomico = pendientes.crearSiCabe && pendientes.intentar
    ? {
        crearSiCabe: pendientes.crearSiCabe.bind(pendientes) as NonNullable<AlmacenPendientesVoz['crearSiCabe']>,
        intentar: pendientes.intentar.bind(pendientes) as NonNullable<AlmacenPendientesVoz['intentar']>,
      }
    : atomicoEnMemoria(pendientes);
  return {
    async iniciar({ llamante, destino, secreto, ahora, enviar, generarCodigo }) {
      // Sin número que llama (llamada anónima) no hay a quién atar el código: no se verifica (R4).
      if (!secreto || !numero(llamante, 7) || !numero(destino, 8)) return 'error';
      const codigo = generarCodigo?.() ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
      const p: PendienteVoz = {
        huella: huellaWhatsAppVoz(secreto, llamante, destino, codigo), telefonoEstudiante: destino, email: '',
        intentos: 0, expira: ahora + VOZ_OTP_TTL_MS, creado: ahora,
      };
      let reserva: Awaited<ReturnType<typeof atomico.crearSiCabe>>;
      try {
        reserva = await atomico.crearSiCabe(llamante, p, VOZ_OTP_TTL_MS, ahora, limites);
      } catch {
        return 'error';
      }
      if (reserva !== 'ok') return reserva;
      let ok = false;
      try {
        ok = await enviar(destino, codigo);
      } catch {
        ok = false;
      }
      if (!ok) {
        // El envío cuenta para los topes (ya se apartó) pero el pendiente no queda vivo.
        await pendientes.borrar(llamante).catch(() => undefined);
        return 'error';
      }
      return 'enviado';
    },
    async confirmar({ llamante, destino, secreto, codigo, ahora }) {
      if (!secreto || !numero(llamante, 7)) return 'vencido';
      try {
        return await atomico.intentar(llamante, destino, huellaWhatsAppVoz(secreto, llamante, destino, codigo.replace(/\D/g, '')), ahora, limites);
      } catch {
        return 'vencido';
      }
    },
  };
}

/** Pendientes en memoria del proceso (pruebas, simulador). La atomicidad la pone `atomicoEnMemoria`. */
export function pendientesVozEnMemoria(): AlmacenPendientesVoz & { _datos: Map<string, PendienteVoz> } {
  const datos = new Map<string, PendienteVoz>();
  return {
    _datos: datos,
    async leer(t) { const p = datos.get(t); return p ? { ...p } : null; },
    async guardar(t, p) { datos.set(t, { ...p }); },
    async borrar(t) { datos.delete(t); },
  };
}

/**
 * El de producción: los pendientes y los Lua atómicos de identityService (`pendientesVoz`), los mismos del código al
 * correo. Se importa al usarlo para no abrir Redis al cargar el módulo.
 */
const identidad = () => import('../identityService');
export const codigoWhatsAppVozReal: CodigoWhatsAppVoz = crearCodigoWhatsAppVoz({
  leer: async (t) => (await identidad()).pendientesVoz.leer(t),
  guardar: async (t, p, ttl) => (await identidad()).pendientesVoz.guardar(t, p, ttl),
  borrar: async (t) => (await identidad()).pendientesVoz.borrar(t),
  crearSiCabe: async (t, p, ttl, ahora, l) => (await identidad()).pendientesVoz.crearSiCabe(t, p, ttl, ahora, l),
  intentar: async (t, d, h, ahora, l) => (await identidad()).pendientesVoz.intentar(t, d, h, ahora, l),
});
