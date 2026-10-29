#!/usr/bin/env node
/**
 * Normaliza lo extraído de utb.edu.co y virtual.utb.edu.co a un catálogo de
 * programas (pregrado y posgrado).
 *
 * Uso: node tools/utb-programas/normalizar.cjs <dir-crudo>
 *   <dir-crudo> debe tener:
 *     crudo.json   estado del extractor de www (extractor.browser.js → run())
 *     virtual.json fichas de virtual.utb.edu.co (extractor-virtual.browser.js)
 *     derechos-pecuniarios.json (opcional) tablas de matrícula (__utb.derechosPecuniarios())
 *     parches.json (opcional) fichas re-extraídas a mano que reemplazan a las de crudo.json
 *
 * Escribe src/data/programas-utb.json (lo lee el bot) y
 * data/utb-programas/programas-utb.csv (resumen para revisar en Excel).
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const [dirCrudo] = process.argv.slice(2);
if (!dirCrudo) {
  console.error('Uso: node tools/utb-programas/normalizar.cjs <dir-crudo>');
  process.exit(1);
}
const leer = f => JSON.parse(fs.readFileSync(path.join(dirCrudo, f), 'utf8'));
const leerOpcional = (f, vacio) => fs.existsSync(path.join(dirCrudo, f)) ? leer(f) : vacio;

// Escuela de cada pregrado, según las páginas de escuela de utb.edu.co.
const ESCUELAS = {
  'Escuela de Transformación Digital': ['ingenieria-de-sistemas-y-computacion', 'ciencia-de-datos', 'marketing-y-transformacion-digital', 'comunicacion-social'],
  'Escuela de Negocios, Leyes y Sociedad': ['administracion-de-empresas', 'finanzas-y-negocios-internacionales', 'contaduria-publica', 'derecho', 'psicologia', 'economia', 'ciencia-politica-y-relaciones-internacionales'],
  'Escuela de Ingeniería, Arquitectura & Diseño': ['arquitectura', 'diseno', 'ingenieria-civil', 'ingenieria-industrial', 'ingenieria-ambiental', 'ingenieria-quimica', 'ingenieria-naval', 'ingenieria-mecanica', 'ingenieria-electrica', 'ingenieria-electronica', 'ingenieria-mecatronica', 'ingenieria-biomedica'],
};
const escuelaDe = slug => Object.keys(ESCUELAS).find(e => ESCUELAS[e].includes(slug)) || null;

// Secciones con nombre propio; lo que no encaje queda en otras_secciones.
const SECCIONES = [
  ['descripcion', /^¿?Por qu[eé] estudiar|^Descubre m[aá]s de esta|^Especial[ií]zate en/i],
  ['objetivos', /^Objetivos/i],
  ['beneficios', /^Beneficios/i],
  ['que_hace', /^¿Qu[eé] hace un/i],
  ['campo_laboral', /D[oó]nde puede trabajar|En qu[eé] puede desempe[nñ]arse|D[oó]nde y qu[eé] roles|Campos de desempe[nñ]o|Potencia tu futuro laboral/i],
  ['perfil_egresado', /^Perfil del egres/i],
  ['perfil_aspirante', /^Perfil del aspirante/i],
  ['salario', /Cu[aá]nto gana/i],
  ['plan_estudios_texto', /^Plan de estudios/i],
  ['experiencias', /^Experiencias del programa/i],
  ['preguntas_frecuentes', /^Preguntas frecuentes/i],
  ['docentes', /cuerpo docente|^Profesores$|^Director del Programa$/i],
];
const RUIDO = /^(\[email[^\]]*protected\]|CvLAC|Consulta toda la informaci[oó]n relacionada al proceso de inscripci[oó]n\.?)$/i;

const limpiar = s => (s || '').replace(/\s+/g, ' ').trim();
const slugDe = url => new URL(url).pathname.split('/').filter(Boolean).filter(p => p !== 'index.php').pop();
const nivelDe = (nombre, url) => {
  if (/\/pregrados?\//.test(url)) return 'pregrado';
  if (/^Especializaci/i.test(nombre)) return 'especializacion';
  if (/^Maestr/i.test(nombre)) return 'maestria';
  if (/^Doctorado/i.test(nombre)) return 'doctorado';
  return null;
};
// "Administración De Empresas" → "Administración de Empresas"
const arreglarNombre = n => limpiar(n).replace(/(?<=\S) (De|Del|Y|En|La|Las|Los|Para|Por) (?=\S)/g, (m, p) => ' ' + p.toLowerCase() + ' ');
const semestres = s => { const m = (s || '').match(/(\d+)\s*semestre/i); return m ? Number(m[1]) : null; };
const sinPdfInstitucional = p => !/politica|res_ndeg1|Res-N|Plan-de-Desarrollo|modalBrochure/i.test(p.url);

function inversion(texto) {
  if (!texto) return {inversion_texto: null, inversion_cop: null};
  const t = limpiar(texto).replace(/^\$\s*\$/, '$');
  const m = t.match(/\d{1,3}(?:[.,]\d{3})+/);
  return {inversion_texto: t, inversion_cop: m ? Number(m[0].replace(/[.,]/g, '')) : null};
}

// "107299 – Acreditación de alta calidad", "117268 | Registro Calificado 15772 del ...", "Registro Calificado y Acreditación ...: Resolución ..."
function snies(texto) {
  const t = limpiar(texto);
  const m = t.match(/^(\d{4,6})\s*[|–-]?\s*(.*)$/);
  const resto = m ? m[2] : t;
  return {
    snies: m ? m[1] : null,
    acreditacion_alta_calidad: /acreditaci[oó]n de alta calidad/i.test(t),
    registro: limpiar(resto.replace(/^[–-]?\s*Acreditaci[oó]n de alta calidad\s*/i, '')) || null,
  };
}

