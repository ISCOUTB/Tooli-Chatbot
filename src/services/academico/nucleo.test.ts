import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ResultadoConsulta, TipoConsulta } from '../../contratos/academico';
import { crearAcademico, type DepsNucleo, type IdentidadVigente } from './nucleo';
import type { Interruptores } from './interruptores';
import type {
  DatosEstudiante, ProveedorCursos, ProveedorHorario, ProveedorNotas, ProveedorRecibo, ProveedorTurno,
} from './tipos';
import { esTextoVozLimpio } from './voz';

const REGLA = { notaMinima: 3.0, notaMaxima: 5.0, pesosCortes: [30, 30, 40], sinConfirmar: true };
// Lunes 22 de noviembre de 2026, 10:00 en Colombia.
const AHORA = new Date('2026-11-23T10:00:00-05:00');

const ANA: IdentidadVigente = {
  email: 'ana.perez@utb.edu.co', codigo: 'T00012345', codigoVerificado: true, nombre: 'Ana Pérez', programa: 'Ingeniería', nivel: 'pregrado',
};
const LUIS: IdentidadVigente = { email: 'luis.gomez@utb.edu.co', codigo: 'T00099999', codigoVerificado: true };

interface Llamadas { notas: DatosEstudiante[]; recibo: Array<[string, string]>; turno: string[]; horario: DatosEstudiante[]; cursos: string[] }

function armar(over: {
  identidades?: Record<string, IdentidadVigente>;
  on?: Partial<Record<TipoConsulta, boolean>>;
  notas?: ProveedorNotas['consultar'];
  recibo?: ProveedorRecibo['consultar'];
  turno?: ProveedorTurno['consultar'];
  horario?: ProveedorHorario['consultar'];
  cursos?: ProveedorCursos['consultar'];
  cedula?: string | null;
  busquedaPermitida?: boolean;
  existeEnFuente?: boolean;
  /** Sin TOOLI_ACADEMICO_CLAVE la cédula no se puede guardar. */
  sinClave?: boolean;
} = {}) {
  const llamadas: Llamadas = { notas: [], recibo: [], turno: [], horario: [], cursos: [] };
  const on = { notas: true, recibo: true, turno: true, horario: true, cursos: true, ...over.on };
  const interruptores: Interruptores = {
    notas: () => on.notas, recibo: () => on.recibo, turno: () => on.turno, horario: () => on.horario, cursos: () => on.cursos,
  };
  const identidades = over.identidades ?? { '573001112233': ANA, '573004445566': LUIS };
  const deps: DepsNucleo = {
    identidad: {
      obtener: async (t) => identidades[t] ?? null,
      porCodigo: async (c) => {
        const t = Object.keys(identidades).find((k) => identidades[k].codigo === c);
        return t ? { telefono: t, email: identidades[t].email } : null;
      },
      porCedula: async (c) => (c === '1045678901' ? { telefono: '573001112233', email: ANA.email } : null),
    },
    existeCodigoEnFuente: async () => over.existeEnFuente ?? false,
    cedulaDe: async () => (over.cedula === undefined ? '1045678901' : over.cedula),
    interruptores,
    proveedores: {
      notas: { consultar: async (e) => { llamadas.notas.push(e); return over.notas ? over.notas(e) : { estado: 'sin_sesion' }; } },
      recibo: { consultar: async (c, d) => { llamadas.recibo.push([c, d]); return over.recibo ? over.recibo(c, d) : { estado: 'sin_recibos' }; } },
      turno: { consultar: async (c) => { llamadas.turno.push(c); return over.turno ? over.turno(c) : null; } },
      horario: { consultar: async (e) => { llamadas.horario.push(e); return over.horario ? over.horario(e) : { estado: 'sin_sesion' }; } },
      cursos: { consultar: async (m) => { llamadas.cursos.push(m); return over.cursos ? over.cursos(m) : { estado: 'no_encontrado' }; } },
    },
    permitirBusqueda: async () => over.busquedaPermitida ?? true,
    regla: () => REGLA,
    ahora: () => AHORA,
    puedeGuardarCedula: () => !over.sinClave,
  };
  return { api: crearAcademico(deps), llamadas };
}

const ANA_TEL = '573001112233';
const TIPOS: TipoConsulta[] = ['notas', 'recibo', 'turno', 'horario', 'cursos'];
const todos: ResultadoConsulta[] = [];
const guardar = (r: ResultadoConsulta): ResultadoConsulta => { todos.push(r); return r; };

