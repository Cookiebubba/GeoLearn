import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export interface ServerConfig {
  port: number;
  host: string;
  /** Postgres connection string. When absent an embedded PGlite database is used. */
  databaseUrl: string | undefined;
  /** Where embedded PGlite keeps its files (":memory:" for tests). */
  dataDir: string;
  /** Built web client to serve (production). */
  webDist: string | undefined;
  /** Puzzle JSON directory. */
  puzzleDir: string;
  /** SQL migrations directory. */
  migrationsDir: string;
  /** Postgres SSL for hosted providers (Supabase, Railway external URLs). */
  databaseSsl: boolean;
  logLevel: string;
  trustProxy: boolean;
}

/**
 * Paths are resolved relative to this file so the same code works from
 * `src/` (tsx in development) and from the bundled `dist/` (production).
 */
export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const root = resolve(HERE, '..');
  const repo = resolve(root, '..', '..');
  const bundled = HERE.endsWith('dist');
  const defaults: ServerConfig = {
    port: Number(env('PORT', '8787')),
    host: env('HOST', '0.0.0.0')!,
    databaseUrl: env('DATABASE_URL'),
    dataDir: env('DATA_DIR', join(repo, '.data', 'pglite'))!,
    webDist: env('WEB_DIST', bundled ? join(HERE, 'public') : undefined),
    puzzleDir: env('PUZZLE_DIR', bundled ? join(HERE, 'data', 'puzzles') : join(repo, 'packages', 'shared', 'data', 'puzzles'))!,
    migrationsDir: env('MIGRATIONS_DIR', bundled ? join(HERE, 'drizzle') : join(root, 'drizzle'))!,
    databaseSsl: env('DATABASE_SSL', 'false') === 'true',
    logLevel: env('LOG_LEVEL', 'info')!,
    trustProxy: env('TRUST_PROXY', 'true') === 'true',
  };
  return { ...defaults, ...overrides };
}