function repartirSecciones(secciones, nombreDocentes) {
  const out = {}, otras = [];
  for (const s of secciones) {
    const contenido = s.contenido.map(limpiar).filter(t => t && !RUIDO.test(t));
    if (!contenido.length) continue;
    const clave = SECCIONES.find(([, re]) => re.test(s.titulo))?.[0];
    if (!clave) { otras.push({titulo: s.titulo, contenido}); continue; }
    if (clave === 'docentes') { nombreDocentes.push(...contenido); continue; }
    out[clave] = out[clave] ? out[clave].concat(contenido) : contenido;
  }
  if (out.salario) out.salario = out.salario.join(' ');
  return {...out, ...(otras.length ? {otras_secciones: otras} : {})};
}

// En la plantilla antigua el plan viene como ["Semestre 1", "Semestre 2", "• a • b", "• c • d", ...]:
// los encabezados y las listas de viñetas se emparejan en orden.
function planDeViñetas(lineas = []) {
  const periodos = lineas.filter(t => /^Semestre \d+$/i.test(t));
  const listas = lineas.filter(t => t.startsWith('•'));
  if (!periodos.length || periodos.length !== listas.length) return [];
  return periodos.map((periodo, i) => ({periodo, asignaturas: listas[i].split('•').map(limpiar).filter(Boolean)}));
}

// Fichas de www.utb.edu.co
function deWww(r) {
  const c = r.campos || {};
  const nombre = arreglarNombre(r.nombre);
  const nivel = nivelDe(nombre, r.url);
  const slug = slugDe(r.url);
  const sn = snies(c.SNIES || '');
  let registro = c['Registro Calificado'] || sn.registro;
  const extraRes = (r.encabezado_extra || []).find(t => /Resoluci[oó]n|Registro calificado/i.test(t));
  if (extraRes) registro = registro ? registro + ' | ' + extraRes : extraRes;
  const inv = inversion(c['Inversión'] || c['Inversión por semestre 2026']);
  const docentesTexto = [];
  const secs = repartirSecciones(r.secciones || [], docentesTexto);
  const pdfs = (r.pdfs || []).filter(sinPdfInstitucional);
  const modalidad = c.Modalidad || c['Metodología'] || null;
  const notas = (r.encabezado_extra || []).filter(t => t !== extraRes);
  if (c['Inversión por semestre 2026']) inv.inversion_periodo = '2026';
  const profes = (r.profesores || []).map(p => p.nombre).filter(Boolean);
  return {
    id: slug,
    nivel,
    nombre,
    sitio: 'www.utb.edu.co',
    url: r.url.endsWith('/') ? r.url : r.url + '/',
    escuela: nivel === 'pregrado' ? escuelaDe(slug) : null,
    modalidad: modalidad ? modalidad[0].toUpperCase() + modalidad.slice(1) : null,
    duracion: c['Duración'] || null,
    duracion_semestres: semestres(c['Duración']),
    ...inv,
    titulo_otorgado: c['Titulación'] || null,
    snies: sn.snies,
    acreditacion_alta_calidad: sn.acreditacion_alta_calidad || /acreditaci[oó]n de alta calidad/i.test(registro || ''),
    registro_calificado: registro || null,
    ...secs,
    plan_estudios: r.plan_estudios?.length ? r.plan_estudios : planDeViñetas(secs.plan_estudios_texto),
    plan_estudios_pdf: pdfs.find(p => /plan de estudios/i.test(p.texto))?.url || null,
    brochure_pdf: pdfs.find(p => /brochure/i.test(p.texto))?.url || null,
    profesores: profes.length ? profes : [...new Set(docentesTexto.filter(t => t.split(' ').length <= 5 && !/[.:]$/.test(t)))],
    inscripcion_url: r.inscripcion_url || null,
    fuentes: r.fuentes || [],
    ...(r.plantilla ? {plantilla: r.plantilla} : {}),
    ...(notas.length ? {notas} : {}),
  };
}

