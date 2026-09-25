import { mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import * as schema from './schema';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Database;
  kind: 'postgres' | 'pglite';
  /** Runs raw SQL and returns plain rows, whichever driver is active. */
  rows<T>(query: SQL): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Connects to Postgres when DATABASE_URL is set (Railway, Supabase, your own
 * server…) and otherwise falls back to an embedded PGlite database on disk, so
 * `npm run dev` works with zero setup. Both run the same SQL migrations.
 */
export async function openDatabase(opts: {
  databaseUrl?: string;
  dataDir: string;
  ssl?: boolean;
  migrationsDir: string;
}): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({
      connectionString: opts.databaseUrl,
      max: 10,
      ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    });
    const db = drizzle({ client: pool, schema });
    await migrate(db, { migrationsFolder: opts.migrationsDir });
    return {
      db: db as unknown as Database,
      kind: 'postgres',
      rows: async <T>(q: SQL) => (await db.execute(q)).rows as T[],
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const memory = opts.dataDir === ':memory:';
  if (!memory) mkdirSync(opts.dataDir, { recursive: true });
  const client = memory ? new PGlite() : new PGlite(opts.dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: opts.migrationsDir });
  return {
    db: db as unknown as Database,
    kind: 'pglite',
    rows: async <T>(q: SQL) => (await db.execute(q)).rows as T[],
    close: () => client.close(),
  };
}
