import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import type { ClientMsg, ServerMsg } from '@geolearn/shared/protocol';
import { buildApp, type App } from '../src/app';
import { loadConfig } from '../src/config';

let app: App;
let base: string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ dataDir: ':memory:', databaseUrl: undefined, logLevel: 'silent', webDist: undefined }));
  await app.fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.fastify.server.address() as AddressInfo;
  base = `127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
});

class Client {
  ws: WebSocket;
  inbox: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  you = '';
  session = '';

  constructor(
    readonly name: string,
    readonly token = `token-${name}-0123456789abcdef`,
  ) {
    this.ws = new WebSocket(`ws://${base}/ws`);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as ServerMsg;
      if (msg.t === 'welcome') {
        this.you = msg.you;
        this.session = msg.session;
      }
      const i = this.waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.inbox.push(msg);
    });
  }

  open() {
    return new Promise<void>((res, rej) => {
      if (this.ws.readyState === 1) return res();
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }

  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 5000): Promise<Extract<ServerMsg, { t: T }>> {
    const match = (m: ServerMsg) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>);
    const i = this.inbox.findIndex(match);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: timed out waiting for ${t}`)), ms);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMsg, { t: T }>);
        },
      });
    });
  }

  close() {
    this.ws.close();
  }
}

async function http(path: string, init?: RequestInit) {
  const res = await fetch(`http://${base}${path}`, init);
  return { status: res.status, body: (await res.json()) as any };
}

