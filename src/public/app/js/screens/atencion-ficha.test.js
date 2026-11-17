import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { avisoVentanaHtml, haceCuanto, htmlFicha, resumenTextoHtml, textoVentana, ultimoEntrante } from './atencion-ficha.js';

const AHORA = Date.UTC(2026, 10, 17, 15, 0, 0);
const HORA = 60 * 60 * 1000;

const FICHA = {
  telefono: '573001234567', puedeRecibirPlantilla: true,
  ventana: { abierta: false, ultimoEntranteTs: AHORA - 30 * HORA, cierraTs: AHORA - 6 * HORA },
  interes: { nombre: 'ANA MARÍA PÉREZ', correo: 'ana@gmail.com', programa: 'Especialización en Finanzas', area: '', relacion: 'Egresado UTB', registradoEl: '' },
  crm: { estado: 'interesado', asignadoA: 'luis', etiquetas: ['beca'], notas: [{ texto: 'Pidió <b>info</b> de becas', autor: 'luis', ts: AHORA - HORA }] },
  asistencias: [{ evento: 'Feria de posgrados', sector: 'posgrado', fecha: '2026-11-20', origen: 'qr', registradoEn: 1 }],
  plantillas: [{ templateName: 'gracias', createdAt: AHORA - 2 * HORA, createdBy: 'luis', resultado: 'fallido', error: 'Meta rechazó el envío' }],
  bajaCampanas: true, sinDatos: ['CRM'],
};

describe('ventana de 24 horas en palabras', () => {
  it('abierta: hasta cuándo se le puede escribir', () => {
    assert.match(textoVentana({ abierta: true, ultimoEntranteTs: AHORA - 2 * HORA, cierraTs: AHORA + 22 * HORA }, AHORA).texto, /^Puedes escribirle hasta (hoy|mañana) a las /);
  });
  it('a punto de cerrarse lo avisa en minutos', () => {
    const v = textoVentana({ abierta: true, ultimoEntranteTs: AHORA - 23.5 * HORA, cierraTs: AHORA + 30 * 60 * 1000 }, AHORA);
    assert.equal(v.pronto, true);
    assert.match(v.texto, /30 min más/);
  });
  it('cerrada: cuándo escribió por última vez', () => {
    assert.equal(textoVentana(FICHA.ventana, AHORA).abierta, false);
    assert.match(textoVentana({ abierta: false, ultimoEntranteTs: null, cierraTs: null }, AHORA).texto, /solo se le puede enviar una plantilla/);
    assert.equal(textoVentana(null, AHORA), null, 'fuera de Meta no hay ventana');
  });
  it('dice hace cuánto con palabras completas', () => {
    assert.equal(haceCuanto(Date.now() - 5 * 60 * 1000), 'hace 5 min');
    assert.equal(haceCuanto(Date.now()), 'hace un momento');
  });
});

describe('ficha de la persona', () => {
  it('muestra cada fuente y escapa lo que escribieron', () => {
    const html = htmlFicha({ datos: FICHA, resumen: { estado: 'listo', datos: { texto: '• Busca becas\n• Egresada', hastaTs: AHORA - 40 * HORA, generadoEn: AHORA } } }, AHORA);
    for (const texto of ['Especialización en Finanzas', 'Interesado', 'Lo lleva luis', 'Feria de posgrados', 'gracias', 'No se envió', 'Pidió no recibir campañas', 'No se pudo consultar: CRM', 'Enviar plantilla', 'Escribió algo después de este resumen']) {
      assert.ok(html.includes(texto), `falta «${texto}»`);
    }
    assert.ok(!html.includes('<b>info</b>'), 'las notas se escapan');
    assert.match(html, /<li>Busca becas<\/li><li>Egresada<\/li>/);
    assert.ok(!html.includes('>Área<'), 'un dato vacío no se muestra');
  });
  it('mientras carga muestra el esqueleto y, si falla, el error con reintento', () => {
    assert.match(htmlFicha({ datos: null, resumen: { estado: 'nada' } }), /aria-busy="true"/);
    assert.match(htmlFicha({ datos: null, error: 'Chatwoot no responde', resumen: { estado: 'nada' } }), /Chatwoot no responde[\s\S]*data-ficha="reintentar"/);
  });
  it('el resumen explica cuando no hay nada que resumir o cuando falló', () => {
    assert.match(htmlFicha({ datos: FICHA, resumen: { estado: 'listo', datos: null } }), /No le escribió al bot/);
    assert.match(htmlFicha({ datos: FICHA, resumen: { estado: 'error', mensaje: 'El resumen con IA no está configurado.' } }), /no está configurado[\s\S]*data-resumen="reintentar"/);
  });
  it('a quien escribe sin número no se le ofrece plantilla', () => {
    const html = htmlFicha({ datos: { ...FICHA, puedeRecibirPlantilla: false }, resumen: { estado: 'nada' } }, AHORA);
    assert.ok(!html.includes('atn-enviar-plantilla'));
    assert.ok(!avisoVentanaHtml({ nombre: 'Ana', puedeRecibirPlantilla: false }).includes('atn-enviar-plantilla'));
    assert.ok(avisoVentanaHtml({ nombre: 'Ana <x>', puedeRecibirPlantilla: true }).includes('de Ana &lt;x&gt;'));
  });
  it('el resumen separa viñetas de párrafos', () => {
    assert.equal(resumenTextoHtml('Resumen:\n- uno\n• dos'), '<p>Resumen:</p><ul><li>uno</li><li>dos</li></ul>');
  });
  it('encuentra el último mensaje de la persona en el hilo', () => {
    assert.equal(ultimoEntrante([{ tipo: 'in', ts: 5 }, { tipo: 'out', ts: 9 }, { tipo: 'in', ts: 7 }, { tipo: 'nota', ts: 10 }]), 7);
    assert.equal(ultimoEntrante(null), 0);
  });
});
