/**
 * Extractor de fichas de posgrado de virtual.utb.edu.co (UTB Virtual).
 *
 * Se pega en la consola (DevTools) de una pestaña abierta en
 * https://virtual.utb.edu.co/. Toma las fichas del sitemap (especializaciones y
 * maestrías; los diplomados quedan fuera) y va de a una cada 3 s.
 *
 * Al terminar:  copy(JSON.stringify(__utbvRes))  y pegar en virtual.json.
 */
window.__utbv = (() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'FORM', 'IFRAME', 'SELECT', 'OPTION', 'BUTTON', 'TEMPLATE', 'IMG', 'NAV', 'HEADER', 'FOOTER']);
  const BLOCK = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'UL', 'OL']);
  const NOISE = /^(Solicitar informaci[oó]n|Descargar plan de estudios|Ver programa|Home|INICIO DE CLASES|100% VIRTUAL|Reg[ií]strate y solicita informaci[oó]n sobre costos y planes de pago|Autorizo el tratamiento.*|Necesitas un t[ií]tulo.*)$/i;
  const END = /^(Te recomendamos estos programas|Descubre la educaci[oó]n de calidad)/i;
  const clean = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function lines(doc) {
    const h1 = doc.querySelector('h1');
    if (!h1) return [];
    const out = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let started = false, cur = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!started) { if (h1.contains(n)) started = true; else continue; }
      let skip = false, block = null;
      for (let e = n.parentElement; e && e !== doc.body; e = e.parentElement) {
        if (SKIP.has(e.tagName) || e.matches('.uk-breadcrumb, [hidden]')) { skip = true; break; }
        if (!block && BLOCK.has(e.tagName)) block = e;
      }
      if (skip || !n.textContent.trim()) continue;
      if (cur && cur.block === block) cur.text += ' ' + n.textContent;
      else { cur = {block, text: n.textContent}; out.push(cur); }
    }
    const res = [];
    for (const l of out) {
      const text = clean(l.text);
      if (!text) continue;
      if (END.test(text)) break;
      const head = !!(l.block && (/^H[1-3]$/.test(l.block.tagName) || l.block.matches('.uk-accordion-title, .uk-accordion-title *')));
      res.push({text, head, h1: !!(l.block && h1.contains(l.block))});
    }
    return res;
  }

  function parse(doc, url) {
    const h1 = doc.querySelector('h1');
    // el h1 trae una marca "100% VIRTUAL" que no es parte del nombre
    const nombre = clean([...h1.childNodes].filter(n => !(n.nodeType === 1 && n.tagName === 'MARK')).map(n => n.textContent).join(' '));
    const ls = lines(doc).filter(l => !l.h1);
    const encabezado = [], secciones = [];
    let sec = null, i = 0;
    for (; i < ls.length && !ls[i].head; i++) if (!NOISE.test(ls[i].text)) encabezado.push(ls[i].text);
    for (; i < ls.length; i++) {
      const {text, head} = ls[i];
      if (head) { sec = {titulo: text, contenido: []}; secciones.push(sec); continue; }
      if (!sec || NOISE.test(text)) continue;
      if (!sec.contenido.includes(text)) sec.contenido.push(text);
    }
    const pdfs = [...new Map([...doc.querySelectorAll('a[href]')].filter(a => /\.pdf(\?|#|$)/i.test(a.href) || /plan de estudios/i.test(a.textContent)).map(a => [a.href, {texto: clean(a.textContent), url: a.href}])).values()];
    return {nombre, url, titulo_pagina: clean(doc.title), encabezado, secciones: secciones.filter(s => s.contenido.length), pdfs};
  }

  async function urlsDelSitemap() {
    const xml = new DOMParser().parseFromString(await (await fetch('/sitemap.xml')).text(), 'text/xml');
    return [...xml.querySelectorAll('loc')].map(l => new URL(l.textContent.trim()).pathname)
      .filter(p => /^\/(especializaciones|maestrias)\/[^/]+\/$/.test(p));
  }

  async function run(delay = 3000) {
    window.__utbvRes = [];
    for (const u of await urlsDelSitemap()) {
      try {
        const r = await fetch(u);
        const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
        const base = doc.createElement('base'); base.href = r.url; doc.head.prepend(base);
        window.__utbvRes.push(r.status === 200 ? parse(doc, r.url) : {url: u, error: 'HTTP ' + r.status});
      } catch (e) { window.__utbvRes.push({url: u, error: String(e)}); }
      console.log(window.__utbvRes.length, u);
      await sleep(delay);
    }
    console.log('Listo. Ejecuta: copy(JSON.stringify(__utbvRes))');
  }
  return {parse, run};
})();
__utbv.run();
