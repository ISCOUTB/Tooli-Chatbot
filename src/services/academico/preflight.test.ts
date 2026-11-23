import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { problemasConfigAcademica } from './interruptores';

// tools/deploy-preflight.py repite en Python la regla de problemasConfigAcademica (el preflight corre en el VPS antes
// de construir, sin Node). Esta prueba fija que las dos digan lo mismo.
const PREFLIGHT = join(__dirname, '..', '..', '..', 'tools', 'deploy-preflight.py');
const SIN_PYTHON = spawnSync('python3', ['--version']).status === 0 ? false : 'no hay python3';

function preflight(env: Record<string, string>): { bloqueos: string[]; avisos: string[] } {
  const codigo = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location('preflight', ${JSON.stringify(PREFLIGHT)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'b, a = m.check_academico(json.loads(sys.stdin.read()))',
    'print(json.dumps({"bloqueos": b, "avisos": a}))',
  ].join('\n');
  const r = spawnSync('python3', ['-I', '-c', codigo], { input: JSON.stringify(env), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('preflight y arranque avisan lo mismo de la configuración académica', { skip: SIN_PYTHON }, () => {
  const clave = randomBytes(32).toString('hex');
  const casos: Array<Record<string, string>> = [
    {},
    { TOOLI_ACADEMIC_LOOKUP_ENABLED: '1' },
    { TOOLI_ACADEMIC_LOOKUP_ENABLED: '1', TOOLI_ACADEMICO_CLAVE: 'corta' },
    { TOOLI_ACADEMIC_LOOKUP_ENABLED: '1', TOOLI_ACADEMICO_CLAVE: clave },
    { TOOLI_ACADEMIC_LOOKUP_ENABLED: '1', TOOLI_ACADEMICO_CLAVE: randomBytes(32).toString('base64') },
    { TOOLI_NOTAS_CAMINO: 'A' },
    { TOOLI_HORARIO_ENABLED: '1', TOOLI_NOTAS_CAMINO: 'A', TOOLI_ACADEMICO_CLAVE: clave },
    { TOOLI_HORARIO_ENABLED: '1', TOOLI_ACADEMICO_CLAVE: clave },
    { TOOLI_HORARIO_ENABLED: '1', TOOLI_HORARIO_PROVEEDOR: 'simulado' },
    { TOOLI_ACADEMIC_LOOKUP_ENABLED: '1', TOOLI_ACADEMICO_CLAVE: clave, TOOLI_BUSQUEDA_CLAVE: 'x'.repeat(40) },
    { TOOLI_BUSQUEDA_CLAVE: 'corta' },
  ];
  for (const env of casos) {
    it(JSON.stringify(env), () => {
      const ts = problemasConfigAcademica(env);
      const py = preflight(env);
      assert.equal(py.bloqueos.length, ts.filter((p) => p.nivel === 'bloqueo').length, 'bloqueos');
      assert.equal(py.avisos.length, ts.filter((p) => p.nivel === 'aviso').length, 'avisos');
    });
  }
});
