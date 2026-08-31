// Mechanical second projection using the same sources and compiler, no bundler.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const destination = 'dist/cjs';
await mkdir(destination, { recursive: true });
async function copy(directory, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await copy(join(directory, entry.name), join(target, entry.name));
    else if (entry.name.endsWith('.ts')) {
      const source = await readFile(join(directory, entry.name), 'utf8');
      await writeFile(join(target, entry.name.replace(/\.ts$/, '.cts')), source.replace(/(from\s+|import\s*)(['"])([^'"]+)\.js\2/g, '$1$2$3.cjs$2'));
    }
  }
}
await copy('src', destination);
const compiler = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.cjs.json'], { stdio: 'inherit' });
if (compiler.status !== 0) process.exit(compiler.status ?? 1);
