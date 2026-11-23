import { $, haptic } from './dom.js';
import { icon } from './icons.js';
import { navigate } from './router.js';
import { ActionSheet } from '../ui/sheet.js';

/* ============= ATAJOS DE TECLADO =============
   Para quien usa el panel todo el día en computador. Nunca se disparan
   mientras se está escribiendo en un campo — eso convertiría cada letra en un
   comando. */
function esCampoDeTexto(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const ATAJOS = [
  { tecla: '/', desc: 'Buscar en la pantalla actual' },
  { tecla: 'g', desc: 'Ir a… (luego i inicio, c conversaciones, a agenda, p prospectos, r recordatorios, m métricas)' },
  { tecla: '?', desc: 'Ver esta lista' },
  { tecla: 'Esc', desc: 'Cerrar lo que esté abierto' },
];

let esperandoIr = false;
const DESTINOS_IR = { i: 'home', c: 'conversaciones', a: 'agenda', p: 'registros', r: 'recordatorios', m: 'metricas', e: 'evento-posgrado', s: 'health' };

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (esperandoIr) {
    esperandoIr = false;
    const destino = DESTINOS_IR[e.key.toLowerCase()];
    if (destino) { e.preventDefault(); haptic(10); navigate(destino); }
    return;
  }

  if (esCampoDeTexto(document.activeElement)) {
    // Escape saca el foco del campo para que los atajos vuelvan a funcionar.
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }

  if (e.key === '/') {
    const buscador = document.querySelector('#crmSearch, #inboxSearch, #eventoSearch');
    if (buscador) { e.preventDefault(); buscador.focus(); buscador.select?.(); }
    return;
  }

  if (e.key === 'g') { esperandoIr = true; setTimeout(() => { esperandoIr = false; }, 1500); return; }

  if (e.key === '?') {
    e.preventDefault();
    ActionSheet.open({
      title: 'Atajos de teclado',
      subtitle: 'Funcionan cuando no estás escribiendo en un campo.',
      groups: [
        ATAJOS.map(a => ({ label: `${a.tecla} — ${a.desc}`, icon: icon('bolt', 15) })),
        [{ label: 'Cerrar', cancel: true }],
      ],
    });
  }
});