// Fichas de virtual.utb.edu.co
function deVirtual(r) {
  const enc = r.encabezado || [];
  const nombre = arreglarNombre(r.nombre);
  const i = enc.findIndex(t => /^Duraci[oó]n:?$/i.test(t));
  const dur = i >= 0 ? enc.slice(i + 1).filter(t => /a[nñ]o|mes|semestre/i.test(t) && t.length < 30) : [];
  const resI = enc.findIndex(t => /^N[uú]mero de resoluci[oó]n:?$/i.test(t));
  const registro = enc.find(t => /^Resoluci[oó]n/i.test(t)) || (resI >= 0 ? 'Resolución ' + enc[resI + 1] : null);
  const docentesTexto = [];
  const secs = repartirSecciones(r.secciones || [], docentesTexto);
  const desc = enc.filter(t => t.length > 80);
  if (desc.length) secs.descripcion = desc.concat(secs.descripcion || []);
  const notas = enc.filter(t => /^\*/.test(t));
  return {
    id: 'virtual-' + slugDe(r.url),
    nivel: nivelDe(nombre, r.url),
    nombre,
    sitio: 'virtual.utb.edu.co',
    url: r.url.split('?')[0],
    escuela: null,
    modalidad: 'Virtual (100% virtual)',
    duracion: dur.join(' / ') || null,
    duracion_semestres: semestres(dur.join(' ')),
    inversion_texto: null,
    inversion_cop: null,
    titulo_otorgado: null,
    snies: (enc.find(t => /^SNIES:/i.test(t)) || '').replace(/\D/g, '') || null,
    acreditacion_alta_calidad: false,
    registro_calificado: registro,
    numero_asignaturas: Number((enc.find(t => /\d+ asignaturas/i.test(t)) || '').replace(/\D/g, '')) || null,
    ...secs,
    plan_estudios: [],
    plan_estudios_pdf: null,
    brochure_pdf: null,
    // en el sitio virtual los docentes vienen como nombre + reseña; los nombres son las líneas cortas
    profesores: docentesTexto.filter(t => t.split(' ').length <= 5 && !/[.:]$/.test(t)),
    inscripcion_url: null,
    fuentes: ['sitemap virtual.utb.edu.co'],
    ...(notas.length ? {notas: notas.map(t => t.replace(/^\*/, ''))} : {}),
  };
}

// --- ensamblaje ---------------------------------------------------------
const crudo = leer('crudo.json');
const parches = Object.fromEntries(leerOpcional('parches.json', []).map(p => [p.url, p]));
const virtual = leer('virtual.json');
const pecuniarios = leerOpcional('derechos-pecuniarios.json', null);

// www: una ficha por URL final; se juntan las fuentes de las URLs que redirigen a ella
const porUrl = new Map();
const fallidas = [];
for (const r of Object.values(crudo.res)) {
  if (r.error) { fallidas.push({url: r.url_pedida || r.url, error: r.error, fuentes: r.fuentes}); continue; }
  const prev = porUrl.get(r.url);
  if (prev) { prev.fuentes = [...new Set([...prev.fuentes, ...r.fuentes])]; continue; }
  porUrl.set(r.url, {...(parches[r.url] || r), fuentes: r.fuentes, url_pedida: r.url_pedida});
}

const programas = [...porUrl.values()].map(deWww);
const virtuales = virtual.map(deVirtual);

// La ficha virtual de Contaduría Pública está vacía en el sitio; se registra desde el listado de pregrado.
virtuales.push({
  id: 'virtual-contaduria-publica', nivel: 'pregrado', nombre: 'Contaduría Pública Virtual', sitio: 'virtual.utb.edu.co',
  url: 'https://virtual.utb.edu.co/pregrado/contaduria-publica/', escuela: null, modalidad: 'Virtual (100% virtual)',
  duracion: null, duracion_semestres: null, inversion_texto: null, inversion_cop: null, titulo_otorgado: null, snies: null,
  acreditacion_alta_calidad: false, registro_calificado: null, plan_estudios: [], plan_estudios_pdf: null, brochure_pdf: null,
  profesores: [], inscripcion_url: null, fuentes: ['listado pregrado'],
  notas: ['La página del programa en virtual.utb.edu.co responde sin contenido (body vacío) al momento de la extracción.'],
});