describe('interruptores: cada integración respeta el suyo', () => {
  for (const tipo of TIPOS) {
    it(`${tipo} apagado -> ok:false, motivo apagado y un texto útil, sin tocar el proveedor`, async () => {
      const { api, llamadas } = armar({ on: { [tipo]: false } });
      const r = guardar(await api.consultar(ANA_TEL, tipo));
      assert.equal(r.ok, false);
      assert.equal(r.ok === false && r.motivo, 'apagado');
      assert.equal(r.tipo, tipo);
      assert.ok(r.paraVoz.length > 20);
      assert.match(r.paraTexto, /https?:\/\//, 'el texto manda al portal oficial');
      assert.equal(Object.values(llamadas).flat().length, 0, 'no se consultó ninguna fuente');
    });
  }

  it('apagado se responde aunque el número no esté verificado (no pide verificar algo que no existe)', async () => {
    const { api } = armar({ on: { notas: false } });
    const r = await api.consultar('573000000000', 'notas');
    assert.equal(r.ok === false && r.motivo, 'apagado');
  });
});

describe('no verificado', () => {
  for (const tipo of TIPOS) {
    it(`${tipo}: un número sin vínculo recibe no_verificado y no se consulta nada`, async () => {
      const { api, llamadas } = armar();
      const r = guardar(await api.consultar('573000000000', tipo));
      assert.equal(r.ok === false && r.motivo, 'no_verificado');
      assert.match(r.paraVoz, /confirmar que eres estudiante/);
      assert.equal(Object.values(llamadas).flat().length, 0);
    });
  }

  it('estudianteDe devuelve al estudiante verificado y null a quien no lo es', async () => {
    const { api } = armar();
    const ana = await api.estudianteDe(ANA_TEL);
    assert.deepEqual(ana, {
      telefono: ANA_TEL, email: ANA.email, codigo: 'T00012345', nombre: 'Ana Pérez', programa: 'Ingeniería', nivel: 'pregrado',
    });
    assert.equal(await api.estudianteDe('573000000000'), null);
  });
});

describe('notas', () => {
  it('sin sesión: motivo sin_sesion con instrucciones', async () => {
    const { api } = armar();
    const r = guardar(await api.consultar(ANA_TEL, 'notas'));
    assert.equal(r.ok === false && r.motivo, 'sin_sesion');
    assert.match(r.paraVoz, /inicies sesión/);
  });

  it('con notas: las dice en palabras, da el promedio y calcula lo que falta', async () => {
    const { api } = armar({
      notas: async () => ({
        estado: 'ok',
        cursos: [
          { titulo: 'Cálculo Diferencial', notaFinal: '4.2' },
          { titulo: 'Física Mecánica', notaFinal: '3.5' },
          { titulo: 'Programación', cortes: [{ nombre: 'C1', peso: 30, nota: 3.5 }, { nombre: 'C2', peso: 30, nota: 3.5 }, { nombre: 'Final', peso: 40 }] },
        ],
      }),
    });
    const r = guardar(await api.consultar(ANA_TEL, 'notas'));
    assert.equal(r.ok, true);
    assert.match(r.paraVoz, /Cálculo Diferencial, cuatro punto dos/);
    assert.match(r.paraVoz, /Física Mecánica, tres punto cinco/);
    assert.match(r.paraVoz, /Tu promedio es tres punto ocho cinco/);
    assert.match(r.paraVoz, /En Programación necesitas sacar dos punto dos cinco/);
    assert.match(r.paraTexto, /Cálculo Diferencial: \*4\.2\*/);
    assert.match(r.paraTexto, /por confirmar/);
    const datos = (r as Extract<ResultadoConsulta, { ok: true }>).datos as { promedio: number; cursos: Array<{ necesario?: { caso: string } }> };
    assert.equal(datos.promedio, 3.85);
    assert.equal(datos.cursos[2].necesario?.caso, 'posible');
  });

  it('un error del portal o una excepción no filtran detalles', async () => {
    const a = armar({ notas: async () => ({ estado: 'error' }) });
    const ra = guardar(await a.api.consultar(ANA_TEL, 'notas'));
    assert.equal(ra.ok === false && ra.motivo, 'error');
    const b = armar({ notas: async () => { throw new Error('ECONNRESET ssbprod.utb.edu.co clave=Secreta123 ana.perez@utb.edu.co'); } });
    const rb = guardar(await b.api.consultar(ANA_TEL, 'notas'));
    assert.equal(rb.ok === false && rb.motivo, 'error');
    for (const texto of [rb.paraVoz, rb.paraTexto]) {
      assert.ok(!/Secreta123|ECONNRESET|ana\.perez/.test(texto), texto);
    }
  });
});

describe('turno y recibo exigen el código atado y comprobado', () => {
  it('sin código atado: sin_codigo y la fuente no se consulta', async () => {
    const { api, llamadas } = armar({ identidades: { [ANA_TEL]: { email: ANA.email } } });
    for (const tipo of ['turno', 'recibo'] as const) {
      const r = guardar(await api.consultar(ANA_TEL, tipo));
      assert.equal(r.ok === false && r.motivo, 'sin_codigo', tipo);
    }
    assert.equal(llamadas.turno.length + llamadas.recibo.length, 0);
  });

  it('código declarado pero NO comprobado contra la fuente: sin_codigo', async () => {
    const { api, llamadas } = armar({ identidades: { [ANA_TEL]: { ...ANA, codigoVerificado: false } } });
    const r = guardar(await api.consultar(ANA_TEL, 'turno'));
    assert.equal(r.ok === false && r.motivo, 'sin_codigo');
    assert.equal(llamadas.turno.length, 0);
  });

  it('recibo con código declarado pero NO comprobado: sin_codigo y Iceberg no se toca', async () => {
    const { api, llamadas } = armar({ identidades: { [ANA_TEL]: { ...ANA, codigoVerificado: false } } });
    const r = guardar(await api.consultar(ANA_TEL, 'recibo'));
    assert.equal(r.ok === false && r.motivo, 'sin_codigo');
    assert.equal(llamadas.recibo.length, 0);
  });

  it('código ajeno: cada quien consulta SOLO el código atado a su número', async () => {
    const { api, llamadas } = armar({
      turno: async (codigo) => ({ codigo, nombre: 'X', programa: 'P', turno: '14', fecha: '15/12/2026', hora: '08:00' }),
    });
    await api.consultar(ANA_TEL, 'turno');
    await api.consultar('573004445566', 'turno');
    assert.deepEqual(llamadas.turno, ['T00012345', 'T00099999']);
    // La API no acepta un código por parámetro: no hay manera de pedir el de otro.
    assert.equal(api.consultar.length, 2);
  });

  it('turno: lo dice en voz con número, fecha, hora y límite', async () => {
    const { api } = armar({
      turno: async (codigo) => ({
        codigo, nombre: 'Ana Pérez', programa: 'Ingeniería', turno: '14', fecha: '15/12/2026', hora: '08:00',
        fechaLimite: '20/12/2026', horaLimite: '17:00',
      }),
    });
    const r = guardar(await api.consultar(ANA_TEL, 'turno'));
    assert.equal(r.ok, true);
    assert.equal(
      r.paraVoz,
      'Tu turno de matrícula es el número catorce. Te toca el quince de diciembre a las ocho de la mañana. Tienes hasta el veinte de diciembre a las cinco de la tarde.',
    );
    assert.match(r.paraTexto, /Turno: \*14\*/);
  });

  it('turno: no encontrado y error de la hoja', async () => {
    const a = armar({ turno: async () => null });
    const ra = guardar(await a.api.consultar(ANA_TEL, 'turno'));
    assert.equal(ra.ok === false && ra.motivo, 'no_encontrado');
    const b = armar({ turno: async () => { throw new Error('invalid_grant private_key'); } });
    const rb = guardar(await b.api.consultar(ANA_TEL, 'turno'));
    assert.equal(rb.ok === false && rb.motivo, 'error');
    assert.ok(!/private_key|invalid_grant/.test(rb.paraVoz + rb.paraTexto));
  });

  it('recibo: sin cédula guardada pide vincular y no llama a Iceberg', async () => {
    const { api, llamadas } = armar({ cedula: null });
    const r = guardar(await api.consultar(ANA_TEL, 'recibo'));
    assert.equal(r.ok === false && r.motivo, 'sin_codigo');
    assert.equal(llamadas.recibo.length, 0);
  });

  it('recibo encendido SIN TOOLI_ACADEMICO_CLAVE: falla claro y no manda a vincular otra vez (no hay ciclo)', async () => {
    // Antes: sin_codigo -> WhatsApp pedía vincular -> login Playwright -> la cédula no se guardaba -> sin_codigo…
    const { api, llamadas } = armar({ cedula: null, sinClave: true });
    const r = guardar(await api.consultar(ANA_TEL, 'recibo'));
    assert.equal(r.ok === false && r.motivo, 'apagado');
    assert.doesNotMatch(r.paraTexto, /vincular/i);
    assert.match(r.paraTexto, /https?:\/\//, 'manda al portal oficial');
    assert.equal(llamadas.recibo.length, 0, 'ni un login a Iceberg');
  });

  it('recibo: usa el código y la cédula del vínculo, dice el valor y la fecha, y entrega el PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4 falso');
    const { api, llamadas } = armar({
      recibo: async () => ({
        estado: 'ok', nombre: 'Ana Pérez', pdf,
        vencimientos: [
          { tipo: 'EXTRAORDINARIA', fecha: '20/12/2026', recargo: '2%', valor: 8_529_000 },
          { tipo: 'ORDINARIA', fecha: '15/12/2026', recargo: '0%', valor: 8_363_000 },
        ],
      }),
    });
    const r = guardar(await api.consultar(ANA_TEL, 'recibo'));
    assert.deepEqual(llamadas.recibo, [['T00012345', '1045678901']]);
    assert.equal(r.ok, true);
    assert.match(r.paraVoz, /matrícula ordinaria: paga hasta el quince de diciembre, por ocho millones trescientos sesenta y tres mil pesos/);
    assert.match(r.paraVoz, /matrícula extraordinaria: paga hasta el veinte de diciembre, por ocho millones quinientos veintinueve mil pesos, con dos por ciento de recargo/);
    assert.match(r.paraTexto, /\$8\.363\.000/);
    assert.equal(((r as Extract<ResultadoConsulta, { ok: true }>).datos as { pdf: Buffer }).pdf, pdf);
    assert.ok(!r.paraVoz.includes('1045678901') && !r.paraTexto.includes('1045678901'), 'la cédula no se repite');
  });

  it('recibo: sin recibos pendientes es una respuesta válida; credenciales rotas pide volver a vincular', async () => {
    const a = armar({ recibo: async () => ({ estado: 'sin_recibos', nombre: 'Ana' }) });
    const ra = guardar(await a.api.consultar(ANA_TEL, 'recibo'));
    assert.equal(ra.ok, true);
    assert.match(ra.paraVoz, /No tienes recibos pendientes/);
    const b = armar({ recibo: async () => ({ estado: 'credenciales' }) });
    const rb = guardar(await b.api.consultar(ANA_TEL, 'recibo'));
    assert.equal(rb.ok === false && rb.motivo, 'sin_codigo');
    const c = armar({ recibo: async () => ({ estado: 'error' }) });
    assert.equal((guardar(await c.api.consultar(ANA_TEL, 'recibo'))).ok, false);
  });
});