describe('server', () => {
  it('reports health', async () => {
    const { body } = await http('/api/health');
    expect(body.ok).toBe(true);
    expect(body.db).toBe('pglite');
  });

  it('claims usernames first come, first served', async () => {
    const a = await http('/api/players/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', token: 'token-ada-0123456789abcdef' }),
    });
    expect(a.status).toBe(200);
    const again = await http('/api/players/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ada', token: 'token-ada-0123456789abcdef' }),
    });
    expect(again.status).toBe(200);
    const thief = await http('/api/players/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ADA', token: 'token-mallory-0123456789ab' }),
    });
    expect(thief.status).toBe(409);
  });

  it('plays a full duo co-op game with locking, reconnect and results', async () => {
    const host = new Client('Grace');
    const guest = new Client('Linus');
    await Promise.all([host.open(), guest.open()]);

    host.send({ t: 'create', name: host.name, token: host.token, settings: { puzzleId: 'oceania', mode: 'coop', partySize: 2, isPublic: true } });
    const welcome = await host.waitFor('welcome');
    const code = welcome.room.code;
    expect(welcome.room.players).toHaveLength(1);
    expect(welcome.room.players[0].host).toBe(true);

    const open = await http('/api/rooms/open');
    expect(open.body.rooms.map((r: { code: string }) => r.code)).toContain(code);

    guest.send({ t: 'join', name: guest.name, token: guest.token, code: code.toLowerCase() });
    const gw = await guest.waitFor('welcome');
    expect(gw.room.players).toHaveLength(2);
    await host.waitFor('room', (m) => m.room.players.length === 2);

    guest.send({ t: 'start' });
    const notHost = await guest.waitFor('error');
    expect(notHost.code).toBe('not-host');

    host.send({ t: 'start' });
    const counting = await host.waitFor('room', (m) => m.room.status === 'countdown');
    const pieces = counting.room.game!.pieces;
    expect(pieces).toHaveLength(15);
    await host.waitFor('room', (m) => m.room.status === 'playing', 6000);
    await guest.waitFor('room', (m) => m.room.status === 'playing', 6000);

    // Both reach for Australia: only one wins.
    host.send({ t: 'grab', p: 'AUS', m: 'lift' });
    await host.waitFor('grabbed', (m) => m.p === 'AUS');
    guest.send({ t: 'grab', p: 'AUS', m: 'lift' });
    const denied = await guest.waitFor('denied');
    expect(denied.p).toBe('AUS');

    // Moves are relayed to the other player.
    host.send({ t: 'move', p: 'AUS', x: 100, y: 100 });
    const moved = await guest.waitFor('moved', (m) => m.p === 'AUS');
    expect(moved.by).toBe(host.you);

    // Guest drops out and comes back with the same session.
    guest.close();
    await host.waitFor('players', (m) => m.players.some((p) => !p.connected));
    const back = new Client('Linus');
    await back.open();
    back.send({ t: 'join', name: 'Linus', token: back.token, code, session: guest.session });
    const rw = await back.waitFor('welcome');
    expect(rw.you).toBe(guest.you);
    expect(rw.room.status).toBe('playing');

    // Solve: we need the home positions, which come from the puzzle data.
    const data = (await http('/data/puzzles/oceania.json')).body as { pieces: { id: string; target: [number, number]; label: [number, number, number] }[] };
    const homes = new Map(data.pieces.map((p) => [p.id, p.target]));
    const labels = new Map(data.pieces.map((p) => [p.id, p.label]));
    const order = pieces.map((p) => p.id).filter((id) => id !== 'AUS');
    // Host places Australia.
    const aus = homes.get('AUS')!;
    host.send({ t: 'drop', p: 'AUS', x: aus[0] + 0.5, y: aus[1] - 0.5, z: 2 });
    const placed = await back.waitFor('dropped', (m) => m.p === 'AUS');
    expect(placed.placed).toBe(true);

    // A wrong drop onto land is a miss: put New Zealand's label point on Papua New Guinea's.
    const png = homes.get('PNG')!;
    const [plx, ply] = labels.get('PNG')!;
    const [nlx, nly] = labels.get('NZL')!;
    back.send({ t: 'grab', p: 'NZL', m: 'lift' });
    await back.waitFor('grabbed', (m) => m.p === 'NZL');
    back.send({ t: 'drop', p: 'NZL', x: png[0] + plx - nlx, y: png[1] + ply - nly, z: 2 });
    const miss = await back.waitFor('dropped', (m) => m.p === 'NZL');
    expect(miss.placed).toBe(false);

    for (const [i, id] of order.entries()) {
      const c = i % 2 === 0 ? host : back;
      const [x, y] = homes.get(id)!;
      c.send({ t: 'grab', p: id, m: 'slide' });
      await c.waitFor('grabbed', (m) => m.p === id);
      c.send({ t: 'drop', p: id, x, y, z: 3 });
      const d = await c.waitFor('dropped', (m) => m.p === id);
      expect(d.placed, id).toBe(true);
    }

    const fin = await host.waitFor('finished');
    expect(fin.results.completed).toBe(true);
    expect(fin.results.playerCount).toBe(2);
    expect(fin.results.players.find((p) => p.name === 'Linus')!.misses).toBe(1);

    const withBoards = await host.waitFor('room', (m) => !!m.room.results?.leaderboard);
    const fastest = withBoards.room.results!.leaderboard!.find((l) => l.board === 'fastest')!;
    expect(fastest.rank).toBe(1);

    const lb = await http('/api/leaderboard?kind=fastest&puzzle=oceania&party=duo');
    expect(lb.body.entries).toHaveLength(1);
    expect(lb.body.entries[0].names).toBe('Grace & Linus');

    const all = await http('/api/leaderboard?kind=alltime');
    expect(all.body.entries.length).toBe(2);

    // Rematch returns everyone to the lobby.
    host.send({ t: 'rematch' });
    await back.waitFor('room', (m) => m.room.status === 'lobby');
    host.close();
    back.close();
  });

  it('runs a versus game and ranks by points', async () => {
    const a = new Client('Mae');
    const b = new Client('Otto');
    await Promise.all([a.open(), b.open()]);
    a.send({ t: 'create', name: a.name, token: a.token, settings: { puzzleId: 'south-america', mode: 'versus', partySize: 2, isPublic: false } });
    const { room } = await a.waitFor('welcome');
    b.send({ t: 'join', name: b.name, token: b.token, code: room.code });
    await b.waitFor('welcome');
    a.send({ t: 'start' });
    await a.waitFor('room', (m) => m.room.status === 'playing', 6000);
    const data = (await http('/data/puzzles/south-america.json')).body as { pieces: { id: string; target: [number, number] }[] };
    for (const [i, p] of data.pieces.entries()) {
      const c = i < 10 ? a : b;
      c.send({ t: 'grab', p: p.id, m: 'lift' });
      await c.waitFor('grabbed', (m) => m.p === p.id);
      c.send({ t: 'drop', p: p.id, x: p.target[0], y: p.target[1], z: 1 });
      await c.waitFor('dropped', (m) => m.p === p.id);
    }
    const fin = await b.waitFor('finished');
    expect(fin.results.winners).toEqual([a.you]);
    const pts = await b.waitFor('room', (m) => !!m.room.results?.leaderboard);
    expect(pts.room.results!.leaderboard![0].board).toBe('points');
    const lb = await http('/api/leaderboard?kind=points&puzzle=south-america&party=duo');
    expect(lb.body.entries[0].names).toBe('Mae');
    a.close();
    b.close();
  });

  it('rejects stolen names and unknown rooms over the socket', async () => {
    const c = new Client('Grace', 'token-not-grace-0123456789');
    await c.open();
    c.send({ t: 'join', name: 'Grace', token: c.token, code: 'ZZZZZ' });
    const err = await c.waitFor('error');
    expect(err.code).toBe('name-taken');
    c.send({ t: 'join', name: 'Someone', token: c.token, code: 'ZZZZZ' });
    const err2 = await c.waitFor('error');
    expect(err2.code).toBe('room-not-found');
    c.close();
  });
});
