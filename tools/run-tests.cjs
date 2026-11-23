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

// --test-force-exit: una prueba que deja abierta una conexión (Redis, un
// temporizador) ya no cuelga la tanda para siempre. --test-timeout corta una
// prueba trabada y la marca como fallo en vez de esperar sin fin. El tope de
// spawnSync es la última red: la tanda entera nunca pasa de 10 minutos.
const result = spawnSync(process.execPath, [
  '--env-file=.env.test', '--import', 'tsx', '--test',
  '--test-force-exit', '--test-timeout=60000',
  // Las pruebas cruzadas de la integración (src/flows/integracion.test.ts, verificacionVoz.test.ts) cambian Redis y
  // Chatwoot con mock.module, que existe desde Node 22.3 (CI y Docker usan 22 LTS). En un Node más viejo el flag
  // no existe y esas pruebas se saltan.
  ...(conMockDeModulos() ? ['--experimental-test-module-mocks'] : []),
  ...process.argv.slice(2), ...testFiles('src').sort(),
], { stdio: 'inherit', timeout: 10 * 60 * 1000, killSignal: 'SIGKILL' });
if (result.signal) console.error(`[run-tests] la tanda se cortó por tiempo (${result.signal}).`);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
