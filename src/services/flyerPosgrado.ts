/**
 * Flyer de un posgrado con la línea gráfica de la UTB en Instagram (@utboficial):
 * formato vertical 4:5, foto oficial arriba fundida en azul eléctrico, logo blanco,
 * titular en mayúsculas extra negrita, detalles en verde neón, píldora azul marino
 * con borde punteado y tarjetas translúcidas con los datos del programa.
 *
 * Aquí solo se arma el HTML (puro y probado); lo convierte en JPG el Chromium del
 * servidor (`fotoProgramaService.ts`). Todo va incrustado: sin red al renderizar.
 */
import type { ProgramaUtb } from './catalogoUtb';
import { esVirtual } from './catalogoUtb';

export const ANCHO_FLYER = 1080;
/** Azul de marca: el del logo en @utboficial y el del menú de utb.edu.co. */
export const AZUL_UTB = '#093AD8';
export const ALTO_FLYER = 1350;

export interface DatosFlyer {
  nivel: string;
  titular: string;
  semestres: string;
  modalidad: string;
  inversion: string;
  inversionDetalle: string;
  titulo: string | null;
  snies: string | null;
  acreditado: boolean;
  campoLaboral: string[];
  vigencia: string;
}

const NIVEL: Record<string, string> = {
  especializacion: 'Especialización',
  maestria: 'Maestría',
  doctorado: 'Doctorado',
};

function pesos(valor: number): string {
  return `$${Math.round(valor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function modalidadCorta(p: ProgramaUtb): string {
  if (esVirtual(p)) return '100% virtual';
  const m = (p.modalidad ?? 'Presencial').trim();
  if (/20%\s*sesiones remotas/i.test(m)) return 'Presencial + 20% remoto';
  if (/presencial\s*[–-]\s*remota/i.test(m)) return 'Presencial / remota';
  return m;
}

function recortar(texto: string, max: number): string {
  const t = texto.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/[\s,;:.]+\S*$/, '')}…`;
}

/** Lo que dice el flyer, sacado del catálogo oficial. */
export function datosFlyer(p: ProgramaUtb, vigencia: string): DatosFlyer {
  const nivel = NIVEL[p.nivel] ?? 'Posgrado';
  const titular = p.nombre.replace(/^(Especialización|Maestría|Doctorado)\s+(en\s+)?/i, '').trim() || p.nombre;
  return {
    nivel,
    titular,
    semestres: p.duracion_semestres ? String(p.duracion_semestres) : (p.duracion ?? '—'),
    modalidad: modalidadCorta(p),
    inversion: p.inversion_cop ? pesos(p.inversion_cop) : 'Consulta el valor',
    inversionDetalle: p.inversion_cop ? `por semestre · ${vigencia}` : 'con un asesor',
    titulo: p.titulo_otorgado ? recortar(p.titulo_otorgado, 110) : null,
    snies: p.snies,
    acreditado: p.acreditacion_alta_calidad,
    campoLaboral: campoLaboralCorto(p.campo_laboral ?? []),
    vigencia,
  };
}

/**
 * Solo cargos o sectores cortos ("Desarrollo de software"), no frases largas
 * ("Con los conocimientos y habilidades…"). Con menos de dos, no va la sección.
 */
