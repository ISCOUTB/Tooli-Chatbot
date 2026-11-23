import Redis from 'ioredis';
import { config } from '../../config';
import { cifrar, descifrar, ErrorCifrado, leerClave } from './cifrado';
import { horasSesionNotas } from './interruptores';
import type { AlmacenSesionNotas, SesionGuardada } from './proveedores/notasBanner';

/**
 * Camino A: almacén de la sesión de Banner (cookies, NUNCA la contraseña),
 * cifrada con AES-256-GCM, atada al teléfono (AAD) y con vencimiento.
 * Clave Redis: notas-sesion:<teléfono>. identityService.revokeIdentity la borra
 * al desvincular.
 */

const redis = new Redis(config.redis.url);
const llave = (telefono: string) => `notas-sesion:${telefono}`;
const contexto = (telefono: string) => `notas-sesion:${telefono}`;

/** Guarda la sesión. false si no hay clave de cifrado válida (entonces no se guarda nada). */
export async function guardarSesionNotas(telefono: string, email: string, estado: string): Promise<boolean> {
  const clave = leerClave();
  if (!clave) return false;
  const blob = cifrar(JSON.stringify({ estado, email, creada: Date.now() }), contexto(telefono), clave);
  await redis.setex(llave(telefono), horasSesionNotas() * 3600, blob);
  return true;
}

export const almacenSesionNotas: AlmacenSesionNotas & {
  guardar: typeof guardarSesionNotas;
  existe(telefono: string): Promise<boolean>;
} = {
  guardar: guardarSesionNotas,
  async leer(telefono): Promise<SesionGuardada | null> {
    const clave = leerClave();
    const blob = await redis.get(llave(telefono));
    if (!clave || !blob) return null;
    try {
      const { estado, email } = JSON.parse(descifrar(blob, contexto(telefono), clave)) as SesionGuardada;
      return typeof estado === 'string' && typeof email === 'string' ? { estado, email } : null;
    } catch (error) {
      // Blob manipulado, de otra clave o de otro teléfono: se descarta sin loguear contenido.
      if (error instanceof ErrorCifrado) await redis.del(llave(telefono));
      return null;
    }
  },
  async borrar(telefono) {
    await redis.del(llave(telefono));
  },
  async existe(telefono) {
    return (await redis.exists(llave(telefono))) === 1;
  },
};

export function cerrarAlmacenSesionNotas(): void {
  redis.disconnect();
}
