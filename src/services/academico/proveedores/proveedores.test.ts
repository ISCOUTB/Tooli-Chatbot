import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearProveedorNotasBanner, type AlmacenSesionNotas, type SesionGuardada } from './notasBanner';
import { crearProveedorReciboIceberg } from './reciboIceberg';
import { crearProveedorTurnoSheets } from './turnoSheets';
import { crearProveedorCursosSavio } from './cursosSavio';
import { AcademicoProviderSimulado, crearProveedorHorarioBanner, proveedorHorarioDesdeAcademico } from './horario';
import { hora24, parseHorarioBanner } from './bannerHorarioParser';
import type { DatosEstudiante } from '../tipos';

const ANA: DatosEstudiante = { telefono: '573001112233', email: 'ana.perez@utb.edu.co', codigo: 'T00012345', codigoVerificado: true };

function almacen(sesion: SesionGuardada | null) {
  const borrados: string[] = [];
  const a: AlmacenSesionNotas = { leer: async () => sesion, borrar: async (t) => { borrados.push(t); } };
  return { a, borrados };
}

describe('notas de Banner: solo con sesión guardada (camino A)', () => {
  const COOKIES = JSON.stringify({ cookies: [] });

  it('camino B: sin sesión, nunca lee el almacén ni el portal', async () => {
    let tocado = false;
    const p = crearProveedorNotasBanner({
      camino: () => 'B',
      almacen: { leer: async () => { tocado = true; return null; }, borrar: async () => undefined },
      leerConSesion: async () => { tocado = true; return { status: 'error' }; },
    });
    assert.deepEqual(await p.consultar(ANA), { estado: 'sin_sesion' });
    assert.equal(tocado, false);
  });

  it('camino A con sesión vigente: devuelve las notas', async () => {
    const { a } = almacen({ estado: COOKIES, email: ANA.email });
    const p = crearProveedorNotasBanner({
      camino: () => 'A', almacen: a,
      leerConSesion: async (estado) => {
        assert.equal(estado, COOKIES);
        return { status: 'ok', valor: [{ titulo: 'Cálculo', notaFinal: '4.2' }] };
      },
    });
    assert.deepEqual(await p.consultar(ANA), { estado: 'ok', cursos: [{ titulo: 'Cálculo', notaFinal: '4.2' }] });
  });

  it('una sesión guardada para OTRO correo no se usa (ni se lee el portal con ella)', async () => {
    const { a } = almacen({ estado: COOKIES, email: 'luis.gomez@utb.edu.co' });
    let leyo = false;
    const p = crearProveedorNotasBanner({ camino: () => 'A', almacen: a, leerConSesion: async () => { leyo = true; return { status: 'error' }; } });
    assert.deepEqual(await p.consultar(ANA), { estado: 'sin_sesion' });
    assert.equal(leyo, false);
  });

  it('sesión vencida en el portal: se borra y vuelve a pedir inicio de sesión', async () => {
    const { a, borrados } = almacen({ estado: COOKIES, email: ANA.email });
    const p = crearProveedorNotasBanner({ camino: () => 'A', almacen: a, leerConSesion: async () => ({ status: 'expirada' }) });
    assert.deepEqual(await p.consultar(ANA), { estado: 'sin_sesion' });
    assert.deepEqual(borrados, [ANA.telefono]);
  });

  it('error del portal: error, sin borrar la sesión', async () => {
    const { a, borrados } = almacen({ estado: COOKIES, email: ANA.email });
    const p = crearProveedorNotasBanner({ camino: () => 'A', almacen: a, leerConSesion: async () => ({ status: 'error' }) });
    assert.deepEqual(await p.consultar(ANA), { estado: 'error' });
    assert.equal(borrados.length, 0);
  });
});