export function campoLaboralCorto(campo: readonly string[]): string[] {
  const cortos = campo
    .map((c) => c.replace(/\s+/g, ' ').replace(/[.;:]+$/, '').trim())
    .filter((c) => c.length >= 4 && c.length <= 46 && !/^(con|el|la|los|las|en|al|como|puede|podr)\b/i.test(c));
  return cortos.length >= 2 ? cortos.slice(0, 4) : [];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** El titular se achica según el largo, para que nunca pase de tres o cuatro líneas. */
export function tamanoTitular(titular: string): number {
  const n = titular.length;
  if (n <= 18) return 96;
  if (n <= 28) return 84;
  if (n <= 40) return 72;
  if (n <= 56) return 62;
  return 54;
}

export interface RecursosFlyer {
  /** Foto oficial como data URI (o null: solo el fondo azul). */
  foto: string | null;
  /** Logo UTB blanco (SVG) como data URI, para el fondo azul. */
  logo: string;
  /** Logo UTB oficial en azul de marca (SVG) como data URI, para el pie blanco. */
  logoColor: string;
  /** Montserrat por peso, como data URIs woff2. */
  fuentes: Record<400 | 600 | 800 | 900, string>;
}

const ZIGZAG =
  '<svg width="92" height="18" viewBox="0 0 92 18"><path d="M2 12 L10 4 L18 12 L26 4 L34 12 L42 4 L50 12 L58 4 L66 12 L74 4 L82 12 L90 4" ' +
  'fill="none" stroke="#6CFF5C" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICONO = {
  semestres: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  modalidad: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  inversion: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.6-3.1-1.6M12 6.5v11"/></svg>',
  titulo: '<svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/></svg>',
};

