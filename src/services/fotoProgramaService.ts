/**
 * Flyer de cada posgrado listo para WhatsApp: se descarga la foto oficial (la
 * principal de su página en utb.edu.co o virtual.utb.edu.co, guardada en el
 * catálogo como `imagen`), se arma el flyer con la línea gráfica de la UTB
 * (`flyerPosgrado.ts`) y el Chromium sin interfaz que la imagen de producción ya
 * trae para Playwright lo convierte en JPG. Se sube una vez a Meta y el id se
 * guarda 25 días en Redis (Meta lo conserva 30). Si el catálogo cambia, cambia
 * la clave y se genera de nuevo.
 */
import axios from 'axios';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Redis from 'ioredis';
import type { Browser } from 'playwright';
import { config } from '../config';
import { ProgramaUtb, VIGENCIA_VALORES } from './catalogoUtb';
import { ALTO_FLYER, ANCHO_FLYER, RecursosFlyer, datosFlyer, htmlFlyer } from './flyerPosgrado';

const redis = new Redis(config.redis.url, { lazyConnect: true });

/** Sube con cada cambio de diseño, para no reutilizar flyers viejos. */
export const VERSION_FLYER = 'v2';
const TTL_ID_SEG = 25 * 24 * 60 * 60;
export const MAX_BYTES_FOTO = 8 * 1024 * 1024;
const DOMINIOS = new Set(['www.utb.edu.co', 'utb.edu.co', 'virtual.utb.edu.co']);

/** Solo fotos de los sitios de la UTB, por https. */
export function urlFotoPermitida(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && DOMINIOS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Tipo real de la imagen por sus primeros bytes (el sitio sirve JPG, PNG y WebP). */
export function tipoImagen(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export async function descargarFoto(url: string): Promise<Buffer> {
  if (!urlFotoPermitida(url)) throw new Error('foto fuera de los sitios de la UTB');
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 15_000,
    maxContentLength: MAX_BYTES_FOTO,
    headers: { 'User-Agent': 'Mozilla/5.0 TooliBot/1.0' },
  });
  return Buffer.from(res.data);
}

const dataUri = (buf: Buffer, tipo: string) => `data:${tipo};base64,${buf.toString('base64')}`;

let recursos: Omit<RecursosFlyer, 'foto'> | null = null;

/** Logo y Montserrat incrustados (se leen una vez del disco). */
function recursosFijos(): Omit<RecursosFlyer, 'foto'> {
  if (recursos) return recursos;
  const publico = path.join(__dirname, '..', 'public', 'posgrados');
  const fuentesDir = path.join(path.dirname(require.resolve('@fontsource/montserrat/package.json')), 'files');
  const fuente = (w: number) => dataUri(readFileSync(path.join(fuentesDir, `montserrat-latin-${w}-normal.woff2`)), 'font/woff2');
  recursos = {
    logo: dataUri(readFileSync(path.join(publico, 'logo-utb.svg')), 'image/svg+xml'),
    logoColor: dataUri(readFileSync(path.join(publico, 'logo-utb-azul.svg')), 'image/svg+xml'),
    fuentes: { 400: fuente(400), 600: fuente(600), 800: fuente(800), 900: fuente(900) },
  };
  return recursos;
}

// ── Chromium: uno compartido, que se cierra solo tras un minuto sin uso ─────

let navegador: Promise<Browser> | null = null;
let cierre: NodeJS.Timeout | null = null;

async function obtenerNavegador(): Promise<Browser> {
  if (cierre) clearTimeout(cierre);
  cierre = setTimeout(() => {
    const abierto = navegador;
    navegador = null;
    void abierto?.then((b) => b.close()).catch(() => undefined);
  }, 60_000);
  cierre.unref();
  if (navegador) {
    const b = await navegador.catch(() => null);
    if (b?.isConnected()) return b;
  }
  const { chromium } = await import('playwright');
  navegador = chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    // Solo para probarlo fuera del contenedor, con un Chromium de otra versión.
    ...(process.env.TOOLI_CHROMIUM_PATH ? { executablePath: process.env.TOOLI_CHROMIUM_PATH } : {}),
  });
  return navegador;
}

/** Convierte el HTML del flyer en JPG. Sin red: todo va incrustado. */
export async function renderizarFlyer(html: string): Promise<Buffer> {
  const browser = await obtenerNavegador();
  const page = await browser.newPage({ viewport: { width: ANCHO_FLYER, height: ALTO_FLYER }, deviceScaleFactor: 1 });
  try {
    await page.route('**/*', (ruta) => ruta.abort());
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    // Corre dentro de Chromium; el proyecto compila sin los tipos del DOM.
    await page.evaluate(() => (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document?.fonts?.ready);
    return await page.screenshot({ type: 'jpeg', quality: 88 });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** El flyer del programa en JPG, con su foto oficial (o solo el fondo azul si no se pudo bajar). */
export async function generarFlyer(p: ProgramaUtb): Promise<Buffer> {
  let foto: string | null = null;
  if (urlFotoPermitida(p.imagen)) {
    try {
      const buf = await descargarFoto(p.imagen);
      const tipo = tipoImagen(buf);
      if (tipo) foto = dataUri(buf, tipo);
    } catch {
      foto = null;
    }
  }
  return renderizarFlyer(htmlFlyer(datosFlyer(p, VIGENCIA_VALORES), { foto, ...recursosFijos() }));
}

/** La clave cambia si cambia el diseño, los datos del catálogo o la foto. */
export function claveFlyer(p: ProgramaUtb): string {
  const huella = createHash('sha1')
    .update(JSON.stringify([datosFlyer(p, VIGENCIA_VALORES), p.imagen ?? '']))
    .digest('hex')
    .slice(0, 12);
  return `flyer:meta:${VERSION_FLYER}:${p.id}:${huella}`;
}

export type SubirImagen = (jpg: Buffer) => Promise<string>;

/** El id en Meta del flyer: el guardado, o lo genera, lo sube y lo guarda. */
export async function idDeFlyer(p: ProgramaUtb, subir: SubirImagen, renovar = false): Promise<string> {
  const clave = claveFlyer(p);
  if (!renovar) {
    const guardado = await redis.get(clave);
    if (guardado) return guardado;
  }
  const id = await subir(await generarFlyer(p));
  await redis.set(clave, id, 'EX', TTL_ID_SEG);
  return id;
}

/**
 * Genera y sube de antemano los flyers que falten, uno por uno y sin apuro,
 * para que la primera recomendación no espere. Devuelve cuántos subió.
 */
export async function precalentarFlyers(programas: readonly ProgramaUtb[], subir: SubirImagen, pausaMs = 1_500): Promise<number> {
  let subidos = 0;
  for (const p of programas) {
    try {
      if (await redis.exists(claveFlyer(p))) continue;
      await idDeFlyer(p, subir);
      subidos++;
      await new Promise((r) => setTimeout(r, pausaMs));
    } catch {
      // Un flyer que falla se intentará de nuevo cuando alguien lo necesite.
    }
  }
  return subidos;
}