describe('recibo de Iceberg', () => {
  it('mapea fechas, recargo, valor y PDF', async () => {
    const pdf = Buffer.from('pdf');
    const p = crearProveedorReciboIceberg(async () => ({
      ok: true, nombre: 'ANA', cedula: '1045678901', pdf, matriculas: [{ tipo: 'ORDINARIA', fechaVencimiento: '15/12/2026', recargo: '0%', valor: 8_363_000 }],
    }));
    assert.deepEqual(await p.consultar('T00012345', '1045678901'), {
      estado: 'ok', nombre: 'ANA', pdf,
      vencimientos: [{ tipo: 'ORDINARIA', fecha: '15/12/2026', recargo: '0%', valor: 8_363_000 }],
    });
  });

  it('distingue sin recibos, credenciales malas y fallas técnicas', async () => {
    assert.deepEqual(await crearProveedorReciboIceberg(async () => ({ ok: true, noRecibos: true, nombre: 'ANA', cedula: '1045678901' })).consultar('T1', '1045678901'), { estado: 'sin_recibos', nombre: 'ANA' });
    assert.deepEqual(await crearProveedorReciboIceberg(async () => ({ ok: false, error: 'Login falló tras 5 intentos' })).consultar('T1', '1'), { estado: 'credenciales' });
    assert.deepEqual(await crearProveedorReciboIceberg(async () => ({ ok: false, error: 'No se pudo completar la consulta del portal' })).consultar('T1', '1'), { estado: 'error' });
    assert.deepEqual(await crearProveedorReciboIceberg(async () => { throw new Error('playwright: clave'); }).consultar('T1', '1'), { estado: 'error' });
  });

  it('no dice «no tienes recibos» ni entrega un PDF si el portal no confirmó la cédula', async () => {
    // Sin la cédula en la página no hay prueba de haber entrado como esa persona.
    assert.deepEqual(await crearProveedorReciboIceberg(async () => ({ ok: true, noRecibos: true })).consultar('T1', '1045678901'), { estado: 'error' });
    assert.deepEqual(await crearProveedorReciboIceberg(async () => ({ ok: true, noRecibos: true, nombre: 'ANA', cedula: '99999999' })).consultar('T1', '1045678901'), { estado: 'error' });
    assert.deepEqual(await crearProveedorReciboIceberg(async () => ({ ok: true, pdf: Buffer.from('x'), cedula: '99999999' })).consultar('T1', '1045678901'), { estado: 'error' }, 'el PDF de otra cédula');
  });
});

describe('turno de la hoja', () => {
  it('une nombre y apellido y conserva la fecha límite', async () => {
    const p = crearProveedorTurnoSheets(async (c) => ({
      codigo: c, nombre: 'Ana', apellido: 'Pérez', programa: 'Ing', turno: '14', fecha: '15/12/2026', hora: '08:00', fechaLimite: '20/12/2026', horaLimite: '17:00',
    }));
    assert.deepEqual(await p.consultar('T00012345'), {
      codigo: 'T00012345', nombre: 'Ana Pérez', programa: 'Ing', turno: '14', fecha: '15/12/2026', hora: '08:00', fechaLimite: '20/12/2026', horaLimite: '17:00',
    });
    assert.equal(await crearProveedorTurnoSheets(async () => null).consultar('T0'), null);
  });
});

describe('cursos de Savio', () => {
  it('mapea cursos y tareas, y no filtra el mensaje del error', async () => {
    const ok = crearProveedorCursosSavio(async () => ({
      accountFound: true,
      courses: [{ id: 1, name: 'Cálculo', url: 'https://savio.utb.edu.co/course/view.php?id=1' }],
      tareas: [{ titulo: 'Taller', curso: 'Cálculo', vence: '2026-11-25T00:00:00Z' }],
    }));
    const r = await ok.consultar(ANA.email);
    assert.equal(r.estado, 'ok');
    assert.equal(r.estado === 'ok' && r.cursos[0].nombre, 'Cálculo');
    assert.deepEqual(await crearProveedorCursosSavio(async () => ({ accountFound: false, courses: [], tareas: [] })).consultar(ANA.email), { estado: 'no_encontrado' });
    const malo = crearProveedorCursosSavio(async () => { throw new Error('wstoken=SECRETO'); });
    assert.deepEqual(await malo.consultar(ANA.email), { estado: 'error' });
  });
});

