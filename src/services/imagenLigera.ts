/**
 * Reduce una imagen que pasa el límite de WhatsApp (5 MB) a un JPEG más
 * liviano, sin agregar dependencias: usa el Chromium sin interfaz que la
 * imagen de producción ya trae para Playwright.
 *
 * Meta aprueba plantillas con imágenes más pesadas de lo que después deja
 * enviar; sin esto, una plantilla aprobada fallaría con "archivo demasiado
 * grande" en cada destinatario.
 */
import { chromium } from 'playwright';

/** Tope de WhatsApp para imágenes, con margen para que Meta no la rechace por poco. */
export const MAX_BYTES_IMAGEN_WHATSAPP = 5 * 1024 * 1024;
const OBJETIVO_BYTES = Math.floor(4.5 * 1024 * 1024);
/** Más grande no se nota en un celular y solo hace más pesado el archivo. */
const MAX_LADO_PX = 2048;

export interface ImagenReducida {
  buffer: Buffer;
  mime: 'image/jpeg';
}

export type ReducirImagen = (buffer: Buffer, mime: string) => Promise<ImagenReducida>;

export class ImagenNoReducibleError extends Error {}

export const reducirImagen: ReducirImagen = async (buffer, mime) => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    // Solo para probarlo fuera del contenedor, con un Chromium de otra versión.
    ...(process.env.TOOLI_CHROMIUM_PATH ? { executablePath: process.env.TOOLI_CHROMIUM_PATH } : {}),
  });
  try {
    const page = await browser.newPage();
    const resultado = await page.evaluate(async ({ src, maxLado, objetivo }) => {
      // Corre dentro de Chromium; el proyecto compila sin los tipos del DOM.
      const navegador = globalThis as any;
      const img = new navegador.Image();
      img.src = src;
      await img.decode();
      let escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
      for (let intento = 0; intento < 6; intento++) {
        const ancho = Math.max(1, Math.round(img.naturalWidth * escala));
        const alto = Math.max(1, Math.round(img.naturalHeight * escala));
        const canvas = navegador.document.createElement('canvas');
        canvas.width = ancho;
        canvas.height = alto;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        // JPEG no tiene transparencia: el fondo blanco evita que se vuelva negro.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, ancho, alto);
        ctx.drawImage(img, 0, 0, ancho, alto);
        for (const calidad of [0.9, 0.82, 0.72]) {
          const url = canvas.toDataURL('image/jpeg', calidad);
          const base64 = url.slice(url.indexOf(',') + 1);
          if (Math.ceil(base64.length * 3 / 4) <= objetivo) return base64;
        }
        escala *= 0.75;
      }
      return null;
    }, { src: `data:${mime};base64,${buffer.toString('base64')}`, maxLado: MAX_LADO_PX, objetivo: OBJETIVO_BYTES });
    if (!resultado) throw new ImagenNoReducibleError('No se pudo reducir la imagen por debajo del límite de WhatsApp');
    return { buffer: Buffer.from(resultado, 'base64'), mime: 'image/jpeg' };
  } finally {
    await browser.close().catch(() => {});
  }
};