// Los enlaces "-virtual" del listado de www redirigen al sitio virtual: se marcan como listados.
const redirVirtual = {
  'especializacion-en-derechos-humanos-virtual': 'virtual-derechos-humanos',
  'especializacion-en-gerencia-de-servicios-de-salud-virtual': 'virtual-gerencia-servicios-salud',
  'especializacion-en-contratacion-estatal-virtual': 'virtual-contratacion-estatal',
  'especializacion-en-contratacion-estatal': 'virtual-contratacion-estatal',
  'especializacion-en-seguridad-y-salud-en-el-trabajo': 'virtual-seguridad-y-salud-trabajo',
  'maestria-en-tic-para-la-educacion': 'virtual-tic-para-educacion',
  'contaduria-publica-virtual': 'virtual-contaduria-publica',
};
for (const f of fallidas) {
  const v = virtuales.find(x => x.id === redirVirtual[slugDe(f.url)]);
  if (v) { v.fuentes = [...new Set([...v.fuentes, ...f.fuentes.map(s => s + ' (vía www)')])]; f.redirige_a = v.url; }
}

// Mismo programa publicado en los dos sitios (mismo SNIES y mismo nombre): queda la ficha vigente.
const todos = programas.concat(virtuales);
const clave = p => p.nombre.toLowerCase().replace(/\s*\(?virtual\)?\s*$/, '');
const descartados = [];
for (const p of programas.filter(p => p.plantilla === 'legacy-acordeon')) {
  const gemelo = todos.find(q => q !== p && q.snies && q.snies === p.snies && clave(q) === clave(p));
  if (!gemelo) continue;
  gemelo.urls_alternas = [...(gemelo.urls_alternas || []), p.url];
  gemelo.registro_calificado ||= p.registro_calificado;
  gemelo.titulo_otorgado ||= p.titulo_otorgado;
  gemelo.fuentes = [...new Set([...gemelo.fuentes, ...p.fuentes.map(s => s + ' (página antigua)')])];
  descartados.push(p);
}
const finales = todos.filter(p => !descartados.includes(p));

