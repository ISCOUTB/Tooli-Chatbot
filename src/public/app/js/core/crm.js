import { api } from './api.js';
import { $, escapeHtml, haptic, toast } from './dom.js';
import { relativeTime } from './format.js';
import { icon } from './icons.js';
import { sesion } from './session.js';

/* Categoriza la conversación según el paso de flujo real (no es un campo
   inventado: son los mismos nombres de `step` que usan los flujos en
   src/flows — programas/registro/prospecto son de posgrado, turno/recibo
   son de pregrado/matrícula). Si no hay sesión activa, queda "Sin flujo". */
const FLOW_CATEGORIES = {
  posgrado: { label: 'Posgrado', color: '#7c3aed', prefixes: ['menu_posgrado', 'programas_', 'registro_', 'prospecto_', 'reco_'] },
  pregrado: { label: 'Pregrado', color: '#0284c7', prefixes: ['menu_pregrado', 'pregrado_', 'esperando_codigo', 'recibo_'] },
  evento: { label: 'Evento', color: '#db2777', prefixes: ['evento_', 'posg_'] },
  soporte: { label: 'Soporte', color: '#64748b', prefixes: ['agent_', 'ti_', 'with_agent', 'chatting_with_ai'] },
};
function flowCategory(step) {
  if (!step || step === 'menu') return null;
  for (const [key, cat] of Object.entries(FLOW_CATEGORIES)) {
    if (cat.prefixes.some(p => step.startsWith(p))) return { key, ...cat };
  }
  return null;
}

/* El paso de la sesión en palabras para el asesor: "registro_email" no le dice
   nada a quien atiende; "Registro de interés · escribiendo su correo" sí.
   Pasos que no se reconocen se muestran tal cual, nunca se ocultan. */
const PASOS_EXACTOS = {
  menu: 'En el menú principal',
  menu_clasico: 'En el menú principal',
  menu_posgrado: 'En el menú de posgrados',
  menu_pregrado: 'En el menú de pregrado',
  with_agent: 'Hablando con un asesor',
  chatting_with_ai: 'Conversando con la IA',
  agent_area: 'Eligiendo con qué área hablar',
  esperando_codigo: 'Consulta de turno · escribiendo su código',
  posg_completada: 'Evento de posgrados · registro completo',
  posg_registro_pendiente: 'Evento de posgrados · registro sin terminar',
};
const PASOS_FLUJO = [
  ['reco_', 'Recomendación de posgrados'],
  ['posg_', 'Evento de posgrados'],
  ['evento_', 'Evento de posgrados'],
  ['programas_', 'Explorando programas'],
  ['pregrado_explorar_', 'Explorando carreras'],
  ['pregrado_', 'Registro de pregrado'],
  ['registro_', 'Registro de interés'],
  ['prospecto_', 'Registro de interés'],
  ['recibo_', 'Descarga de recibo'],
  ['notas_', 'Consulta de notas'],
  ['academico_', 'Mi vida académica'],
  ['verif_', 'Verificación de identidad'],
  ['ti_', 'Soporte TI'],
];
const PASOS_ACCION = [
  [/_(nombre)$/, 'escribiendo su nombre'],
  [/_(email|correo)$/, 'escribiendo su correo'],
  [/_(programa|carrera|nivel|grupo|cual_v|cual_final_v|elegir|categoria|area)$/, 'eligiendo opciones'],
  [/_(consent|consentimiento)$/, 'aceptando el uso de sus datos'],
  [/_(confirmar|confirma_v|confirmacion)$/, 'confirmando sus datos'],
  [/_codigo$/, 'escribiendo su código'],
  [/_cedula$/, 'escribiendo su cédula'],
  [/_password$/, 'escribiendo su contraseña'],
  [/_mfa$/, 'verificando su identidad'],
  [/_(detalle|ficha|resultados|accion)$/, 'viendo información'],
];
function describirPaso(step) {
  if (!step) return '';
  if (PASOS_EXACTOS[step]) return PASOS_EXACTOS[step];
  const flujo = PASOS_FLUJO.find(([prefijo]) => step.startsWith(prefijo))?.[1];
  const accion = PASOS_ACCION.find(([patron]) => patron.test(step))?.[1];
  if (flujo && accion) return `${flujo} · ${accion}`;
  return flujo ?? step;
}

/* ============= FICHA DE SEGUIMIENTO DEL CRM =============
   Notas, estado del embudo, etiquetas y asignación por prospecto.
   Todo esto lo escribe el equipo — no viene del bot ni de un sistema
   universitario, y la UI lo deja claro (ver src/services/crmService.ts). */
const CRM_ESTADOS = [
  { value: 'nuevo',       label: 'Nuevo',       icon: '⏳', color: '#94a3b8' },
  { value: 'contactado',  label: 'Contactado',  icon: '📞', color: '#0284c7' },
  { value: 'interesado',  label: 'Interesado',  icon: '⭐', color: '#7c3aed' },
  { value: 'inscrito',    label: 'Inscrito',    icon: '🎓', color: '#16a34a' },
  { value: 'descartado',  label: 'Descartado',  icon: '✖️', color: '#64748b' },
];
function crmEstadoMeta(valor) {
  return CRM_ESTADOS.find(e => e.value === valor) ?? CRM_ESTADOS[0];
}

