// Ejecuta `node tools/generar-favicon.cjs` cuando cambie src/public/app/favicon.svg.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const raiz = path.resolve(__dirname, '..');
const directorioApp = path.join(raiz, 'src', 'public', 'app');
const rutaSvg = path.join(directorioApp, 'favicon.svg');

async function rasterizar(page, svg, tamano, fondoTransparente = true) {
  await page.setViewportSize({ width: tamano, height: tamano });
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>${svg}`);
  return page.screenshot({
    type: 'png',
    omitBackground: fondoTransparente,
    clip: { x: 0, y: 0, width: tamano, height: tamano },
  });
}

function crearIco(imagenes) {
  const cabecera = Buffer.alloc(6 + imagenes.length * 16);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(imagenes.length, 4);

  let desplazamiento = cabecera.length;
  imagenes.forEach(({ tamano, png }, indice) => {
    const entrada = 6 + indice * 16;
    cabecera.writeUInt8(tamano, entrada);
    cabecera.writeUInt8(tamano, entrada + 1);
    cabecera.writeUInt8(0, entrada + 2);
    cabecera.writeUInt8(0, entrada + 3);
    cabecera.writeUInt16LE(1, entrada + 4);
    cabecera.writeUInt16LE(32, entrada + 6);
    cabecera.writeUInt32LE(png.length, entrada + 8);
    cabecera.writeUInt32LE(desplazamiento, entrada + 12);
    desplazamiento += png.length;
  });

  return Buffer.concat([cabecera, ...imagenes.map(({ png }) => png)]);
}

async function main() {
  const svg = fs.readFileSync(rutaSvg, 'utf8');
  const svgApple = svg
    .replace('rx="14"', 'rx="0"')
    .replace('<g id="tooli-figure">', '<g id="tooli-figure" transform="translate(4.16 4.16) scale(0.87)">');
  const navegador = await chromium.launch({ channel: process.env.FAVICON_CHANNEL || 'msedge' });

  try {
    const page = await navegador.newPage();
    const imagenesIco = [];
    for (const tamano of [16, 32, 48]) {
      imagenesIco.push({ tamano, png: await rasterizar(page, svg, tamano) });
    }

    fs.writeFileSync(path.join(directorioApp, 'favicon-32.png'), imagenesIco[1].png);
    fs.writeFileSync(path.join(directorioApp, 'icon-192.png'), await rasterizar(page, svg, 192));
    fs.writeFileSync(path.join(directorioApp, 'apple-touch-icon.png'), await rasterizar(page, svgApple, 180, false));
    fs.writeFileSync(path.join(directorioApp, 'favicon.ico'), crearIco(imagenesIco));
  } finally {
    await navegador.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