// Derechos pecuniarios: valor oficial de matrícula por programa. Completa los
// precios que la ficha no publica (UTB Virtual) y confirma que el programa sigue en la oferta.
const nombreClave = s => limpiar(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ALIAS_PECUNIARIOS = {
  'especializacion en contabilidad y auditoria internacional': 'especializacion en estandares internacionales de contabilidad y auditoria',
  'estandares internacionales de contabilidad y auditoria': 'especializacion en estandares internacionales de contabilidad y auditoria',
  'maestria en administracion mba': 'maestria en administracion de empresas mba',
  'contaduria publica': 'contaduria publica virtual',
};
const tablaPecuniarios = filas => {
  const m = new Map();
  for (const [programa, valor, duracion] of filas || []) {
    const k = nombreClave(programa);
    m.set(ALIAS_PECUNIARIOS[k] || k, {programa, ...inversion(valor), duracion: duracion || null});
  }
  return m;
};
const pecPresencial = tablaPecuniarios([...(pecuniarios?.especializaciones || []), ...(pecuniarios?.maestrias || []), ...(pecuniarios?.doctorados || [])]);
const pecVirtual = tablaPecuniarios(pecuniarios?.virtuales);
const pecUsados = new Set();

for (const p of finales) {
  const tabla = p.sitio === 'virtual.utb.edu.co' ? pecVirtual : pecPresencial;
  const k = nombreClave(p.nombre);
  const dp = tabla.get(k);
  if (dp) {
    pecUsados.add(dp);
    p.inversion_derechos_pecuniarios = {texto: dp.inversion_texto, cop: dp.inversion_cop, ...(dp.duracion ? {duracion: dp.duracion} : {})};
    if (p.inversion_cop == null && dp.inversion_cop != null) {
      p.inversion_cop = dp.inversion_cop;
      p.inversion_texto = dp.inversion_texto.replace(/,00$/, '') + ' por semestre';
      p.inversion_fuente = 'derechos pecuniarios ' + pecuniarios.vigencia;
    } else if (p.inversion_cop != null && dp.inversion_cop != null && p.inversion_cop !== dp.inversion_cop) {
      (p.notas ||= []).push(`La ficha publica ${p.inversion_texto} y derechos pecuniarios ${pecuniarios.vigencia} publica ${dp.inversion_texto}.`);
    }
    if (dp.duracion && p.duracion_semestres && semestres(dp.duracion) !== p.duracion_semestres)
      (p.notas ||= []).push(`La ficha dice ${p.duracion} y derechos pecuniarios ${pecuniarios.vigencia} dice ${dp.duracion}.`);
  }
  if (p.inversion_cop != null && !p.inversion_fuente) p.inversion_fuente = 'ficha del programa';
  p.en_listado_oficial = p.fuentes.some(f => /listado|sitemap/.test(f));
  // vigente = lo publica el listado oficial o tiene matrícula fijada para la vigencia
  p.oferta_vigente = p.en_listado_oficial || !!dp;
  if (!p.en_listado_oficial)
    (p.notas ||= []).push('No aparece en el listado oficial de /posgrado/ o /pregrado/ (sí en el menú de inicio)' +
      (dp ? `; figura en derechos pecuniarios ${pecuniarios.vigencia}.` : '.'));
}
const pecuniariosSinFicha = [...pecPresencial.values(), ...pecVirtual.values()].filter(dp => !pecUsados.has(dp)).map(dp => ({programa: dp.programa, valor: dp.inversion_texto}));
// SNIES repetido entre programas distintos: es un error del sitio, se deja anotado.
const porSnies = {};
for (const p of finales) if (p.snies) (porSnies[p.snies] ||= []).push(p);
for (const grupo of Object.values(porSnies).filter(g => g.length > 1))
  for (const p of grupo) (p.notas ||= []).push(`El sitio publica el mismo SNIES (${p.snies}) para: ${grupo.map(g => g.nombre).join(', ')}.`);

const ORDEN = {pregrado: 0, especializacion: 1, maestria: 2, doctorado: 3};
finales.sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel] || a.nombre.localeCompare(b.nombre, 'es'));

const totales = {};
for (const p of finales) totales[p.nivel] = (totales[p.nivel] || 0) + 1;

const catalogo = {
  fuente: ['https://www.utb.edu.co/pregrado/', 'https://www.utb.edu.co/posgrado/', 'https://www.utb.edu.co/ (menú)', 'https://virtual.utb.edu.co/sitemap.xml',
    ...(pecuniarios ? [pecuniarios.fuente] : [])],
  // fecha local (Colombia), no UTC: de noche toISOString ya da el día siguiente
  extraido_en: crudo.extraido_en || new Date().toLocaleDateString('sv-SE'),
  vigencia_valores: pecuniarios?.vigencia || null,
  totales: {...totales, total: finales.length},
  programas: finales,
  urls_no_disponibles: fallidas.filter(f => !f.redirige_a),
  derechos_pecuniarios_sin_ficha: pecuniariosSinFicha,
};

const rutaJson = path.join(RAIZ, 'src', 'data', 'programas-utb.json');
fs.mkdirSync(path.dirname(rutaJson), {recursive: true});
fs.writeFileSync(rutaJson, JSON.stringify(catalogo, null, 2) + '\n');

const COLS = ['nivel', 'nombre', 'modalidad', 'duracion', 'duracion_semestres', 'inversion_cop', 'inversion_texto', 'inversion_fuente', 'titulo_otorgado', 'snies', 'acreditacion_alta_calidad', 'registro_calificado', 'escuela', 'sitio', 'en_listado_oficial', 'oferta_vigente', 'url', 'plan_estudios_pdf', 'brochure_pdf'];
const csv = v => v == null ? '' : /[",\n;]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const filas = [COLS.join(',')].concat(finales.map(p => COLS.map(c => csv(p[c])).join(',')));
const rutaCsv = path.join(RAIZ, 'data', 'utb-programas', 'programas-utb.csv');
fs.mkdirSync(path.dirname(rutaCsv), {recursive: true});
// BOM para que Excel abra bien las tildes
fs.writeFileSync(rutaCsv, '﻿' + filas.join('\n') + '\n');

console.log('totales', catalogo.totales);
console.log('descartados por duplicado', descartados.map(d => d.url));
console.log('urls no disponibles', catalogo.urls_no_disponibles);
console.log('derechos pecuniarios sin ficha', pecuniariosSinFicha);
console.log('fuera de la oferta vigente', finales.filter(p => !p.oferta_vigente).map(p => p.nombre));