function notaHtml(n) {
  return `
    <li class="crm-nota" data-nota="${escapeHtml(n.id)}">
      <div class="crm-nota-texto">${escapeHtml(n.texto)}</div>
      <div class="crm-nota-meta">
        <span>${escapeHtml(n.autor)} · ${relativeTime(n.ts)}</span>
        <button type="button" class="crm-nota-del" data-del="${escapeHtml(n.id)}" aria-label="Eliminar nota">${icon('trash', 13)}</button>
      </div>
    </li>`;
}

function fichaHtml(ficha) {
  const f = ficha ?? { estado: 'nuevo', etiquetas: [], notas: [] };
  const meta = crmEstadoMeta(f.estado);
  return `
    <div class="crm-ficha">
      <details class="disclosure" open>
        <summary><span class="disclosure-title">${icon('tag', 15)} Seguimiento</span>
          <span class="disclosure-value" id="fichaEstadoActual" style="color:${meta.color};">${meta.icon} ${meta.label}</span>
          ${icon('chevronRight', 16)}
        </summary>
        <div class="disclosure-body">
          <div class="crm-estado-chips" id="fichaEstados">
            ${CRM_ESTADOS.map(e => `
              <button type="button" class="crm-estado-chip ${f.estado === e.value ? 'active' : ''}" data-estado="${e.value}"
                style="--chip:${e.color};">${e.icon} ${e.label}</button>`).join('')}
          </div>
          <div class="crm-asignado">
            <span class="crm-asignado-label">${icon('user', 14)} Asesor responsable</span>
            <span class="crm-asignado-valor" id="fichaAsignado">${f.asignadoA ? escapeHtml(f.asignadoA) : 'Sin asignar'}</span>
            <button type="button" class="btn btn-secondary crm-mini-btn" id="fichaAsignarBtn">${f.asignadoA === sesion.user?.username ? 'Liberar' : 'Tomar'}</button>
          </div>
          <div class="crm-etiquetas" id="fichaEtiquetas">
            ${f.etiquetas.map(e => `<span class="crm-etiqueta">${escapeHtml(e)}<button type="button" data-quitar="${escapeHtml(e)}" aria-label="Quitar etiqueta">${icon('x', 11)}</button></span>`).join('')}
            <input type="text" class="crm-etiqueta-input" id="fichaEtiquetaInput" placeholder="+ etiqueta" maxlength="30" aria-label="Agregar etiqueta">
          </div>
        </div>
      </details>

      <details class="disclosure" ${f.notas.length ? 'open' : ''}>
        <summary><span class="disclosure-title">${icon('note', 15)} Notas del equipo</span>
          <span class="disclosure-value" id="fichaNotasCount">${f.notas.length}</span>
          ${icon('chevronRight', 16)}
        </summary>
        <div class="disclosure-body">
          <ul class="crm-notas" id="fichaNotas">
            ${f.notas.length ? f.notas.map(notaHtml).join('')
              : '<li class="crm-notas-vacio">Nadie ha dejado notas todavía. Lo que escribas acá lo ve todo el equipo.</li>'}
          </ul>
          <form class="crm-nota-form" id="fichaNotaForm">
            <textarea id="fichaNotaInput" rows="2" maxlength="2000" placeholder="Ej: Llamé, quedó de confirmar el viernes…" aria-label="Escribir una nota"></textarea>
            <button type="submit" class="btn btn-primary crm-mini-btn" id="fichaNotaBtn" disabled>Agregar nota</button>
          </form>
        </div>
      </details>
    </div>`;
}

