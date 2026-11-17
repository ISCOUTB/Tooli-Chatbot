import { api } from '../core/api.js';
import { escapeHtml, haptic, toast } from '../core/dom.js';
import { formatTelefono } from '../core/format.js';
import { icon } from '../core/icons.js';
import {
  TIPOS_DATO, claveDePlantilla, motivoNoEnviable, partesPlantilla, ranurasDePlantilla, textoDePlantilla, valoresParaContacto,
} from '../core/plantillas.js';
import { abrirDialogo } from './dialog.js';
import { burbujaHtml } from './plantilla-burbuja.js';

/* Enviar una plantilla aprobada a una sola persona desde el chat de Atención:
   pasadas 24 horas desde su último mensaje, WhatsApp no deja escribirle texto
   libre. Usa la misma cola que la pantalla Plantillas (broadcastJobService.ts)
   y espera unos segundos a que Meta confirme para decir si salió. */

const ESPERA_RESULTADO_MS = 20_000;
const CADA_MS = 1500;

async function leerJson(respuesta) {
  return respuesta.json().catch(() => ({}));
}

const pausa = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** 'enviado', 'pendiente' o { error } según lo que diga la cola del envío. */
async function esperarResultado(id, telefono) {
  const limite = Date.now() + ESPERA_RESULTADO_MS;
  while (Date.now() < limite) {
    await pausa(CADA_MS);
    try {
      const r = await api(`/api/tools/broadcast/jobs/${encodeURIComponent(id)}`);
      if (!r?.ok) continue;
      const { job } = await r.json();
      if ((job?.enviados ?? []).includes(telefono)) return 'enviado';
      const fallo = (job?.fallidos ?? []).find(f => f.numero === telefono);
      if (fallo) return { error: fallo.error || 'WhatsApp no entregó la plantilla.' };
      if (job?.estado === 'completado') return 'enviado';
    } catch { /* se reintenta hasta el límite */ }
  }
  return 'pendiente';
}

/**
 * Abre la ventana para enviar una plantilla a `telefono` (con indicativo).
 * `alEnviar({ plantilla, texto, estado })` se llama cuando el envío salió
 * ('enviado') o quedó en la cola sin respuesta todavía ('pendiente').
 * `bajaCampanas`: la persona pidió no recibir campañas; se advierte en las de marketing.
 */