describe('horario', () => {
  const clases = [
    { materia: 'Cálculo Diferencial', dia: 'lunes', inicio: '08:00', fin: '09:50', salon: 'Aula 101' },
    { materia: 'Física Mecánica', dia: 'miércoles', inicio: '14:00', fin: '15:50' },
  ];

  it('dice lo de hoy', async () => {
    const { api } = armar({ horario: async () => ({ estado: 'ok', clases }) });
    const r = guardar(await api.consultar(ANA_TEL, 'horario'));
    assert.equal(r.paraVoz, 'Hoy lunes tienes Cálculo Diferencial de las ocho de la mañana a las nueve y cincuenta de la mañana, en Aula 101.');
    assert.match(r.paraTexto, /Lunes/);
  });

  it('si hoy no hay clase, dice la próxima', async () => {
    const { api } = armar({ horario: async () => ({ estado: 'ok', clases: [clases[1]] }) });
    const r = guardar(await api.consultar(ANA_TEL, 'horario'));
    assert.match(r.paraVoz, /^Hoy no tienes clases\. Tu próxima clase es el miércoles: Física Mecánica de las dos de la tarde/);
  });

  it('un horario simulado avisa que son datos de ejemplo', async () => {
    const { api } = armar({ horario: async () => ({ estado: 'ok', clases, simulado: true }) });
    const r = guardar(await api.consultar(ANA_TEL, 'horario'));
    assert.match(r.paraVoz, /^Atención, estos son datos de ejemplo/);
    assert.match(r.paraTexto, /Datos de ejemplo/);
  });

  it('sin sesión y con error', async () => {
    assert.equal((await armar().api.consultar(ANA_TEL, 'horario')).ok, false);
    const r = guardar(await armar({ horario: async () => ({ estado: 'error' }) }).api.consultar(ANA_TEL, 'horario'));
    assert.equal(r.ok === false && r.motivo, 'error');
  });
});

