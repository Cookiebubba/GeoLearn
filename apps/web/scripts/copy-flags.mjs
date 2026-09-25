// Copies the flag SVGs GeoLearn needs from `flag-icons` into public/flags/.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3');
const out = join(here, '..', 'public', 'flags');
mkdirSync(out, { recursive: true });

const countries = readFileSync(join(here, '..', '..', '..', 'packages', 'shared', 'src', 'geo', 'countries.ts'), 'utf8');
const codes = [...countries.matchAll(/\['[A-Z]{3}', '([a-z]{2})'/g)].map((m) => m[1]);
let copied = 0;
for (const code of new Set(codes)) {
  const from = join(src, `${code}.svg`);
  if (!existsSync(from)) {
    console.warn(`no flag for ${code}`);
    continue;
  }
  copyFileSync(from, join(out, `${code}.svg`));
  copied++;
}
console.log(`flags: ${copied} copied`);
