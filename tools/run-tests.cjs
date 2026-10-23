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

const result = spawnSync(process.execPath, [
  '--env-file=.env.test', '--import', 'tsx', '--test',
  ...process.argv.slice(2), ...testFiles('src').sort(),
], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