describe('cursos y tareas de Savio', () => {
  it('lista cursos y tareas próximas con fecha dicha', async () => {
    const { api, llamadas } = armar({
      cursos: async () => ({
        estado: 'ok',
        cursos: [{ id: 15, nombre: 'Cálculo I', url: 'https://savio.utb.edu.co/course/view.php?id=15' }],
        tareas: [{ titulo: 'Taller 1', curso: 'Cálculo I', vence: '2026-11-25T23:59:00-05:00' }],
      }),
    });
    const r = guardar(await api.consultar(ANA_TEL, 'cursos'));
    assert.deepEqual(llamadas.cursos, [ANA.email], 'consulta con el correo del vínculo, no con uno ajeno');
    assert.equal(r.paraVoz, 'Estás inscrito en un curso en Savio. Tienes una tarea próxima: Taller 1 de Cálculo I, el miércoles veinticinco de noviembre.');
    assert.match(r.paraTexto, /savio\.utb\.edu\.co\/course\/view\.php\?id=15/);
    assert.ok(!r.paraVoz.includes('http'));
  });

  it('cuenta no encontrada y error del servicio', async () => {
    const a = guardar(await armar().api.consultar(ANA_TEL, 'cursos'));
    assert.equal(a.ok === false && a.motivo, 'no_encontrado');
    const b = guardar(await armar({ cursos: async () => ({ estado: 'error' }) }).api.consultar(ANA_TEL, 'cursos'));
    assert.equal(b.ok === false && b.motivo, 'error');
  });
});

