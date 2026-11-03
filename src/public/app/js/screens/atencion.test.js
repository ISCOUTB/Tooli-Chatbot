import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* atencion.js arrastra screen.js y conversaciones.js, que tocan document al
   importarse. Igual que en conversaciones.test.js: stub mínimo, porque las
   funciones probadas no usan el DOM. */
globalThis.document ??= {
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {} },
    appendChild() {}, addEventListener() {}, setAttribute() {},
  }),
  body: { appendChild() {} },
  activeElement: null,
};

let A;
before(async () => { A = await import('./atencion.js'); });

describe('vistaPrevia', () => {
  it('dice quién habló último', () => {
    assert.equal(A.vistaPrevia({ tipo: 'in', texto: '¿Tienen becas?' }), '¿Tienen becas?');
    assert.equal(A.vistaPrevia({ tipo: 'out', texto: 'Sí, te cuento' }), 'Asesor: Sí, te cuento');
    assert.equal(A.vistaPrevia({ tipo: 'nota', texto: 'Llamar mañana' }), '📝 Nota: Llamar mañana');
  });

  it('junta los saltos de línea del contexto del bot en una sola línea', () => {
    assert.equal(A.vistaPrevia({ tipo: 'in', texto: '🎓 Posgrado · MBA\n\n👤 Nombre: Ana' }), '🎓 Posgrado · MBA 👤 Nombre: Ana');
  });

  it('quita las marcas de WhatsApp', () => {
    assert.equal(A.vistaPrevia({ tipo: 'out', texto: 'Tu turno es el *12 de octubre*.' }), 'Asesor: Tu turno es el 12 de octubre.');
  });

  it('sin texto ni mensajes no deja la fila en blanco', () => {
    assert.equal(A.vistaPrevia({ tipo: 'in', texto: '' }), '(archivo adjunto)');
    assert.equal(A.vistaPrevia(null), 'Sin mensajes');
  });
});

describe('textoAsignacion', () => {
  it('distingue sin asignar, asignada a mí y a otra persona', () => {
    assert.equal(A.textoAsignacion(null, 2), 'Sin asignar');
    assert.equal(A.textoAsignacion({ id: 2, nombre: 'Luis Pérez' }, 2), 'Asignada a ti');
    assert.equal(A.textoAsignacion({ id: 3, nombre: 'Ana Díaz' }, 2), 'Asignada a Ana Díaz');
  });
});

describe('subtítulo y detalles móviles', () => {
  it('prioriza un teléfono real y usa la asignación para Usuario de WhatsApp', () => {
    assert.equal(A.subtituloMovil({ contacto: { nombre: 'Ana', telefono: '573001112233' }, asignado: null }, 2), '+57 300 111 2233');
    assert.equal(A.subtituloMovil({ contacto: { nombre: 'Usuario de WhatsApp', telefono: 'CO.ENT.abc123' }, asignado: { id: 2, nombre: 'Luis' } }, 2), 'Asignada a ti');
    assert.equal(A.subtituloMovil({ contacto: { nombre: 'Usuario de WhatsApp', telefono: 'CO.ENT.abc123' }, asignado: null }, 2), 'Sin asignar');
  });

  it('arma las acciones según estado y disponibilidad del teléfono', () => {
    const conv = (estado, telefono = '573001112233') => ({ estado, contacto: { telefono } });
    assert.deepEqual(A.accionesDetalles(conv('open')).map(a => a.label), ['Historial', 'Macros', 'Pendiente']);
    assert.deepEqual(A.accionesDetalles(conv('pending')).map(a => a.label), ['Historial', 'Macros', 'Abrir']);
    assert.deepEqual(A.accionesDetalles(conv('resolved')).map(a => a.label), ['Historial', 'Macros']);
    assert.deepEqual(A.accionesDetalles(conv('open', null)).map(a => a.label), ['Macros', 'Pendiente']);
  });
});

describe('etiquetaEstado', () => {
  it('traduce los estados de Chatwoot y no rompe con uno nuevo', () => {
    assert.equal(A.etiquetaEstado('pending').label, 'Pendiente');
    assert.equal(A.etiquetaEstado('snoozed').label, 'snoozed');
  });
});

describe('configuración del equipo', () => {
  it('traduce los estados de presencia', () => {
    assert.equal(A.textoEstadoPresencia('disponible'), 'Disponible');
    assert.equal(A.textoEstadoPresencia('desconectado'), 'Desconectado');
  });

  it('arma el contrato desde valores de formulario', () => {
    assert.deepEqual(A.armarConfigAtencion({
      asignacionAutomatica: 'true', maxAbiertasPorAsesor: '8', horarioActivo: false,
      encuestaSatisfaccion: 'true', avisosCorreo: 'true', dias: ['5', '1', '3'], desde: '08:00', hasta: '17:00',
    }), {
      asignacionAutomatica: true, maxAbiertasPorAsesor: 8,
      encuestaSatisfaccion: true,
      avisosCorreo: true,
      horario: { activo: false, dias: [1, 3, 5], desde: '08:00', hasta: '17:00' },
    });
  });

  it('valida máximo, días y orden de horas', () => {
    const base = { asignacionAutomatica: true, maxAbiertasPorAsesor: 8, horario: { activo: true, dias: [1], desde: '08:00', hasta: '17:00' } };
    assert.equal(A.validarConfigAtencion(base), null);
    assert.match(A.validarConfigAtencion({ ...base, maxAbiertasPorAsesor: 51 }), /1 y 50/);
    assert.match(A.validarConfigAtencion({ ...base, horario: { ...base.horario, dias: [] } }), /día/);
    assert.match(A.validarConfigAtencion({ ...base, horario: { ...base.horario, desde: '18:00' } }), /anterior/);
  });
});

describe('resumenMacro', () => {
  it('resume las acciones en el orden que entiende el asesor', () => {
    assert.equal(A.resumenMacro({ acciones: { nota: 'n', mensaje: 'm', etiquetas: ['beca'], estado: 'resolved' } }), 'Nota · Mensaje · Etiqueta beca · Resuelve');
  });
});

describe('construirAccionesMacro', () => {
  it('omite Sin cambio y convierte las selecciones del formulario', () => {
    assert.deepEqual(A.construirAccionesMacro({
      nota: '  revisar ', mensaje: '', etiquetas: 'beca, urgente',
      equipoId: 'null', asesorId: 'yo', estado: 'pending',
    }), { nota: 'revisar', etiquetas: ['beca', 'urgente'], equipoId: null, asesorId: 'yo', estado: 'pending' });
  });
});

describe('archivos adjuntos', () => {
  it('valida tipo y límite de 3 MB', () => {
    assert.equal(A.validarArchivo({ type: 'image/png', size: 100 }), null);
    assert.match(A.validarArchivo({ type: 'application/zip', size: 100 }), /no permitido/i);
    assert.match(A.validarArchivo({ type: 'application/pdf', size: 3 * 1024 * 1024 + 1 }), /3 MB/);
  });

  it('formatea KB y MB', () => {
    assert.equal(A.formatoTamano(1536), '2 KB');
    assert.equal(A.formatoTamano(1572864), '1.5 MB');
  });
});
