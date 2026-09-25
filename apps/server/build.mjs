// Bundles the server (and the shared workspace code it imports) into dist/,
// alongside everything it serves at runtime: migrations, puzzle data and the web app.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(here, 'src', 'index.ts')],
  outfile: join(dist, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // npm dependencies are installed next to the bundle; workspace code is inlined.
  external: Object.keys(pkg.dependencies ?? {}),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

cpSync(join(here, 'drizzle'), join(dist, 'drizzle'), { recursive: true });
cpSync(join(here, '..', '..', 'packages', 'shared', 'data', 'puzzles'), join(dist, 'data', 'puzzles'), { recursive: true });
const web = join(here, '..', 'web', 'dist');
if (existsSync(web)) cpSync(web, join(dist, 'public'), { recursive: true });
else console.warn('! apps/web/dist not found — build the web app first (npm run build at the repo root)');
// Pre-compress text assets so @fastify/static can serve .br / .gz directly.
const compressible = /\.(json|js|css|html|svg|webmanifest|map)$/;
let saved = 0;
function precompress(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) {
      precompress(file);
      continue;
    }
    if (!compressible.test(name) || name.endsWith('.map')) continue;
    const raw = readFileSync(file);
    if (raw.length < 1024) continue;
    const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    writeFileSync(`${file}.br`, br);
    writeFileSync(`${file}.gz`, gzipSync(raw, { level: 9 }));
    saved += raw.length - br.length;
  }
}
precompress(join(dist, 'data'));
precompress(join(dist, 'public'));
console.log(`pre-compressed assets (${(saved / 1e6).toFixed(1)} MB saved with brotli)`);
console.log('server bundle ready in dist/');