function abrirEnviarPlantilla({ telefono, nombre = '', programa = '', etiqueta = '', bajaCampanas = false, alEnviar = null }) {
  const para = nombre ? `${nombre} (${formatTelefono(telefono)})` : formatTelefono(telefono);
  const dialogo = abrirDialogo({
    titulo: 'Enviar plantilla',
    ayuda: `Para ${para}. Fuera de las 24 horas, WhatsApp solo deja enviar mensajes aprobados por Meta.`,
    cuerpo: '<div class="asis-leyendo"><span class="spinner"></span> Cargando plantillas…</div>',
    ancho: true,
  });
  const cuerpo = dialogo.el.querySelector('.dialogo-cuerpo');
  let plantillas = [];
  let elegida = null;
  let valores = {};
  let enviando = false;

  if (!/^[1-9]\d{9,14}$/.test(String(telefono ?? ''))) {
    cuerpo.innerHTML = `
      <div class="alert alert-warning" role="status">Esta persona escribe sin mostrar su número, así que WhatsApp no deja enviarle una plantilla. Habrá que esperar a que vuelva a escribir.</div>
      <div class="password-dialog-actions"><button type="button" class="btn btn-primary" data-cerrar>Entendido</button></div>`;
    return dialogo;
  }

  const ranuras = () => {
    try { return elegida ? ranurasDePlantilla(elegida) : []; } catch { return []; }
  };

  const etiquetaRanura = (r) => {
    const tipo = elegida?.significados?.[r.clave];
    return tipo && TIPOS_DATO[tipo] ? `${TIPOS_DATO[tipo].etiqueta} · ${r.etiqueta}` : r.etiqueta;
  };

  function elegir(plantilla) {
    elegida = plantilla;
    valores = valoresParaContacto(plantilla, { nombre, programa });
  }

  function estado(html, tono = 'info') {
    const caja = cuerpo.querySelector('#eptEstado');
    if (caja) caja.innerHTML = html ? `<div class="alert alert-${tono}" role="${tono === 'error' ? 'alert' : 'status'}">${html}</div>` : '';
  }

  function faltan() {
    return ranuras().filter(r => !String(valores[r.clave] ?? '').trim());
  }

  function pintarBoton() {
    const boton = cuerpo.querySelector('#eptEnviar');
    if (!boton) return;
    boton.disabled = enviando || !elegida || faltan().length > 0;
    boton.innerHTML = enviando ? '<span class="spinner"></span> Enviando…' : `${icon('send', 16)} Enviar plantilla`;
  }

  function pintarPrevia() {
    const previa = cuerpo.querySelector('#eptPrevia');
    if (!previa || !elegida) return;
    previa.innerHTML = burbujaHtml(elegida, valores);
    previa.querySelector('.plt-media-img')?.addEventListener('error', (event) => {
      const marcador = document.createElement('div');
      marcador.className = 'plt-media';
      marcador.innerHTML = `${icon('paperclip', 16)} Imagen`;
      event.target.replaceWith(marcador);
    });
  }

  function pintar() {
    if (!plantillas.length) {
      cuerpo.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${icon('megaphone', 40)}</div>
          <div class="empty-state-title">No hay plantillas aprobadas</div>
          <div class="empty-state-sub">Crea una en <a href="#/plantillas" data-cerrar>Plantillas</a>. Cuando Meta la apruebe, se podrá enviar desde aquí.</div>
        </div>`;
      return;
    }
    const lista = ranuras();
    const { encabezadoMedia } = partesPlantilla(elegida);
    const marketing = String(elegida.category).toUpperCase() === 'MARKETING';
    const avisos = [
      encabezadoMedia ? `Va con ${encabezadoMedia === 'IMAGE' ? 'la imagen' : 'el archivo'} con que Meta aprobó la plantilla.` : '',
      marketing && !bajaCampanas ? 'Es de marketing: Meta puede no entregarla si la persona recibió varias hace poco.' : '',
    ].filter(Boolean);
    cuerpo.innerHTML = `
      <div class="ept">
        <div class="ept-form">
          <div class="field"><label for="eptPlantilla">Plantilla</label>
            <select id="eptPlantilla">${plantillas.map((t, i) => `<option value="${i}"${t === elegida ? ' selected' : ''}>${escapeHtml(t.name)} · ${escapeHtml(t.language)}</option>`).join('')}</select>
          </div>
          ${lista.length ? `
            <fieldset class="plt-variables">
              <legend>Datos del mensaje</legend>
              ${lista.map(r => {
                const id = `eptVar_${r.clave.replace(':', '_')}`;
                return `
                  <div class="plt-variable-campo">
                    <label for="${id}">${escapeHtml(etiquetaRanura(r))}</label>
                    <input type="text" id="${id}" data-clave="${escapeHtml(r.clave)}" maxlength="200" value="${escapeHtml(valores[r.clave] ?? '')}"
                      placeholder="${r.ejemplo ? `Ej.: ${escapeHtml(r.ejemplo)}` : ''}">
                    ${r.lugar === 'boton' ? `<div class="field-help">Se agrega al final de ${escapeHtml(r.base)}</div>` : ''}
                  </div>`;
              }).join('')}
            </fieldset>` : ''}
          ${marketing && bajaCampanas ? `<div class="alert alert-warning" role="status">Esta persona pidió no recibir campañas y esta plantilla es de marketing. Elige una de utilidad si es para responderle.</div>` : ''}
          ${avisos.length ? `<ul class="plt-confirmar-avisos">${avisos.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : ''}
          <div id="eptEstado"></div>
        </div>
        <div class="plt-chat ept-previa" id="eptPrevia" aria-label="Así le llega"></div>
      </div>
      <p class="plt-confirmar-final">${icon('alert', 15)} El mensaje sale por WhatsApp apenas lo envíes y no se puede retirar.</p>
      <div class="password-dialog-actions">
        <button type="button" class="btn btn-ghost" data-cerrar>Cancelar</button>
        <button type="button" class="btn btn-primary" id="eptEnviar"></button>
      </div>`;
    cuerpo.querySelector('#eptPlantilla').addEventListener('change', (event) => {
      elegir(plantillas[Number(event.target.value)]);
      pintar();
      cuerpo.querySelector('#eptPlantilla')?.focus();
    });
    cuerpo.querySelectorAll('[data-clave]').forEach(input => input.addEventListener('input', () => {
      valores[input.dataset.clave] = input.value;
      pintarPrevia();
      pintarBoton();
    }));
    cuerpo.querySelector('#eptEnviar').addEventListener('click', enviar);
    pintarPrevia();
    pintarBoton();
  }

  async function enviar() {
    if (enviando || !elegida) return;
    const lista = ranuras();
    if (faltan().length) { estado('Llena los datos del mensaje.', 'warning'); return; }
    const plantilla = elegida;
    const parametros = lista.map(r => String(valores[r.clave]).trim());
    const texto = textoDePlantilla(plantilla, Object.fromEntries(lista.map((r, i) => [r.clave, parametros[i]])));
    enviando = true;
    estado('');
    pintarBoton();
    haptic(10);
    let resultado;
    try {
      const r = await api('/api/tools/broadcast/send', {
        method: 'POST',
        body: JSON.stringify({
          templateName: plantilla.name, language: plantilla.language, etiqueta,
          ...(lista.length ? { destinatarios: [{ telefono, parametros }] } : { telefonos: [telefono] }),
        }),
      });
      if (!r) return;
      const data = await leerJson(r);
      if (!r.ok || !data.job?.id) throw new Error(data.message || `No se pudo enviar (HTTP ${r.status}).`);
      if (data.repetido) {
        enviando = false;
        if (!dialogo.abierto()) return;
        estado('Hoy ya le enviaste esta plantilla con los mismos datos, así que no se volvió a enviar. Para repetirla hay que esperar 24 horas o cambiar algún dato.');
        pintarBoton();
        return;
      }
      if (dialogo.abierto()) estado('<span class="spinner"></span> Esperando a que WhatsApp confirme…');
      resultado = await esperarResultado(data.job.id, telefono);
    } catch (err) {
      enviando = false;
      if (!dialogo.abierto()) { toast(err?.message || 'No se pudo enviar la plantilla'); return; }
      estado(escapeHtml(err?.message || 'Se perdió la conexión al enviar.'), 'error');
      pintarBoton();
      return;
    }
    enviando = false;
    if (typeof resultado === 'object') {
      if (!dialogo.abierto()) { toast(`La plantilla no se entregó: ${resultado.error}`); return; }
      estado(`No se entregó: ${escapeHtml(resultado.error)}`, 'error');
      pintarBoton();
      return;
    }
    haptic([10, 20, 10]);
    toast(resultado === 'enviado' ? 'Plantilla enviada' : 'La plantilla va en camino; el resultado queda en Plantillas');
    dialogo.cerrar();
    alEnviar?.({ plantilla, texto, estado: resultado });
  }

  (async () => {
    try {
      const r = await api('/api/tools/broadcast/templates/todas');
      if (!r || !dialogo.abierto()) return;
      const data = await leerJson(r);
      if (!r.ok) throw new Error(data.message || 'No se pudieron consultar las plantillas de Meta.');
      plantillas = (Array.isArray(data.templates) ? data.templates : []).filter(t => !motivoNoEnviable(t));
      // Las de utilidad primero: son las que Meta entrega sin el tope de marketing.
      plantillas.sort((a, b) => Number(String(a.category).toUpperCase() === 'MARKETING') - Number(String(b.category).toUpperCase() === 'MARKETING')
        || claveDePlantilla(a).localeCompare(claveDePlantilla(b)));
      if (plantillas.length) elegir(plantillas[0]);
      pintar();
    } catch (err) {
      if (!dialogo.abierto()) return;
      cuerpo.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err?.message || 'No se pudieron cargar las plantillas.')}</div>
        <div class="password-dialog-actions"><button type="button" class="btn btn-primary" data-cerrar>Cerrar</button></div>`;
    }
  })();

  return dialogo;
}

export { abrirEnviarPlantilla };
