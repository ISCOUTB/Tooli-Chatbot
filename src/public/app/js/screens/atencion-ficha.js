import { ORIGENES, SECTORES, fechaEvento } from '../core/asistencia.js';
import { crmEstadoMeta } from '../core/crm.js';
import { escapeHtml } from '../core/dom.js';
import { colorTextoLegible, relativeTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { nombreParaSaludo } from '../core/plantillas.js';

/* La ficha de la persona junto al chat de Atención: el resumen con IA de lo
   que habló con el bot, lo que dejó registrado, su etapa en el CRM, los
   eventos a los que fue y las plantillas que recibió. Aquí solo se arma el
   HTML (probado con node:test); atencion.js la carga y la conecta. */

/** «hace 5 min», «hace 2 h» o «el 12 nov.», según cuánto pasó. */
function haceCuanto(ts) {
  const r = relativeTime(ts);
  if (r === 'ahora') return 'hace un momento';
  return /^\d/.test(r) ? `hace ${r}` : `el ${r}`;
}

function horaCorta(ts) {
  return new Date(ts).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
}

/**
 * La ventana de 24 h en palabras: hasta cuándo se le puede escribir o desde
 * cuándo no. null si el canal no tiene ventana.
 */
function textoVentana(ventana, ahora = Date.now()) {
  if (!ventana) return null;
  if (ventana.abierta && ventana.cierraTs) {
    const faltan = ventana.cierraTs - ahora;
    if (faltan <= 60 * 60 * 1000) {
      return { abierta: true, pronto: true, texto: `Puedes escribirle solo ${Math.max(1, Math.round(faltan / 60000))} min más; después, con plantilla.` };
    }
    const hoy = new Date(ventana.cierraTs).toDateString() === new Date(ahora).toDateString();
    const hora = horaCorta(ventana.cierraTs);
    // «3:05 p. m.» ya termina en punto.
    return { abierta: true, pronto: false, texto: `Puedes escribirle hasta ${hoy ? 'hoy' : 'mañana'} a las ${hora}${hora.endsWith('.') ? '' : '.'}` };
  }
  return {
    abierta: false, pronto: false,
    texto: ventana.ultimoEntranteTs
      ? `Escribió por última vez ${haceCuanto(ventana.ultimoEntranteTs)}: ya pasaron las 24 horas.`
      : 'No hay mensajes suyos recientes: solo se le puede enviar una plantilla.',
  };
}

/** Las viñetas del resumen como lista; cualquier otra línea, como párrafo. */
function resumenTextoHtml(texto) {
  const lineas = String(texto ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const vinetas = lineas.filter(l => /^[•\-*]\s*/.test(l)).map(l => l.replace(/^[•\-*]\s*/, ''));
  const otras = lineas.filter(l => !/^[•\-*]\s*/.test(l));
  return `${otras.map(l => `<p>${escapeHtml(l)}</p>`).join('')}${vinetas.length ? `<ul>${vinetas.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>` : ''}`;
}

function seccionResumen(resumen, ultimoEntranteTs) {
  const cabecera = `<h3>${icon('bot', 13)} Lo que habló con el bot <span class="atn-ficha-ia">IA</span></h3>`;
  if (!resumen || resumen.estado === 'nada' || resumen.estado === 'cargando') {
    return `<section class="atn-ficha-seccion" aria-busy="true">${cabecera}
      <div class="atn-ficha-resumen">
        <div class="skeleton skeleton-line" style="width:92%;"></div>
        <div class="skeleton skeleton-line" style="width:78%;"></div>
        <div class="skeleton skeleton-line" style="width:64%;"></div>
        <span class="sr-only">Resumiendo la conversación…</span>
      </div></section>`;
  }
  if (resumen.estado === 'error') {
    return `<section class="atn-ficha-seccion">${cabecera}
      <div class="atn-ficha-resumen atn-ficha-resumen-error" role="alert">
        <p>${escapeHtml(resumen.mensaje || 'No se pudo hacer el resumen.')}</p>
        <button type="button" class="btn btn-secondary atn-ficha-mini" data-resumen="reintentar">${icon('refresh', 13)} Reintentar</button>
      </div></section>`;
  }
  const datos = resumen.datos;
  if (!datos) {
    return `<section class="atn-ficha-seccion">${cabecera}<p class="atn-ficha-vacio">No le escribió al bot antes de llegar aquí, o su historial ya expiró.</p></section>`;
  }
  const hayNuevos = ultimoEntranteTs && ultimoEntranteTs > datos.hastaTs;
  return `<section class="atn-ficha-seccion">${cabecera}
    <div class="atn-ficha-resumen">
      ${resumenTextoHtml(datos.texto)}
      ${hayNuevos ? '<p class="atn-ficha-nota">Escribió algo después de este resumen.</p>' : ''}
      <div class="atn-ficha-ia-pie">
        <span title="${escapeHtml(new Date(datos.generadoEn).toLocaleString('es-CO'))}">Hecho con IA ${escapeHtml(haceCuanto(datos.generadoEn))}: puede equivocarse.</span>
        <button type="button" class="btn btn-ghost atn-ficha-mini" data-resumen="actualizar" aria-label="Volver a resumir">${icon('refresh', 13)}<span>Actualizar</span></button>
      </div>
    </div></section>`;
}

function seccionVentana(ficha, ahora) {
  const ventana = textoVentana(ficha.ventana, ahora);
  const boton = ficha.puedeRecibirPlantilla
    ? `<button type="button" class="btn ${ventana && !ventana.abierta ? 'btn-primary' : 'btn-secondary'} atn-ficha-mini atn-enviar-plantilla">${icon('send', 13)} Enviar plantilla</button>`
    : '';
  if (!ventana && !boton) return '';
  return `<section class="atn-ficha-seccion">
    <h3>${icon('clock', 13)} WhatsApp</h3>
    ${ventana ? `<p class="atn-ficha-ventana ${ventana.abierta ? (ventana.pronto ? 'pronto' : 'abierta') : 'cerrada'}">${escapeHtml(ventana.texto)}</p>` : ''}
    ${!ficha.puedeRecibirPlantilla ? '<p class="atn-ficha-vacio">Escribe sin mostrar su número, así que no se le pueden enviar plantillas.</p>' : ''}
    ${ficha.bajaCampanas ? `<p class="atn-ficha-baja">${icon('bellOff', 13)} Pidió no recibir campañas: no le envíes plantillas de marketing.</p>` : ''}
    ${boton}
  </section>`;
}

function seccionInteres(interes) {
  const filas = [
    ['Nombre', nombreParaSaludo(interes.nombre) || interes.nombre], ['Programa', interes.programa], ['Área', interes.area],
    ['Perfil', interes.relacion], ['Correo', interes.correo], ['Se registró', interes.registradoEl],
  ].filter(([, valor]) => String(valor ?? '').trim());
  return `<section class="atn-ficha-seccion">
    <h3>${icon('clipboard', 13)} Lo que dejó registrado</h3>
    ${filas.length
      ? `<dl class="atn-ficha-datos">${filas.map(([dato, valor]) => `<div><dt>${dato}</dt><dd>${escapeHtml(valor)}</dd></div>`).join('')}</dl>`
      : '<p class="atn-ficha-vacio">No dejó datos en el registro de posgrados.</p>'}
  </section>`;
}

function seccionCrm(crm) {
  if (!crm) return '';
  const estado = crmEstadoMeta(crm.estado);
  return `<section class="atn-ficha-seccion">
    <h3>${icon('target', 13)} CRM</h3>
    <div class="atn-ficha-crm">
      <span class="badge" style="background:${estado.color}1f;color:${colorTextoLegible(estado.color)};">${escapeHtml(estado.label)}</span>
      ${crm.asignadoA ? `<span class="atn-ficha-sub">Lo lleva ${escapeHtml(crm.asignadoA)}</span>` : ''}
    </div>
    ${crm.etiquetas?.length ? `<div class="atn-ficha-etiquetas">${crm.etiquetas.map(e => `<span>${escapeHtml(e)}</span>`).join('')}</div>` : ''}
    ${crm.notas?.length ? `<ul class="atn-ficha-lista atn-ficha-notas">${crm.notas.map(n => `
      <li><span>${escapeHtml(n.texto)}</span><span class="atn-ficha-sub">${escapeHtml(n.autor)} · ${escapeHtml(haceCuanto(n.ts))}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}

function seccionEventos(asistencias) {
  if (!asistencias.length) return '';
  return `<section class="atn-ficha-seccion">
    <h3>${icon('calendar', 13)} Eventos a los que fue</h3>
    <ul class="atn-ficha-lista">${asistencias.map(a => `
      <li><span>${escapeHtml(a.evento)}</span><span class="atn-ficha-sub">${escapeHtml([SECTORES[a.sector]?.label ?? a.sector, fechaEvento(a.fecha), ORIGENES[a.origen] ?? ''].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>
  </section>`;
}

const RESULTADOS = {
  enviado: { texto: 'Enviada', tono: 'ok' },
  fallido: { texto: 'No se envió', tono: 'error' },
  pendiente: { texto: 'En cola', tono: 'info' },
};

function seccionPlantillas(plantillas) {
  if (!plantillas.length) return '';
  return `<section class="atn-ficha-seccion">
    <h3>${icon('megaphone', 13)} Plantillas que recibió</h3>
    <ul class="atn-ficha-lista">${plantillas.map(p => {
      const r = RESULTADOS[p.resultado] ?? RESULTADOS.pendiente;
      return `<li>
        <span class="atn-ficha-plantilla"><span>${escapeHtml(p.templateName)}</span><span class="badge plt-tono-${r.tono}">${r.texto}</span></span>
        <span class="atn-ficha-sub">${escapeHtml(haceCuanto(p.createdAt))} · ${escapeHtml(p.createdBy)}${p.error ? ` · ${escapeHtml(p.error)}` : ''}</span>
      </li>`;
    }).join('')}</ul>
  </section>`;
}

/**
 * El contenido completo del panel. `estado`: { datos, error, resumen }, donde
 * `datos` es la ficha del servidor (null mientras carga).
 */
function htmlFicha({ datos, error = '', resumen }, ahora = Date.now()) {
  const cabecera = `
    <div class="atn-ficha-cabecera">
      <h2 id="atnFichaTitulo">${icon('user', 16)} Ficha</h2>
      <button type="button" class="btn btn-ghost atn-ficha-cerrar" aria-label="Cerrar la ficha">${icon('x', 18)}</button>
    </div>`;
  if (!datos) {
    return `${cabecera}<div class="atn-ficha-cuerpo">${error
      ? `<div class="alert alert-error" role="alert">${escapeHtml(error)} <button type="button" class="btn btn-secondary atn-ficha-mini" data-ficha="reintentar">Reintentar</button></div>`
      : `<div aria-busy="true">${Array.from({ length: 4 }).map(() => '<div class="skeleton skeleton-line" style="height:48px;margin:0 0 12px;"></div>').join('')}</div>`}
    </div>`;
  }
  const secciones = [
    seccionResumen(resumen, datos.ventana?.ultimoEntranteTs ?? null),
    seccionVentana(datos, ahora),
    seccionInteres(datos.interes),
    seccionCrm(datos.crm),
    seccionEventos(datos.asistencias),
    seccionPlantillas(datos.plantillas),
  ].filter(Boolean);
  return `${cabecera}<div class="atn-ficha-cuerpo">
    ${secciones.join('')}
    ${datos.sinDatos?.length ? `<p class="atn-ficha-aviso">${icon('alert', 13)} No se pudo consultar: ${escapeHtml(datos.sinDatos.join(', '))}.</p>` : ''}
    <button type="button" class="btn btn-ghost atn-ficha-historial" data-ficha="historial">${icon('message', 14)} Ver todo el historial con el bot</button>
  </div>`;
}

/** El aviso sobre la caja de texto cuando ya no se puede escribir texto libre. */
function avisoVentanaHtml({ nombre = '', puedeRecibirPlantilla = false }) {
  return `
    <span class="atn-ventana-icono">${icon('clock', 16)}</span>
    <span class="atn-ventana-texto"><strong>Pasaron más de 24 horas</strong> desde el último mensaje${nombre ? ` de ${escapeHtml(nombre)}` : ''}.
      ${puedeRecibirPlantilla
        ? 'WhatsApp solo deja enviarle una plantilla aprobada; las notas privadas sí se pueden dejar.'
        : 'Escribe sin mostrar su número, así que hay que esperar a que vuelva a escribir.'}</span>
    ${puedeRecibirPlantilla ? `<button type="button" class="btn btn-primary atn-enviar-plantilla">${icon('send', 15)} Enviar plantilla</button>` : ''}`;
}

/** La hora del último mensaje de la persona en el hilo, para saber si escribió algo nuevo. */
function ultimoEntrante(mensajes) {
  return (Array.isArray(mensajes) ? mensajes : []).reduce((max, m) => (m?.tipo === 'in' && m.ts > max ? m.ts : max), 0);
}

export { avisoVentanaHtml, haceCuanto, htmlFicha, resumenTextoHtml, textoVentana, ultimoEntrante };
