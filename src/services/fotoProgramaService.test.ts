import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPrograma } from './catalogoUtb';
import { claveFlyer, generarFlyer, tipoImagen, urlFotoPermitida } from './fotoProgramaService';

describe('flyer de un posgrado para WhatsApp', () => {
  it('solo baja fotos de los sitios de la UTB por https', () => {
    assert.equal(urlFotoPermitida('https://www.utb.edu.co/wp-content/uploads/2026/02/hero-8.jpg'), true);
    assert.equal(urlFotoPermitida('https://virtual.utb.edu.co/images/hero_1200w.jpg'), true);
    assert.equal(urlFotoPermitida('http://www.utb.edu.co/x.jpg'), false);
    assert.equal(urlFotoPermitida('https://utb.edu.co.malo.com/x.jpg'), false);
    assert.equal(urlFotoPermitida(null), false);
  });

  it('reconoce JPG, PNG y WebP por sus primeros bytes', () => {
    assert.equal(tipoImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(tipoImagen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
    assert.equal(tipoImagen(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'image/webp');
    assert.equal(tipoImagen(Buffer.from('<html>')), null);
  });

  it('la clave del flyer cambia si cambian los datos del programa', () => {
    const p = getPrograma('maestria-en-administracion')!;
    assert.match(claveFlyer(p), /^flyer:meta:v\d+:maestria-en-administracion:[0-9a-f]{12}$/);
    assert.equal(claveFlyer(p), claveFlyer({ ...p }));
    assert.notEqual(claveFlyer(p), claveFlyer({ ...p, inversion_cop: (p.inversion_cop ?? 0) + 1 }));
  });

  // Genera el JPG de verdad solo donde hay un Chromium a mano (TOOLI_CHROMIUM_PATH).
  it('genera un JPG de 1080 × 1350', { skip: !process.env.TOOLI_CHROMIUM_PATH }, async () => {
    const jpg = await generarFlyer({ ...getPrograma('doctorado-en-ingenieria')!, imagen: null });
    assert.equal(tipoImagen(jpg), 'image/jpeg');
    // Alto y ancho del marcador SOF0/SOF2 del JPG.
    const i = jpg.findIndex((b, k) => b === 0xff && (jpg[k + 1] === 0xc0 || jpg[k + 1] === 0xc2));
    assert.equal(jpg.readUInt16BE(i + 5), 1350);
    assert.equal(jpg.readUInt16BE(i + 7), 1080);
  });
});