/** Conecta los controles de la ficha. `onChange` refresca la grilla de atrás. */
function wireFicha(sheet, phone, ficha, onChange) {
  let f = ficha ?? { estado: 'nuevo', etiquetas: [], notas: [] };
  const $$$ = (sel) => sheet.querySelector(sel);

  const guardar = async (ruta, body) => {
    try {
      const r = await api(`/api/tools/crm/${phone}/${ruta}`, { method: 'POST', body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? 'error');
      f = data.ficha;
      if (!sheet.isConnected) return false;
      onChange?.();
      return true;
    } catch (err) {
      if (sheet.isConnected) {
        toast('No se pudo guardar');
        haptic([20, 30, 20]);
      }
      return false;
    }
  };

  // Estado del embudo
  $$$('#fichaEstados')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-estado]');
    if (!btn || btn.classList.contains('active')) return;
    haptic(12);
    const estado = btn.dataset.estado;
    if (!(await guardar('estado', { estado }))) return;
    $$$('#fichaEstados').querySelectorAll('.crm-estado-chip').forEach(b => b.classList.toggle('active', b === btn));
    const meta = crmEstadoMeta(estado);
    const actual = $$$('#fichaEstadoActual');
    actual.textContent = `${meta.icon} ${meta.label}`;
    actual.style.color = meta.color;
    toast(`Marcado como ${meta.label.toLowerCase()}`);
  });

  // Asignación
  $$$('#fichaAsignarBtn')?.addEventListener('click', async (e) => {
    haptic(12);
    const mio = f.asignadoA === sesion.user?.username;
    if (!(await guardar('asignar', { username: mio ? null : sesion.user?.username }))) return;
    $$$('#fichaAsignado').textContent = f.asignadoA ? f.asignadoA : 'Sin asignar';
    e.target.textContent = f.asignadoA === sesion.user?.username ? 'Liberar' : 'Tomar';
    toast(f.asignadoA ? 'Prospecto asignado a ti' : 'Prospecto liberado');
  });

  // Etiquetas
  const pintarEtiquetas = () => {
    const cont = $$$('#fichaEtiquetas');
    const input = $$$('#fichaEtiquetaInput');
    cont.querySelectorAll('.crm-etiqueta').forEach(el => el.remove());
    f.etiquetas.forEach(et => {
      const span = document.createElement('span');
      span.className = 'crm-etiqueta';
      span.innerHTML = `${escapeHtml(et)}<button type="button" data-quitar="${escapeHtml(et)}" aria-label="Quitar etiqueta">${icon('x', 11)}</button>`;
      cont.insertBefore(span, input);
    });
  };
  $$$('#fichaEtiquetaInput')?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const valor = e.target.value.trim();
    if (!valor || f.etiquetas.includes(valor)) { e.target.value = ''; return; }
    haptic(10);
    if (!(await guardar('etiquetas', { etiquetas: [...f.etiquetas, valor] }))) return;
    e.target.value = '';
    pintarEtiquetas();
  });
  $$$('#fichaEtiquetas')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-quitar]');
    if (!btn) return;
    haptic(10);
    if (!(await guardar('etiquetas', { etiquetas: f.etiquetas.filter(x => x !== btn.dataset.quitar) }))) return;
    pintarEtiquetas();
  });

  // Notas
  const notaInput = $$$('#fichaNotaInput');
  const notaBtn = $$$('#fichaNotaBtn');
  notaInput?.addEventListener('input', () => { notaBtn.disabled = !notaInput.value.trim(); });
  $$$('#fichaNotaForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = notaInput.value.trim();
    if (!texto) return;
    notaBtn.disabled = true;
    haptic(12);
    if (!(await guardar('nota', { texto }))) { notaBtn.disabled = false; return; }
    notaInput.value = '';
    const lista = $$$('#fichaNotas');
    lista.querySelector('.crm-notas-vacio')?.remove();
    lista.insertAdjacentHTML('afterbegin', notaHtml(f.notas[0]));
    lista.firstElementChild.classList.add('recien-agregada');
    $$$('#fichaNotasCount').textContent = f.notas.length;
    toast('Nota guardada');
  });
  $$$('#fichaNotas')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    haptic([15, 20, 15]);
    const id = btn.dataset.del;
    try {
      const r = await api(`/api/tools/crm/${phone}/nota/${id}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok) throw new Error();
      f = data.ficha ?? f;
      if (!sheet.isConnected) return;
      const li = $$$(`[data-nota="${id}"]`);
      li?.classList.add('saliendo');
      setTimeout(() => li?.remove(), 220);
      $$$('#fichaNotasCount').textContent = f.notas.length;
      onChange?.();
    } catch { if (sheet.isConnected) toast('No se pudo eliminar la nota'); }
  });
}

function programaCategoria(programa) {
  const p = (programa || '').toLowerCase();
  if (p.includes('doctorado')) return 'doctorado';
  if (p.includes('maestr')) return 'maestria';
  if (p.includes('especial')) return 'especializacion';
  return 'otro';
}
const PROGRAMA_LABELS = { pregrado: 'Pregrado', especializacion: 'Especialización', maestria: 'Maestría', doctorado: 'Doctorado', otro: 'Otro' };
const PROGRAMA_COLORS = { pregrado: '#0284c7', especializacion: '#0369a1', maestria: '#7c3aed', doctorado: '#db2777', otro: '#64748b' };
/* Columna F del sheet = área (agregada para distinguir prospectos de
   pregrado y posgrado que ahora comparten el mismo registro) — las filas
   guardadas antes de esa columna vienen vacías y se tratan como Posgrado. */
function areaOf(row) { return row[5] || 'Posgrado'; }
function crmCategoria(row) { return areaOf(row) === 'Pregrado' ? 'pregrado' : programaCategoria(row[4]); }

export { CRM_ESTADOS, crmEstadoMeta, notaHtml, fichaHtml, wireFicha, programaCategoria, PROGRAMA_LABELS, PROGRAMA_COLORS, areaOf, crmCategoria, FLOW_CATEGORIES, flowCategory, describirPaso };
