import type { ProveedorCursos } from '../tipos';

/** Forma mínima de lo que devuelve savioService.getSavioResumenForEmail. */
export interface ResumenSavio {
  accountFound: boolean;
  courses: Array<{ id: number; name: string; url: string }>;
  tareas: Array<{ titulo: string; curso: string; vence: string }>;
}

/** Cursos y tareas próximas de Savio con el token de servicio (solo lectura). */
export function crearProveedorCursosSavio(
  resumen: (email: string) => Promise<ResumenSavio>,
): ProveedorCursos {
  return {
    async consultar(email) {
      try {
        const r = await resumen(email);
        if (!r.accountFound) return { estado: 'no_encontrado' };
        return {
          estado: 'ok',
          cursos: r.courses.map((c) => ({ id: c.id, nombre: c.name, url: c.url })),
          tareas: r.tareas.map((t) => ({ titulo: t.titulo, curso: t.curso, vence: t.vence })),
        };
      } catch {
        // Sin message: el error de Moodle puede traer URL o token.
        return { estado: 'error' };
      }
    },
  };
}
