import type { CaminoNotas } from '../interruptores';
import type { CursoNota, DatosEstudiante, ProveedorNotas } from '../tipos';

/**
 * Notas desde Banner. La consulta con contraseña (camino B) es INTERACTIVA y
 * vive en el flujo de WhatsApp (flows/notasLogin.ts): este proveedor, que es lo
 * que ve la voz, solo puede leer con una SESIÓN GUARDADA (camino A). Sin ella
 * responde 'sin_sesion' y quien llama decide cómo pedir el inicio de sesión.
 */

export interface SesionGuardada {
  /** storageState de Playwright en JSON (ya descifrado, solo en memoria). */
  estado: string;
  email: string;
}

export interface AlmacenSesionNotas {
  leer(telefono: string): Promise<SesionGuardada | null>;
  borrar(telefono: string): Promise<void>;
}

export interface DepsNotasBanner {
  camino(): CaminoNotas;
  almacen: AlmacenSesionNotas;
  /** Lee las notas con la sesión guardada (en producción: consultarNotasConSesion). */
  leerConSesion(estado: string): Promise<
    | { status: 'ok'; valor: Array<{ titulo: string; notaFinal: string }> }
    | { status: 'expirada' }
    | { status: 'error' }
  >;
}

export function crearProveedorNotasBanner(deps: DepsNotasBanner): ProveedorNotas {
  return {
    async consultar(e: DatosEstudiante) {
      if (deps.camino() !== 'A') return { estado: 'sin_sesion' };
      const guardada = await deps.almacen.leer(e.telefono);
      // La sesión guardada solo vale para el correo que la creó.
      if (!guardada || guardada.email.toLowerCase() !== e.email.toLowerCase()) return { estado: 'sin_sesion' };
      const r = await deps.leerConSesion(guardada.estado);
      if (r.status === 'expirada') {
        await deps.almacen.borrar(e.telefono);
        return { estado: 'sin_sesion' };
      }
      if (r.status === 'error') return { estado: 'error' };
      const cursos: CursoNota[] = r.valor.map((c) => ({ titulo: c.titulo, notaFinal: c.notaFinal }));
      return cursos.length ? { estado: 'ok', cursos } : { estado: 'error' };
    },
  };
}
