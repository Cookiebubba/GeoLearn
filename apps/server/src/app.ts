import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { z } from 'zod';
import { isPuzzleId, PUZZLES } from '@geolearn/shared/puzzles';
import { normalizeRoomCode } from '@geolearn/shared/protocol';
import type { ServerConfig } from './config';
import { openDatabase, type DbHandle } from './db/client';
import { PlayerDirectory } from './players';
import { PuzzleLibrary } from './puzzles';
import { ResultsStore } from './results';
import { handleConnection } from './rooms/connection';
import { RoomManager } from './rooms/manager';

export interface App {
  fastify: FastifyInstance;
  rooms: RoomManager;
  db: DbHandle;
  close(): Promise<void>;
}

export async function buildApp(config: ServerConfig): Promise<App> {
  const fastify = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
  });

  const db = await openDatabase({
    databaseUrl: config.databaseUrl,
    dataDir: config.dataDir,
    ssl: config.databaseSsl,
    migrationsDir: config.migrationsDir,
    warn: (m) => fastify.log.warn(m),
  });
  fastify.log.info(`database: ${db.kind}${db.kind === 'pglite' ? ` (${config.dataDir})` : ''}`);

  const players = new PlayerDirectory(db);
  const results = new ResultsStore(db);
  const puzzles = new PuzzleLibrary(config.puzzleDir).loadAll();
  const now = () => Date.now();
  const rooms = new RoomManager({ puzzles, results, log: fastify.log, now });

  // Dynamic responses are compressed on the fly; big static files ship pre-compressed.
  await fastify.register(fastifyCompress, { global: true, threshold: 1024, encodings: ['br', 'gzip'], brotliOptions: { params: { 1: 5 } } });
  await fastify.register(fastifyWebsocket, { options: { maxPayload: 16 * 1024 } });

  fastify.get('/ws', { websocket: true }, (socket) => {
    handleConnection(socket, { rooms, players, now, log: fastify.log });
  });

  // ── REST ────────────────────────────────────────────────────────────────
  fastify.get('/api/health', async () => ({ ok: true, db: db.kind, rooms: rooms.size }));

  fastify.get('/api/stats', async () => {
    const totals = await results.totals();
    return { online: rooms.onlinePlayers(), rooms: rooms.size, players: await players.count(), ...totals };
  });

  const claimBody = z.object({ name: z.string().max(64), token: z.string().min(16).max(128) });
  fastify.post('/api/players/claim', async (req, reply) => {
    const body = claimBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, code: 'bad-request', message: 'Invalid request' });
    const res = await players.claim(body.data.name, body.data.token);
    if (!res.ok) return reply.code(res.code === 'name-taken' ? 409 : 400).send(res);
    return { ok: true, name: res.name };
  });

  fastify.get('/api/rooms/open', async () => ({ rooms: rooms.openRooms() }));

  fastify.get<{ Params: { code: string } }>('/api/rooms/:code', async (req, reply) => {
    const room = rooms.get(normalizeRoomCode(req.params.code));
    if (!room) return reply.code(404).send({ ok: false, code: 'room-not-found' });
    return {
      ok: true,
      code: room.code,
      settings: room.settings,
      status: room.status,
      players: room.slots.size,
      host: room.host?.info.name ?? null,
    };
  });

  const boardQuery = z.object({
    kind: z.enum(['fastest', 'precision', 'points', 'alltime']).default('fastest'),
    puzzle: z.string().refine(isPuzzleId).default('europe'),
    party: z.enum(['solo', 'duo', 'quad']).default('solo'),
    period: z.enum(['all', 'week']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });
  fastify.get('/api/leaderboard', async (req, reply) => {
    const q = boardQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ ok: false, code: 'bad-request' });
    const { kind, puzzle, party, period, limit } = q.data;
    const entries = await results.leaderboard(kind, puzzle as never, party, period, limit);
    reply.header('cache-control', 'public, max-age=10');
    return { kind, puzzle, party, period, entries };
  });

  fastify.get('/api/puzzles', async () => ({ puzzles: PUZZLES }));

  // ── Static: puzzle data, and the built web client in production ─────────
  await fastify.register(fastifyStatic, {
    root: config.puzzleDir,
    prefix: '/data/puzzles/',
    decorateReply: false,
    maxAge: '7d',
    immutable: false,
    preCompressed: true,
  });

  if (config.webDist && existsSync(config.webDist)) {
    await fastify.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      wildcard: false,
      preCompressed: true,
      setHeaders(reply, path) {
        if (/[\\/]assets[\\/]/.test(path)) reply.header('cache-control', 'public, max-age=31536000, immutable');
      },
    });
    // Single-page app: unknown non-API routes render index.html.
    fastify.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws') && !req.url.startsWith('/data')) {
        return reply.header('cache-control', 'no-cache').sendFile('index.html', config.webDist!);
      }
      return reply.code(404).send({ ok: false, code: 'not-found' });
    });
  }

  return {
    fastify,
    rooms,
    db,
    async close() {
      rooms.close();
      await fastify.close();
      await db.close();
    },
  };
}
