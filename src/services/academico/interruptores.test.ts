import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  avisosProactivosActivos, caminoNotas, horasSesionNotas, interruptoresDeEntorno, problemasConfigAcademica, proveedorHorario,
} from './interruptores';
import { formatearPesos, leerValorPesos } from './pesos';

const VARIABLES = [
  'TOOLI_NOTAS_SSO_ENABLED', 'TOOLI_ACADEMIC_LOOKUP_ENABLED', 'TOOLI_SAVIO_ENABLED', 'SAVIO_WS_TOKEN', 'TOOLI_HORARIO_ENABLED',
  'TOOLI_NOTAS_CAMINO', 'TOOLI_ACADEMICO_CLAVE', 'TOOLI_NOTAS_SESION_HORAS', 'TOOLI_AVISOS_ACADEMICOS_ENABLED',
  'TOOLI_HORARIO_PROVEEDOR', 'NODE_ENV', 'TOOLI_BUSQUEDA_CLAVE',
] as const;
let guardado: Record<string, string | undefined>;
beforeEach(() => {
  guardado = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  for (const v of VARIABLES) delete process.env[v];
});
afterEach(() => {
  for (const v of VARIABLES) { if (guardado[v] === undefined) delete process.env[v]; else process.env[v] = guardado[v]; }
});

describe('interruptores: todo apagado por defecto y se leen en cada llamada', () => {
  it('sin variables, nada está encendido', () => {
    for (const nombre of ['notas', 'recibo', 'turno', 'horario', 'cursos'] as const) {
      assert.equal(interruptoresDeEntorno[nombre](), false, nombre);
    }
    assert.equal(avisosProactivosActivos(), false);
  });

  it('cada integración se enciende con SU variable, sin arrastrar a las otras', () => {
    process.env.TOOLI_NOTAS_SSO_ENABLED = '1';
    assert.deepEqual(
      ['notas', 'recibo', 'turno', 'horario', 'cursos'].map((n) => interruptoresDeEntorno[n as 'notas']()),
      [true, false, false, false, false],
    );
    process.env.TOOLI_ACADEMIC_LOOKUP_ENABLED = '1';
    assert.equal(interruptoresDeEntorno.recibo(), true);
    assert.equal(interruptoresDeEntorno.turno(), true);
    process.env.TOOLI_HORARIO_ENABLED = '1';
    assert.equal(interruptoresDeEntorno.horario(), true);
  });

  it('solo el valor 1 enciende (true, yes o espacios no)', () => {
    for (const v of ['true', 'yes', ' 1', '0', '']) {
      process.env.TOOLI_NOTAS_SSO_ENABLED = v;
      assert.equal(interruptoresDeEntorno.notas(), false, JSON.stringify(v));
    }
  });

  it('Savio exige el interruptor Y el token', () => {
    process.env.TOOLI_SAVIO_ENABLED = '1';
    assert.equal(interruptoresDeEntorno.cursos(), false);
    process.env.SAVIO_WS_TOKEN = '   ';
    assert.equal(interruptoresDeEntorno.cursos(), false);
    process.env.SAVIO_WS_TOKEN = 'token-de-servicio';
    assert.equal(interruptoresDeEntorno.cursos(), true);
  });
});

describe('camino de las notas: B por defecto, A solo con clave', () => {
  it('por defecto es B', () => {
    assert.equal(caminoNotas(), 'B');
  });

  it('pedir A sin clave válida cae a B (no se guarda nada sin poder cifrarlo)', () => {
    process.env.TOOLI_NOTAS_CAMINO = 'A';
    assert.equal(caminoNotas(), 'B');
    process.env.TOOLI_ACADEMICO_CLAVE = 'corta';
    assert.equal(caminoNotas(), 'B');
  });

  it('A con clave de 32 bytes funciona (en minúscula también)', () => {
    process.env.TOOLI_ACADEMICO_CLAVE = randomBytes(32).toString('hex');
    process.env.TOOLI_NOTAS_CAMINO = 'a';
    assert.equal(caminoNotas(), 'A');
    process.env.TOOLI_NOTAS_CAMINO = 'B';
    assert.equal(caminoNotas(), 'B');
  });

  it('la sesión guardada dura 12 h por defecto y se acota entre 1 y 72', () => {
    assert.equal(horasSesionNotas(), 12);
    process.env.TOOLI_NOTAS_SESION_HORAS = '24';
    assert.equal(horasSesionNotas(), 24);
    process.env.TOOLI_NOTAS_SESION_HORAS = '500';
    assert.equal(horasSesionNotas(), 12);
    process.env.TOOLI_NOTAS_SESION_HORAS = '0';
    assert.equal(horasSesionNotas(), 12);
  });
});

