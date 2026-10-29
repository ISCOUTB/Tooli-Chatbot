import { api } from '../core/api.js';
import { haptic, toast } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ActionSheet } from './sheet.js';

/* Respuestas rápidas: plantillas compartidas del equipo, usadas por la bandeja
   de Conversaciones y por Atención. Se insertan donde está el cursor y NO se
   envían: el asesor siempre revisa antes. El placeholder {nombre} se reemplaza
   con el nombre real que capturó el bot; nunca se inserta el literal
   "{nombre}" en un mensaje que va a un estudiante. */
let respuestasCache = null;

function aplicarPlaceholders(texto, nombre) {
  const primerNombre = (nombre ?? '').trim().split(/\s+/)[0];
  return texto.replace(/\{nombre\}/g, primerNombre || 'hola');
}

async function abrirRespuestasRapidas(input, sync, nombre) {
  haptic(10);
  if (!respuestasCache) {
    try {
      respuestasCache = (await (await api('/api/tools/quick-replies')).json()).replies ?? [];
    } catch {
      toast('No se pudieron cargar las respuestas rápidas');
      return;
    }
  }

  const insertar = (texto) => {
    const final = aplicarPlaceholders(texto, nombre);
    const pos = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, pos) + final + input.value.slice(pos);
    input.focus();
    input.setSelectionRange(pos + final.length, pos + final.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    haptic(12);
  };

  const guardarActual = async () => {
    const texto = input.value.trim();
    if (!texto) { toast('Escribe primero el mensaje que quieres guardar'); return; }
    const titulo = texto.split('\n')[0].slice(0, 48);
    try {
      const r = await api('/api/tools/quick-replies', { method: 'POST', body: JSON.stringify({ titulo, texto }) });
      const data = await r.json();
      if (!r.ok) { toast(data.message ?? 'No se pudo guardar'); return; }
      respuestasCache = null;
      toast('Guardada como respuesta rápida');
      haptic([10, 20, 10]);
    } catch { toast('No se pudo guardar'); }
  };

  const grupos = [];
  if (respuestasCache.length) {
    grupos.push(respuestasCache.slice(0, 10).map(q => ({
      label: q.titulo,
      icon: icon('bolt', 15),
      onClick: () => insertar(q.texto),
    })));
  }
  grupos.push([{ label: 'Guardar el mensaje actual', icon: icon('plus', 15), onClick: guardarActual }]);
  grupos.push([{ label: 'Cancelar', cancel: true }]);

  ActionSheet.open({
    title: 'Respuestas rápidas',
    subtitle: respuestasCache.length
      ? 'Se inserta en el mensaje para que la revises antes de enviar.'
      : 'Aún no hay ninguna. Escribe un mensaje y guárdalo para reutilizarlo.',
    groups: grupos,
  });
}

export { aplicarPlaceholders, abrirRespuestasRapidas };
