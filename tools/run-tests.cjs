// Node 20 does not expand quoted ** globs in --test. Pass explicit file paths
// so local runs, CI and Windows discover the same tests.
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? testFiles(path) : /\.test\.(ts|js)$/.test(entry.name) ? [path] : [];
  });
}

function conMockDeModulos() {
  const [mayor, menor] = process.versions.node.split('.').map(Number);
  return mayor > 22 || (mayor === 22 && menor >= 3);
}

// Sin --test-force-exit: corta el proceso de cada archivo antes de que termine
// de mandar sus resultados, así que se perdían suites enteras (con fallos
// incluidos) y la tanda igual decía «0 fallan». Para que nada quede colgado,
// los clientes de Redis se crean con lazyConnect: importar un servicio no abre
// ningún socket. --test-timeout corta una prueba trabada y la marca como
// fallo; el tope de spawnSync es la última red: un archivo que deje algo
// abierto hace fallar la tanda a los 10 minutos, a la vista, en vez de perder
// resultados en silencio.
const result = spawnSync(process.execPath, [
  '--env-file=.env.test', '--import', 'tsx', '--test',
  '--test-timeout=60000',
  // Las pruebas cruzadas de la integración (src/flows/integracion.test.ts, verificacionVoz.test.ts) cambian Redis y
  // Chatwoot con mock.module, que existe desde Node 22.3 (CI y Docker usan 22 LTS). En un Node más viejo el flag
  // no existe y esas pruebas se saltan.
  ...(conMockDeModulos() ? ['--experimental-test-module-mocks'] : []),
  ...process.argv.slice(2), ...testFiles('src').sort(),
], { stdio: 'inherit', timeout: 10 * 60 * 1000, killSignal: 'SIGKILL' });
if (result.signal) console.error(`[run-tests] la tanda se cortó por tiempo (${result.signal}).`);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
