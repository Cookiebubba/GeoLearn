/** Downloads the Natural Earth source layers into packages/geo/cache/. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '..', 'cache');
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const FILES = ['ne_10m_admin_0_countries', 'ne_10m_admin_0_countries_deu'];

mkdirSync(CACHE, { recursive: true });
for (const name of FILES) {
  const target = join(CACHE, `${name}.geojson`);
  if (existsSync(target) && !process.argv.includes('--force')) {
    console.log(`✓ ${name} (cached)`);
    continue;
  }
  const res = await fetch(`${BASE}/${name}.geojson`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log(`↓ ${name}`);
}