/** HTML del flyer, 1080 × 1350, con fuentes, foto y logo incrustados. */
export function htmlFlyer(d: DatosFlyer, r: RecursosFlyer): string {
  const fuentes = ([400, 600, 800, 900] as const)
    .map((w) => `@font-face{font-family:Montserrat;font-weight:${w};src:url(${r.fuentes[w]}) format('woff2')}`)
    .join('');
  const conCampo = d.campoLaboral.length > 0;
  const fotoAlto = 780;
  const tarjeta = (icono: string, grande: string, chico: string, clase = '') =>
    `<div class="dato ${clase}${grande.length > 11 ? ' largo' : ''}"><div class="ico">${icono}</div>` +
    `<div class="grande">${esc(grande)}</div><div class="chico">${esc(chico)}</div></div>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
${fuentes}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${ANCHO_FLYER}px;height:${ALTO_FLYER}px;overflow:hidden}
body{font-family:Montserrat,Arial,sans-serif;color:#fff;background:#1d22e6}
.flyer{position:relative;width:100%;height:100%;overflow:hidden;
  background:linear-gradient(180deg,#2a33ff 0%,#2129f2 45%,#1a1bd0 78%,#1512b4 100%)}
/* La portada (foto + velo azul) se desvanece hacia abajo: sin corte con el fondo. */
.portada{position:absolute;left:0;top:0;width:100%;height:${fotoAlto}px;
  -webkit-mask-image:linear-gradient(180deg,#000 62%,transparent 100%);mask-image:linear-gradient(180deg,#000 62%,transparent 100%)}
.foto{position:absolute;left:0;top:0;width:100%;height:100%;background:#2a33ff center/cover no-repeat;
  ${r.foto ? `background-image:url(${r.foto});` : ''}}
.velo{position:absolute;left:0;top:0;width:100%;height:100%;
  background:linear-gradient(180deg,rgba(20,26,170,.55) 0%,rgba(42,51,255,.05) 20%,rgba(42,51,255,.12) 42%,rgba(38,46,248,.82) 70%,#2129f2 100%)}
.cab{position:absolute;top:44px;left:0;width:100%;display:flex;justify-content:center}
.cab img{height:74px;filter:brightness(0) invert(1)}
/* Anclado sobre el pie: crece hacia arriba y nunca se corta. */
.cuerpo{position:absolute;left:64px;right:64px;bottom:152px}
.nivel{display:inline-block;padding:12px 30px;border-radius:40px;background:#16186b;border:3px dashed rgba(255,255,255,.55);
  font-weight:800;font-size:30px;letter-spacing:3px;text-transform:uppercase}
h1{margin-top:22px;font-weight:900;font-size:${tamanoTitular(d.titular)}px;line-height:1.04;text-transform:uppercase;
  text-shadow:0 0 0 #1b22ff,4px 4px 0 #1612b8,0 6px 26px rgba(10,10,90,.55)}
.deco{display:flex;align-items:center;gap:22px;margin:26px 0 30px}
.deco .linea{flex:1;border-top:3px dashed rgba(255,255,255,.55);position:relative}
.deco .linea:after{content:"";position:absolute;left:50%;top:-11px;width:18px;height:18px;border-radius:50%;background:#fff}
.datos{display:grid;grid-template-columns:1fr 1fr 1.25fr;gap:18px}
.dato{background:rgba(255,255,255,.13);border:2px solid rgba(255,255,255,.22);border-radius:26px;padding:22px 22px 20px}
.ico{width:46px;height:46px;border-radius:50%;background:#16186b;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.ico svg{width:26px;height:26px;fill:none;stroke:#6CFF5C;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.grande{font-weight:900;font-size:38px;line-height:1.05}
.semestres .grande{font-size:64px;color:#6CFF5C}
.largo .grande{font-size:30px}
.chico{margin-top:6px;font-weight:600;font-size:22px;line-height:1.2;text-transform:uppercase;letter-spacing:.5px;opacity:.95}
.titulo{margin-top:18px;display:flex;align-items:center;gap:16px;background:rgba(22,24,107,.55);border-radius:22px;padding:16px 22px}
.titulo .ico{margin:0;flex:none}
.titulo b{font-weight:800;color:#6CFF5C;font-size:20px;letter-spacing:1px;display:block;text-transform:uppercase}
.titulo span{font-weight:600;font-size:25px;line-height:1.2}
.campo{margin-top:22px}
.campo h2{font-weight:800;font-size:24px;letter-spacing:1px;text-transform:uppercase;color:#6CFF5C;margin-bottom:12px}
.chips{display:flex;flex-wrap:wrap;gap:10px}
.chip{background:#fff;color:${AZUL_UTB};border-radius:30px;padding:9px 18px;font-weight:700;font-size:21px}
.sello{margin-top:16px;font-weight:600;font-size:20px;opacity:.9}
.sello b{color:#6CFF5C}
.pie{position:absolute;left:0;bottom:0;width:100%;height:118px;background:#fff;display:flex;align-items:center;
  justify-content:space-between;padding:0 56px;color:${AZUL_UTB}}
.pie img{height:54px}
.pie .txt{font-weight:600;font-size:18px;color:#3d4a7a;text-align:center;line-height:1.3}
.pie .boton{border:3px solid ${AZUL_UTB};border-radius:40px;padding:12px 26px;font-weight:800;font-size:24px}
</style></head><body><div class="flyer">
<div class="portada"><div class="foto"></div><div class="velo"></div></div>
<div class="cab"><img src="${r.logo}" alt="UTB"></div>
<div class="cuerpo">
  <div class="nivel">${esc(d.nivel)}</div>
  <h1>${esc(d.titular)}</h1>
  <div class="deco">${ZIGZAG}<div class="linea"></div>${ZIGZAG}</div>
  <div class="datos">
    ${tarjeta(ICONO.semestres, d.semestres, /^\d+$/.test(d.semestres) ? (d.semestres === '1' ? 'semestre' : 'semestres') : 'duración', 'semestres')}
    ${tarjeta(ICONO.modalidad, d.modalidad.split(' ')[0], d.modalidad.split(' ').slice(1).join(' ') || 'modalidad')}
    ${tarjeta(ICONO.inversion, d.inversion, d.inversionDetalle)}
  </div>
  ${d.titulo ? `<div class="titulo"><div class="ico">${ICONO.titulo}</div><div><b>Título</b><span>${esc(d.titulo)}</span></div></div>` : ''}
  ${conCampo ? `<div class="campo"><h2>¿Dónde podrás trabajar?</h2><div class="chips">${d.campoLaboral.map((c) => `<div class="chip">${esc(c)}</div>`).join('')}</div></div>` : ''}
  ${d.snies || d.acreditado ? `<div class="sello">${d.snies ? `SNIES ${esc(d.snies)}` : ''}${d.snies && d.acreditado ? ' · ' : ''}${d.acreditado ? '<b>Acreditación de alta calidad</b>' : ''}</div>` : ''}
</div>
<div class="pie"><img src="${r.logoColor}" alt="UTB"><div class="txt">Valores de matrícula ${esc(d.vigencia)}<br>Vigilada Mineducación</div><div class="boton">utb.edu.co/posgrados</div></div>
</div></body></html>`;
}
