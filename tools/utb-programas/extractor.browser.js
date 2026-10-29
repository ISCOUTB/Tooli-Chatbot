/**
 * Extractor de fichas de programas de www.utb.edu.co.
 *
 * El sitio está detrás de Cloudflare, así que no se descarga con curl: se pega
 * este script en la consola (DevTools) de una pestaña abierta en
 * https://www.utb.edu.co/ y se deja correr. Va despacio a propósito (3 s entre
 * fichas) y guarda el avance en sessionStorage, así que si se interrumpe basta
 * con volver a ejecutar `__utb.run()` en la misma pestaña.
 *
 * Al terminar:  copy(sessionStorage.getItem('utbRes'))  y pegar en crudo.json.
 *
 * Valores de matrícula: en https://www.utb.edu.co/la-utb/derechos-pecuniarios/
 * ejecutar  copy(JSON.stringify(__utb.derechosPecuniarios()))  y pegar en
 * derechos-pecuniarios.json.
 */
window.__utb = (() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'FORM', 'IFRAME', 'SELECT', 'OPTION', 'BUTTON', 'TEMPLATE', 'IMG']);
  const BLOCK = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'UL', 'OL']);
  const NOISE = /^(›|\d{1,2}|Recibe asesor[ií]a personalizada|Descargar brochure|Conoce m[aá]s|Quiero inscribirme|Realiza tu inscripci[oó]n\s+al programa|Conoce el plan de estudios|Inscr[ií]bete( aqu[ií])?|Ver m[aá]s|Descarga(r)? (el )?plan de estudios|No data was found|Conoce aqu[ií] los valores de nuestras matr[ií]culas)$/i;
  const END = /^(¿Te podemos ayudar|Nuestra ubicaci[oó]n|Conoce m[aá]s de lo que tenemos)/i;
  const clean = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  // los h3 de carruseles (cargos, campos) son contenido; solo h1/h2 y los títulos de Elementor abren sección
  const isHeading = el => /^H[12]$/.test(el.tagName) || el.classList.contains('elementor-heading-title');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function profCards(doc) {
    const cards = new Map();
    for (const a of doc.querySelectorAll('a[href*="/profesores/"]')) {
      if (cards.has(a.href)) continue;
      let card = a;
      // la tarjeta es el contenedor más grande que solo tiene a este profesor y poco texto
      while (card.parentElement && card.parentElement !== doc.body) {
        const p = card.parentElement;
        const hrefs = new Set([...p.querySelectorAll('a[href*="/profesores/"]')].map(x => x.href));
        if (hrefs.size > 1 || p.querySelector('h1') || clean(p.textContent).length > 400) break;
        card = p;
      }
      cards.set(a.href, card);
    }
    return cards;
  }

  // Texto del documento agrupado por bloque, desde el h1 hasta el formulario de contacto (o hasta stopAt).
  function lines(doc, excluded, stopAt) {
    const h1 = doc.querySelector('h1');
    if (!h1) return [];
    const out = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let started = false, cur = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!started) { if (h1.contains(n)) started = true; else continue; }
      if (stopAt && (stopAt.contains(n) || stopAt.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      let skip = false, block = null;
      for (let e = n.parentElement; e && e !== doc.body; e = e.parentElement) {
        if (SKIP.has(e.tagName) || excluded.has(e) || e.classList.contains('jet-tabs__control') || e.classList.contains('jet-tabs__content') || e.classList.contains('screen-reader-text')) { skip = true; break; }
        if (!block && BLOCK.has(e.tagName)) block = e;
      }
      if (skip || !n.textContent.trim()) continue;
      if (cur && cur.block === block) cur.text += n.textContent;
      else { cur = {block, text: n.textContent}; out.push(cur); }
    }
    const res = [];
    for (const l of out) {
      const text = clean(l.text);
      if (!text) continue;
      const head = !!(l.block && isHeading(l.block)) || /^¿Por qué estudiar/i.test(text);
      if (head && END.test(text)) break;
      res.push({text, head});
    }
    return res;
  }

  function enlaces(doc) {
    const links = [...doc.querySelectorAll('a[href]')];
    const pdfs = [...new Map(links.filter(a => /\.pdf(\?|#|$)/i.test(a.href) && !/Politica|Res-N|Plan-de-Desarrollo/i.test(a.href)).map(a => [a.href, {texto: clean(a.textContent), url: a.href}])).values()];
    const inscripcion_url = links.map(a => a.href).find(h => /inscribete\.utb\.edu\.co/.test(h)) || null;
    return {pdfs, inscripcion_url};
  }

  // Plantilla actual: encabezado "Campo: valor", secciones por título y plan en pestañas.
  function parse(doc, url) {
    const cards = profCards(doc);
    const ls = lines(doc, new Set(cards.values()));
    const campos = {}, extra = [], secciones = [];
    let sec = null, i = 1;
    for (; i < ls.length && !ls[i].head; i++) {
      const m = ls[i].text.match(/^([^:]{2,45}):\s*(.+)$/);
      if (m) campos[clean(m[1])] = clean(m[2]);
      else if (!NOISE.test(ls[i].text)) extra.push(ls[i].text);
    }
    for (; i < ls.length; i++) {
      const {text, head} = ls[i];
      if (head) { sec = {titulo: text, contenido: []}; secciones.push(sec); continue; }
      const t = text.replace(/^›\s*/, '');
      if (!sec || !t || NOISE.test(t)) continue;
      if (!sec.contenido.includes(t)) sec.contenido.push(t);
    }
    const plan = [...doc.querySelectorAll('.jet-tabs__content')].map(c => ({
      periodo: clean(c.querySelector('h1,h2,h3,h4')?.textContent),
      asignaturas: [...c.querySelectorAll('li')].map(li => clean(li.textContent)).filter(Boolean),
    })).filter(p => p.asignaturas.length);
    const profesores = [...cards.entries()].map(([href, card]) => ({nombre: clean(card.querySelector('h1,h2,h3,h4,h5,.elementor-heading-title')?.textContent) || null, url: href}));
    return {
      nombre: clean(doc.querySelector('h1')?.textContent), url, titulo_pagina: clean(doc.title), campos,
      ...(extra.length ? {encabezado_extra: extra} : {}),
      secciones: secciones.filter(s => !/^¡/.test(s.titulo) && s.contenido.length),
      plan_estudios: plan, profesores, ...enlaces(doc),
    };
  }

  // Plantilla antigua: todo el contenido va en acordeones (.jet-toggle).
  function parseLegacy(doc, url) {
    const blockLines = root => {
      const out = []; let cur = null;
      const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        let skip = false, block = null;
        for (let e = n.parentElement; e && e !== root.parentElement; e = e.parentElement) {
          if (SKIP.has(e.tagName)) { skip = true; break; }
          if (!block && BLOCK.has(e.tagName)) block = e;
        }
        if (skip || !n.textContent.trim()) continue;
        if (cur && cur.block === block) cur.text += n.textContent; else { cur = {block, text: n.textContent}; out.push(cur); }
      }
      return [...new Set(out.map(l => clean(l.text)).filter(t => t && !NOISE.test(t)))];
    };
    const toggles = [...doc.querySelectorAll('.jet-toggle')];
    const campos = {}, extra = [];
    const head = lines(doc, new Set(), toggles[0]).map(l => l.text);
    for (const t of head.slice(1)) {
      if (NOISE.test(t)) continue;
      for (const part of t.split(/\s*\|\s*(?=[A-ZÁÉÍÓÚ][^:|]{2,40}:)/)) {
        const m = part.match(/^([^:]{2,45}):\s*(.+)$/);
        if (m) campos[clean(m[1])] = clean(m[2]); else extra.push(part);
      }
    }
    const secciones = toggles.map(tg => ({
      titulo: clean(tg.querySelector('.jet-toggle__control')?.textContent),
      contenido: blockLines(tg.querySelector('.jet-toggle__content') || tg),
    })).filter(s => s.contenido.length);
    return {
      nombre: clean(doc.querySelector('h1')?.textContent), url, titulo_pagina: clean(doc.title), plantilla: 'legacy-acordeon', campos,
      ...(extra.length ? {encabezado_extra: extra} : {}),
      secciones, plan_estudios: [], profesores: [], ...enlaces(doc),
    };
  }

  async function get(url) {
    const r = await fetch(url, {credentials: 'include'});
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    const base = doc.createElement('base'); base.href = r.url; doc.head.prepend(base);
    return {status: r.status, finalUrl: r.url, doc, challenge: /Just a moment|Un momento/i.test(doc.title)};
  }

  // URLs de fichas que aparecen en el menú de inicio y en los listados oficiales.
  async function descubrir() {
    const fuentes = {};
    for (const p of ['/', '/pregrado/', '/posgrado/']) {
      const g = await get(p);
      for (const a of g.doc.querySelectorAll('a[href]')) {
        if (!/^https:\/\/www\.utb\.edu\.co\/(pregrados|posgrados)\/[^/?#]+\/?$/.test(a.href)) continue;
        const u = a.href.endsWith('/') ? a.href : a.href + '/';
        (fuentes[u] ||= new Set()).add(p === '/' ? 'menu' : 'listado ' + p.replace(/\//g, ''));
      }
      await sleep(3000);
    }
    return Object.entries(fuentes).map(([url, s]) => ({url, fuentes: [...s]}));
  }

  async function run(delay = 3000) {
    const st = JSON.parse(sessionStorage.getItem('utbRes') || '{"cola":null,"res":{}}');
    st.extraido_en ||= new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
    if (!st.cola) { st.cola = await descubrir(); sessionStorage.setItem('utbRes', JSON.stringify(st)); }
    for (const item of st.cola) {
      if (st.res[item.url] && !st.res[item.url].error) continue;
      let r;
      try {
        const g = await get(item.url);
        if (g.challenge) r = {url: item.url, error: 'challenge'};
        else if (g.status !== 200) r = {url: item.url, error: 'HTTP ' + g.status, finalUrl: g.finalUrl};
        else r = g.doc.querySelector('.jet-toggle') && !g.doc.querySelector('.jet-tabs__content') ? parseLegacy(g.doc, g.finalUrl) : parse(g.doc, g.finalUrl);
      } catch (e) {
        // las fichas virtuales redirigen a virtual.utb.edu.co y el fetch cruzado falla: se extraen aparte
        r = {url: item.url, error: String(e)};
      }
      r.url_pedida = item.url; r.fuentes = item.fuentes;
      st.res[item.url] = r;
      sessionStorage.setItem('utbRes', JSON.stringify(st));
      if (r.error === 'challenge') { console.warn('Cloudflare pidió verificación; recarga la página y vuelve a ejecutar __utb.run()'); return st; }
      console.log(Object.keys(st.res).length + '/' + st.cola.length, r.nombre || r.error);
      await sleep(delay);
    }
    st.terminado = true;
    sessionStorage.setItem('utbRes', JSON.stringify(st));
    console.log('Listo. Ejecuta: copy(sessionStorage.getItem("utbRes"))');
    return st;
  }

  // Tablas de posgrado de la página de derechos pecuniarios (se corre en esa página).
  // Cada tabla vive en una pestaña; el nombre de la pestaña dice qué tabla es.
  function derechosPecuniarios(doc = document) {
    const out = {
      fuente: 'https://www.utb.edu.co/la-utb/derechos-pecuniarios/',
      vigencia: (clean(doc.body.textContent).match(/vigencia (\d{4})/i) || [])[1] || null,
      especializaciones: [], maestrias: [], doctorados: [], virtuales: [],
    };
    for (const tabla of doc.querySelectorAll('table')) {
      const panel = tabla.closest('.jet-tabs__content');
      const pestaña = clean(panel && doc.getElementById(panel.id.replace('content', 'control'))?.textContent);
      const [cabecera, ...filas] = [...tabla.querySelectorAll('tr')]
        .map(tr => [...tr.cells].map(c => clean(c.textContent)).filter(x => x && !/^Inscr[ií]bete/i.test(x)));
      const grupo =
        pestaña === 'Especializaciones' ? 'especializaciones' :
        pestaña === 'Programas virtuales' ? 'virtuales' :
        pestaña === 'Maestrías y Doctorados' ? (/^Doctorados/i.test(cabecera?.[0] || '') ? 'doctorados' : 'maestrias') : null;
      if (grupo) out[grupo].push(...filas.filter(f => f.length >= 2));
    }
    return out;
  }

  return {parse, parseLegacy, get, descubrir, run, derechosPecuniarios};
})();
if (location.pathname.startsWith('/la-utb/derechos-pecuniarios')) console.log('Ejecuta: copy(JSON.stringify(__utb.derechosPecuniarios()))');
else __utb.run();