describe('proveedor de horario', () => {
  it('Banner por defecto; el simulado solo fuera de producción', () => {
    assert.equal(proveedorHorario(), 'banner');
    process.env.TOOLI_HORARIO_PROVEEDOR = 'simulado';
    process.env.NODE_ENV = 'test';
    assert.equal(proveedorHorario(), 'simulado');
    process.env.NODE_ENV = 'production';
    assert.equal(proveedorHorario(), 'banner', 'en producción nunca se usan datos inventados');
  });
});

describe('valores en pesos del portal', () => {
  it('lee el valor y descarta fechas y porcentajes', () => {
    assert.equal(leerValorPesos('ORDINARIA 15/12/2026 0 % $ 8.363.000'), 8_363_000);
    assert.equal(leerValorPesos('EXTRAORDINARIA 20/12/2026 2% 8.529.000,00'), 8_529_000);
    assert.equal(leerValorPesos('ORDINARIA 15/12/2026 0 %'), null);
    assert.equal(leerValorPesos('COP 8363000'), 8_363_000);
    assert.equal(leerValorPesos(''), null);
  });

  it('da formato colombiano', () => {
    assert.equal(formatearPesos(8_363_000), '$8.363.000');
    assert.equal(formatearPesos(950), '$950');
  });
});

describe('configuración académica: lo que necesita TOOLI_ACADEMICO_CLAVE', () => {
  const bloqueos = () => problemasConfigAcademica(process.env).filter((p) => p.nivel === 'bloqueo');
  const avisos = () => problemasConfigAcademica(process.env).filter((p) => p.nivel === 'aviso');

  it('todo apagado: nada que decir', () => {
    assert.deepEqual(problemasConfigAcademica(process.env), []);
  });

  it('turno/recibo sin TOOLI_BUSQUEDA_CLAVE avisa (los índices dependen de otras claves, #38); con ella, no', () => {
    process.env.TOOLI_ACADEMIC_LOOKUP_ENABLED = '1';
    process.env.TOOLI_ACADEMICO_CLAVE = randomBytes(32).toString('hex');
    assert.match(avisos().map((p) => p.mensaje).join(' '), /TOOLI_BUSQUEDA_CLAVE/);
    process.env.TOOLI_BUSQUEDA_CLAVE = 'x'.repeat(40);
    assert.deepEqual(problemasConfigAcademica(process.env), []);
    process.env.TOOLI_BUSQUEDA_CLAVE = 'corta';
    assert.match(avisos().map((p) => p.mensaje).join(' '), /menos de 32/);
  });

  it('recibo encendido sin clave: bloquea (el recibo no se podría bajar y cada intento haría un login)', () => {
    process.env.TOOLI_ACADEMIC_LOOKUP_ENABLED = '1';
    assert.equal(bloqueos().length, 1);
    assert.match(bloqueos()[0].mensaje, /TOOLI_ACADEMIC_LOOKUP_ENABLED.*TOOLI_ACADEMICO_CLAVE/);
    process.env.TOOLI_ACADEMICO_CLAVE = 'corta';
    assert.equal(bloqueos().length, 1, 'una clave inválida es como no tenerla');
    process.env.TOOLI_ACADEMICO_CLAVE = randomBytes(32).toString('hex');
    assert.equal(bloqueos().length, 0);
  });

  it('camino A u horario sin clave: avisa (caen a B o no muestran el horario)', () => {
    process.env.TOOLI_NOTAS_CAMINO = 'A';
    assert.match(avisos().map((p) => p.mensaje).join(' '), /TOOLI_NOTAS_CAMINO=A/);
    process.env.TOOLI_HORARIO_ENABLED = '1';
    assert.match(avisos().map((p) => p.mensaje).join(' '), /TOOLI_HORARIO_ENABLED/);
    process.env.TOOLI_ACADEMICO_CLAVE = randomBytes(32).toString('hex');
    assert.deepEqual(avisos().filter((p) => /TOOLI_ACADEMICO_CLAVE/.test(p.mensaje)), []);
  });
});

