import { avanceCortes, cortesDesdeNotas, necesarioParaPasar, promedio, type ReglaNotas } from './calculos';
import type { CursoNota } from './tipos';
import { notaEnPalabras, numeroEnPalabras } from './voz';

/**
 * Cómo se muestran las notas: el MISMO armado lo usan `academico.consultar('notas')`
 * (voz y texto) y el flujo de WhatsApp que entrega las notas tras el login (camino B).
 */
export function armarNotas(cursos: CursoNota[], periodo: string | undefined, regla: ReglaNotas) {
  const filas = cursos.map((c) => {
    const nota = c.notaFinal !== undefined ? Number(String(c.notaFinal).replace(',', '.')) : NaN;
    const cortes = c.cortes;
    return {
      titulo: c.titulo,
      nota: Number.isFinite(nota) ? nota : null,
      ...(cortes?.length ? { cortes, avance: avanceCortes(cortes), necesario: necesarioParaPasar(cortes, regla) } : {}),
    };
  });
  const prom = promedio(filas.map((c) => c.nota));
  const datos = {
    periodo: periodo ?? null,
    cursos: filas,
    promedio: prom,
    regla: { notaMinima: regla.notaMinima, sinConfirmar: regla.sinConfirmar },
  };

  const conNota = filas.filter((c) => c.nota !== null);
  let paraVoz = conNota.length
    ? `Estas son tus notas: ${conNota.slice(0, 6).map((c) => `${c.titulo}, ${notaEnPalabras(c.nota as number)}`).join('; ')}.`
    : 'Todavía no veo notas definitivas en tu periodo.';
  if (conNota.length > 6) paraVoz += ` Y ${numeroEnPalabras(conNota.length - 6)} materias más.`;
  if (prom !== null) paraVoz += ` Tu promedio es ${notaEnPalabras(prom)}.`;
  for (const c of filas) {
    if (c.necesario?.caso === 'posible') {
      paraVoz += ` En ${c.titulo} necesitas sacar ${notaEnPalabras(c.necesario.necesaria)} en lo que falta para pasar, tomando ${notaEnPalabras(regla.notaMinima)} como nota mínima.`;
    } else if (c.necesario?.caso === 'imposible') {
      paraVoz += ` En ${c.titulo} ya no alcanzas la nota mínima con lo que falta; habla con tu profesor.`;
    }
  }

  let paraTexto = '📊 *Tus notas del período*\n\n';
  for (const c of filas) {
    paraTexto += `• ${c.titulo}: *${c.nota !== null ? c.nota.toFixed(1) : 'sin nota'}*\n`;
    if (c.necesario?.caso === 'posible') paraTexto += `   ↳ Para pasar necesitas *${c.necesario.necesaria.toFixed(1)}* en lo que falta\n`;
    if (c.necesario?.caso === 'imposible') paraTexto += '   ↳ Con lo que falta ya no se alcanza la nota mínima\n';
  }
  if (prom !== null) paraTexto += `\n📈 Promedio: *${prom.toFixed(2)}*`;
  paraTexto += `\n_Nota mínima usada en los cálculos: ${regla.notaMinima.toFixed(1)}${regla.sinConfirmar ? ' (regla por confirmar con Registro Académico)' : ''}._`;
  paraTexto += '\n_Escribe *menu* para volver al inicio._';
  return { datos, paraVoz, paraTexto };
}

/**
 * «¿Cuánto necesito para pasar?» a partir de las notas que la persona ya sacó en
 * una materia (en orden: corte 1, corte 2…). Usa los pesos de la regla configurada.
 */
export function armarCalculo(notasSacadas: number[], regla: ReglaNotas): { paraTexto: string; paraVoz: string } {
  const cortes = cortesDesdeNotas(notasSacadas, regla);
  const n = necesarioParaPasar(cortes, regla);
  const pesos = regla.pesosCortes.map((p) => `${p} %`).join(', ');
  const nota = regla.notaMinima.toFixed(1);
  const pie = `\n\n_Cálculo con ${regla.pesosCortes.length} cortes de ${pesos} y nota mínima ${nota}${regla.sinConfirmar ? ' (regla por confirmar con Registro Académico)' : ''}._`;
  switch (n.caso) {
    case 'posible':
      return {
        paraTexto: `🧮 Necesitas sacar *${n.necesaria.toFixed(1)}* en lo que falta para pasar con ${nota}.${pie}`,
        paraVoz: `Necesitas sacar ${notaEnPalabras(n.necesaria)} en lo que falta para pasar, tomando ${notaEnPalabras(regla.notaMinima)} como nota mínima.`,
      };
    case 'ya_aprobada':
      return {
        paraTexto: `🎉 Con lo que llevas ya aseguraste la nota mínima (${nota}), aunque saques cero en lo que falta.${pie}`,
        paraVoz: 'Con lo que llevas ya aseguraste la nota mínima, aunque saques cero en lo que falta.',
      };
    case 'imposible':
      return {
        paraTexto: `😕 Con lo que falta ya no se alcanza la nota mínima (tendrías que sacar ${n.necesaria.toFixed(1)}). Habla con tu profesor sobre opciones.${pie}`,
        paraVoz: 'Con lo que falta ya no se alcanza la nota mínima. Habla con tu profesor sobre las opciones.',
      };
    case 'sin_pendientes':
      return {
        paraTexto: `Ya tienes todas las notas: tu definitiva es *${n.definitiva.toFixed(2)}*.${pie}`,
        paraVoz: `Ya tienes todas las notas. Tu definitiva es ${notaEnPalabras(n.definitiva)}.`,
      };
    default:
      return { paraTexto: 'Escribe al menos una nota entre 0 y 5.', paraVoz: 'No tengo notas para calcular.' };
  }
}