describe('buscarParaVerificar', () => {
  it('por código vinculado: dice a dónde irá el código, enmascarado, sin datos del estudiante', async () => {
    const { api } = armar();
    const r = await api.buscarParaVerificar({ codigo: 't00012345' });
    assert.deepEqual(r, { encontrado: true, telefonoVinculado: '****2233', emailEnmascarado: 'a***@utb.edu.co' });
    const texto = JSON.stringify(r);
    for (const filtrado of ['573001112233', 'ana.perez', 'Ana', 'Ingeniería']) assert.ok(!texto.includes(filtrado), filtrado);
  });

  it('por cédula vinculada', async () => {
    const r = await armar().api.buscarParaVerificar({ cedula: '1.045.678.901' });
    assert.equal(r.encontrado, true);
    assert.equal(r.emailEnmascarado, 'a***@utb.edu.co');
  });

  it('un código que no existe, o con formato malo, da exactamente lo mismo: no encontrado', async () => {
    const { api } = armar();
    assert.deepEqual(await api.buscarParaVerificar({ codigo: 'T00055555' }), { encontrado: false });
    assert.deepEqual(await api.buscarParaVerificar({ codigo: 'hola' }), { encontrado: false });
    assert.deepEqual(await api.buscarParaVerificar({}), { encontrado: false });
    assert.deepEqual(await api.buscarParaVerificar({ cedula: '1' }), { encontrado: false });
  });

  it('existe en la fuente oficial pero sin WhatsApp vinculado: se confirma sin destino', async () => {
    const r = await armar({ existeEnFuente: true }).api.buscarParaVerificar({ codigo: 'T00055555' });
    assert.deepEqual(r, { encontrado: true });
  });

  it('si se agotó el cupo de búsquedas no se consulta nada (anti-enumeración)', async () => {
    const { api } = armar({ busquedaPermitida: false });
    assert.deepEqual(await api.buscarParaVerificar({ codigo: 'T00012345' }), { encontrado: false });
  });
});

describe('textos para la voz', () => {
  it('todos los paraVoz generados arriba son frases limpias: sin emojis, markdown, enlaces ni saltos', () => {
    assert.ok(todos.length > 25, `se acumularon ${todos.length} resultados`);
    for (const r of todos) {
      assert.equal(esTextoVozLimpio(r.paraVoz), true, `${r.tipo}: ${r.paraVoz}`);
      assert.match(r.paraVoz, /[.!?]$/);
      assert.ok(r.paraVoz.length < 600, 'corto para leerse en una llamada');
    }
  });

  it('el texto de WhatsApp sí puede traer formato y es distinto del de voz', () => {
    const conFormato = todos.filter((r) => /[*_]/.test(r.paraTexto));
    assert.ok(conFormato.length > 5);
  });
});
