import { createHash } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { normalizeName, validateName } from '@geolearn/shared/protocol';
import type { DbHandle } from './db/client';
import { players } from './db/schema';

export type ClaimResult =
  | { ok: true; id: string; name: string }
  | { ok: false; code: 'name-invalid' | 'name-taken'; message: string };

export function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(`geolearn:${token}`).digest('hex');
}

/**
 * First come, first served usernames. A random token kept in the player's
 * browser proves ownership; nobody else can play under that name.
 */
export class PlayerDirectory {
  constructor(private readonly handle: DbHandle) {}

  async claim(rawName: string, token: string): Promise<ClaimResult> {
    const problem = validateName(rawName);
    if (problem) return { ok: false, code: 'name-invalid', message: problem };
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) {
      return { ok: false, code: 'name-invalid', message: 'Missing device token' };
    }
    const name = normalizeName(rawName);
    const key = nameKey(name);
    const tokenHash = hashToken(token);
    const { db } = this.handle;

    for (let attempt = 0; attempt < 2; attempt++) {
      const [existing] = await db.select().from(players).where(eq(players.nameKey, key)).limit(1);
      if (existing) {
        if (existing.tokenHash !== tokenHash) {
          return { ok: false, code: 'name-taken', message: 'That name is already taken' };
        }
        await db.update(players).set({ name, lastSeenAt: new Date() }).where(eq(players.id, existing.id));
        return { ok: true, id: existing.id, name };
      }
      try {
        const [row] = await db.insert(players).values({ name, nameKey: key, tokenHash }).returning({ id: players.id });
        return { ok: true, id: row.id, name };
      } catch {
        // Lost a race for the same name; loop once to re-check ownership.
      }
    }
    return { ok: false, code: 'name-taken', message: 'That name is already taken' };
  }

  async isAvailable(rawName: string, token?: string): Promise<boolean> {
    const key = nameKey(rawName);
    const [existing] = await this.handle.db.select().from(players).where(eq(players.nameKey, key)).limit(1);
    if (!existing) return true;
    return token ? existing.tokenHash === hashToken(token) : false;
  }

  async count(): Promise<number> {
    const [row] = await this.handle.db.select({ n: count() }).from(players);
    return Number(row?.n ?? 0);
  }
}