describe('horario', () => {
  it('el proveedor simulado implementa AcademicoProvider y se marca como simulado', async () => {
    const sim = new AcademicoProviderSimulado();
    assert.ok((await sim.getHorario()).length > 0);
    const r = await proveedorHorarioDesdeAcademico(sim, true).consultar(ANA);
    assert.equal(r.estado, 'ok');
    assert.ok(r.estado === 'ok' && r.simulado === true);
    assert.deepEqual(r.estado === 'ok' && r.clases[0], {
      materia: 'Cálculo Diferencial (simulado)', dia: 'lunes', inicio: '08:00', fin: '09:50', salon: 'Aula 101',
    });
  });

  it('Banner real: misma vía de sesión que las notas; sin sesión no lee nada', async () => {
    let leyo = false;
    const p = crearProveedorHorarioBanner({
      camino: () => 'B', almacen: almacen(null).a,
      leerHtmlConSesion: async () => { leyo = true; return { status: 'error' }; },
    });
    assert.deepEqual(await p.consultar(ANA), { estado: 'sin_sesion' });
    assert.equal(leyo, false);
  });

  it('Banner real con sesión: parsea el HTML; una página sin clases es error (no se inventa nada)', async () => {
    const { a, borrados } = almacen({ estado: '{}', email: ANA.email });
    const ok = crearProveedorHorarioBanner({ camino: () => 'A', almacen: a, leerHtmlConSesion: async () => ({ status: 'ok', html: HTML_SINTETICO }) });
    const r = await ok.consultar(ANA);
    assert.equal(r.estado === 'ok' && r.clases.length, 3);
    const vacio = crearProveedorHorarioBanner({ camino: () => 'A', almacen: a, leerHtmlConSesion: async () => ({ status: 'ok', html: '<html></html>' }) });
    assert.deepEqual(await vacio.consultar(ANA), { estado: 'error' });
    const vencida = crearProveedorHorarioBanner({ camino: () => 'A', almacen: a, leerHtmlConSesion: async () => ({ status: 'expirada' }) });
    assert.deepEqual(await vencida.consultar(ANA), { estado: 'sin_sesion' });
    assert.deepEqual(borrados, [ANA.telefono]);
  });
});

// HTML SINTÉTICO con la estructura estándar de Banner 8. No es una captura del Banner de la UTB.
const HTML_SINTETICO = `
<table class="datadisplaytable"><caption class="captiontext">Cálculo Diferencial - MAT101 - 01</caption>
<tr><th>Estado</th><td>Matriculado</td></tr><tr><th>CRN</th><td>12345</td></tr></table>
<table class="datadisplaytable"><caption class="captiontext">Reuniones programadas</caption>
<tr><th>Tipo</th><th>Hora</th><th>Días</th><th>Donde</th><th>Rango de fechas</th></tr>
<tr><td>Clase</td><td>8:00 am - 9:50 am</td><td>L I</td><td>Edificio 101 Aula 3</td><td>01/02/2026</td></tr></table>
<table class="datadisplaytable"><caption class="captiontext">Física Mecánica - FIS101 - 02</caption>
<tr><th>CRN</th><td>54321</td></tr></table>
<table class="datadisplaytable"><caption class="captiontext">Reuniones programadas</caption>
<tr><th>Tipo</th><th>Hora</th><th>Días</th><th>Donde</th></tr>
<tr><td>Clase</td><td>2:00 pm - 3:50 pm</td><td>M</td><td>Por definir</td></tr></table>`;

describe('lector del horario de Banner (sobre HTML sintético)', () => {
  it('convierte horas a 24 h', () => {
    assert.equal(hora24('8:00 am'), '08:00');
    assert.equal(hora24('2:30 pm'), '14:30');
    assert.equal(hora24('12:00 pm'), '12:00');
    assert.equal(hora24('12:15 am'), '00:15');
    assert.equal(hora24('14:30'), '14:30');
    assert.equal(hora24('mañana'), null);
  });

  it('saca materia, CRN, días, horas y salón; ignora «por definir»', () => {
    assert.deepEqual(parseHorarioBanner(HTML_SINTETICO), [
      { materia: 'Cálculo Diferencial', dia: 'lunes', inicio: '08:00', fin: '09:50', salon: 'Edificio 101 Aula 3', crn: '12345' },
      { materia: 'Cálculo Diferencial', dia: 'miércoles', inicio: '08:00', fin: '09:50', salon: 'Edificio 101 Aula 3', crn: '12345' },
      { materia: 'Física Mecánica', dia: 'martes', inicio: '14:00', fin: '15:50', crn: '54321' },
    ]);
  });

  it('una página irreconocible no da clases', () => {
    assert.deepEqual(parseHorarioBanner('<html><body>Acceso denegado</body></html>'), []);
  });
});
