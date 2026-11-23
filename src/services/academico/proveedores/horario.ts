import type { AcademicoProvider } from '../../academicoLinks';
import type { CaminoNotas } from '../interruptores';
import type { ClaseHorario, DatosEstudiante, ProveedorHorario } from '../tipos';
import { parseHorarioBanner } from './bannerHorarioParser';
import type { AlmacenSesionNotas } from './notasBanner';

/** Nombre completo del día a partir del que usa AcademicoProvider ("Lunes", "lun"…). */
function diaNormal(dia: string): string {
  const d = dia.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const mapa: Record<string, string> = {
    lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado', dom: 'domingo',
  };
  return mapa[d.slice(0, 3)] ?? dia.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Proveedor SIMULADO. Implementa el contrato histórico AcademicoProvider.
// SOLO pruebas y demos (interruptores.proveedorHorario() lo bloquea en producción).
// ─────────────────────────────────────────────────────────────────────────────

export class AcademicoProviderSimulado implements AcademicoProvider {
  async getNotas() {
    return [
      { asignatura: 'Cálculo Diferencial (simulado)', nota: 4.1, corte: 'Corte 1' },
      { asignatura: 'Física Mecánica (simulado)', nota: 3.4, corte: 'Corte 1' },
    ];
  }
  async getHorario() {
    return [
      { asignatura: 'Cálculo Diferencial (simulado)', dia: 'Lunes', hora: '08:00 - 09:50', salon: 'Aula 101' },
      { asignatura: 'Física Mecánica (simulado)', dia: 'Miércoles', hora: '14:00 - 15:50', salon: 'Laboratorio 2' },
    ];
  }
  async getPendientes() {
    return [{ titulo: 'Taller 1 (simulado)', curso: 'Cálculo Diferencial', venceEn: '2 días' }];
  }
}

/** Adapta cualquier AcademicoProvider (simulado o futuro) al puerto de horario. */
export function proveedorHorarioDesdeAcademico(
  provider: AcademicoProvider, esSimulado = false,
): ProveedorHorario {
  return {
    async consultar(e: DatosEstudiante) {
      try {
        const filas = await provider.getHorario(e.codigo ?? '');
        const clases: ClaseHorario[] = filas.map((f) => {
          const [ini, fin] = f.hora.split(/\s*-\s*/);
          return {
            materia: f.asignatura, dia: diaNormal(f.dia),
            inicio: ini?.trim() ?? '', fin: fin?.trim() ?? '', ...(f.salon ? { salon: f.salon } : {}),
          };
        });
        return { estado: 'ok', clases, ...(esSimulado ? { simulado: true } : {}) };
      } catch {
        return { estado: 'error' };
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Proveedor REAL (Banner): usa la MISMA vía de sesión que las notas (camino A).
// ─────────────────────────────────────────────────────────────────────────────

export interface DepsHorarioBanner {
  camino(): CaminoNotas;
  almacen: AlmacenSesionNotas;
  /** Descarga el HTML del horario con la sesión guardada (en producción: ver servicio.ts). */
  leerHtmlConSesion(estado: string): Promise<{ status: 'ok'; html: string } | { status: 'expirada' } | { status: 'error' }>;
}

export function crearProveedorHorarioBanner(deps: DepsHorarioBanner): ProveedorHorario {
  return {
    async consultar(e) {
      if (deps.camino() !== 'A') return { estado: 'sin_sesion' };
      const guardada = await deps.almacen.leer(e.telefono);
      if (!guardada || guardada.email.toLowerCase() !== e.email.toLowerCase()) return { estado: 'sin_sesion' };
      const r = await deps.leerHtmlConSesion(guardada.estado);
      if (r.status === 'expirada') {
        await deps.almacen.borrar(e.telefono);
        return { estado: 'sin_sesion' };
      }
      if (r.status === 'error') return { estado: 'error' };
      const clases = parseHorarioBanner(r.html);
      // Una página sin clases puede ser un periodo sin horario o un selector que no coincide:
      // no se inventa nada, se reporta error para que se revise con una cuenta real.
      return clases.length ? { estado: 'ok', clases } : { estado: 'error' };
    },
  };
}
